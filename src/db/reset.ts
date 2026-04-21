/**
 * db/reset.ts — destructive reset pipeline.
 *
 * Source of truth: CLAUDE.md Appendix I (Reset & Data Wipe Behaviour).
 *
 * The reset flow is a single, irreversible operation that returns the
 * device to a fresh-install state. It is the only supported way to
 * "start over" because amban is local-only — there is no server to
 * re-download data from and no account to sign back into.
 *
 * Ordered steps (every step MUST run, even if an earlier one fails):
 *   1. Cancel every scheduled local notification across all ID ranges
 *      (daily prompt, upcoming payments, salary nudges, and the
 *      reserved future ranges documented in Appendix E).
 *   2. Wipe the SQLite database. This closes the connection, deletes
 *      the file, and resets the migration bookkeeping so the next
 *      `getDb()` call re-applies every migration from scratch.
 *   3. Clear every amban-scoped preference key. We do NOT call
 *      `Preferences.clear()` — that would wipe keys owned by unrelated
 *      plugins that happen to share the backend storage.
 *   4. Reset every Zustand store so the in-memory state reflects the
 *      clean slate without requiring an app relaunch. The caller is
 *      expected to navigate back to Welcome afterwards (UI concern,
 *      not a DB concern).
 *
 * Design rules:
 *   - Never throw. The reset screen's contract with the user is
 *     "tapping RESET makes the app forget you" — a partial failure
 *     must not leave the app wedged. We log every step and continue.
 *   - The UI layer is responsible for the type-to-confirm gate
 *     (Appendix I) and for the destructive haptic. This module is
 *     strictly the plumbing.
 *   - Store resets are done by calling each store's own `reset()`
 *     method, not by rebuilding the stores from scratch. The stores
 *     already expose that hook for exactly this reason.
 *   - The notifications cancellation path is best-effort: if the
 *     plugin isn't available (web dev), we skip it silently. A
 *     missing notification schedule is never a blocker for a wipe.
 */

import { LocalNotifications } from "@capacitor/local-notifications";

import { useDailyStore } from "../stores/dailyStore";
import { useFinanceStore } from "../stores/financeStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useUserStore } from "../stores/userStore";

import { wipeDb } from "./db";
import { prefs } from "./preferences";

/**
 * Outcome of a reset attempt. Every step reports individually so the
 * caller (the Settings screen) can surface a diagnostic if something
 * went wrong — though in practice a reset that "mostly worked" still
 * leaves the app in a fresh-enough state to use.
 */
export interface ResetResult {
  /** True when every step succeeded without throwing. */
  ok: boolean;
  /** True when scheduled notifications were cancelled successfully. */
  notificationsCancelled: boolean;
  /** True when the SQLite database was wiped successfully. */
  databaseWiped: boolean;
  /** True when Capacitor Preferences were cleared successfully. */
  preferencesCleared: boolean;
  /** True when in-memory Zustand stores were reset successfully. */
  storesReset: boolean;
  /**
   * Per-step error messages. Keys match the boolean fields above.
   * Populated only for steps that threw; successful steps are absent.
   */
  errors: Partial<Record<"notifications" | "database" | "preferences" | "stores", string>>;
}

/* ------------------------------------------------------------------
 * Step 1 — cancel every scheduled local notification
 *
 * Per Appendix E the ID space is partitioned into ranges:
 *   1000             → daily prompt
 *   2000..2999       → upcoming recurring payments
 *   3000..3999       → salary day nudges
 *   4000..4999       → reserved (future)
 *
 * The plugin's `getPending()` returns every currently-scheduled
 * notification, which is the cleanest way to cancel the full set
 * without having to know which specific IDs we last assigned.
 * ------------------------------------------------------------------ */

async function cancelAllScheduledNotifications(): Promise<void> {
  let pending: { notifications: { id: number }[] };
  try {
    pending = await LocalNotifications.getPending();
  } catch (error) {
    // On web the plugin is a stub that may throw — treat as "nothing
    // scheduled" because nothing could have been scheduled anyway.
    console.warn("[amban.reset] getPending failed, skipping cancel:", error);
    return;
  }

  if (!pending?.notifications || pending.notifications.length === 0) return;

  try {
    await LocalNotifications.cancel({
      notifications: pending.notifications.map((n) => ({ id: n.id })),
    });
  } catch (error) {
    console.warn("[amban.reset] cancel() failed:", error);
    throw error;
  }
}

/* ------------------------------------------------------------------
 * Step 4 — reset every Zustand store
 *
 * Each store exposes a `reset()` method that returns it to its
 * INITIAL_STATE and flips `hydrated` back to true so consumers
 * re-render with empty data rather than the stale post-onboarding
 * state. We call them inside getState() to avoid spinning up any
 * components that might be listening during the wipe.
 * ------------------------------------------------------------------ */

function resetAllStores(): void {
  useUserStore.getState().reset();
  useFinanceStore.getState().reset();
  useDailyStore.getState().reset();
  useSettingsStore.getState().reset();
}

/* ------------------------------------------------------------------
 * Public entry point
 * ------------------------------------------------------------------ */

/**
 * Runs the full reset pipeline. Returns a structured result describing
 * which steps succeeded. Never throws — the worst case is an object
 * with `ok: false` and populated `errors`.
 *
 * The caller (Settings → Reset App, Appendix I) is responsible for:
 *   - The type-to-confirm gate (user types `RESET`).
 *   - The destructive haptic (`haptics.error()` from utils/haptics).
 *   - Navigating to the Welcome screen once this resolves.
 *   - Displaying any residual diagnostic from the returned `errors`.
 */
export async function resetApp(): Promise<ResetResult> {
  const result: ResetResult = {
    ok: true,
    notificationsCancelled: false,
    databaseWiped: false,
    preferencesCleared: false,
    storesReset: false,
    errors: {},
  };

  // Step 1 — notifications. Runs first so no stale prompt can fire
  // against a half-wiped database moments later.
  try {
    await cancelAllScheduledNotifications();
    result.notificationsCancelled = true;
  } catch (error) {
    result.ok = false;
    result.errors.notifications = error instanceof Error ? error.message : String(error);
  }

  // Step 2 — SQLite. Closes the connection, deletes the file, resets
  // the migration bookkeeping. The next getDb() call will rebuild the
  // schema from migration 001.
  try {
    await wipeDb();
    result.databaseWiped = true;
  } catch (error) {
    result.ok = false;
    result.errors.database = error instanceof Error ? error.message : String(error);
  }

  // Step 3 — Preferences. Remove only the amban-scoped keys; the
  // facade enumerates them so nothing else gets touched.
  try {
    await prefs.clearAll();
    result.preferencesCleared = true;
  } catch (error) {
    result.ok = false;
    result.errors.preferences = error instanceof Error ? error.message : String(error);
  }

  // Step 4 — Zustand. Synchronous, can't really fail, but we wrap
  // defensively so a future store with async reset semantics doesn't
  // silently break the pipeline.
  try {
    resetAllStores();
    result.storesReset = true;
  } catch (error) {
    result.ok = false;
    result.errors.stores = error instanceof Error ? error.message : String(error);
  }

  return result;
}

/**
 * Re-export of `resetApp` under a more intention-revealing name for
 * the Settings screen. Both names refer to the same function; pick
 * whichever reads better at the call site.
 */
export const wipeEverything = resetApp;
