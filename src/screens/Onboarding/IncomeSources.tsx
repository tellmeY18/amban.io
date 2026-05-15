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

/* ------------------------------------------------------------------ */
/*  Quick-add suggestion chips for common Indian income types          */
/* ------------------------------------------------------------------ */
const INCOME_SUGGESTIONS = [
  { label: "Salary", icon: Icons.income.briefcase },
  { label: "Freelance", icon: Icons.income.codeSlash },
  { label: "Rent Income", icon: Icons.income.home },
  { label: "Business", icon: Icons.income.storefront },
  { label: "Side Hustle", icon: Icons.income.rocket },
  { label: "Investments", icon: Icons.income.trendingUp },
  { label: "Pension", icon: Icons.income.shieldCheckmark },
] as const;

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
  onEdit: () => void;
}> = ({ source, onDelete, onEdit }) => (
  <div
    onClick={onEdit}
    role="button"
    tabIndex={0}
    onKeyDown={(e) => {
      if (e.key === "Enter" || e.key === " ") onEdit();
    }}
    aria-label={`Edit ${source.label}`}
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "var(--space-md)",
      padding: "var(--space-md)",
      borderRadius: "var(--radius-md)",
      backgroundColor: "var(--surface-raised)",
      boxShadow: "var(--shadow-card)",
      cursor: "pointer",
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
      onClick={(e) => {
        e.stopPropagation();
        onDelete();
      }}
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
  const updateIncomeSource = useFinanceStore((s) => s.updateIncomeSource);
  const deleteIncomeSource = useFinanceStore((s) => s.deleteIncomeSource);

  const [draft, setDraft] = useState<DraftSource>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activeSources = sources.filter((s) => s.isActive);
  const canContinue = activeSources.length >= 1;

  const handleEdit = (source: IncomeSource) => {
    setEditingId(source.id);
    setDraft({
      label: source.label,
      amount: source.amount,
      creditDay: String(source.creditDay),
    });
    setFormError(null);
  };

  const handleAdd = async () => {
    const err = validateDraft(draft);
    if (err) {
      setFormError(err);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      if (editingId != null) {
        await updateIncomeSource(editingId, {
          label: draft.label.trim(),
          amount: draft.amount ?? 0,
          creditDay: Number(draft.creditDay),
        });
        setEditingId(null);
      } else {
        await addIncomeSource({
          label: draft.label.trim(),
          amount: draft.amount ?? 0,
          creditDay: Number(draft.creditDay),
          isActive: true,
        });
      }
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
              onEdit={() => handleEdit(source)}
            />
          ))}
        </div>
      ) : null}

      {/* Quick-add suggestion chips */}
      <div
        style={{
          display: "flex",
          gap: "var(--space-xs)",
          overflowX: "auto",
          padding: "var(--space-xs) 0",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {INCOME_SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => setDraft((d) => ({ ...d, label: s.label }))}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "var(--space-xs) var(--space-sm)",
              minHeight: 36,
              borderRadius: "var(--radius-pill)",
              border:
                draft.label === s.label
                  ? "1.5px solid var(--color-primary)"
                  : "1.5px solid transparent",
              backgroundColor:
                draft.label === s.label ? "var(--color-primary-light)" : "var(--surface-raised)",
              color: draft.label === s.label ? "var(--color-primary-dark)" : "var(--text-muted)",
              fontSize: "var(--text-caption)",
              fontWeight: "var(--font-weight-medium)",
              cursor: "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            <IonIcon icon={s.icon} aria-hidden="true" />
            {s.label}
          </button>
        ))}
      </div>

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

        <div style={{ display: "flex", gap: "var(--space-sm)" }}>
          <button
            type="button"
            onClick={handleAdd}
            disabled={busy}
            style={{
              flex: 1,
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
            <IonIcon
              icon={editingId != null ? Icons.action.checkOutline : Icons.action.addCircle}
              aria-hidden="true"
            />
            {busy
              ? "Saving…"
              : editingId != null
                ? "Save changes"
                : activeSources.length === 0
                  ? "Add income"
                  : "Add another"}
          </button>

          {editingId != null ? (
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setDraft(EMPTY_DRAFT);
                setFormError(null);
              }}
              style={{
                minHeight: "var(--hit-target-min)",
                padding: "var(--space-sm) var(--space-md)",
                borderRadius: "var(--radius-md)",
                backgroundColor: "var(--surface-raised)",
                color: "var(--text-muted)",
                border: "1px solid var(--color-divider)",
                fontFamily: "var(--font-body)",
                fontSize: "var(--text-body)",
                fontWeight: "var(--font-weight-medium)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          ) : null}
        </div>
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
