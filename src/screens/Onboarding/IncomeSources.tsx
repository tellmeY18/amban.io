/**
 * screens/Onboarding/IncomeSources.tsx — Onboarding Step 3.
 *
 * NOTE: an earlier helper exported a placeholder `OnboardingIncomeSources`
 * component — that export was removed during Phase 7 because no caller
 * referenced it. The default export is the real screen.
 *
 * Source of truth: CLAUDE.md §6.1 (Onboarding → Income Sources):
 *   - Label (free text): e.g. "Salary at TCS"
 *   - Amount (number): e.g. ₹65,000
 *   - Credit Day (1–31): day of month the money hits
 *   - At least ONE income source required to proceed
 *
 * Design rules:
 *   - The list is authoritative — adding a row writes through to
 *     SQLite immediately (via financeStore.addIncomeSource). That way
 *     a user who force-quits mid-flow doesn't lose what they've typed,
 *     and the resume path (§13.8) just works without a draft layer.
 *   - Each row in the inline form is validated before the add button
 *     enables: label non-empty, amount > 0, credit day in [1, 31].
 *   - The "Continue" CTA is gated on having ≥1 active income source.
 */
import { useState } from "react";
import { IonIcon } from "@ionic/react";
import { useHistory } from "react-router-dom";

import StepLayout from "./StepLayout";
import { advanceOnboarding } from "./OnboardingStack";
import CurrencyInput from "../../components/ui/CurrencyInput";
import { useFinanceStore } from "../../stores/financeStore";
import type { IncomeSource } from "../../stores/financeStore";
import { Icons } from "../../theme/icons";
import { formatINR } from "../../utils/formatters";

/**
 * Inline add-source form state. Kept local — we never store a draft
 * income source anywhere but the DB, so there's nothing to restore.
 */
interface DraftSource {
  label: string;
  amount: number | null;
  creditDay: string; // raw string while typing; validated on add
}

const EMPTY_DRAFT: DraftSource = {
  label: "",
  amount: null,
  creditDay: "",
};

function validateDraft(draft: DraftSource): string | null {
  const label = draft.label.trim();
  if (label.length === 0) return "Give this income a label.";
  if (label.length > 40) return "Label is a bit too long — trim it to 40 characters.";
  if (draft.amount == null || draft.amount <= 0) {
    return "Enter how much you earn.";
  }
  const day = Number(draft.creditDay);
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    return "Credit day must be between 1 and 31.";
  }
  return null;
}

