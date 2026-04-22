/**
 * db/db.ts — SQLite connection singleton + migration runner.
 *
 * Source of truth: CLAUDE.md §5 (Data Models), §12 (Local Storage Strategy),
 * and Appendix J (Migration Strategy).
 *
 * Responsibilities:
 *   - Initialize @capacitor-community/sqlite across three environments:
 *       1. Native iOS  — the plugin talks to the system SQLite.
 *       2. Native Android — same plugin, different native binding.
 *       3. Web (Vite dev server) — jeep-sqlite Web Component backed by
 *          sql.js runs in an IndexedDB-persisted memory layer. Dev-only.
 *   - Open the amban database once and memoize the connection.
 *   - Run every pending migration from src/db/migrations/ in numeric
 *     order inside a single transaction. Roll back on failure and
 *     surface the error via preferences so the app root can render the
 *     "reset" escape hatch.
 *   - Expose `getDb()` — the one entry point every repository consumes.
 *   - Expose `closeDb()` and `wipeDb()` for the destructive reset
 *     pipeline (Appendix I) and for app teardown.
 *
 * Rules of the road:
 *   - No repository code lives here. This module is plumbing only.
 *   - Never cache a connection outside this file. Always `await getDb()`
 *     so the memoization + boot-state guards stay authoritative.
 *   - Migration files are imported as raw strings via Vite's `?raw`
 *     suffix. This keeps the SQL in source control (lintable, diffable)
 *     without needing a fs.readFile shim on web.
 *   - Every migration file is immutable once shipped. Add a new
 *     numbered file; never edit an existing one.
 */

import { Capacitor } from "@capacitor/core";
import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from "@capacitor-community/sqlite";

import { migrationFlags } from "./preferences";

/* ------------------------------------------------------------------
 * Migration catalogue
 *
 * Each entry is (version, sql). `version` must be a strictly increasing
 * positive integer — it's what we persist via `migrationFlags.setVersion`
 * once applied. `sql` is the full script, which may contain multiple
 * statements separated by `;` (the plugin's executeSet / execute both
 * support this).
 *
 * Imported via Vite's `?raw` loader so the content ships inside the
 * bundle as a plain string — no fs, no dynamic loader, no surprises.
 * ------------------------------------------------------------------ */

import migration001 from "./migrations/001_init.sql?raw";
import migration002 from "./migrations/002_spend_entries.sql?raw";

interface MigrationDefinition {
  version: number;
  name: string;
  sql: string;
}

/**
 * The full, ordered migration list. Add new entries at the end.
 * Never reorder, never edit a past entry — follow Appendix J.
 *
 * A registered migration is the ONLY way the runner knows a SQL file
 * exists — the file itself living in `migrations/` does nothing on
 * its own. Forgetting to register a shipped migration leaves fresh
 * installs stuck at a lower schema version than the code expects,
 * which is how v0.1.1 first shipped broken for new users: the
 * `spend_entries` table and `daily_logs.confirmed_at` column were
 * authored but never applied, so the rewritten Daily Log screen
 * crashed on the first `INSERT INTO spend_entries`.
 */
const MIGRATIONS: ReadonlyArray<MigrationDefinition> = [
  { version: 1, name: "init", sql: migration001 },
  { version: 2, name: "spend_entries", sql: migration002 },
];

/* ------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------ */

/** Database file name. Kept in one place so nobody can mistype it. */
export const DB_NAME = "amban";

/** SQLite has no concept of "schema version" at the file level; our
 *  migration runner tracks it via Capacitor Preferences. This constant
 *  is the *target* version — the highest number in MIGRATIONS above. */
export const TARGET_SCHEMA_VERSION = MIGRATIONS.reduce(
  (max, m) => (m.version > max ? m.version : max),
  0,
);

/** Fixed app-level storage slot. `encrypted = false` because amban is a
 *  local-only personal finance tracker and we deliberately avoid key
 *  management complexity in v1 (see CLAUDE.md §12 — "No External Calls
 *  Policy" implies no key escrow either). */
const CONNECTION_MODE = "no-encryption" as const;
const CONNECTION_READONLY = false;
const CONNECTION_VERSION = 1;

/* ------------------------------------------------------------------
 * Internal state
 *
 * Module-scoped so the Capacitor SQLite plugin sees exactly one
 * connection attempt per process. Concurrent callers during boot are
 * deduplicated via the `initializing` promise.
 * ------------------------------------------------------------------ */

