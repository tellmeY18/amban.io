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

interface MigrationDefinition {
  version: number;
  name: string;
  sql: string;
}

/**
 * The full, ordered migration list. Add new entries at the end.
 * Never reorder, never edit a past entry — follow Appendix J.
 */
const MIGRATIONS: ReadonlyArray<MigrationDefinition> = [
  { version: 1, name: "init", sql: migration001 },
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
    try {
      // `transaction: true` asks the plugin to wrap the script in a
      // BEGIN/COMMIT pair and ROLLBACK on any statement error. We pair
      // that with our own persisted version bump so partial application
      // across migrations is impossible.
      await db.execute(migration.sql, /* transaction */ true);
      await migrationFlags.setVersion(migration.version);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Migration ${migration.version} (${migration.name}) failed: ${message}`);
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
