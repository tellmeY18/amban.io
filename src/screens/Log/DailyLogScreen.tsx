/**
 * screens/Log/DailyLogScreen.tsx — daily spend capture surface (entry-first).
 *
 * Source of truth: CLAUDE.md §6.2 (Daily Use Flow), §9.2 (Daily Log
 * Screen — revised), §8.4 (Score History), §13.6 (backfill), migration
 * 002 (two-tier logging model), and Appendix F (Haptics).
 *
 * Mental model
 * ------------
 * Users don't live a day as a single number. They spend in bursts —
 * ₹120 chai in the morning, ₹800 groceries at lunch, ₹60 auto in the
 * evening — and each burst carries its own category and note. This
 * screen captures those bursts as *entries* and auto-rolls them into
 * the one-row-per-day `daily_logs` that scoring consumes.
 *
 *   Add entry → Add entry → Add entry → … → Confirm day's total
 *     (fluid, edit anything)                  (stamped, still editable
 *                                              until local midnight)
 *
 * Responsibilities
 * ----------------
 *   - List today's entries newest-first with a running-total banner.
 *   - "Add entry" CTA opens a bottom sheet (amount + optional category
 *     + optional note + optional time). Each save calls
 *     `dailyStore.addEntry` which rolls up automatically.
 *   - Per-row edit / delete on every entry via long-press menu.
 *   - End-of-day confirmation CTA ("I'm done for today") that seals
 *     the day. After confirmation, the CTA swaps to an "Editing until
 *     midnight" badge that remains live until local 23:59.
 *   - Empty state with a clear first-run prompt and an immediate
 *     "Add entry" CTA.
 *   - Stale-logs entry point into the backfill sheet survives (§13.6).
 *
 * Design rules
 * ------------
 *   - All writes go through `dailyStore.addEntry / updateEntry /
 *     deleteEntry / confirmDay / backfillLogs`. This screen does not
 *     speak to the repos directly.
 *   - Amount is the hero of the add sheet with additive quick-amount
 *     chips (+₹100 / +₹500 / +₹1000 / +₹2000 / clear).
 *   - After local midnight the day is sealed purely by time; the UI
 *     disables further edits and routes the user at History to fix
 *     past days.
 *   - Respect Appendix F haptics: success on entry add / confirm,
 *     warning on over-score confirmation toast, selection on chips.
 */

import { useEffect, useMemo, useState } from "react";
import { useHistory } from "react-router-dom";
import { IonContent, IonIcon, IonPage } from "@ionic/react";

import BottomSheet from "../../components/ui/BottomSheet";
import CurrencyInput from "../../components/ui/CurrencyInput";
import DatePicker from "../../components/ui/DatePicker";

import { CATEGORIES } from "../../constants/categories";
import type { CategoryKey } from "../../constants/categories";

import { useAmbanScore } from "../../hooks/useAmbanScore";
import { useDailyStore } from "../../stores/dailyStore";
import type { SpendEntry } from "../../stores/dailyStore";

import { CATEGORY_ICONS, Icons } from "../../theme/icons";
import { formatINR } from "../../utils/formatters";
import { haptics } from "../../utils/haptics";

/* ------------------------------------------------------------------
 * Local helpers
 * ------------------------------------------------------------------ */

/** Additive quick-amount chips in the add-entry sheet. */
const QUICK_AMOUNTS = [100, 500, 1000, 2000] as const;

type ToastTone = "positive" | "neutral" | "warning";

interface Toast {
  tone: ToastTone;
  message: string;
}

const TOAST_COLOR: Record<ToastTone, string> = {
  positive: "var(--color-score-excellent)",
  neutral: "var(--color-primary)",
  warning: "var(--color-score-good)",
};

const TOAST_TINT: Record<ToastTone, string> = {
  positive: "rgba(30, 140, 69, 0.12)",
  neutral: "var(--color-primary-light)",
  warning: "rgba(242, 153, 0, 0.14)",
};