const sqlite = new SQLiteConnection(CapacitorSQLite);

let connection: SQLiteDBConnection | null = null;
let initializing: Promise<SQLiteDBConnection> | null = null;
let webPlatformInitialized = false;

/* ------------------------------------------------------------------
 * Platform helpers
 * ------------------------------------------------------------------ */

function currentPlatform(): "ios" | "android" | "web" {
  const p = Capacitor.getPlatform();
  if (p === "ios" || p === "android") return p;
  return "web";
}

/**
 * On web, the plugin needs the <jeep-sqlite> Web Component mounted in
 * the DOM and `initWebStore()` called once before any connection open.
 * We do this lazily — the app may run for a while before anything
 * touches the database, and we don't want to front-load a dev-only
 * dependency on production platforms.
 *
 * Lazy-imports jeep-sqlite so native bundles never pull in sql.js (a
 * multi-hundred-KB WASM blob we genuinely do not need on device).
 */
async function ensureWebPlatform(): Promise<void> {
  if (currentPlatform() !== "web") return;
  if (webPlatformInitialized) return;

  // Dynamic import keeps jeep-sqlite out of the native bundles. The
  // `loader` entry point is the framework-agnostic custom-elements
  // registration helper.
  const { defineCustomElements } = await import(/* @vite-ignore */ "jeep-sqlite/loader");
  await defineCustomElements(window);

  // jeep-sqlite expects a <jeep-sqlite> element to exist in the DOM.
  // Add it idempotently — the provider may mount before or after us.
  if (!document.querySelector("jeep-sqlite")) {
    const el = document.createElement("jeep-sqlite");
    document.body.appendChild(el);
  }

  // Wait one microtask so Stencil has a chance to upgrade the element
  // before we ask the plugin to look it up.
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });

  await sqlite.initWebStore();
  webPlatformInitialized = true;
}

/* ------------------------------------------------------------------
 * Connection lifecycle
 * ------------------------------------------------------------------ */

/**
 * Opens the amban database, applies every pending migration inside a
 * single transaction, and returns the memoized connection.
 *
 * Concurrent callers during boot share a single in-flight promise so
 * the connection is never opened twice. Callers after boot see the
 * cached connection instantly.
 *
 * If migrations fail, the error is persisted to Capacitor Preferences
 * (via migrationFlags) and re-thrown. The app root is expected to
 * surface the escape-hatch screen described in Appendix I.
 */
export async function getDb(): Promise<SQLiteDBConnection> {
  if (connection) return connection;
  if (initializing) return initializing;

  initializing = (async () => {
    try {
      await ensureWebPlatform();

      // `isConnection` tells us whether the plugin has cached a
      // connection for this DB name. On hot reload (dev) or app resume
      // this may already be true — in which case `retrieveConnection`
      // avoids a duplicate-open error.
      const existing = await sqlite.isConnection(DB_NAME, CONNECTION_READONLY);
      const db: SQLiteDBConnection = existing.result
        ? await sqlite.retrieveConnection(DB_NAME, CONNECTION_READONLY)
        : await sqlite.createConnection(
            DB_NAME,
            false /* encrypted */,
            CONNECTION_MODE,
            CONNECTION_VERSION,
            CONNECTION_READONLY,
          );

      await db.open();

      // Enforce referential integrity. Cheap to set once per open and
      // keeps future schemas honest when they start adding FKs.
      await db.execute("PRAGMA foreign_keys = ON;");

      await runMigrations(db);

      connection = db;
      return db;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await migrationFlags.markFailed(message);
      // Null out so a retry (after user intervention or reset) can
      // reattempt from a clean slate.
      initializing = null;
      throw error;
    }
  })();

  return initializing;
}

/**
 * Close the active connection. Idempotent — safe to call when the
 * database has never been opened. Used by the destructive reset flow
 * and on app teardown paths.
 */
export async function closeDb(): Promise<void> {
  if (!connection) return;
  try {
    await connection.close();
  } catch (error) {
    // Close failures during teardown are non-fatal. Log and move on.
    console.warn("[amban.db] close() failed:", error);
  }
  try {
    await sqlite.closeConnection(DB_NAME, CONNECTION_READONLY);
  } catch {
    // Same reasoning — teardown is best-effort.
  }
  connection = null;
  initializing = null;
}

