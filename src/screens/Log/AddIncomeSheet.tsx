/**
 * screens/Log/AddIncomeSheet.tsx — bottom sheet for logging burst income.
 *
 * Source of truth: CLAUDE.md §6.6 (Burst Income / Manual Credit Flow).
 *
 * Mental model
 * ------------
 * The income-side mirror of the daily spend log. Uses the same
 * CurrencyInput, the same bottom-sheet pattern, and the same
 * toast/haptic vocabulary so the user doesn't context-switch.
 *
 * Fields:
 *   - Amount (₹, via CurrencyInput)
 *   - Label (free text — "Freelance — logo design", "Refund — Amazon")
 *   - Date (defaults to today; back-dating allowed)
 *
 * In edit mode (`editCredit` prop), the sheet pre-fills all fields.
 * Since the store exposes only add/delete (no update), editing is
 * implemented as delete-then-add — transparent to the user.
 *
 * Design rules
 * ------------
 *   - Green accent (`--color-score-excellent`) for the save button to
 *     visually distinguish from the blue spend flow.
 *   - Haptic ladder: success on save, error on delete-confirm (§F).
 *   - Same BottomSheet wrapper used everywhere else in the app.
 */

import { useCallback, useEffect, useState } from "react";
import { IonIcon } from "@ionic/react";

import BottomSheet from "../../components/ui/BottomSheet";
import CurrencyInput from "../../components/ui/CurrencyInput";
import DatePicker from "../../components/ui/DatePicker";

import { useFinanceStore } from "../../stores/financeStore";
import type { ManualCredit } from "../../stores/financeStore";

import { Icons } from "../../theme/icons";
import { formatINR } from "../../utils/formatters";
import { haptics } from "../../utils/haptics";

/* ------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------ */

/** Today's ISO date — local calendar. */
function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/* ------------------------------------------------------------------
 * Props
 * ------------------------------------------------------------------ */

export interface AddIncomeSheetProps {
  /** Controlled open state. */
  isOpen: boolean;
  /** Called when the sheet dismisses (backdrop, drag-down, save, or cancel). */
  onDismiss: () => void;
  /** Pre-fill fields (e.g. from external source acceptance). */
  prefill?: {
    amount?: number;
    label?: string;
    date?: string;
  };
  /** When set, the sheet operates in edit mode (delete old, save new). */
  editCredit?: ManualCredit;
  /** Called after a successful save/delete with a message suitable for a toast. */
  onSaved?: (message: string) => void;
}

/* ==================================================================
 * AddIncomeSheet
 * ================================================================== */

