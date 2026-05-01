/**
 * utils/smsScan.ts — SMS scan orchestrator for Android.
 *
 * Source of truth: CLAUDE.md §15.4 (Trigger Model), §15.5 (Parser).
 *
 * Responsibilities:
 *   - Define the SmsReaderPlugin interface for the custom Capacitor
 *     plugin (native Android) and register it with a web fallback.
 *   - Orchestrate a foreground scan: read SMS since last scan, parse
 *     each through `parseSms()`, filter by confidence, upsert into
 *     the `sms_suggestions` table, and update the scan timestamp.
 *
 * Trigger model (v0.2.0):
 *   - App-foreground scan on every resume + cold start (once permission
 *     is granted and SMS capture is enabled).
 *   - Idempotent: duplicate `message_id` values are silently skipped
 *     via the UNIQUE constraint + INSERT OR IGNORE.
 *   - No background service in v0.2 — live BroadcastReceiver is v0.3.
 *
 * Privacy:
 *   - The original SMS body is never stored. Only parsed fields land
 *     in `sms_suggestions` (see §15.8).
 *   - Zero network calls.
 */

import { Capacitor, registerPlugin } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

import { parseSms } from "./smsParser";
import { SMS_MIN_CONFIDENCE } from "../constants/insightThresholds";
import { getDb } from "../db/db";

import type { SQLiteDBConnection } from "@capacitor-community/sqlite";

/* ------------------------------------------------------------------
 * Capacitor plugin definition
 *
 * The native implementation lives in:
 *   android/app/src/main/java/io/amban/app/sms/SmsReaderPlugin.java
 *
 * The web fallback (src/utils/smsReaderWeb.ts) returns safe defaults
 * so the app compiles and runs on the Vite dev server.
 * ------------------------------------------------------------------ */

/** Raw SMS message as delivered by the native plugin. */
export interface SmsMessage {
  messageId: string;
  sender: string;
  body: string;
  receivedAt: string; // ISO timestamp
}

/** Capacitor plugin interface for reading device SMS. */
export interface SmsReaderPlugin {
  /** Check whether READ_SMS permission has been granted. */
  checkPermission(): Promise<{ granted: boolean }>;

  /** Request READ_SMS permission from the user. */
  requestPermission(): Promise<{ granted: boolean }>;

  /**
   * Read SMS messages received since the given ISO timestamp.
   * Returns at most `limit` messages (default: 500).
   */
  readSince(options: { sinceIso: string; limit?: number }): Promise<{ messages: SmsMessage[] }>;
}

/**
 * Registered Capacitor plugin instance. On web, the dynamic import
 * resolves to SmsReaderWeb which returns empty/false for everything.
 */
export const SmsReader = registerPlugin<SmsReaderPlugin>("SmsReader", {
  web: () => import("./smsReaderWeb").then((m) => new m.SmsReaderWeb()),
});

/* ------------------------------------------------------------------
 * Preference keys — string literals per the scope constraint.
 * The DB resilience agent is adding these to PreferenceKey; we use
 * the raw strings here to avoid import conflicts.
 * ------------------------------------------------------------------ */

const PREF_LAST_SMS_SCAN_AT = "amban.last_sms_scan_at";
const PREF_SMS_CAPTURE_ENABLED = "amban.sms_capture_enabled";

/* ------------------------------------------------------------------
 * DB helpers (inline — not touching repositories.ts)
 * ------------------------------------------------------------------ */

async function withDb<T>(fn: (db: SQLiteDBConnection) => Promise<T>): Promise<T> {
  const db = await getDb();
  return fn(db);
}

/* ------------------------------------------------------------------
 * Scan result type
 * ------------------------------------------------------------------ */

/** Summary of a completed SMS scan. */
export interface SmsScanResult {
  /** Total SMS messages read from the device inbox. */
  scanned: number;
  /** Messages that the parser successfully extracted a transaction from. */
  parsed: number;
  /** New suggestions inserted into the DB (excludes duplicates). */
  newSuggestions: number;
}

/* ------------------------------------------------------------------
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Returns `true` if SMS capture is available and enabled.
 * Checks platform (Android only) and the user preference toggle.
 */
export async function isSmsCaptureActive(): Promise<boolean> {
  if (Capacitor.getPlatform() !== "android") return false;

  const { value } = await Preferences.get({ key: PREF_SMS_CAPTURE_ENABLED });
  if (value !== "1") return false;

  const { granted } = await SmsReader.checkPermission();
  return granted;
}

