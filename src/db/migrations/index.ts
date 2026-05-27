/**
 * db/migrations/index.ts — Explicit migration catalogue.
 *
 * Source of truth: CLAUDE.md §14.3 (Migration File Rules).
 *
 * Every migration file that exists on disk MUST be registered here.
 * The catalogue is the runner's single source of truth for what to
 * apply and in what order. A file that lives in `migrations/` but is
 * absent from this list will never run; a catalogue entry whose file
 * was deleted will fail the checksum assertion at boot.
 *
 * Rules:
 *   - Entries are ordered by `version`, ascending.
 *   - `version` is a strictly-increasing positive integer.
 *   - `name` is a short, stable label — used in `schema_migrations`
 *     rows and in error messages. Never change a shipped name.
 *   - `sql` is the raw migration content, imported via Vite's `?raw`
 *     suffix so it ships as an inlined string.
 *   - `checksum` is computed at module-load time by normalising the
 *     SQL (stripping comments / collapsing whitespace) and hashing
 *     the result with FNV-1a. This fingerprint lets the runner
 *     detect if someone edits a shipped migration file.
 *
 * Adding a new migration:
 *   1. Create `NNN_short_name.sql` in this directory.
 *   2. Import it below with `?raw`.
 *   3. Add an entry to `MIGRATION_CATALOG` with the next version.
 *   4. Run the build — the catalogue is validated at boot; if the
 *      checksums or ordering are wrong you'll hear about it.
 */

import { computeChecksum, normaliseSQL } from "../sql/normalise";

// Raw SQL imports — Vite inlines these as plain strings at build time.
import migration001 from "./001_init.sql?raw";
import migration002 from "./002_spend_entries.sql?raw";
import migration003 from "./003_schema_migrations.sql?raw";
import migration004 from "./004_sms_suggestions.sql?raw";
import migration005 from "./005_recurring_last_paid.sql?raw";
import migration006 from "./006_income_last_credited.sql?raw";
import migration007 from "./007_ledger.sql?raw";

/**
 * Shape of a single catalogue entry. Consumed by the runner in db.ts
 * and by the CI verification script.
 */
export interface MigrationEntry {
  /** Strictly-increasing positive integer. Used as PK in `schema_migrations`. */
  version: number;
  /** Short stable label, e.g. 'init', 'spend_entries'. Never rename once shipped. */
  name: string;
  /** Raw SQL content of the migration file (comments included). */
  sql: string;
  /** FNV-1a hex checksum of the *normalised* SQL. Computed at module load. */
  checksum: string;
}

/**
 * The full, ordered migration catalogue. The runner iterates this to
 * find unapplied migrations. CI asserts it matches the on-disk
 * `migrations/` directory exactly.
 *
 * Checksums are computed eagerly so the catalogue is a plain,
 * synchronous ReadonlyArray — no async init, no lazy evaluation.
 */
export const MIGRATION_CATALOG: ReadonlyArray<MigrationEntry> = [
  {
    version: 1,
    name: "init",
    sql: migration001,
    checksum: computeChecksum(normaliseSQL(migration001)),
  },
  {
    version: 2,
    name: "spend_entries",
    sql: migration002,
    checksum: computeChecksum(normaliseSQL(migration002)),
  },
  {
    version: 3,
    name: "schema_migrations",
    sql: migration003,
    checksum: computeChecksum(normaliseSQL(migration003)),
  },
  {
    version: 4,
    name: "sms_suggestions",
    sql: migration004,
    checksum: computeChecksum(normaliseSQL(migration004)),
  },
  {
    version: 5,
    name: "recurring_last_paid",
    sql: migration005,
    checksum: computeChecksum(normaliseSQL(migration005)),
  },
  {
    version: 6,
    name: "income_last_credited",
    sql: migration006,
    checksum: computeChecksum(normaliseSQL(migration006)),
  },
  {
    version: 7,
    name: "ledger",
    sql: migration007,
    checksum: computeChecksum(normaliseSQL(migration007)),
  },
];

/**
 * The highest version in the catalogue. Used by the runner as the
 * target schema version and by introspection helpers.
 */
export const TARGET_SCHEMA_VERSION: number = MIGRATION_CATALOG.reduce(
  (max, m) => (m.version > max ? m.version : max),
  0,
);
