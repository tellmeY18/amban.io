/**
 * utils/exportData.ts — local-only data export.
 *
 * Source of truth: CLAUDE.md §12 (Local Storage Strategy → Data Backup /
 * Export) and ROADMAP.md Phase 13 ("export-data shell").
 *
 * Responsibilities:
 *   - Produce a single self-contained JSON document describing everything
 *     amban currently has on this device: every SQLite row, every
 *     amban-scoped preference, and a small metadata header tying the
 *     snapshot to the build that produced it.
 *   - Offer that document to the user as a download / share action without
 *     ever touching the network.
 *
 * Design rules:
 *   - This is a READ-ONLY operation. Nothing here writes to SQLite, to
 *     preferences, or to the notification scheduler. If a future "import"
 *     lands, it ships in its own module.
 *   - The payload shape is versioned (`schemaVersion` + `exportVersion`)
 *     so a future importer can reason about forward/backward compatibility
 *     without guessing.
 *   - The file must be human-readable. We pretty-print JSON with two-space
 *     indentation; a few extra kilobytes are a fair trade for an export
 *     the user can actually eyeball in a text editor.
 *   - No network fallback, ever. On web the export goes through an
 *     anchor-download; on native it goes through the Web Share API if
 *     available, otherwise the same anchor-download path.
 */

import { Capacitor } from "@capacitor/core";

import { getAppliedSchemaVersion } from "../db/db";
import { dumpAllTables } from "../db/repositories";
import { prefs } from "../db/preferences";
import { BUILD_INFO } from "../constants/buildInfo";

/**
 * Shape of the exported document. The keys are deliberately verbose so the
 * file stands up to being read six months from now without this comment
 * block next to it.
 */
export interface AmbanExportPayload {
  /** Constant string — lets importers positively identify the file. */
  readonly kind: "amban.io-export";

  /**
   * Version of *this export format*. Bump whenever the shape below changes
   * in a way an importer needs to know about. Independent of the SQLite
   * `schemaVersion`.
   */
  readonly exportVersion: 1;

  /** SQLite schema version at the time of export (from migrations). */
  readonly schemaVersion: number;

  /** App version string, e.g. "0.1.0". */
  readonly appVersion: string;

  /** Short git SHA of the build that produced this export, if known. */
  readonly appCommit: string;

  /** ISO-8601 timestamp of when the export was generated. */
  readonly exportedAt: string;

  /** Platform this export was produced on — purely informational. */
  readonly platform: string;

  /**
   * Every SQLite table as `{ tableName: rows[] }`. Column names are the
   * raw snake_case DB names (not the camelCase repo mappers) so the file
   * stays faithful to the underlying storage.
   */
  readonly database: Record<string, ReadonlyArray<Record<string, unknown>>>;

  /** Every amban-scoped key in Capacitor Preferences. */
  readonly preferences: Record<string, unknown>;
}

/**
 * Build the in-memory export payload. Safe to call from any UI tick — it
 * does not block on the network and runs sequentially against the local
 * SQLite connection.
 */
export async function buildExportPayload(): Promise<AmbanExportPayload> {
  // Pull database + preferences in parallel. `dumpAllTables()` is a
  // dev-inspector helper that already knows how to walk every table the
  // app ships; reusing it keeps this module honest about what "export"
  // actually means (everything, not a curated subset).
  const [rawDatabase, preferences, schemaVersion] = await Promise.all([
    dumpAllTables(),
    prefs.dumpAll(),
    getAppliedSchemaVersion().catch(() => 0),
  ]);

  // `dumpAllTables()` returns a strongly-typed `DbDump` with one field per
  // table. Widen it to a generic `{ [table]: rows[] }` shape for the export
  // payload — the export format is deliberately schema-agnostic so future
  // migrations don't force a breaking change here.
  const database = rawDatabase as unknown as Record<string, ReadonlyArray<Record<string, unknown>>>;

  return {
    kind: "amban.io-export",
    exportVersion: 1,
    schemaVersion,
    appVersion: BUILD_INFO.version,
    appCommit: BUILD_INFO.commit,
    exportedAt: new Date().toISOString(),
    platform: Capacitor.getPlatform(),
    database,
    preferences,
  };
}

/**
 * Serialise the payload to a pretty-printed JSON string. Pulled out as its
 * own function so tests (and a future importer) can round-trip the same
 * bytes the user sees in their file manager.
 */
export function serializeExport(payload: AmbanExportPayload): string {
  return JSON.stringify(payload, null, 2);
}

/**
 * Generate a filename the user will recognise six months later.
 *
 * Shape: `amban-export-0.1.0-20260422T0250Z.json`
 *   - app version so a user with multiple backups can see which build
 *     wrote the file without opening it.
 *   - compact UTC timestamp so the filename sorts chronologically in any
 *     file manager.
 */
export function suggestedFilename(payload: AmbanExportPayload): string {
  const stamp = payload.exportedAt.replace(/[-:]/g, "").replace(/\.\d+/, "").replace(/Z$/, "Z");
  return `amban-export-${payload.appVersion}-${stamp}.json`;
}

/**
 * Present the export to the user. Returns a small result object describing
 * *how* the export was delivered so callers can show tone-matched copy
 * (e.g. "saved" vs "shared").
 *
 * Strategy:
 *   1. If the Web Share API supports files (most modern mobile browsers,
 *      and the Capacitor webview on both platforms), share as a file.
 *      This hands the JSON to the OS share sheet so the user can drop it
 *      into Files, iCloud Drive, Google Drive, email, whatever.
 *   2. Otherwise, fall back to an anchor-tag download. This covers plain
 *      desktop browsers during development.
 *
 * Never throws. The caller can decide what to show on `ok: false`.
 */
export async function exportAndOffer(): Promise<
  | { ok: true; method: "share" | "download"; filename: string; bytes: number }
  | { ok: false; error: string }
> {
  try {
    const payload = await buildExportPayload();
    const serialized = serializeExport(payload);
    const filename = suggestedFilename(payload);
    const blob = new Blob([serialized], { type: "application/json" });

    // Prefer the share sheet when the platform supports sharing files.
    // Feature-detect `canShare` specifically — a bare `navigator.share`
    // check would incorrectly include desktop browsers that can only
    // share URLs.
    const nav = navigator as Navigator & {
      canShare?: (data: ShareData) => boolean;
      share?: (data: ShareData) => Promise<void>;
    };
    if (
      typeof File !== "undefined" &&
      typeof nav.share === "function" &&
      typeof nav.canShare === "function"
    ) {
      const file = new File([blob], filename, { type: "application/json" });
      const shareData: ShareData = { files: [file], title: "amban export" };
      if (nav.canShare(shareData)) {
        await nav.share(shareData);
        return { ok: true, method: "share", filename, bytes: blob.size };
      }
    }

    // Fallback: anchor-download. Revoke the object URL on the next tick
    // so mobile webviews have time to hand it to the system downloader.
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    return { ok: true, method: "download", filename, bytes: blob.size };
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, error };
  }
}