/** Today's ISO date — local calendar. */
function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Short "9:42 PM" style time for entry rows. */
function formatEntryTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const suffix = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${suffix}`;
}

/* ==================================================================
 * DailyLogScreen
 * ================================================================== */

const DailyLogScreen: React.FC = () => {
  const history = useHistory();

  const score = useAmbanScore();
  const todayLog = useDailyStore((s) => s.todayLog);
  const todayEntries = useDailyStore((s) => s.todayEntries);
  const todayEntriesTotal = useDailyStore((s) => s.todayEntriesTotal);
  const logs = useDailyStore((s) => s.logs);
  const addEntry = useDailyStore((s) => s.addEntry);
  const updateEntry = useDailyStore((s) => s.updateEntry);
  const deleteEntry = useDailyStore((s) => s.deleteEntry);
  const confirmDay = useDailyStore((s) => s.confirmDay);
  const backfillLogs = useDailyStore((s) => s.backfillLogs);

  const [addOpen, setAddOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<SpendEntry | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  // Auto-dismiss toasts after a beat.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2_800);
    return () => clearTimeout(t);
  }, [toast]);

  const confirmedAt = todayLog?.confirmedAt ?? null;
  const isConfirmed = confirmedAt != null;
  const staleLogs = score.warnings.includes("stale-logs");

  // Tone hint for the confirmation banner — compares the running total
  // against the live score so the user has a directional sense of how
  // today is shaping up BEFORE they tap "I'm done".
  const scoreDiff = useMemo(() => {
    if (!score.ready) return null;
    return Math.round(score.score - todayEntriesTotal);
  }, [score.ready, score.score, todayEntriesTotal]);

  const handleAddSubmit = async (input: {
    amount: number;
    category: CategoryKey | null;
    notes: string;
    spentAt?: string;
  }) => {
    try {
      await addEntry({
        amount: input.amount,
        category: input.category,
        notes: input.notes.trim() || null,
        spentAt: input.spentAt,
        scoreAtLog: score.ready ? score.score : null,
      });
      void haptics.success();
      setToast({
        tone: "positive",
        message: `Added ${formatINR(Math.round(input.amount))}. Running total: ${formatINR(Math.round(todayEntriesTotal + input.amount))}.`,
      });
      setAddOpen(false);
    } catch (err) {
      setToast({
        tone: "warning",
        message: err instanceof Error ? err.message : "Couldn't save. Try again.",
      });
    }
  };

  const handleEditSubmit = async (input: {
    amount: number;
    category: CategoryKey | null;
    notes: string;
    spentAt?: string;
  }) => {
    if (!editEntry) return;
    try {
      await updateEntry(editEntry.id, {
        amount: input.amount,
        category: input.category,
        notes: input.notes.trim() || null,
        spentAt: input.spentAt,
      });
      void haptics.tapMedium();
      setToast({ tone: "neutral", message: "Entry updated." });
      setEditEntry(null);
    } catch (err) {
      setToast({
        tone: "warning",
        message: err instanceof Error ? err.message : "Couldn't update. Try again.",
      });
    }
  };

  const handleDelete = async (entry: SpendEntry) => {
    try {
      await deleteEntry(entry.id);
      void haptics.selection();
      setToast({ tone: "neutral", message: "Entry deleted." });
      setEditEntry(null);
    } catch (err) {
      setToast({
        tone: "warning",
        message: err instanceof Error ? err.message : "Couldn't delete. Try again.",
      });
    }
  };

  const handleConfirm = async (notes: string) => {
    try {
      await confirmDay({
        notes: notes.trim() || null,
        scoreAtLog: score.ready ? score.score : null,
      });
      void haptics.success();
      // Tone-matched toast against today's running total vs score.
      let tone: ToastTone = "neutral";
      let message = `Day confirmed. Total: ${formatINR(Math.round(todayEntriesTotal))}.`;
      if (scoreDiff != null) {
        if (scoreDiff > 0) {
          tone = "positive";
          message = `Good job! ${formatINR(scoreDiff)} under your daily score.`;
        } else if (scoreDiff < 0) {
          tone = "warning";
          message = `You went ${formatINR(Math.abs(scoreDiff))} over today. Score adjusted.`;
          void haptics.warning();
        } else {
          message = "Right on target!";
        }
      }
      setToast({ tone, message });
      setConfirmOpen(false);
    } catch (err) {
      setToast({
        tone: "warning",
        message: err instanceof Error ? err.message : "Couldn't confirm. Try again.",
      });
    }
  };

  return (
    <IonPage>
      <IonContent fullscreen>
        <main
          className="amban-screen"
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}
        >
          {/* Header */}
          <header
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "var(--space-md) var(--space-xs) 0",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span
                style={{
                  fontSize: "var(--text-caption)",
                  color: "var(--text-muted)",
                  fontWeight: "var(--font-weight-medium)",
                  letterSpacing: "0.02em",
                }}
              >
                Today
              </span>
              <h1
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "var(--text-h1)",
                  fontWeight: "var(--font-weight-bold)",
                  color: "var(--text-strong)",
                  margin: 0,
                }}
              >
                Log your spends
              </h1>
            </div>
            <button
              type="button"
              onClick={() => history.push("/log/history")}
              aria-label="View log history"
              style={{
                minHeight: 40,
                padding: "var(--space-xs) var(--space-sm)",
                borderRadius: "var(--radius-pill)",
                backgroundColor: "var(--surface-sunken)",
                color: "var(--text-muted)",
                border: "none",
                fontSize: "var(--text-caption)",
                fontWeight: "var(--font-weight-semibold)",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <IonIcon icon={Icons.status.calendar} aria-hidden="true" />
              History
            </button>
          </header>

          {/* Running total banner */}
          <section
            style={{
              padding: "var(--space-lg)",
              borderRadius: "var(--radius-lg)",
              backgroundColor: "var(--surface-raised)",
              boxShadow: "var(--shadow-card)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-xs)",
            }}
          >
            <span
              style={{
                fontSize: "var(--text-caption)",
                color: "var(--text-muted)",
                fontWeight: "var(--font-weight-medium)",
              }}
            >
              {isConfirmed ? "Confirmed total" : "Running total"}
            </span>
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "var(--text-score)",
                fontWeight: "var(--font-weight-bold)",
                color: "var(--text-strong)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatINR(Math.round(todayEntriesTotal))}
            </span>
            {scoreDiff != null ? (
              <span
                style={{
                  fontSize: "var(--text-caption)",
                  color:
                    scoreDiff > 0
                      ? "var(--color-score-excellent)"
                      : scoreDiff < 0
                        ? "var(--color-score-warning)"
                        : "var(--text-muted)",
                  fontWeight: "var(--font-weight-semibold)",
                }}
              >
                {scoreDiff > 0
                  ? `${formatINR(scoreDiff)} under your score`
                  : scoreDiff < 0
                    ? `${formatINR(Math.abs(scoreDiff))} over your score`
                    : "Right on your score"}
              </span>
            ) : null}
            <span
              style={{
                fontSize: "var(--text-caption)",
                color: "var(--text-muted)",
                marginTop: "var(--space-xs)",
              }}
            >
              {todayEntries.length === 0
                ? "No entries yet."
                : `${todayEntries.length} ${todayEntries.length === 1 ? "entry" : "entries"}`}
              {isConfirmed ? " · sealed, edits open till midnight" : ""}
            </span>
          </section>

          {/* Primary add CTA */}
          <button
            type="button"
            onClick={() => {
              void haptics.selection();
              setAddOpen(true);
            }}
            style={{
              minHeight: 56,
              padding: "var(--space-sm) var(--space-lg)",
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--color-primary)",
              color: "#ffffff",
              border: "none",
              fontFamily: "var(--font-body)",
              fontSize: "var(--text-body)",
              fontWeight: "var(--font-weight-semibold)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "var(--space-xs)",
              cursor: "pointer",
            }}
          >
            <IonIcon icon={Icons.action.add} aria-hidden="true" />
            Add spend entry
          </button>

          {/* Entries list */}
          {todayEntries.length === 0 ? (
            <div
              style={{
                padding: "var(--space-xl) var(--space-md)",
                borderRadius: "var(--radius-md)",
                backgroundColor: "var(--surface-sunken)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "var(--space-xs)",
                textAlign: "center",
              }}
            >
              <IonIcon
                icon={Icons.nav.log}
                aria-hidden="true"
                style={{ fontSize: 28, color: "var(--text-muted)" }}
              />
              <span style={{ fontSize: "var(--text-body)", color: "var(--text-muted)" }}>
                Nothing logged yet today.
              </span>
              <span
                style={{
                  fontSize: "var(--text-caption)",
                  color: "var(--text-muted)",
                  lineHeight: "var(--line-height-body)",
                }}
              >
                Tap "Add spend entry" for each purchase — amban rolls them up into today's total.
              </span>
            </div>
          ) : (
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-xs)",
              }}
            >
              {todayEntries.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  onEdit={() => {
                    void haptics.selection();
                    setEditEntry(entry);
                  }}
                />
              ))}
            </ul>
          )}

          {/* Confirmation CTA */}
          {todayEntries.length > 0 && !isConfirmed ? (
            <button
              type="button"
              onClick={() => {
                void haptics.selection();
                setConfirmOpen(true);
              }}
              style={{
                minHeight: "var(--hit-target-min)",
                padding: "var(--space-sm) var(--space-lg)",
                borderRadius: "var(--radius-md)",
                backgroundColor: "var(--surface-raised)",
                color: "var(--color-primary-dark)",
                border: "1.5px solid var(--color-primary)",
                fontSize: "var(--text-body)",
                fontWeight: "var(--font-weight-semibold)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "var(--space-xs)",
                cursor: "pointer",
              }}
            >
              <IonIcon icon={Icons.action.checkCircle} aria-hidden="true" />
              I'm done for today — confirm total
            </button>
          ) : null}

          {isConfirmed ? (
            <div
              role="status"
              style={{
                padding: "var(--space-sm) var(--space-md)",
                borderRadius: "var(--radius-md)",
                backgroundColor: "rgba(30, 140, 69, 0.10)",
                color: "var(--color-score-excellent)",
                fontSize: "var(--text-caption)",
                fontWeight: "var(--font-weight-semibold)",
                display: "flex",
                alignItems: "center",
                gap: "var(--space-xs)",
              }}
            >
              <IonIcon icon={Icons.action.check} aria-hidden="true" />
              Day confirmed. You can still edit entries until midnight.
            </div>
          ) : null}

          {/* Stale-log backfill entry */}
          {staleLogs ? (
            <button
              type="button"
              onClick={() => setBackfillOpen(true)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-sm)",
                padding: "var(--space-md)",
                borderRadius: "var(--radius-md)",
                backgroundColor: "rgba(242, 153, 0, 0.12)",
                color: "var(--color-score-good)",
                border: "none",
                fontSize: "var(--text-caption)",
                fontWeight: "var(--font-weight-semibold)",
                cursor: "pointer",
              }}
            >
              <IonIcon icon={Icons.status.time} aria-hidden="true" />
              You haven't logged in a while. Tap to backfill missed days.
            </button>
          ) : null}

          {/* Toast */}
          {toast ? (
            <div
              role="status"
              aria-live="polite"
              style={{
                padding: "var(--space-sm) var(--space-md)",
                borderRadius: "var(--radius-md)",
                backgroundColor: TOAST_TINT[toast.tone],
                color: TOAST_COLOR[toast.tone],
                fontSize: "var(--text-caption)",
                fontWeight: "var(--font-weight-semibold)",
              }}
            >
              {toast.message}
            </div>
          ) : null}
        </main>

        <EntrySheet
          open={addOpen}
          onDismiss={() => setAddOpen(false)}
          title="Add spend entry"
          onSubmit={handleAddSubmit}
        />

        <EntrySheet
          open={editEntry != null}
          onDismiss={() => setEditEntry(null)}
          title="Edit entry"
          initial={
            editEntry
              ? {
                  amount: editEntry.amount,
                  category: editEntry.category,
                  notes: editEntry.notes ?? "",
                  spentAt: editEntry.spentAt,
                }
              : undefined
          }
          onSubmit={handleEditSubmit}
          onDelete={editEntry ? () => handleDelete(editEntry) : undefined}
        />

        <ConfirmDaySheet
          open={confirmOpen}
          onDismiss={() => setConfirmOpen(false)}
          total={todayEntriesTotal}
          entryCount={todayEntries.length}
          scoreDiff={scoreDiff}
          onConfirm={handleConfirm}
        />

        <BackfillSheet
          open={backfillOpen}
          onDismiss={() => setBackfillOpen(false)}
          existingLogDates={new Set(logs.map((l) => l.logDate))}
          onSubmit={async (entries) => {
            if (entries.length === 0) return;
            await backfillLogs(
              entries.map((e) => ({
                amount: e.amount,
                logDate: e.logDate,
                scoreAtLog: score.ready ? score.score : null,
              })),
            );
            setBackfillOpen(false);
            setToast({ tone: "positive", message: `Backfilled ${entries.length} days.` });
            void haptics.tapMedium();
          }}
        />
      </IonContent>
    </IonPage>
  );
};

/* ==================================================================
 * Entry row
 * ================================================================== */

const EntryRow: React.FC<{ entry: SpendEntry; onEdit: () => void }> = ({ entry, onEdit }) => {
  const cat = entry.category ? CATEGORIES.find((c) => c.key === entry.category) : null;
  return (
    <li>
      <button
        type="button"
        onClick={onEdit}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-sm)",
          padding: "var(--space-sm) var(--space-md)",
          borderRadius: "var(--radius-md)",
          backgroundColor: "var(--surface-raised)",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          minHeight: 60,
        }}
      >
        <span
          style={{
            width: 40,
            height: 40,
            borderRadius: "var(--radius-pill)",
            backgroundColor: cat ? `${cat.colorHex}22` : "var(--surface-sunken)",
            color: cat ? cat.colorHex : "var(--text-muted)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
          aria-hidden="true"
        >
          <IonIcon icon={cat ? CATEGORY_ICONS[cat.key] : Icons.finance.wallet} />
        </span>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <span
            style={{
              fontSize: "var(--text-body)",
              fontWeight: "var(--font-weight-semibold)",
              color: "var(--text-strong)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatINR(Math.round(entry.amount))}
          </span>
          <span
            style={{
              fontSize: "var(--text-caption)",
              color: "var(--text-muted)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {cat?.label ?? "Uncategorised"}
            {entry.notes ? ` · ${entry.notes}` : ""}
          </span>
        </div>
        <span
          style={{
            fontSize: "var(--text-caption)",
            color: "var(--text-muted)",
            flexShrink: 0,
          }}
        >
          {formatEntryTime(entry.spentAt)}
        </span>
      </button>
    </li>
  );
};

/* ==================================================================
 * Entry add / edit sheet
 * ================================================================== */

interface EntryFormValue {
  amount: number;
  category: CategoryKey | null;
  notes: string;
  spentAt?: string;
}

interface EntrySheetProps {
  open: boolean;
  onDismiss: () => void;
  title: string;
  initial?: {
    amount: number;
    category: CategoryKey | null;
    notes: string;
    spentAt: string;
  };
  onSubmit: (value: EntryFormValue) => Promise<void>;
  onDelete?: () => Promise<void>;
}

const EntrySheet: React.FC<EntrySheetProps> = ({
  open,
  onDismiss,
  title,
  initial,
  onSubmit,
  onDelete,
}) => {
  const [amount, setAmount] = useState<number | null>(initial?.amount ?? null);
  const [category, setCategory] = useState<CategoryKey | null>(initial?.category ?? null);
  const [notes, setNotes] = useState<string>(initial?.notes ?? "");
  const [busy, setBusy] = useState(false);

  // Re-seed on open so edit sheet shows the latest entry.
  useEffect(() => {
    if (open) {
      setAmount(initial?.amount ?? null);
      setCategory(initial?.category ?? null);
      setNotes(initial?.notes ?? "");
    }
  }, [open, initial?.amount, initial?.category, initial?.notes]);

  const canSave = amount != null && amount > 0 && !busy;

  const handleQuickAmount = (delta: number) => {
    void haptics.selection();
    setAmount((prev) => (prev ?? 0) + delta);
  };

  const handleSave = async () => {
    if (!canSave || amount == null) return;
    setBusy(true);
    try {
      await onSubmit({
        amount,
        category,
        notes,
        spentAt: initial?.spentAt,
      });
      setAmount(null);
      setCategory(null);
      setNotes("");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    setBusy(true);
    try {
      await onDelete();
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet open={open} onDismiss={onDismiss} title={title} initialBreakpoint={0.9}>
      <CurrencyInput
        label="Amount"
        value={amount}
        onChange={setAmount}
        autoFocus={open && amount == null}
        placeholder="120"
      />

      <div
        style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-xs)" }}
        role="group"
        aria-label="Quick amounts"
      >
        {QUICK_AMOUNTS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => handleQuickAmount(value)}
            style={{
              minHeight: 40,
              padding: "var(--space-xs) var(--space-md)",
              borderRadius: "var(--radius-pill)",
              backgroundColor: "var(--surface-sunken)",
              color: "var(--text-strong)",
              border: "none",
              fontSize: "var(--text-caption)",
              fontWeight: "var(--font-weight-semibold)",
              cursor: "pointer",
            }}
          >
            +{formatINR(value)}
          </button>
        ))}
        {amount != null && amount > 0 ? (
          <button
            type="button"
            onClick={() => {
              void haptics.selection();
              setAmount(null);
            }}
            style={{
              minHeight: 40,
              padding: "var(--space-xs) var(--space-md)",
              borderRadius: "var(--radius-pill)",
              backgroundColor: "transparent",
              color: "var(--text-muted)",
              border: "1px solid var(--divider)",
              fontSize: "var(--text-caption)",
              fontWeight: "var(--font-weight-medium)",
              cursor: "pointer",
            }}
          >
            Clear
          </button>
        ) : null}
      </div>

      <span
        style={{
          fontSize: "var(--text-caption)",
          fontWeight: "var(--font-weight-medium)",
          color: "var(--text-muted)",
        }}
      >
        Category
      </span>
      <div
        role="radiogroup"
        aria-label="Spend category"
        style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-xs)" }}
      >
        <button
          type="button"
          role="radio"
          aria-checked={category == null}
          onClick={() => {
            void haptics.selection();
            setCategory(null);
          }}
          style={{
            minHeight: 36,
            padding: "var(--space-xs) var(--space-sm)",
            borderRadius: "var(--radius-pill)",
            backgroundColor:
              category == null ? "var(--color-primary-light)" : "var(--surface-sunken)",
            color: category == null ? "var(--color-primary-dark)" : "var(--text-muted)",
            border: "none",
            fontSize: "var(--text-caption)",
            fontWeight: "var(--font-weight-medium)",
          }}
        >
          None
        </button>
        {CATEGORIES.map((cat) => {
          const selected = category === cat.key;
          return (
            <button
              key={cat.key}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                void haptics.selection();
                setCategory(cat.key);
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "var(--space-xs) var(--space-sm)",
                minHeight: 36,
                borderRadius: "var(--radius-pill)",
                border: selected ? `1.5px solid ${cat.colorHex}` : "1.5px solid transparent",
                backgroundColor: selected ? `${cat.colorHex}22` : "var(--surface-sunken)",
                color: selected ? cat.colorHex : "var(--text-muted)",
                fontSize: "var(--text-caption)",
                fontWeight: "var(--font-weight-medium)",
              }}
            >
              <IonIcon icon={CATEGORY_ICONS[cat.key]} aria-hidden="true" />
              {cat.label}
            </button>
          );
        })}
      </div>

      <label
        htmlFor="entry-notes"
        style={{
          fontSize: "var(--text-caption)",
          fontWeight: "var(--font-weight-medium)",
          color: "var(--text-muted)",
        }}
      >
        Notes (optional)
      </label>
      <textarea
        id="entry-notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Auto to office, groceries at Reliance…"
        maxLength={240}
        rows={2}
        style={{
          width: "100%",
          minHeight: 60,
          padding: "var(--space-sm) var(--space-md)",
          borderRadius: "var(--radius-md)",
          backgroundColor: "var(--surface-sunken)",
          border: "1px solid transparent",
          fontSize: "var(--text-body)",
          color: "var(--text-strong)",
          fontFamily: "var(--font-body)",
          resize: "vertical",
          outline: "none",
        }}
      />

      <div style={{ display: "flex", gap: "var(--space-sm)" }}>
        {onDelete ? (
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy}
            style={{
              minHeight: "var(--hit-target-min)",
              padding: "var(--space-sm) var(--space-md)",
              borderRadius: "var(--radius-md)",
              backgroundColor: "transparent",
              color: "var(--color-score-warning)",
              border: "1px solid var(--color-score-warning)",
              fontFamily: "var(--font-body)",
              fontSize: "var(--text-body)",
              fontWeight: "var(--font-weight-semibold)",
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            Delete
          </button>
        ) : null}
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          style={{
            flex: 1,
            minHeight: "var(--hit-target-min)",
            padding: "var(--space-sm) var(--space-lg)",
            borderRadius: "var(--radius-md)",
            backgroundColor: canSave ? "var(--color-primary)" : "var(--surface-sunken)",
            color: canSave ? "#ffffff" : "var(--text-muted)",
            border: "none",
            fontFamily: "var(--font-body)",
            fontSize: "var(--text-body)",
            fontWeight: "var(--font-weight-semibold)",
            cursor: canSave ? "pointer" : "not-allowed",
          }}
        >
          {busy ? "Saving…" : initial ? "Save changes" : "Add entry"}
        </button>
      </div>
    </BottomSheet>
  );
};

/* ==================================================================
 * End-of-day confirmation sheet
 * ================================================================== */

interface ConfirmDaySheetProps {
  open: boolean;
  onDismiss: () => void;
  total: number;
  entryCount: number;
  scoreDiff: number | null;
  onConfirm: (notes: string) => Promise<void>;
}

const ConfirmDaySheet: React.FC<ConfirmDaySheetProps> = ({
  open,
  onDismiss,
  total,
  entryCount,
  scoreDiff,
  onConfirm,
}) => {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setNotes("");
  }, [open]);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm(notes);
      setNotes("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet open={open} onDismiss={onDismiss} title="Confirm today's total" initialBreakpoint={0.75}>
      <p
        style={{
          margin: 0,
          fontSize: "var(--text-body)",
          color: "var(--text-muted)",
          lineHeight: "var(--line-height-body)",
        }}
      >
        Locking in today's total as your final spend. You can still edit entries until midnight if
        something slipped through.
      </p>

      <div
        style={{
          padding: "var(--space-lg)",
          borderRadius: "var(--radius-md)",
          backgroundColor: "var(--surface-sunken)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-xs)",
          alignItems: "center",
          textAlign: "center",
        }}
      >
        <span
          style={{
            fontSize: "var(--text-caption)",
            color: "var(--text-muted)",
            fontWeight: "var(--font-weight-medium)",
          }}
        >
          {entryCount} {entryCount === 1 ? "entry" : "entries"} · total
        </span>
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "var(--text-score)",
            fontWeight: "var(--font-weight-bold)",
            color: "var(--text-strong)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatINR(Math.round(total))}
        </span>
        {scoreDiff != null ? (
          <span
            style={{
              fontSize: "var(--text-caption)",
              fontWeight: "var(--font-weight-semibold)",
              color:
                scoreDiff > 0
                  ? "var(--color-score-excellent)"
                  : scoreDiff < 0
                    ? "var(--color-score-warning)"
                    : "var(--text-muted)",
            }}
          >
            {scoreDiff > 0
              ? `${formatINR(scoreDiff)} under your daily score`
              : scoreDiff < 0
                ? `${formatINR(Math.abs(scoreDiff))} over your daily score`
                : "Right on your score"}
          </span>
        ) : null}
      </div>

      <label
        htmlFor="confirm-notes"
        style={{
          fontSize: "var(--text-caption)",
          fontWeight: "var(--font-weight-medium)",
          color: "var(--text-muted)",
        }}
      >
        Headline note for today (optional)
      </label>
      <textarea
        id="confirm-notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Heavy day. Friend's birthday dinner."
        maxLength={240}
        rows={2}
        style={{
          width: "100%",
          minHeight: 60,
          padding: "var(--space-sm) var(--space-md)",
          borderRadius: "var(--radius-md)",
          backgroundColor: "var(--surface-sunken)",
          border: "1px solid transparent",
          fontSize: "var(--text-body)",
          color: "var(--text-strong)",
          fontFamily: "var(--font-body)",
          resize: "vertical",
          outline: "none",
        }}
      />

      <button
        type="button"
        onClick={handleConfirm}
        disabled={busy}
        style={{
          minHeight: "var(--hit-target-min)",
          padding: "var(--space-sm) var(--space-lg)",
          borderRadius: "var(--radius-md)",
          backgroundColor: "var(--color-primary)",
          color: "#ffffff",
          border: "none",
          fontFamily: "var(--font-body)",
          fontSize: "var(--text-body)",
          fontWeight: "var(--font-weight-semibold)",
          cursor: busy ? "not-allowed" : "pointer",
        }}
      >
        {busy ? "Confirming…" : "Confirm today's total"}
      </button>
    </BottomSheet>
  );
};

/* ==================================================================
 * Backfill sheet (§13.6) — unchanged from v0.1.0
 * ================================================================== */

interface BackfillEntry {
  logDate: string;
  amount: number;
}

interface BackfillSheetProps {
  open: boolean;
  onDismiss: () => void;
  existingLogDates: Set<string>;
  onSubmit: (entries: BackfillEntry[]) => Promise<void>;
}

const BackfillSheet: React.FC<BackfillSheetProps> = ({
  open,
  onDismiss,
  existingLogDates,
  onSubmit,
}) => {
  const [date, setDate] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [batch, setBatch] = useState<BackfillEntry[]>([]);
  const [busy, setBusy] = useState(false);

  const maxDate = todayIso();
  const canAdd = date != null && amount != null && amount >= 0 && !busy;

  const handleAdd = () => {
    if (!canAdd || date == null || amount == null) return;
    setBatch((prev) => {
      const filtered = prev.filter((b) => b.logDate !== date);
      return [...filtered, { logDate: date, amount }].sort((a, b) =>
        a.logDate < b.logDate ? -1 : 1,
      );
    });
    setDate(null);
    setAmount(null);
    void haptics.selection();
  };

  const handleSubmit = async () => {
    setBusy(true);
    try {
      await onSubmit(batch);
      setBatch([]);
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = batch.length > 0 && !busy;

  const existingWarning = useMemo(() => {
    if (!date) return null;
    if (existingLogDates.has(date)) {
      return "A log already exists for this date — adding will overwrite it.";
    }
    return null;
  }, [date, existingLogDates]);

  return (
    <BottomSheet open={open} onDismiss={onDismiss} title="Backfill missed days" initialBreakpoint={0.75}>
      <p
        style={{
          fontSize: "var(--text-body)",
          color: "var(--text-muted)",
          margin: 0,
          lineHeight: "var(--line-height-body)",
        }}
      >
        Add amounts for days you missed. They all save together once you're done.
      </p>

      <DatePicker value={date} onChange={setDate} label="Date" max={maxDate} />
      <CurrencyInput value={amount} onChange={setAmount} label="Amount" />

      {existingWarning ? (
        <p style={{ fontSize: "var(--text-caption)", color: "var(--color-score-good)", margin: 0 }}>
          {existingWarning}
        </p>
      ) : null}

      <button
        type="button"
        onClick={handleAdd}
        disabled={!canAdd}
        style={{
          minHeight: "var(--hit-target-min)",
          padding: "var(--space-sm) var(--space-md)",
          borderRadius: "var(--radius-md)",
          backgroundColor: canAdd ? "var(--color-primary-light)" : "var(--surface-sunken)",
          color: canAdd ? "var(--color-primary-dark)" : "var(--text-muted)",
          border: "none",
          fontFamily: "var(--font-body)",
          fontSize: "var(--text-body)",
          fontWeight: "var(--font-weight-semibold)",
          cursor: canAdd ? "pointer" : "not-allowed",
        }}
      >
        Add to batch
      </button>

      {batch.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
          <span
            style={{
              fontSize: "var(--text-caption)",
              fontWeight: "var(--font-weight-medium)",
              color: "var(--text-muted)",
            }}
          >
            Batch ({batch.length})
          </span>
          {batch.map((entry) => (
            <div
              key={entry.logDate}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "var(--space-sm) var(--space-md)",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "var(--surface-sunken)",
                fontSize: "var(--text-caption)",
              }}
            >
              <span style={{ color: "var(--text-muted)" }}>{entry.logDate}</span>
              <span
                style={{
                  color: "var(--text-strong)",
                  fontWeight: "var(--font-weight-semibold)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatINR(entry.amount)}
              </span>
              <button
                type="button"
                aria-label={`Remove ${entry.logDate}`}
                onClick={() => setBatch((prev) => prev.filter((b) => b.logDate !== entry.logDate))}
                style={{
                  minWidth: 28,
                  minHeight: 28,
                  borderRadius: "var(--radius-pill)",
                  border: "none",
                  backgroundColor: "transparent",
                  color: "var(--text-muted)",
                }}
              >
                <IonIcon icon={Icons.action.close} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        style={{
          minHeight: "var(--hit-target-min)",
          padding: "var(--space-sm) var(--space-lg)",
          borderRadius: "var(--radius-md)",
          backgroundColor: canSubmit ? "var(--color-primary)" : "var(--surface-sunken)",
          color: canSubmit ? "#ffffff" : "var(--text-muted)",
          border: "none",
          fontFamily: "var(--font-body)",
          fontSize: "var(--text-body)",
          fontWeight: "var(--font-weight-semibold)",
          cursor: canSubmit ? "pointer" : "not-allowed",
        }}
      >
        {busy ? "Saving…" : `Save ${batch.length} entries`}
      </button>
    </BottomSheet>
  );
};

export default DailyLogScreen;