const AddIncomeSheet: React.FC<AddIncomeSheetProps> = ({
  isOpen,
  onDismiss,
  prefill,
  editCredit,
  onSaved,
}) => {
  const addManualCredit = useFinanceStore((s) => s.addManualCredit);
  const deleteManualCredit = useFinanceStore((s) => s.deleteManualCredit);

  const isEdit = editCredit != null;

  /* ---- form state ---- */
  const [amount, setAmount] = useState<number | null>(null);
  const [label, setLabel] = useState("");
  const [date, setDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ---- reset on open / edit target change ---- */
  useEffect(() => {
    if (!isOpen) return;
    if (editCredit) {
      setAmount(editCredit.amount);
      setLabel(editCredit.label);
      setDate(editCredit.creditedAt);
    } else if (prefill) {
      setAmount(prefill.amount ?? null);
      setLabel(prefill.label ?? "");
      setDate(prefill.date ?? todayIso());
    } else {
      setAmount(null);
      setLabel("");
      setDate(todayIso());
    }
    setError(null);
    setBusy(false);
  }, [isOpen, editCredit, prefill]);

  const canSave = amount != null && amount > 0 && label.trim().length > 0 && !busy;

  /* ---- save handler ---- */
  const handleSave = useCallback(async () => {
    if (amount == null || amount <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (!label.trim()) {
      setError("Give this income a short label.");
      return;
    }
    if (busy) return;

    setBusy(true);
    setError(null);
    try {
      // Edit = delete-then-add (store has no update method).
      if (isEdit && editCredit) {
        await deleteManualCredit(editCredit.id);
      }
      await addManualCredit({
        label: label.trim(),
        amount,
        creditedAt: date,
      });
      void haptics.success();
      const msg = isEdit
        ? `Income updated: ${formatINR(Math.round(amount))}`
        : `${formatINR(Math.round(amount))} income added`;
      onSaved?.(msg);
      onDismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save. Try again.");
      void haptics.warning();
    } finally {
      setBusy(false);
    }
  }, [
    amount,
    label,
    date,
    busy,
    isEdit,
    editCredit,
    addManualCredit,
    deleteManualCredit,
    onDismiss,
    onSaved,
  ]);

  /* ---- delete handler (edit mode only) ---- */
  const handleDelete = useCallback(async () => {
    if (!editCredit || busy) return;
    setBusy(true);
    try {
      await deleteManualCredit(editCredit.id);
      void haptics.error();
      onSaved?.(`Deleted: ${editCredit.label}`);
      onDismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete. Try again.");
    } finally {
      setBusy(false);
    }
  }, [editCredit, busy, deleteManualCredit, onDismiss, onSaved]);

  /* ---- render ---- */
  return (
    <BottomSheet
      open={isOpen}
      onDismiss={onDismiss}
      title={isEdit ? "Edit income" : "Add income"}
      initialBreakpoint={0.65}
      breakpoints={[0, 0.65, 1]}
    >
      {/* Amount */}
      <CurrencyInput
        label="Amount received"
        value={amount}
        onChange={setAmount}
        placeholder="0"
        autoFocus={!isEdit}
      />

      {/* Label */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
        <label
          htmlFor="income-label"
          style={{
            fontSize: "var(--text-caption)",
            fontWeight: "var(--font-weight-medium)",
            color: "var(--text-muted)",
            letterSpacing: "0.01em",
          }}
        >
          What's it for?
        </label>
        <input
          id="income-label"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Freelance, Refund — Amazon, Gift from Dad"
          inputMode="text"
          autoComplete="on"
          autoCorrect="on"
          autoCapitalize="words"
          spellCheck={true}
          style={{
            width: "100%",
            minHeight: "var(--hit-target-min)",
            padding: "var(--space-sm) var(--space-md)",
            borderRadius: "var(--radius-md)",
            backgroundColor: "var(--surface-sunken)",
            border: "1px solid transparent",
            fontSize: "var(--text-body)",
            color: "var(--text-strong)",
            fontFamily: "var(--font-body)",
            outline: "none",
          }}
        />
      </div>

      {/* Date */}
      <DatePicker
        label="Date received"
        value={date}
        onChange={(v) => setDate(v ?? todayIso())}
        max={todayIso()}
      />

      {/* Error */}
      {error ? (
        <p
          role="alert"
          style={{
            fontSize: "var(--text-caption)",
            color: "var(--color-score-warning)",
            margin: 0,
          }}
        >
          {error}
        </p>
      ) : null}

      {/* Actions */}
      <div style={{ display: "flex", gap: "var(--space-sm)" }}>
        {isEdit ? (
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy}
            aria-label="Delete this income"
            style={{
              minHeight: "var(--hit-target-min)",
              padding: "var(--space-sm) var(--space-md)",
              borderRadius: "var(--radius-md)",
              backgroundColor: "transparent",
              color: "var(--color-score-warning)",
              border: "1px solid var(--divider)",
              fontFamily: "var(--font-body)",
              fontSize: "var(--text-body)",
              fontWeight: "var(--font-weight-semibold)",
              cursor: busy ? "not-allowed" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <IonIcon icon={Icons.action.delete} aria-hidden="true" />
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
            backgroundColor: canSave ? "var(--color-score-excellent)" : "var(--surface-sunken)",
            color: canSave ? "#ffffff" : "var(--text-muted)",
            border: "none",
            fontFamily: "var(--font-body)",
            fontSize: "var(--text-body)",
            fontWeight: "var(--font-weight-semibold)",
            cursor: canSave ? "pointer" : "not-allowed",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--space-xs)",
          }}
        >
          <IonIcon icon={Icons.finance.cash} aria-hidden="true" />
          {busy ? "Saving\u2026" : isEdit ? "Update income" : "Save income"}
        </button>
      </div>
    </BottomSheet>
  );
};

export default AddIncomeSheet;