/**
 * Run a foreground SMS scan.
 *
 * 1. Reads the `last_sms_scan_at` timestamp from Preferences.
 * 2. Fetches all SMS since that timestamp via the native plugin.
 * 3. Runs each through `parseSms()`.
 * 4. Filters by `SMS_MIN_CONFIDENCE`.
 * 5. Upserts into `sms_suggestions` (idempotent on `message_id`).
 * 6. Updates `last_sms_scan_at`.
 *
 * @returns  A summary with counts of scanned, parsed, and new suggestions.
 * @throws   If the DB write fails. Plugin read failures are caught and
 *           result in `{ scanned: 0, parsed: 0, newSuggestions: 0 }`.
 */
export async function runSmsScan(): Promise<SmsScanResult> {
  // Guard: Android only
  if (Capacitor.getPlatform() !== "android") {
    return { scanned: 0, parsed: 0, newSuggestions: 0 };
  }

  // Guard: permission check
  const { granted } = await SmsReader.checkPermission();
  if (!granted) {
    return { scanned: 0, parsed: 0, newSuggestions: 0 };
  }

  // Read the last scan timestamp — default to 24h ago on first scan
  const { value: lastScanRaw } = await Preferences.get({ key: PREF_LAST_SMS_SCAN_AT });
  const sinceIso =
    lastScanRaw && lastScanRaw.length > 0
      ? lastScanRaw
      : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Fetch messages from the native plugin
  let messages: SmsMessage[];
  try {
    const result = await SmsReader.readSince({ sinceIso, limit: 500 });
    messages = result.messages;
  } catch (err) {
    console.warn("[smsScan] Plugin readSince failed:", err);
    return { scanned: 0, parsed: 0, newSuggestions: 0 };
  }

  const scanned = messages.length;
  if (scanned === 0) {
    // Even with zero messages, update the scan timestamp so we don't
    // re-scan the same empty window next time.
    await Preferences.set({ key: PREF_LAST_SMS_SCAN_AT, value: new Date().toISOString() });
    return { scanned: 0, parsed: 0, newSuggestions: 0 };
  }

  // Parse each message
  let parsed = 0;
  let newSuggestions = 0;
  const now = new Date().toISOString();

  await withDb(async (db) => {
    for (const msg of messages) {
      const txn = parseSms({
        messageId: msg.messageId,
        sender: msg.sender,
        body: msg.body,
        receivedAt: msg.receivedAt,
      });

      if (!txn) continue;
      if (txn.confidence < SMS_MIN_CONFIDENCE) continue;

      parsed++;

      // INSERT OR IGNORE — idempotent on message_id UNIQUE constraint.
      // If the row already exists, the insert silently does nothing.
      const result = await db.run(
        `INSERT OR IGNORE INTO sms_suggestions
           (message_id, received_at, sender, direction, amount,
            counterparty, account_last4, reference_id, confidence,
            status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        [
          msg.messageId,
          msg.receivedAt,
          msg.sender,
          txn.direction,
          txn.amount,
          txn.counterparty,
          txn.accountLast4,
          txn.referenceId,
          txn.confidence,
          now,
        ],
      );

      // `changes` > 0 means a new row was inserted (not a duplicate).
      if (result.changes && result.changes.changes && result.changes.changes > 0) {
        newSuggestions++;
      }
    }
  });

  // Update scan timestamp
  await Preferences.set({ key: PREF_LAST_SMS_SCAN_AT, value: now });

  return { scanned, parsed, newSuggestions };
}

/**
 * Run a one-time initial scan over the past N days. Used when the user
 * first enables SMS capture, to backfill suggestions from recent SMS.
 *
 * @param days  Number of past days to scan (default: 7, max: 30).
 */
export async function runInitialScan(days = 7): Promise<SmsScanResult> {
  const clampedDays = Math.max(1, Math.min(30, days));
  const sinceIso = new Date(Date.now() - clampedDays * 24 * 60 * 60 * 1000).toISOString();

  // Override the last-scan-at to the requested window so runSmsScan
  // picks up the full range.
  await Preferences.set({ key: PREF_LAST_SMS_SCAN_AT, value: sinceIso });

  return runSmsScan();
}
