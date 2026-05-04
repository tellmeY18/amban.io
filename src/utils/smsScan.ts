/**
 * utils/smsScan.ts — Aggressive SMS scan orchestrator for Android.
 *
 * Source of truth: CLAUDE.md §15.4 (Trigger Model), §15.5 (Parser).
 *
 * ENHANCED (v0.2.1): Aggressive mode.
 *   - Processes staged messages from the BroadcastReceiver/WorkManager
 *     queue on every app resume (zero-latency for new SMS).
 *   - Combined aggressive scan: staged + full provider read.
 *   - Auto-accept for high-confidence debit suggestions (configurable).
 *   - Lower confidence threshold for broader capture.
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
 * ------------------------------------------------------------------ */

export interface SmsMessage {
  messageId: string;
  sender: string;
  body: string;
  receivedAt: string;
}

export interface SmsReaderPlugin {
  checkPermission(): Promise<{ granted: boolean }>;
  requestPermission(): Promise<{ granted: boolean }>;
  readSince(options: { sinceIso: string; limit?: number }): Promise<{ messages: SmsMessage[] }>;
  /** Read messages staged by BroadcastReceiver/WorkManager and clear the queue. */
  getStagedMessages(): Promise<{ messages: SmsMessage[] }>;
  /** Clear the staging queue without reading. */
  clearStagedMessages(): Promise<void>;
  /** Check if RECEIVE_SMS permission is granted (needed for BroadcastReceiver). */
  checkReceiveSmsPermission(): Promise<{ granted: boolean }>;
  /** Request RECEIVE_SMS permission for real-time capture. */
  requestReceiveSmsPermission(): Promise<{ granted: boolean }>;
}

export const SmsReader = registerPlugin<SmsReaderPlugin>("SmsReader", {
  web: () => import("./smsReaderWeb").then((m) => new m.SmsReaderWeb()),
});

/* ------------------------------------------------------------------
 * Preference keys
 * ------------------------------------------------------------------ */

const PREF_LAST_SMS_SCAN_AT = "amban.last_sms_scan_at";
const PREF_SMS_CAPTURE_ENABLED = "amban.sms_capture_enabled";
const PREF_SMS_AUTO_ACCEPT = "amban.sms_auto_accept";
// Reserved for future use: const PREF_SMS_AGGRESSIVE_MODE = "amban.sms_aggressive_mode";

/* ------------------------------------------------------------------
 * DB helpers
 * ------------------------------------------------------------------ */

async function withDb<T>(fn: (db: SQLiteDBConnection) => Promise<T>): Promise<T> {
  const db = await getDb();
  return fn(db);
}

/* ------------------------------------------------------------------
 * Scan result type
 * ------------------------------------------------------------------ */

export interface SmsScanResult {
  scanned: number;
  parsed: number;
  newSuggestions: number;
  autoAccepted: number;
}

/* ------------------------------------------------------------------
 * Public API
 * ------------------------------------------------------------------ */

export async function isSmsCaptureActive(): Promise<boolean> {
  if (Capacitor.getPlatform() !== "android") return false;

  const { value } = await Preferences.get({ key: PREF_SMS_CAPTURE_ENABLED });
  if (value !== "1") return false;

  const { granted } = await SmsReader.checkPermission();
  return granted;
}

/**
 * Check if auto-accept mode is enabled. When enabled, high-confidence
 * debit suggestions (>= 0.9) are automatically logged without user
 * intervention.
 */
export async function isAutoAcceptEnabled(): Promise<boolean> {
  const { value } = await Preferences.get({ key: PREF_SMS_AUTO_ACCEPT });
  return value === "1";
}

/**
 * Process staged messages from the BroadcastReceiver/WorkManager queue.
 * These are SMS that arrived while the app was in the background and
 * were captured in real-time by the native layer.
 *
 * This should be called FIRST on app resume, before runSmsScan(),
 * because it picks up messages that may not yet be visible in the
 * Telephony content provider (race condition on some OEMs).
 */
export async function processStagedMessages(): Promise<SmsScanResult> {
  if (Capacitor.getPlatform() !== "android") {
    return { scanned: 0, parsed: 0, newSuggestions: 0, autoAccepted: 0 };
  }

  const { granted } = await SmsReader.checkPermission();
  if (!granted) {
    return { scanned: 0, parsed: 0, newSuggestions: 0, autoAccepted: 0 };
  }

  let messages: SmsMessage[];
  try {
    const result = await SmsReader.getStagedMessages();
    messages = result.messages;
  } catch (err) {
    console.warn("[smsScan] getStagedMessages failed:", err);
    return { scanned: 0, parsed: 0, newSuggestions: 0, autoAccepted: 0 };
  }

  if (messages.length === 0) {
    return { scanned: 0, parsed: 0, newSuggestions: 0, autoAccepted: 0 };
  }

  return processMessages(messages);
}

/**
 * Run the standard SMS scan (reads from Telephony content provider).
 */
