/**
 * stores/smsSuggestionsStore.ts — Zustand store for SMS-parsed suggestions.
 *
 * Source of truth: CLAUDE.md §15.6 (Suggestion Inbox), §15.7 (Storage
 * Schema), §15.9 (Edge Cases).
 *
 * Responsibilities:
 *   - Hydrate the pending suggestions list from SQLite on boot.
 *   - Expose accept / dismiss / clear actions that write through to
 *     SQLite first, then update in-memory state.
 *   - Provide a `refreshPending()` method that re-reads from the DB
 *     (called after a scan completes to pick up new suggestions).
 *
 * Design rules:
 *   - UI reads from this store, never from the DB directly.
 *   - Write-through order: SQLite first, then in-memory. A failed
 *     write MUST NOT update the in-memory state.
 *   - `hydrate` is the ONLY method allowed to bypass write-through.
 *   - `reset` is called by the destructive reset pipeline. It does NOT
 *     touch SQLite — the pipeline handles that separately.
 *   - The inline repository functions follow the same pattern as
 *     db/repositories.ts (withDb, rows helpers) but live here to
 *     avoid editing repositories.ts (another agent's scope).
 */

import { create } from "zustand";

import { getDb } from "../db/db";

import type { SQLiteDBConnection } from "@capacitor-community/sqlite";

/* ------------------------------------------------------------------
 * DB helpers (inline — matches repositories.ts pattern)
 * ------------------------------------------------------------------ */

function rows<T>(result: { values?: unknown[] } | undefined): T[] {
  return (result?.values ?? []) as T[];
}

async function withDb<T>(fn: (db: SQLiteDBConnection) => Promise<T>): Promise<T> {
  const db = await getDb();
  return fn(db);
}

/* ------------------------------------------------------------------
 * Public types
 * ------------------------------------------------------------------ */

export interface SmsSuggestion {
  id: number;
  messageId: string;
  receivedAt: string;
  sender: string;
  direction: "debit" | "credit";
  amount: number;
  counterparty: string | null;
  accountLast4: string | null;
  referenceId: string | null;
  confidence: number;
  status: "pending" | "accepted" | "dismissed";
  linkedLogId: number | null;
  linkedCreditId: number | null;
  createdAt: string;
}

/* ------------------------------------------------------------------
 * Raw DB record shape
 *
 * Column names use snake_case; the public `SmsSuggestion` uses
 * camelCase. The `toSuggestion` mapper bridges the two.
 * ------------------------------------------------------------------ */

interface SuggestionRecord {
  id: number;
  message_id: string;
  received_at: string;
  sender: string;
  direction: string;
  amount: number;
  counterparty: string | null;
  account_last4: string | null;
  reference_id: string | null;
  confidence: number;
  status: string;
  linked_log_id: number | null;
  linked_credit_id: number | null;
  created_at: string;
}

function toSuggestion(r: SuggestionRecord): SmsSuggestion {
  return {
    id: r.id,
    messageId: r.message_id,
    receivedAt: r.received_at,
    sender: r.sender,
    direction: r.direction as "debit" | "credit",
    amount: r.amount,
    counterparty: r.counterparty,
    accountLast4: r.account_last4,
    referenceId: r.reference_id,
    confidence: r.confidence,
    status: r.status as "pending" | "accepted" | "dismissed",
    linkedLogId: r.linked_log_id,
    linkedCreditId: r.linked_credit_id,
    createdAt: r.created_at,
  };
}

/* ------------------------------------------------------------------
 * Inline repository — SQL queries for sms_suggestions
 * ------------------------------------------------------------------ */

