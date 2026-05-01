/**
 * db/sql/normalise.ts — SQL comment stripping and checksum utilities.
 *
 * Source of truth: CLAUDE.md §14.1 (Non-Negotiable Guarantees, bullet 5)
 * and §14.4 (Runner Behaviour — "`stripSqlComments` first").
 *
 * Extracted from db.ts so the normaliser can be unit-tested in isolation
 * and imported by the migration catalogue without pulling in the entire
 * SQLite connection machinery. The logic is identical to the v0.1.3
 * inline version — comments are stripped, blank lines collapsed, but no
 * statement semantics are altered.
 *
 * `computeChecksum` produces a deterministic hash of a normalised SQL
 * string. It uses a fast, synchronous FNV-1a variant so the migration
 * catalogue can compute checksums at module-load time without awaiting
 * SubtleCrypto. The checksum is a fingerprint for drift detection, not
 * a security primitive — collision resistance is not a concern.
 */

/* ------------------------------------------------------------------
 * normaliseSQL  (née stripSqlComments)
 *
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
 * comment, or a block comment. Most migration authors
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
 *   - Block comments are removed in full, including any
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
 * ------------------------------------------------------------------ */

export function normaliseSQL(sql: string): string {
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

/**
 * Backwards-compatible alias. The original name used throughout the
 * codebase was `stripSqlComments`; kept as an export so existing
 * call sites in db.ts can migrate gradually.
 */
export const stripSqlComments = normaliseSQL;

/* ------------------------------------------------------------------
 * computeChecksum — FNV-1a hash for migration fingerprinting
 *
 * We need a synchronous, deterministic hash that can run at module
 * load time (when the `MIGRATION_CATALOG` is built). SubtleCrypto
 * is async and unavailable at top-level module scope without an
 * immediately-invoked async wrapper, which would turn the catalogue
 * into a promise and cascade through the boot path.
 *
 * FNV-1a is perfect here:
 *   - Runs synchronously in pure JS — no WASM, no native deps.
 *   - Deterministic across platforms and JS engines.
 *   - Produces a fixed-width hex string (8 chars for 32-bit).
 *   - Fast enough for three migration files at boot; would be fast
 *     enough for three hundred.
 *
 * This is NOT a security hash. It's a drift-detection fingerprint so
 * the migration runner can detect if someone edited a shipped file.
 * ------------------------------------------------------------------ */

/**
 * Compute a 32-bit FNV-1a hash of the input string and return it as
 * an 8-character zero-padded hexadecimal string.
 *
 * The hash is computed over the UTF-16 code units of the string, which
 * is what JavaScript's `.charCodeAt` yields. This is fine for our use
 * case — the inputs are normalised SQL strings that are pure ASCII.
 */
export function computeChecksum(sql: string): string {
  // FNV-1a parameters for 32-bit output.
  const FNV_OFFSET_BASIS = 0x811c9dc5;
  const FNV_PRIME = 0x01000193;

  let hash = FNV_OFFSET_BASIS;

  for (let i = 0; i < sql.length; i++) {
    hash ^= sql.charCodeAt(i);
    // Multiply by prime. `Math.imul` gives us a correct 32-bit result
    // even though JS numbers are 64-bit doubles. This is the standard
    // trick for FNV-1a in JavaScript.
    hash = Math.imul(hash, FNV_PRIME);
  }

  // Convert to unsigned 32-bit, then to an 8-char hex string.
  return (hash >>> 0).toString(16).padStart(8, "0");
}