/**
 * Destructive wipe. Closes the connection, deletes the database file,
 * and clears our in-memory state. The next call to `getDb()` will open
 * a fresh database and re-run every migration from scratch.
 *
 * Part of the Appendix I reset pipeline. Not exported for general use —
 * always route through the reset helper in src/db/reset.ts (Phase 3).
 */
export async function wipeDb(): Promise<void> {
  try {
    if (connection) {
      await connection.close();
    }
  } catch {
    // Fall through — we're deleting the file anyway.
  }
  try {
    await sqlite.closeConnection(DB_NAME, CONNECTION_READONLY);
  } catch {
    // Ditto.
  }
  try {
    await CapacitorSQLite.deleteDatabase({ database: DB_NAME });
  } catch (error) {
    // A missing database is not an error in the reset context.
    console.warn("[amban.db] deleteDatabase() failed:", error);
  }
  connection = null;
  initializing = null;
  // Reset the migration bookkeeping so the next open re-applies every
  // migration from version 0.
  await migrationFlags.setVersion(0);
  await migrationFlags.markSucceeded();
}

/* ------------------------------------------------------------------
 * Migration runner
 *
 * The contract (Appendix J):
 *   1. Read the persisted schema_version via preferences.
 *   2. Filter MIGRATIONS down to unapplied entries (version > persisted).
 *   3. Apply each, in order, inside a BEGIN/COMMIT transaction. Any
 *      failure triggers ROLLBACK and re-throws — the caller (getDb)
 *      then marks the failure for the error-boundary to pick up.
 *   4. After each successful migration, persist the new schema_version.
 *      This makes mid-run interruptions safe: re-running picks up where
 *      the last successful version left off.
 * ------------------------------------------------------------------ */

/**
 * Strip SQL comments and collapse runs of whitespace so the plugin's
 * statement splitter never has to reason about a `;` that lives
 * inside a comment, and so a migration file can be authored with as
 * much prose as the author wants without worrying about the runner.
 *
 * Why this exists
 * ---------------
 * `@capacitor-community/sqlite`'s `execute(sql, transaction=true)`
 * splits the script on `;` before handing each statement to the
 * native binding. The splitter is intentionally simple — it does
 * NOT track whether a `;` is inside a string literal, a `--` line
 * comment, or a `/* … *\/` block comment. Most migration authors
 * never hit the edge: 001 slipped through fine because its comments
 * were short. But 002 carries long prose comment blocks, a `CHECK`
 * constraint with a paren-wrapped expression (`amount > 0`) sitting
 * right next to a `--` comment, and several `-- …` lines that break
 * up column definitions. On the native Android binding this causes
 * the plugin to hand the C layer a fragment like "amount REAL NOT
 * NULL CHECK (amount > 0)" followed by another fragment starting
 * with ", category TEXT," — which is an unparseable prefix and
 * fails the whole migration with a vague syntax error.
 *
 * The SQL files stay authoritative and immutable (Appendix J); we
 * normalise here in the runner so every migration — past, present,
 * future — gets the same treatment without needing to police comment
 * style in review.
 *
 * Rules
 * -----
 *   - Block comments `/* … *\/` are removed in full, including any
 *     `;` that happens to live inside them.
 *   - Line comments `-- …` are removed from the `--` marker to end
 *     of line, but only when `--` is not inside a single-quoted
 *     string literal. The naive split on `--` would mangle a
 *     legitimate amount like `'10--20'`; our scanner tracks quote
 *     state to avoid that.
 *   - Adjacent blank lines are collapsed; trailing whitespace on
 *     each retained line is stripped. The splitter only cares about
 *     `;`, but tidy input makes any error surface line-number-accurate.
 *
 * This function is a pure string → string transform. No plugin
 * calls, no I/O, no state. The migration SQL we ship stays the
 * source of truth; this is the runner meeting it halfway.
 */