const IncomeRow: React.FC<{
  source: IncomeSource;
  onDelete: () => void;
}> = ({ source, onDelete }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "var(--space-md)",
      padding: "var(--space-md)",
      borderRadius: "var(--radius-md)",
      backgroundColor: "var(--surface-raised)",
      boxShadow: "var(--shadow-card)",
    }}
  >
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
      <span
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "var(--text-body)",
          fontWeight: "var(--font-weight-semibold)",
          color: "var(--text-strong)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {source.label}
      </span>
      <span
        style={{
          fontSize: "var(--text-caption)",
          color: "var(--text-muted)",
        }}
      >
        {formatINR(source.amount)} on the {source.creditDay}
        {ordinalSuffix(source.creditDay)}
      </span>
    </div>
    <button
      type="button"
      onClick={onDelete}
      aria-label={`Remove ${source.label}`}
      style={{
        minWidth: 40,
        minHeight: 40,
        borderRadius: "var(--radius-pill)",
        backgroundColor: "var(--surface-sunken)",
        color: "var(--text-muted)",
        border: "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <IonIcon icon={Icons.action.delete} aria-hidden="true" />
    </button>
  </div>
);

/** "1st / 2nd / 3rd / 4th …" without pulling a full i18n library. */
function ordinalSuffix(day: number): string {
  const j = day % 10;
  const k = day % 100;
  if (j === 1 && k !== 11) return "st";
  if (j === 2 && k !== 12) return "nd";
  if (j === 3 && k !== 13) return "rd";
  return "th";
}

const IncomeSources: React.FC = () => {
  const history = useHistory();
  const sources = useFinanceStore((s) => s.incomeSources);
  const addIncomeSource = useFinanceStore((s) => s.addIncomeSource);
  const deleteIncomeSource = useFinanceStore((s) => s.deleteIncomeSource);

  const [draft, setDraft] = useState<DraftSource>(EMPTY_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activeSources = sources.filter((s) => s.isActive);
  const canContinue = activeSources.length >= 1;

  const handleAdd = async () => {
    const err = validateDraft(draft);
    if (err) {
      setFormError(err);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await addIncomeSource({
        label: draft.label.trim(),
        amount: draft.amount ?? 0,
        creditDay: Number(draft.creditDay),
        isActive: true,
      });
      setDraft(EMPTY_DRAFT);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleContinue = async () => {
    if (!canContinue) return;
    await advanceOnboarding(history, 2);
  };

  return (
    <StepLayout
      stepIndex={2}
      title="What do you earn?"
      subtitle="Add every income that lands in your account — salary, freelance, rent."
      ctaLabel="Continue"
      ctaDisabled={!canContinue}
      onCta={handleContinue}
    >
      {activeSources.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {activeSources.map((source) => (
            <IncomeRow
              key={source.id}
              source={source}
              onDelete={() => void deleteIncomeSource(source.id)}
            />
          ))}
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-sm)",
          padding: "var(--space-md)",
          borderRadius: "var(--radius-md)",
          backgroundColor: "var(--surface-sunken)",
        }}
      >
        <label
          htmlFor="income-label"
          style={{
            fontSize: "var(--text-caption)",
            fontWeight: "var(--font-weight-medium)",
            color: "var(--text-muted)",
          }}
        >
          Label
        </label>
        <input
          id="income-label"
          type="text"
          placeholder="Salary"
          maxLength={40}
          value={draft.label}
          onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
          style={{
            minHeight: "var(--hit-target-min)",
            padding: "var(--space-sm) var(--space-md)",
            borderRadius: "var(--radius-md)",
            backgroundColor: "var(--surface-raised)",
            border: "1px solid transparent",
            fontSize: "var(--text-body)",
            color: "var(--text-strong)",
            outline: "none",
          }}
        />

        <CurrencyInput
          label="Amount"
          value={draft.amount}
          onChange={(v) => setDraft((d) => ({ ...d, amount: v }))}
          placeholder="65,000"
        />

        <label
          htmlFor="income-day"
          style={{
            fontSize: "var(--text-caption)",
            fontWeight: "var(--font-weight-medium)",
            color: "var(--text-muted)",
          }}
        >
          Credit day (1–31)
        </label>
        <input
          id="income-day"
          type="number"
          inputMode="numeric"
          pattern="[0-9]*"
          min={1}
          max={31}
          placeholder="1"
          value={draft.creditDay}
          onChange={(e) =>
            setDraft((d) => ({ ...d, creditDay: e.target.value.replace(/\D/g, "").slice(0, 2) }))
          }
          style={{
            minHeight: "var(--hit-target-min)",
            padding: "var(--space-sm) var(--space-md)",
            borderRadius: "var(--radius-md)",
            backgroundColor: "var(--surface-raised)",
            border: "1px solid transparent",
            fontSize: "var(--text-body)",
            color: "var(--text-strong)",
            outline: "none",
            width: "100%",
          }}
        />

        {formError ? (
          <p
            role="alert"
            style={{
              fontSize: "var(--text-caption)",
              color: "var(--color-score-warning)",
              margin: 0,
            }}
          >
            {formError}
          </p>
        ) : null}

        <button
          type="button"
          onClick={handleAdd}
          disabled={busy}
          style={{
            minHeight: "var(--hit-target-min)",
            padding: "var(--space-sm) var(--space-md)",
            borderRadius: "var(--radius-md)",
            backgroundColor: "var(--color-primary-light)",
            color: "var(--color-primary-dark)",
            border: "none",
            fontFamily: "var(--font-body)",
            fontSize: "var(--text-body)",
            fontWeight: "var(--font-weight-semibold)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--space-xs)",
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          <IonIcon icon={Icons.action.addCircle} aria-hidden="true" />
          {busy ? "Adding…" : activeSources.length === 0 ? "Add income" : "Add another"}
        </button>
      </div>

      {!canContinue ? (
        <p
          style={{
            fontSize: "var(--text-caption)",
            color: "var(--text-muted)",
            margin: 0,
          }}
        >
          Add at least one income source to continue.
        </p>
      ) : null}
    </StepLayout>
  );
};

// Prevent the previously-declared cut-off placeholder from existing at
// the module boundary. Re-export the real component as default.
export default IncomeSources;