const smsRepo = {
  /** Fetch all suggestions with the given status, newest first. */
  async listByStatus(status: "pending" | "accepted" | "dismissed"): Promise<SmsSuggestion[]> {
    return withDb(async (db) => {
      const result = await db.query(
        `SELECT * FROM sms_suggestions
         WHERE status = ?
         ORDER BY received_at DESC`,
        [status],
      );
      return rows<SuggestionRecord>(result).map(toSuggestion);
    });
  },

  /** Mark a suggestion as accepted, linking to the created log/credit row. */
  async accept(id: number, linkedLogId?: number, linkedCreditId?: number): Promise<void> {
    return withDb(async (db) => {
      await db.run(
        `UPDATE sms_suggestions
         SET status = 'accepted',
             linked_log_id = ?,
             linked_credit_id = ?
         WHERE id = ?`,
        [linkedLogId ?? null, linkedCreditId ?? null, id],
      );
    });
  },

  /** Mark a suggestion as dismissed. */
  async dismiss(id: number): Promise<void> {
    return withDb(async (db) => {
      await db.run(`UPDATE sms_suggestions SET status = 'dismissed' WHERE id = ?`, [id]);
    });
  },

  /** Delete all suggestions (pending, accepted, and dismissed). */
  async deleteAll(): Promise<void> {
    return withDb(async (db) => {
      await db.run("DELETE FROM sms_suggestions", []);
    });
  },

  /** Count pending suggestions. */
  async countPending(): Promise<number> {
    return withDb(async (db) => {
      const result = await db.query(
        "SELECT COUNT(*) as cnt FROM sms_suggestions WHERE status = 'pending'",
      );
      const records = rows<{ cnt: number }>(result);
      const first = records[0];
      return first ? first.cnt : 0;
    });
  },
} as const;

/* ------------------------------------------------------------------
 * Store shape
 * ------------------------------------------------------------------ */

interface SmsSuggestionsState {
  /** Currently pending suggestions, newest first. */
  pending: SmsSuggestion[];
  /** True after the initial hydrate from SQLite resolves. */
  hydrated: boolean;
}

interface SmsSuggestionsActions {
  /**
   * Pull pending suggestions from SQLite into memory. Called once
   * during app boot (or after enabling SMS capture).
   */
  hydrate(): Promise<void>;

  /**
   * Mark a suggestion as accepted. Optionally link it to the
   * daily_logs or manual_credits row that was created from it.
   */
  accept(id: number, linkedLogId?: number, linkedCreditId?: number): Promise<void>;

  /** Mark a suggestion as dismissed (removed from pending). */
  dismiss(id: number): Promise<void>;

  /** Delete all suggestions from the DB. Used by "Clear all" in Settings. */
  clearAll(): Promise<void>;

  /** Re-read pending from the DB. Called after a scan completes. */
  refreshPending(): Promise<void>;

  /**
   * Reset in-memory state. Called by the destructive reset pipeline.
   * Does NOT touch SQLite.
   */
  reset(): void;
}

export type SmsSuggestionsStore = SmsSuggestionsState & SmsSuggestionsActions;

/* ------------------------------------------------------------------
 * Initial state
 * ------------------------------------------------------------------ */

const INITIAL_STATE: SmsSuggestionsState = {
  pending: [],
  hydrated: false,
};

/* ------------------------------------------------------------------
 * Store creation
 * ------------------------------------------------------------------ */

export const useSmsSuggestionsStore = create<SmsSuggestionsStore>((set) => ({
  ...INITIAL_STATE,

  hydrate: async () => {
    try {
      const pending = await smsRepo.listByStatus("pending");
      set({ pending, hydrated: true });
    } catch (err) {
      // If the table doesn't exist yet (migration 004 not applied),
      // degrade gracefully — SMS capture is a v0.2.0 feature and
      // must not block boot.
      console.warn("[smsSuggestionsStore] hydrate failed (table may not exist yet):", err);
      set({ pending: [], hydrated: true });
    }
  },

  accept: async (id, linkedLogId, linkedCreditId) => {
    await smsRepo.accept(id, linkedLogId, linkedCreditId);
    // Remove from in-memory pending list
    set((state) => ({
      pending: state.pending.filter((s) => s.id !== id),
    }));
  },

  dismiss: async (id) => {
    await smsRepo.dismiss(id);
    set((state) => ({
      pending: state.pending.filter((s) => s.id !== id),
    }));
  },

  clearAll: async () => {
    await smsRepo.deleteAll();
    set({ pending: [] });
  },

  refreshPending: async () => {
    try {
      const pending = await smsRepo.listByStatus("pending");
      set({ pending });
    } catch (err) {
      console.warn("[smsSuggestionsStore] refreshPending failed:", err);
    }
  },

  reset: () => {
    set({ ...INITIAL_STATE, hydrated: true });
  },
}));
