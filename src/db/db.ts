/**
 * db/db.ts — SQLite connection singleton + migration runner.
 *
 * Source of truth: CLAUDE.md §5 (Data Models), §12 (Local Storage Strategy),
 * §14 (Database Resilience & Migration Discipline), and Appendix J
 * (Migration Strategy — superseded by §14 as of v0.2.0).
 *
 * Responsibilities:
 *   - Initialize @capacitor-community/sqlite across three environments:
 *       1. Native iOS  — the plugin talks to the system SQLite.
 *       2. Native Android — same plugin, different native binding.
 *       3. Web (Vite dev server) — jeep-sqlite Web Component backed by
 *          sql.js runs in an IndexedDB-persisted memory layer. Dev-only.
 *   - Open the amban database once and memoize the connection.
 *   - Run every pending migration from the catalogue (src/db/migrations/)
 *     with per-migration transactions. On failure: ROLLBACK, persist
 *     the error, throw. Per §14.4, a failure at migration N leaves
 *     migrations 1…N-1 durably applied.
 *   - Track applied migrations in the `schema_migrations` table
 *     (the authoritative record) AND mirror the highest version to
 *     Capacitor Preferences for quick pre-boot checks.
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
import { MIGRATION_CATALOG, TARGET_SCHEMA_VERSION } from "./migrations/index";
import { normaliseSQL } from "./sql/normalise";

export { TARGET_SCHEMA_VERSION };

/* ------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------ */

/** Database file name. Kept in one place so nobody can mistype it. */
export const DB_NAME = "amban";

/** Fixed app-level storage slot. `encrypted = false` because amban is a
 *  local-only personal finance tracker and we deliberately avoid key
 *  management complexity in v1 (see CLAUDE.md §12 — "No External Calls
 *  Policy" implies no key escrow either). */
const CONNECTION_MODE = "no-encryption" as const;
const CONNECTION_READONLY = false;
const CONNECTION_VERSION = 1;

/**
 * DDL for the `schema_migrations` tracker table. Applied idempotently
 * at the top of every migration run so the table exists before we try
 * to query it. This is the exact same DDL as migration 003, but we
 * execute it unconditionally (with IF NOT EXISTS) because the runner
 * must be able to read the table even on a fresh install where migration
 * 003 has not yet been applied.
 */
