/**
 * stores/financeStore.ts — income, balance, and recurring payments.
 *
 * Source of truth: CLAUDE.md §5 (Data Models → Zustand Store Shapes),
 * §6 (User Flows), and §7 (Core Business Logic — Balance Tracking).
 *
 * Responsibilities:
 *   - Hydrate from `income_sources`, `recurring_payments`,
 *     `balance_snapshots`, and `manual_credits` on app boot.
 *   - Expose the latest balance snapshot and every active income /
 *     recurring row so the scoring hook (Phase 5) can compute the
 *     Amban Score without issuing its own SQL.
 *   - Write through to SQLite on every mutation. SQLite is always the
 *     authoritative source; in-memory state is the cache.
 *
 * Design rules:
 *   - UI reads from this store, never from the DB directly. New
 *     selectors belong here or in a hook, not as ad-hoc repo calls.
 *   - Write-through order: SQLite first, then in-memory. A failed
 *     write MUST NOT update the in-memory state.
 *   - Derived values (effective balance, next income date, days left,
 *     upcoming recurring sum) live in hooks / selectors, not here.
 *     See hooks/useAmbanScore.ts and utils/scoring.ts.
 *   - `hydrate` is the only method allowed to bypass write-through;
 *     it's the boot path that pulls state out of SQLite into memory.
 *   - `reset` is called by the destructive reset pipeline in
 *     db/reset.ts. It does NOT touch SQLite — the pipeline handles
 *     that separately.
 *   - After every write-through, the newly-affected slice is re-read
 *     from the repository layer instead of optimistically patched in
 *     memory. The cost is one extra query per mutation; the payoff is
 *     that the store can never drift from SQLite. On a local-only,
 *     offline, user-triggered mutation cadence that's effectively free.
 */

import { create } from "zustand";

import {
  balanceSnapshotsRepo,
  incomeSourcesRepo,
  manualCreditsRepo,
  recurringPaymentsRepo,
} from "../db/repositories";
import type {
  BalanceSnapshotRecord,
  IncomeSourceRecord,
  ManualCreditRecord,
  RecurringPaymentRecord,
} from "../db/repositories";
import type { CategoryKey } from "../constants/categories";

/* ------------------------------------------------------------------
 * Public store types
 *
 * These are re-declared here (rather than re-exported from the repo
 * module) so UI code depends on the store's contract, not on the
 * storage layer's. The two happen to line up in v1, but keeping the
 * boundary explicit means a future schema tweak stays a one-file edit.
 * ------------------------------------------------------------------ */

export interface IncomeSource {
  id: number;
  label: string;
  amount: number;
  /** Day of month the income hits the account (1–31). */
  creditDay: number;
  isActive: boolean;
}

export interface RecurringPayment {
  id: number;
  label: string;
  amount: number;
  /** Day of month the payment is due (1–31). */
  dueDay: number;
  /** Category key from Appendix C — stable enum, never renamed. */
  category: CategoryKey;
  isActive: boolean;
}

export interface BalanceSnapshot {
  id: number;
  amount: number;
  /** ISO date string (YYYY-MM-DD) recorded when the snapshot was taken. */
  recordedAt: string;
}

export interface ManualCredit {
  id: number;
  label: string;
  amount: number;
  /** ISO date string (YYYY-MM-DD) the credit was received. */
  creditedAt: string;
}

export interface FinanceState {
  /** Most recent balance snapshot; null until first snapshot is captured. */
  latestBalance: BalanceSnapshot | null;
  /** Every balance snapshot ever recorded, newest first. */
  balanceHistory: BalanceSnapshot[];
  /** All income sources (active + inactive). UI filters where needed. */
  incomeSources: IncomeSource[];
  /** All recurring payments (active + inactive). */
  recurringPayments: RecurringPayment[];
  /** One-off income credits (e.g. bonus, gift, tax refund). */
  manualCredits: ManualCredit[];
  /** True after the initial hydrate from SQLite resolves. */
  hydrated: boolean;
}

export interface FinanceActions {
  /**
   * Pull every finance slice from SQLite into memory. Called once
   * during app boot. Bypasses write-through by design. Safe to call
   * more than once — a re-hydrate resolves conflicts that would
   * otherwise require a cold restart.
   */
  hydrate: () => Promise<void>;

  /**
   * Append a new balance snapshot dated today. Scoring reads only the
   * latest snapshot, so this is the canonical way to "update balance"
   * (§6.3, §9.5). Returns once SQLite has acknowledged the write.
   */
  setBalance: (amount: number) => Promise<void>;