export async function runSmsScan(): Promise<SmsScanResult> {
  if (Capacitor.getPlatform() !== "android") {
    return { scanned: 0, parsed: 0, newSuggestions: 0, autoAccepted: 0 };
  }

  const { granted } = await SmsReader.checkPermission();
  if (!granted) {
    return { scanned: 0, parsed: 0, newSuggestions: 0, autoAccepted: 0 };
  }

  const { value: lastScanRaw } = await Preferences.get({ key: PREF_LAST_SMS_SCAN_AT });
  const sinceIso =
    lastScanRaw && lastScanRaw.length > 0
      ? lastScanRaw
      : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  let messages: SmsMessage[];
  try {
    const result = await SmsReader.readSince({ sinceIso, limit: 500 });
    messages = result.messages;
  } catch (err) {
    console.warn("[smsScan] Plugin readSince failed:", err);
    return { scanned: 0, parsed: 0, newSuggestions: 0, autoAccepted: 0 };
  }

  if (messages.length === 0) {
    await Preferences.set({ key: PREF_LAST_SMS_SCAN_AT, value: new Date().toISOString() });
    return { scanned: 0, parsed: 0, newSuggestions: 0, autoAccepted: 0 };
  }

  const result = await processMessages(messages);

  await Preferences.set({ key: PREF_LAST_SMS_SCAN_AT, value: new Date().toISOString() });

  return result;
}

/**
 * Aggressive scan: processes staged (real-time) messages FIRST, then
 * does a full content-provider scan. Deduplication is handled by the
 * DB's UNIQUE constraint on message_id.
 *
 * This is the primary entry point for the app-resume lifecycle.
 */
export async function runAggressiveScan(): Promise<SmsScanResult> {
  const active = await isSmsCaptureActive();
  if (!active) {
    return { scanned: 0, parsed: 0, newSuggestions: 0, autoAccepted: 0 };
  }

  // Phase 1: Process staged messages (from BroadcastReceiver/Worker)
  const stagedResult = await processStagedMessages();

  // Phase 2: Full provider scan (catches anything missed)
  const providerResult = await runSmsScan();

  return {
    scanned: stagedResult.scanned + providerResult.scanned,
    parsed: stagedResult.parsed + providerResult.parsed,
    newSuggestions: stagedResult.newSuggestions + providerResult.newSuggestions,
    autoAccepted: stagedResult.autoAccepted + providerResult.autoAccepted,
  };
}

/**
 * One-time initial scan over the past N days.
 */
export async function runInitialScan(days = 7): Promise<SmsScanResult> {
  const clampedDays = Math.max(1, Math.min(30, days));
  const sinceIso = new Date(Date.now() - clampedDays * 24 * 60 * 60 * 1000).toISOString();

  await Preferences.set({ key: PREF_LAST_SMS_SCAN_AT, value: sinceIso });

  return runSmsScan();
}

/* ------------------------------------------------------------------
 * Internal: process a batch of messages
 *
 * NOTE: The SMS_MIN_CONFIDENCE threshold used here is defined in
 * src/constants/insightThresholds.ts. Lower it there to capture
 * more messages (recommended: 0.5 for aggressive mode).
 * ------------------------------------------------------------------ */

async function processMessages(messages: SmsMessage[]): Promise<SmsScanResult> {
  const scanned = messages.length;
  let parsed = 0;
  let newSuggestions = 0;
  let autoAccepted = 0;
  const now = new Date().toISOString();

  const autoAccept = await isAutoAcceptEnabled();

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

      // Determine initial status
      const shouldAutoAccept = autoAccept && txn.confidence >= 0.9 && txn.direction === "debit";

      const status = shouldAutoAccept ? "accepted" : "pending";

      const result = await db.run(
        `INSERT OR IGNORE INTO sms_suggestions
           (message_id, received_at, sender, direction, amount,
            counterparty, account_last4, reference_id, confidence,
            status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          status,
          now,
        ],
      );

      if (result.changes && result.changes.changes && result.changes.changes > 0) {
        newSuggestions++;

        // Auto-accept: create a daily log entry
        if (shouldAutoAccept) {
          const today = new Date().toISOString().split("T")[0];
          try {
            // Check if there's already a log for today
            const existing = await db.query("SELECT id, spent FROM daily_logs WHERE log_date = ?", [
              today,
            ]);
            const rows = (existing?.values ?? []) as Array<{ id: number; spent: number }>;

            if (rows.length > 0 && rows[0]) {
              // Add to existing log (additive behavior)
              const newSpent = rows[0].spent + txn.amount;
              await db.run("UPDATE daily_logs SET spent = ? WHERE id = ?", [newSpent, rows[0].id]);
              // Link the suggestion to this log
              await db.run("UPDATE sms_suggestions SET linked_log_id = ? WHERE message_id = ?", [
                rows[0].id,
                msg.messageId,
              ]);
            } else {
              // Create new log for today
              const insertResult = await db.run(
                `INSERT INTO daily_logs (log_date, spent, notes, logged_at)
                 VALUES (?, ?, ?, ?)`,
                [today, txn.amount, `[Auto] ${txn.counterparty || "SMS transaction"}`, now],
              );
              if (insertResult.changes?.lastId) {
                await db.run("UPDATE sms_suggestions SET linked_log_id = ? WHERE message_id = ?", [
                  insertResult.changes.lastId,
                  msg.messageId,
                ]);
              }
            }
            autoAccepted++;
          } catch (err) {
            console.warn("[smsScan] Auto-accept failed for", msg.messageId, err);
            // Revert to pending status if auto-accept fails
            await db.run("UPDATE sms_suggestions SET status = 'pending' WHERE message_id = ?", [
              msg.messageId,
            ]);
          }
        }
      }
    }
  });

  return { scanned, parsed, newSuggestions, autoAccepted };
}
