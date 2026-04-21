/**
 * screens/Log/DailyLogScreen.tsx — daily spend capture surface.
 *
 * Source of truth: CLAUDE.md §6.2 (Daily Use Flow), §9.2 (Daily Log
 * Screen), §8.4 (Score History), §13.6 (backfill), and Appendix F
 * (Haptics & Micro-interactions).
 *
 * Responsibilities:
 *   - Capture today's spend via a large numeric input (₹), with quick-
 *     amount chips that add to the running total so a user can tap
 *     "₹500" three times and land on ₹1,500 without a keyboard.
 *   - Optional free-text notes and optional category tag (from
 *     Appendix C) — neither is required to save.
 *   - On save, call `dailyStore.logSpend({ scoreAtLog, ... })`. The
 *     score at the moment of logging is captured from `useAmbanScore`
 *     so the history view can show the "under / over / on-target" dot
 *     even after the live score has since changed (§8.4).
 *   - Post-save feedback: a transient toast with the matching tone
 *     (success / neutral / warning) and the matching Appendix F haptic.
 *   - Entry point into the backfill flow when logs are stale (§13.6).
 *     The backfill sheet itself lives below — it's a DailyLogScreen
 *     concern because there's no other entry point that needs it.
 *
 * Design rules:
 *   - Writes go through `dailyStore.logSpend` which upserts on log_date,
 *     so re-logging today replaces the existing row. The UI treats
 *     "logged today" as a soft edit flow — we prefill the input with
 *     the existing amount and swap the CTA to "Update".
 *   - Never surface negative or NaN amounts to the store. The amount
 *     input clamps at 0 and rejects garbage; notes are trimmed on save.
 *   - The screen is rendered inside AppShell, so the bottom nav stays
 *     visible. The footer CTA respects the safe-area inset + nav height.
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

import { CATEGORY_ICONS, Icons } from "../../theme/icons";
import { formatINR } from "../../utils/formatters";
import { haptics } from "../../utils/haptics";

/** Quick-amount chips from §9.2. Kept small and additive by design. */
const QUICK_AMOUNTS = [100, 500, 1000, 2000] as const;

/** Soft toast tone — drives colour + haptic variant. */
type ToastTone = "positive" | "neutral" | "warning";

interface Toast {
  tone: ToastTone;
  message: string;
}

/** Today's ISO date — local calendar. */
function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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

const DailyLogScreen: React.FC = () => {
  const history = useHistory();

  const score = useAmbanScore();
  const logSpend = useDailyStore((s) => s.logSpend);
  const todayLog = useDailyStore((s) => s.todayLog);
  const logs = useDailyStore((s) => s.logs);
  const backfillLogs = useDailyStore((s) => s.backfillLogs);

  // Prefill with the existing log for today (edit flow) when present.
  const [amount, setAmount] = useState<number | null>(todayLog?.spent ?? null);
  const [notes, setNotes] = useState<string>(todayLog?.notes ?? "");
  const [category, setCategory] = useState<CategoryKey | null>(todayLog?.category ?? null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [backfillOpen, setBackfillOpen] = useState(false);

  // Reflect the store when `todayLog` changes (e.g. another tab / a
  // backfill just re-wrote today's row). The local draft wins while
  // the user is actively editing — we only sync when the draft is
  // still at its initial value.
  useEffect(() => {
    if (todayLog) {
      setAmount((prev) => (prev == null ? todayLog.spent : prev));
      setNotes((prev) => (prev.length === 0 ? (todayLog.notes ?? "") : prev));
      setCategory((prev) => prev ?? todayLog.category);
    }
  }, [todayLog]);

  // Auto-dismiss the toast after a beat. Keeps the surface quiet.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2_800);
    return () => clearTimeout(t);
  }, [toast]);

  const canSave = amount != null && amount >= 0 && !busy;

  const handleQuickAmount = (delta: number) => {
    void haptics.selection();
    setAmount((prev) => (prev ?? 0) + delta);
  };

  const handleSave = async () => {
    if (!canSave || amount == null) return;
    setBusy(true);
    try {
      const stored = await logSpend({
        amount,
        notes: notes.trim() || null,
        category,
        scoreAtLog: score.ready ? score.score : null,
      });

      // Post-save feedback — tone against the score at log time.
      const scoreAtLog = stored.scoreAtLog ?? null;
      let tone: ToastTone = "neutral";
      let message = "Logged.";
      if (scoreAtLog != null) {
        const diff = scoreAtLog - amount;
        if (diff > 0) {
          tone = "positive";
          message = `Good job! ${formatINR(Math.round(diff))} saved vs your daily score.`;
        } else if (diff < 0) {
          tone = "warning";
          message = `You went ${formatINR(Math.round(Math.abs(diff)))} over today. Score adjusted.`;
        } else {
          tone = "neutral";
          message = "Right on target!";
        }
      }
      setToast({ tone, message });

      if (tone === "positive") void haptics.success();
      else if (tone === "warning") void haptics.warning();
      else void haptics.tapMedium();
    } catch (err) {
      setToast({
        tone: "warning",
        message: err instanceof Error ? err.message : "Couldn't save. Try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  const isEditing = todayLog != null;
  const staleLogs = score.warnings.includes("stale-logs");

  return (
    <IonPage>
      <IonContent fullscreen>
        <main
          className="amban-screen"
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}
        >
          {/* Header row */}
          <header
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "var(--space-md) var(--space-xs) var(--space-sm)",
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
                {isEditing ? "Update your spend" : "What did today cost?"}
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

          {/* Amount input */}
          <CurrencyInput
            label="I spent"
            value={amount}
            onChange={setAmount}
            autoFocus={!isEditing}
            placeholder="2,000"
          />

          {/* Quick-amount chips */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "var(--space-xs)",
            }}
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
                  setAmount(0);
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

          {/* Notes */}
          <label
            htmlFor="log-notes"
            style={{
              fontSize: "var(--text-caption)",
              fontWeight: "var(--font-weight-medium)",
              color: "var(--text-muted)",
            }}
          >
            Notes (optional)
          </label>
          <textarea
            id="log-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Groceries, auto fare, coffee…"
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

          {/* Category chips */}
          <span
            style={{
              fontSize: "var(--text-caption)",
              fontWeight: "var(--font-weight-medium)",
              color: "var(--text-muted)",
            }}
          >
            Category (optional)
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

          {/* Save CTA */}
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            style={{
              marginTop: "var(--space-sm)",
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
            {busy ? "Saving…" : isEditing ? "Update spend" : "Save spend"}
          </button>
        </main>

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

/* ------------------------------------------------------------------
 * Backfill sheet (§13.6)
 *
 * Minimal UI: pick a date, enter an amount, add to the batch list,
 * repeat as needed. Submit in one atomic transaction via
 * dailyStore.backfillLogs. Intentionally sparse — backfilling should
 * feel like catching up, not a bureaucratic form.
 * ------------------------------------------------------------------ */

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
    // Replace existing draft for the same date (avoid dupes in the batch).
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
    <BottomSheet
      open={open}
      onDismiss={onDismiss}
      title="Backfill missed days"
      initialBreakpoint={0.75}
    >
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
        <p
          style={{
            fontSize: "var(--text-caption)",
            color: "var(--color-score-good)",
            margin: 0,
          }}
        >
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
