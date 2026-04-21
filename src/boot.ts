/**
 * boot.ts — application boot orchestrator.
 *
 * Source of truth: CLAUDE.md §4 (App Architecture), §12 (Local Storage
 * Strategy), Appendix I (Reset & Data Wipe Behaviour), and Appendix J
 * (Migration Strategy).
 *
 * Responsibilities:
 *   - Open the SQLite database and apply every pending migration inside
 *     a single transaction (via db.getDb()).
 *   - Hydrate every Zustand store from SQLite in parallel so the first
 *     screen render sees fully-populated state.
 *   - Surface a structured BootResult describing which stage succeeded
 *     or failed, so the app root can decide between:
 *       a. Normal render (BootStage.Ready)
 *       b. The migration-failure / reset escape hatch (BootStage.MigrationFailed)
 *       c. A generic unexpected-error screen (BootStage.UnexpectedError)
 *
 * Design rules:
 *   - Boot never throws. Every failure is caught and represented as a
 *     BootResult so the root UI can always render SOMETHING. A thrown
 *     boot leaves the user with a white screen, which is unacceptable
 *     for a local-only app with no recovery channel.
 *   - Boot is idempotent. Calling it more than once (e.g. after the
 *     user taps "Retry" from the error screen) is safe: getDb() is
 *     memoised, stores self-replace on re-hydrate, and notifications
 *     aren't scheduled from here.
 *   - Boot does NOT schedule notifications, mount the theme, or touch
 *     the router. Those concerns live in their own modules (Phase 12,
 *     ThemeProvider, App.tsx respectively). Keeping the orchestrator
 *     laser-focused on persistence + state keeps Phase 3/4 verifiable
 *     without pulling in every later phase.
 *   - Boot has ONE public entry point: bootstrapApp(). The rest of the
 *     exports are the result types consumers type against.
 *
 * Execution order (must stay in this order):
 *   1. DB open + migrations   — nothing else can proceed without it.
 *   2. Store hydration        — parallel; all four stores read slices
 *                               of SQLite that are independent of
 *                               each other's hydration order.
 *   3. Done.                  — the app is now "ready". Rendering can
 *                               proceed against real data.
 */

import { getDb, getMigrationError, isMigrationFailed } from "./db/db";
import { useDailyStore } from "./stores/dailyStore";
import { useFinanceStore } from "./stores/financeStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useUserStore } from "./stores/userStore";

/**
 * Stages of the boot pipeline. Surfaced in BootResult so the app root
 * can pick the right render branch without having to introspect the
 * error message.
 */
export const BootStage = {
  /** Fresh slate — nothing has run yet. */
  Idle: "idle",
  /** Opening SQLite + applying migrations. */
  Database: "database",
  /** Pulling state out of SQLite into every Zustand store. */
  Hydration: "hydration",
  /** All stages succeeded; the UI can render real data. */
  Ready: "ready",
  /**
   * Migration runner failed or detected a prior failure flag. The UI
   * must render the escape-hatch screen (Appendix I) and offer only
   * "Reset App" as a forward path — no normal screens are safe.
   */
  MigrationFailed: "migration-failed",
  /**
   * A stage other than migrations threw unexpectedly. The UI should
   * render a generic error with the captured message and a retry
   * affordance. Rare — most failures we care about are classified as
   * MigrationFailed above.
   */
  UnexpectedError: "unexpected-error",
} as const;

export type BootStage = (typeof BootStage)[keyof typeof BootStage];

/**
 * Structured result of a boot attempt. Never throws — a thrown boot
 * is a bug, not a normal failure mode.
 */
export interface BootResult {
  /** Terminal stage reached. Drives the app root's render choice. */
  stage: BootStage;
  /** Wall-clock milliseconds the whole pipeline took. Useful for perf. */
  durationMs: number;
  /**
   * When `stage` is MigrationFailed or UnexpectedError, a human-
   * readable message the UI can render verbatim. Null in the happy
   * path.
   */
  error: string | null;
  /**
   * Per-stage success flags. Useful for diagnostics and for the
   * dev-only inspector. Order mirrors the execution order above.
   */
  stages: {
    database: boolean;
    hydration: boolean;
  };
}

/**
 * Default, zero-ed result. Mutated in place by the pipeline so the
 * shape is always consistent — even a very early failure returns a
 * fully-populated BootResult.
 */
function initialResult(): BootResult {
  return {
    stage: BootStage.Idle,
    durationMs: 0,
    error: null,
    stages: {
      database: false,
      hydration: false,
    },
  };
}