  /** Income sources CRUD. */
  addIncomeSource: (source: Omit<IncomeSource, "id">) => Promise<IncomeSource>;
  updateIncomeSource: (id: number, patch: Partial<Omit<IncomeSource, "id">>) => Promise<void>;
  deleteIncomeSource: (id: number) => Promise<void>;
  toggleIncomeSource: (id: number) => Promise<void>;

  /** Recurring payments CRUD. */
  addRecurringPayment: (payment: Omit<RecurringPayment, "id">) => Promise<RecurringPayment>;
  updateRecurringPayment: (
    id: number,
    patch: Partial<Omit<RecurringPayment, "id">>,
  ) => Promise<void>;
  deleteRecurringPayment: (id: number) => Promise<void>;
  toggleRecurringPayment: (id: number) => Promise<void>;

  /** One-off income credits. */
  addManualCredit: (credit: Omit<ManualCredit, "id">) => Promise<ManualCredit>;
  deleteManualCredit: (id: number) => Promise<void>;

  /**
   * Reset to initial state. In-memory only — the destructive reset
   * pipeline (db/reset.ts) wipes SQLite separately.
   */
  reset: () => void;
}

export type FinanceStore = FinanceState & FinanceActions;

/* ------------------------------------------------------------------
 * Record → store-shape mappers
 *
 * The repository records and the store-facing types are identical in
 * v1. We still route through tiny mappers so a future schema field
 * that shouldn't leak into the UI (e.g. a computed last_modified
 * column) has an obvious place to be dropped.
 * ------------------------------------------------------------------ */

function toIncomeSource(record: IncomeSourceRecord): IncomeSource {
  return {
    id: record.id,
    label: record.label,
    amount: record.amount,
    creditDay: record.creditDay,
    isActive: record.isActive,
  };
}

function toRecurringPayment(record: RecurringPaymentRecord): RecurringPayment {
  return {
    id: record.id,
    label: record.label,
    amount: record.amount,
    dueDay: record.dueDay,
    category: record.category,
    isActive: record.isActive,
  };
}

function toBalanceSnapshot(record: BalanceSnapshotRecord): BalanceSnapshot {
  return {
    id: record.id,
    amount: record.amount,
    recordedAt: record.recordedAt,
  };
}

function toManualCredit(record: ManualCreditRecord): ManualCredit {
  return {
    id: record.id,
    label: record.label,
    amount: record.amount,
    creditedAt: record.creditedAt,
  };
}

/* ------------------------------------------------------------------
 * Store factory
 * ------------------------------------------------------------------ */

const INITIAL_STATE: FinanceState = {
  latestBalance: null,
  balanceHistory: [],
  incomeSources: [],
  recurringPayments: [],
  manualCredits: [],
  hydrated: false,
};

/**
 * Re-read the income sources slice from SQLite into memory. Used
 * after every mutation that touches `income_sources` so the store
 * stays in lockstep with storage — ordering, is_active flips, and
 * soft-deletes all show up without bespoke patch logic.
 */
async function refreshIncomeSources(): Promise<IncomeSource[]> {
  const records = await incomeSourcesRepo.listAll();
  return records.map(toIncomeSource);
}

async function refreshRecurringPayments(): Promise<RecurringPayment[]> {
  const records = await recurringPaymentsRepo.listAll();
  return records.map(toRecurringPayment);
}

async function refreshBalances(): Promise<{
  latestBalance: BalanceSnapshot | null;
  balanceHistory: BalanceSnapshot[];
}> {
  // One query for the history list, then pick the head as "latest".
  // Avoids a second round-trip and keeps the two views provably
  // consistent (the latest can never disagree with history[0]).
  const history = await balanceSnapshotsRepo.history(100);
  const mapped = history.map(toBalanceSnapshot);
  return {
    balanceHistory: mapped,
    latestBalance: mapped[0] ?? null,
  };
}

async function refreshManualCredits(): Promise<ManualCredit[]> {
  const records = await manualCreditsRepo.listAll();
  return records.map(toManualCredit);
}