export function stripSqlComments(sql: string): string {
  let out = "";
  const n = sql.length;
  let i = 0;

  // Scanner state. Only one of these can be true at a time; the
  // condition checks below enforce that.
  let inSingleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < n) {
    const ch = sql[i];
    const next = i + 1 < n ? sql[i + 1] : "";

    if (inLineComment) {
      // A line comment ends at the next newline. We drop the
      // comment body but retain the newline so line numbers in any
      // downstream error message line up with the original file.
      if (ch === "\n") {
        inLineComment = false;
        out += "\n";
      }
      i += 1;
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
        continue;
      }
      // Preserve newlines inside block comments so line numbers
      // survive the strip.
      if (ch === "\n") out += "\n";
      i += 1;
      continue;
    }

    if (inSingleQuote) {
      out += ch;
      if (ch === "'") {
        // SQL escapes a single quote by doubling it ('' means a
        // literal quote, not the end of the string).
        if (next === "'") {
          out += next;
          i += 2;
          continue;
        }
        inSingleQuote = false;
      }
      i += 1;
      continue;
    }

    // Not inside any commentary / string — look for openers.
    if (ch === "-" && next === "-") {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (ch === "'") {
      inSingleQuote = true;
      out += ch;
      i += 1;
      continue;
    }

    out += ch;
    i += 1;
  }

  // Collapse any run of blank lines + trim trailing whitespace so the
  // final script is compact without losing statement separators.
  return out
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .filter((line, idx, arr) => {
      if (line.length > 0) return true;
      // Keep at most one consecutive blank line to preserve some
      // visual structure for anyone who `.dump`s the DB. The
      // explicit-undefined guard is for `noUncheckedIndexedAccess`;
      // `idx > 0` already implies the previous index is in bounds.
      const prev = idx > 0 ? arr[idx - 1] : undefined;
      return prev !== undefined && prev.length > 0;
    })
    .join("\n")
    .trim();
}

export async function runMigrations(db: SQLiteDBConnection): Promise<void> {
  const currentVersion = await migrationFlags.getVersion();
  const pending = MIGRATIONS.filter((m) => m.version > currentVersion).sort(
    (a, b) => a.version - b.version,
  );

  if (pending.length === 0) {
    // Clear any prior failure flag — a clean boot is a successful one.
    await migrationFlags.markSucceeded();
    return;
  }

  for (const migration of pending) {
    // Normalise the SQL before handing it to the plugin. See
    // `stripSqlComments` above for why this exists. The original
    // file is still the source of truth — this is runner-side
    // preprocessing, not a rewrite of the shipped migration.
    const cleanSql = stripSqlComments(migration.sql);

    try {
      // `transaction: true` asks the plugin to wrap the script in a
      // BEGIN/COMMIT pair and ROLLBACK on any statement error. We pair
      // that with our own persisted version bump so partial application
      // across migrations is impossible.
      await db.execute(cleanSql, /* transaction */ true);
      await migrationFlags.setVersion(migration.version);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Enrich the error with the migration identity AND the first
      // few lines of the (normalised) SQL so the reset-escape-hatch
      // screen can show a user / developer exactly what went wrong
      // without needing a reproduction step. Truncated to stay within
      // the Preferences blob size budget.
      const preview = cleanSql.slice(0, 500).replace(/\s+/g, " ").trim();
      throw new Error(
        `Migration ${migration.version} (${migration.name}) failed: ${message} — preview: ${preview}${
          cleanSql.length > 500 ? "…" : ""
        }`,
      );
    }
  }

  await migrationFlags.markSucceeded();
}

/* ------------------------------------------------------------------
 * Introspection helpers
 *
 * These exist primarily for the dev-only inspector in the style guide
 * (Phase 2/3) and for diagnostics during boot-failure rendering. They
 * are intentionally thin — nothing here should be consumed by feature
 * code in screens or stores.
 * ------------------------------------------------------------------ */

/**
 * Returns the currently-applied schema version. Works even when the
 * connection is closed — reads from preferences directly.
 */
export async function getAppliedSchemaVersion(): Promise<number> {
  return migrationFlags.getVersion();
}

/**
 * True when the last migration attempt failed and the app should
 * refuse to boot normally. The app root consults this before rendering
 * the authenticated tree so a broken DB never reaches a user flow.
 */
export async function isMigrationFailed(): Promise<boolean> {
  return migrationFlags.isFailed();
}

/**
 * The persisted error message from the last failed migration, or null
 * when everything is clean. Surfaced by the escape-hatch screen so a
 * curious user / developer can see what went wrong before resetting.
 */
export async function getMigrationError(): Promise<string | null> {
  return migrationFlags.getError();
}

/**
 * Lightweight liveness probe. Opens (if needed) and runs a trivial
 * query. Used by the dev inspector; safe to call at any time.
 */
export async function ping(): Promise<boolean> {
  try {
    const db = await getDb();
    const res = await db.query("SELECT 1 AS ok;");
    return res.values?.[0]?.ok === 1;
  } catch {
    return false;
  }
}