/**
 * Normalise any thrown value to a string the UI can render. Error
 * instances drop to `.message`; everything else is stringified. We
 * intentionally keep this terse — the error boundary is the place
 * for stack traces, not the boot result.
 */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/* ------------------------------------------------------------------
 * Stage 1 — database + migrations
 *
 * `getDb()` opens the connection and applies every pending migration
 * inside a single transaction. It also persists any failure to
 * Capacitor Preferences (see db/db.ts → migrationFlags), so even a
 * hard crash mid-run leaves a breadcrumb for the next boot.
 *
 * We check the "prior failure" flag BEFORE calling getDb() so a
 * previously-broken install can present the escape hatch immediately
 * without retrying a migration that's already known to fail.
 * ------------------------------------------------------------------ */

async function runDatabaseStage(result: BootResult): Promise<boolean> {
  result.stage = BootStage.Database;

  // Respect a persisted failure flag from a prior boot. getDb() would
  // re-attempt the migrations otherwise and likely fail again in the
  // same way — better to short-circuit to the escape hatch.
  if (await isMigrationFailed()) {
    const prior = await getMigrationError();
    result.stage = BootStage.MigrationFailed;
    result.error = prior ?? "Migrations previously failed. Reset the app to start fresh.";
    return false;
  }

  try {
    await getDb();
    result.stages.database = true;
    return true;
  } catch (error) {
    result.stage = BootStage.MigrationFailed;
    result.error = messageOf(error);
    return false;
  }
}

/* ------------------------------------------------------------------
 * Stage 2 — store hydration
 *
 * Every store exposes an async hydrate() that reads its slice of
 * SQLite and flips `hydrated: true`. Running them in parallel is
 * safe: the four tables they touch are independent of each other,
 * and SQLite handles concurrent reads natively.
 *
 * A single store failing is treated as an unexpected error — the
 * authoritative data is intact but something in our mapping code
 * regressed. The user is pushed to the generic error screen rather
 * than the destructive reset flow, because a reset would throw away
 * real data for what is usually a code-level fix.
 * ------------------------------------------------------------------ */

async function runHydrationStage(result: BootResult): Promise<boolean> {
  result.stage = BootStage.Hydration;

  try {
    await Promise.all([
      useSettingsStore.getState().hydrate(),
      useUserStore.getState().hydrate(),
      useFinanceStore.getState().hydrate(),
      useDailyStore.getState().hydrate(),
    ]);
    result.stages.hydration = true;
    return true;
  } catch (error) {
    result.stage = BootStage.UnexpectedError;
    result.error = messageOf(error);
    return false;
  }
}

/* ------------------------------------------------------------------
 * Public entry point
 * ------------------------------------------------------------------ */

/**
 * Runs the full boot pipeline. Returns a BootResult describing the
 * outcome — never throws.
 *
 * Typical usage (from main.tsx or App.tsx):
 *
 *   const result = await bootstrapApp();
 *   if (result.stage === BootStage.Ready) {
 *     mountApp();
 *   } else if (result.stage === BootStage.MigrationFailed) {
 *     mountMigrationFailureScreen(result.error);
 *   } else {
 *     mountGenericErrorScreen(result.error);
 *   }
 *
 * Safe to call multiple times. getDb() is memoised, and each store's
 * hydrate() simply replaces its slice with a fresh read from SQLite,
 * which is exactly what a retry path needs.
 */
export async function bootstrapApp(): Promise<BootResult> {
  const start = performance.now();
  const result = initialResult();

  // Stage 1 — database + migrations. Short-circuits if the runner
  // already reported a failure on a previous launch.
  const dbOk = await runDatabaseStage(result);
  if (!dbOk) {
    result.durationMs = performance.now() - start;
    return result;
  }

  // Stage 2 — Zustand store hydration.
  const hydrationOk = await runHydrationStage(result);
  if (!hydrationOk) {
    result.durationMs = performance.now() - start;
    return result;
  }

  // All clear.
  result.stage = BootStage.Ready;
  result.durationMs = performance.now() - start;
  return result;
}

/**
 * Dev/test helper — returns true when every store reports `hydrated`.
 * Cheap to call; purely reads already-in-memory flags. Not part of
 * the production render path; the style-guide inspector consumes this
 * to show a green check when the pipeline is done.
 */
export function isFullyHydrated(): boolean {
  return (
    useSettingsStore.getState().hydrated &&
    useUserStore.getState().hydrated &&
    useFinanceStore.getState().hydrated &&
    useDailyStore.getState().hydrated
  );
}