export const useFinanceStore = create<FinanceStore>((set) => ({
  ...INITIAL_STATE,

  hydrate: async () => {
    // Pull every slice in parallel. Cheap for SQLite, and it keeps
    // cold boot tight — the four queries have no dependencies on each
    // other so there's no reason to serialise them.
    const [incomeSources, recurringPayments, balances, manualCredits] = await Promise.all([
      refreshIncomeSources(),
      refreshRecurringPayments(),
      refreshBalances(),
      refreshManualCredits(),
    ]);

    set({
      incomeSources,
      recurringPayments,
      latestBalance: balances.latestBalance,
      balanceHistory: balances.balanceHistory,
      manualCredits,
      hydrated: true,
    });
  },

  /* -----------------------------
   * Balance
   * ----------------------------- */

  setBalance: async (amount) => {
    if (!Number.isFinite(amount)) {
      throw new Error("financeStore.setBalance: amount must be a finite number");
    }

    // Write-through first. Snapshots are append-only — scoring reads
    // the latest row, so correcting a mistake is another snapshot,
    // not an edit (see repositories.ts balanceSnapshotsRepo).
    await balanceSnapshotsRepo.insert({ amount });

    const balances = await refreshBalances();
    set((prev) => ({
      ...prev,
      latestBalance: balances.latestBalance,
      balanceHistory: balances.balanceHistory,
    }));
  },

  /* -----------------------------
   * Income sources
   * ----------------------------- */

  addIncomeSource: async (source) => {
    const id = await incomeSourcesRepo.insert(source);
    const incomeSources = await refreshIncomeSources();
    set((prev) => ({ ...prev, incomeSources }));

    // Find the newly-inserted row in the refreshed list so the caller
    // gets the same in-memory reference the store now exposes. Falls
    // back to a synthesised record if the find fails — defensive, but
    // effectively unreachable given we just inserted by this id.
    const inserted = incomeSources.find((row) => row.id === id);
    return inserted ?? { id, ...source };
  },

  updateIncomeSource: async (id, patch) => {
    await incomeSourcesRepo.update(id, patch);
    const incomeSources = await refreshIncomeSources();
    set((prev) => ({ ...prev, incomeSources }));
  },

  deleteIncomeSource: async (id) => {
    await incomeSourcesRepo.delete(id);
    const incomeSources = await refreshIncomeSources();
    set((prev) => ({ ...prev, incomeSources }));
  },

  toggleIncomeSource: async (id) => {
    // Repo returns the new is_active state, but we re-read the full
    // list anyway so ordering (is_active DESC, credit_day ASC) stays
    // correct after the flip.
    await incomeSourcesRepo.toggleActive(id);
    const incomeSources = await refreshIncomeSources();
    set((prev) => ({ ...prev, incomeSources }));
  },

  /* -----------------------------
   * Recurring payments
   * ----------------------------- */

  addRecurringPayment: async (payment) => {
    const id = await recurringPaymentsRepo.insert(payment);
    const recurringPayments = await refreshRecurringPayments();
    set((prev) => ({ ...prev, recurringPayments }));

    const inserted = recurringPayments.find((row) => row.id === id);
    return inserted ?? { id, ...payment };
  },

  updateRecurringPayment: async (id, patch) => {
    await recurringPaymentsRepo.update(id, patch);
    const recurringPayments = await refreshRecurringPayments();
    set((prev) => ({ ...prev, recurringPayments }));
  },

  deleteRecurringPayment: async (id) => {
    await recurringPaymentsRepo.delete(id);
    const recurringPayments = await refreshRecurringPayments();
    set((prev) => ({ ...prev, recurringPayments }));
  },

  toggleRecurringPayment: async (id) => {
    await recurringPaymentsRepo.toggleActive(id);
    const recurringPayments = await refreshRecurringPayments();
    set((prev) => ({ ...prev, recurringPayments }));
  },

  /* -----------------------------
   * Manual credits
   * ----------------------------- */

  addManualCredit: async (credit) => {
    const id = await manualCreditsRepo.insert(credit);
    const manualCredits = await refreshManualCredits();
    set((prev) => ({ ...prev, manualCredits }));

    const inserted = manualCredits.find((row) => row.id === id);
    return inserted ?? { id, ...credit };
  },

  deleteManualCredit: async (id) => {
    await manualCreditsRepo.delete(id);
    const manualCredits = await refreshManualCredits();
    set((prev) => ({ ...prev, manualCredits }));
  },

  /* -----------------------------
   * Lifecycle
   * ----------------------------- */

  reset: () => {
    // In-memory only. The reset pipeline in db/reset.ts handles the
    // SQLite wipe; calling repository mutators here would double-fire
    // and race the pipeline's ordering guarantees.
    set({ ...INITIAL_STATE, hydrated: true });
  },
}));