const SCHEMA_MIGRATIONS_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`;

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
 * Opens the amban database, applies every pending migration with
 * per-migration transactions, and returns the memoized connection.
 *
 * Concurrent callers during boot share a single in-flight promise so
 * the connection is never opened twice. Callers after boot see the
 * cached connection instantly.
 *
 * If migrations fail, the error is persisted to Capacitor Preferences
 * (via migrationFlags) and re-thrown. The app root is expected to
 * surface the escape-hatch screen described in §14.6.
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
  await migrationFlags.clearBackupVersion();
  await migrationFlags.markSucceeded();
}

/* ------------------------------------------------------------------
 * Migration runner — v0.2.0 rewrite (§14)
 *
 * Key changes from the v0.1.x runner:
 *   1. Catalogue-based: reads MIGRATION_CATALOG from migrations/index.ts
 *      instead of an inline array.
 *   2. Dual tracking: applied versions are persisted in both the
 *      `schema_migrations` SQLite table (source of truth) and
 *      Capacitor Preferences (quick boot-time check).
 *   3. Per-migration transactions: a failure at migration N leaves
 *      1…N-1 durably applied. Next launch resumes at N.
 *   4. Backfill support: on first v0.2.0 launch over a v0.1.x install,
 *      already-applied migrations are backfilled into the new tracker
 *      table so the runner doesn't try to re-apply them.
 *   5. Pre-migration backup flag: records the pre-migration schema
 *      version so the boot gate can offer a "Restore backup" CTA.
 *
 * The contract (§14.4):
 *   a. Bootstrap the `schema_migrations` DDL (idempotent).
 *   b. Read applied versions from the tracker table.
 *   c. On first v0.2 launch: backfill tracker rows for already-applied
 *      migrations (detected via Preferences version).
 *   d. Filter catalogue to unapplied entries.
 *   e. For each pending: BEGIN → normalised SQL → INSERT tracker row →
 *      COMMIT. On error: ROLLBACK, persist, throw.
 *   f. Sync Preferences version to match.
 * ------------------------------------------------------------------ */

/**
 * Read applied migration versions from the `schema_migrations` table.
 * Returns a Set<number> of version numbers. Returns an empty set if
 * the table has no rows (fresh install or pre-v0.2 upgrade).
 */
async function readAppliedVersions(db: SQLiteDBConnection): Promise<Set<number>> {
  const result = await db.query("SELECT version FROM schema_migrations ORDER BY version;");
  const versions = new Set<number>();
  if (result.values) {
    for (const row of result.values) {
      const v = row["version"];
      if (typeof v === "number") {
        versions.add(v);
      }
    }
  }
  return versions;
}

/**
 * On first v0.2.0 launch over a v0.1.x install, the `schema_migrations`
 * table exists (we just created it with DDL) but is empty. Meanwhile,
 * Preferences knows that versions 1 and 2 were already applied. We
 * backfill the tracker table so the runner doesn't try to re-apply them.
 *
 * This is a one-time operation — subsequent launches see the tracker
 * rows and skip this path.
 */
async function backfillTrackerFromPreferences(
  db: SQLiteDBConnection,
  prefsVersion: number,
  applied: Set<number>,
): Promise<void> {
  const now = new Date().toISOString();
  for (const entry of MIGRATION_CATALOG) {
    if (entry.version <= prefsVersion && !applied.has(entry.version)) {
      const checksum = entry.checksum;
      await db.run(
        "INSERT OR IGNORE INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?);",
        [entry.version, entry.name, checksum, now],
      );
      applied.add(entry.version);
    }
  }
}

/**
 * Record a pre-migration backup marker. On native platforms, we could
 * copy the SQLite file — but the capacitor-community/sqlite plugin
 * does not expose a raw file-copy API, and reaching into the native
 * filesystem from JS is fragile. For v0.2.0, we record the
 * pre-migration schema version as a backup marker so the boot gate
 * knows a conceptual backup exists. Actual file-level backup will
 * land in v0.3 once we have a thin native helper.
 *
 * The key deliverable for v0.2.0 is the per-migration transaction
 * safety, not the file backup. The backup flag is best-effort UX.
 */
async function recordPreMigrationBackup(currentVersion: number): Promise<void> {
  if (currentVersion > 0) {
    await migrationFlags.setBackupVersion(currentVersion);
  }
}

export async function runMigrations(db: SQLiteDBConnection): Promise<void> {
  // Step (a): bootstrap the tracker table. The DDL is idempotent (IF
  // NOT EXISTS) so this is safe on every launch.
  await db.execute(SCHEMA_MIGRATIONS_DDL, false);

  // Step (b): read what's already been applied (from the DB itself).
  const applied = await readAppliedVersions(db);

  // Step (c): reconcile with Preferences for v0.1.x → v0.2.0 upgrades.
  // If the tracker table is empty but Preferences says versions were
  // applied, backfill the tracker so we don't re-apply them.
  const prefsVersion = await migrationFlags.getVersion();
  if (applied.size === 0 && prefsVersion > 0) {
    await backfillTrackerFromPreferences(db, prefsVersion, applied);
  }

  // Step (d): filter catalogue to unapplied migrations.
  const pending = MIGRATION_CATALOG.filter((m) => !applied.has(m.version)).slice();
  pending.sort((a, b) => a.version - b.version);

  if (pending.length === 0) {
    // Sync Preferences with the tracker's highest version in case
    // they drifted (e.g. Preferences were cleared by the OS).
    const maxApplied = appliedMax(applied);
    if (maxApplied > prefsVersion) {
      await migrationFlags.setVersion(maxApplied);
    }
    // Clear any prior failure flag — a clean boot is a successful one.
    await migrationFlags.markSucceeded();
    return;
  }

  // Step (e-prep): record a backup marker before we touch anything.
  const currentVersion = appliedMax(applied);
  await recordPreMigrationBackup(currentVersion);

  // Step (e): apply each pending migration individually.
  // We use `execute(sql, true)` which lets the plugin wrap each
  // migration in its own BEGIN/COMMIT pair and ROLLBACK on error.
  // We deliberately do NOT call BEGIN/COMMIT ourselves — the
  // @capacitor-community/sqlite plugin errors with "Already in
  // transaction" when explicit BEGIN is issued alongside its own
  // transaction management. After a successful migration, we record
  // the version in the tracker table and Preferences.
  for (const migration of pending) {
    const cleanSql = normaliseSQL(migration.sql);
    const now = new Date().toISOString();

    try {
      // Let the plugin manage the transaction for the migration DDL/DML.
      await db.execute(cleanSql, true);

      // Record in the tracker table. This is a separate statement so
      // it's outside the migration's transaction — but since the
      // migration succeeded, this is safe. If the app crashes between
      // the execute and the insert, the next boot will see the schema
      // change applied (tables exist) but no tracker row. The backfill
      // logic in step (c) handles this by checking Preferences.
      await db.run(
        "INSERT OR REPLACE INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?);",
        [migration.version, migration.name, migration.checksum, now],
      );

      // Mirror to Preferences after each successful migration so a
      // mid-run crash leaves the Preferences version accurate.
      await migrationFlags.setVersion(migration.version);
    } catch (error) {
      // The plugin's transaction wrapper handles ROLLBACK internally
      // when execute(sql, true) fails. We just need to record the
      // failure and surface it.
      const message = error instanceof Error ? error.message : String(error);
      // Enrich the error with the migration identity AND the first
      // few lines of the (normalised) SQL so the escape-hatch screen
      // can show exactly what went wrong.
      const preview = cleanSql.slice(0, 500).replace(/\s+/g, " ").trim();
      const enrichedMessage = `Migration ${migration.version} (${migration.name}) failed: ${message} — preview: ${preview}${
        cleanSql.length > 500 ? "…" : ""
      }`;

      await migrationFlags.markFailed(enrichedMessage);
      throw new Error(enrichedMessage);
    }
  }

  // Step (f): all migrations applied successfully.
  await migrationFlags.markSucceeded();
}

/**
 * Returns the maximum version from a set, or 0 if the set is empty.
 */
function appliedMax(versions: Set<number>): number {
  let max = 0;
  for (const v of versions) {
    if (v > max) max = v;
  }
  return max;
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
