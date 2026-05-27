/**
 * screens/Onboarding/RecurringPayments.tsx — Onboarding Step 5.
 *
 * Source of truth: CLAUDE.md §6.1 (Onboarding → Recurring Payments):
 *   - Label, amount, due day (1–31), category (Appendix C).
 *   - Zero recurring payments is valid — "Skip for now" is explicit.
 *
 * Design rules:
 *   - Adding a row writes through to SQLite immediately (via
 *     financeStore.addRecurringPayment). Same resumability story as
 *     IncomeSources — no draft layer needed.
 *   - Category picker is a horizontally-scrollable chip row rendered
 *     from the CATEGORIES list in Appendix C. Default pick follows
 *     DEFAULT_RECURRING_CATEGORY from constants/categories.ts.
 *   - Zero recurring is a real user choice — the Continue CTA is
 *     always enabled. "Skip for now" exists as an explicit secondary
 *     action per the spec wording.
 */
import { useState } from "react";
import { IonIcon } from "@ionic/react";
import { useHistory } from "react-router-dom";

import StepLayout from "./StepLayout";
import { advanceOnboarding } from "./OnboardingStack";
import CurrencyInput from "../../components/ui/CurrencyInput";
import {
  CATEGORIES,
  CATEGORY_BY_KEY,
  DEFAULT_RECURRING_CATEGORY,
} from "../../constants/categories";
import type { CategoryKey } from "../../constants/categories";
import { useFinanceStore } from "../../stores/financeStore";
import type { RecurringPayment } from "../../stores/financeStore";
import { CATEGORY_ICONS, Icons } from "../../theme/icons";
import { formatINR } from "../../utils/formatters";

interface DraftRecurring {
  label: string;
  amount: number | null;
  dueDay: string;
  category: CategoryKey;
}

const EMPTY_DRAFT: DraftRecurring = {
  label: "",
  amount: null,
  dueDay: "",
  category: DEFAULT_RECURRING_CATEGORY,
};

const RECURRING_SUGGESTIONS: ReadonlyArray<{
  label: string;
  category: CategoryKey;
  icon: string;
}> = [
  { label: "Rent", category: "housing", icon: "home-outline" },
  { label: "Electricity", category: "utilities", icon: "flash-outline" },
  { label: "WiFi / Broadband", category: "utilities", icon: "wifi-outline" },
  { label: "Mobile Recharge", category: "subscriptions", icon: "phone-portrait-outline" },
  { label: "Netflix", category: "subscriptions", icon: "play-circle-outline" },
  { label: "Spotify", category: "subscriptions", icon: "musical-notes-outline" },
  { label: "Gym", category: "health", icon: "barbell-outline" },
  { label: "Home Loan EMI", category: "emi", icon: "card-outline" },
  { label: "Car Loan EMI", category: "emi", icon: "car-outline" },
  { label: "Insurance Premium", category: "insurance", icon: "shield-checkmark-outline" },
  { label: "Maid / Cook", category: "housing", icon: "person-outline" },
  { label: "Gas Cylinder", category: "utilities", icon: "flame-outline" },
];

function validateDraft(draft: DraftRecurring): string | null {
  const label = draft.label.trim();
  if (label.length === 0) return "Give this payment a label.";
  if (label.length > 40) return "Label is a bit too long — trim it to 40 characters.";
  if (draft.amount == null || draft.amount <= 0) {
    return "Enter how much you pay.";
  }
  const day = Number(draft.dueDay);
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    return "Due day must be between 1 and 31.";
  }
  return null;
}

/** "1st / 2nd / 3rd / 4th …" — kept local to keep this file self-contained. */
function ordinalSuffix(day: number): string {
  const j = day % 10;
  const k = day % 100;
  if (j === 1 && k !== 11) return "st";
  if (j === 2 && k !== 12) return "nd";
  if (j === 3 && k !== 13) return "rd";
  return "th";
}

const RecurringRow: React.FC<{
  payment: RecurringPayment;
  onDelete: () => void;
  onEdit: () => void;
}> = ({ payment, onDelete, onEdit }) => {
  const category = CATEGORY_BY_KEY[payment.category];
  return (
    <div
      onClick={onEdit}
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-sm)",
          minWidth: 0,
          flex: 1,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 32,
            height: 32,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "var(--radius-pill)",
            backgroundColor: `${category.colorHex}22`,
            color: category.colorHex,
          }}
        >
          <IonIcon icon={CATEGORY_ICONS[payment.category]} />
        </span>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <span
            style={{
              fontSize: "var(--text-body)",
              fontWeight: "var(--font-weight-semibold)",
              color: "var(--text-strong)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {payment.label}
          </span>
          <span style={{ fontSize: "var(--text-caption)", color: "var(--text-muted)" }}>
            {formatINR(payment.amount)} on the {payment.dueDay}
            {ordinalSuffix(payment.dueDay)}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label={`Remove ${payment.label}`}
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
};

const RecurringPayments: React.FC = () => {
  const history = useHistory();
  const recurring = useFinanceStore((s) => s.recurringPayments);
  const addRecurring = useFinanceStore((s) => s.addRecurringPayment);
  const deleteRecurring = useFinanceStore((s) => s.deleteRecurringPayment);
  const updateRecurring = useFinanceStore((s) => s.updateRecurringPayment);

  const [draft, setDraft] = useState<DraftRecurring>(EMPTY_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const activePayments = recurring.filter((p) => p.isActive);

  const handleEdit = (payment: RecurringPayment) => {
    setEditingId(payment.id);
    setDraft({
      label: payment.label,
      amount: payment.amount,
      dueDay: String(payment.dueDay),
      category: payment.category,
    });
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
        await updateRecurring(editingId, {
          label: draft.label.trim(),
          amount: draft.amount ?? 0,
          dueDay: Number(draft.dueDay),
          category: draft.category,
        });
        setEditingId(null);
      } else {
        await addRecurring({
          label: draft.label.trim(),
          amount: draft.amount ?? 0,
          dueDay: Number(draft.dueDay),
          category: draft.category,
          isActive: true,
          lastPaidDate: null,
        });
      }
      setDraft({ ...EMPTY_DRAFT });
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleContinue = async () => {
    await advanceOnboarding(history, 4);
  };

  return (
    <StepLayout
      stepIndex={4}
      title="What goes out every month?"
      subtitle="Rent, subscriptions, EMIs, insurance. amban will set these aside from your score."
      ctaLabel="Continue"
      onCta={handleContinue}
      secondary={
        activePayments.length === 0
          ? { label: "Skip for now", onSelect: handleContinue }
          : undefined
      }
    >
      {activePayments.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {activePayments.map((payment) => (
            <RecurringRow
              key={payment.id}
              payment={payment}
              onDelete={() => void deleteRecurring(payment.id)}
              onEdit={() => handleEdit(payment)}
            />
          ))}
        </div>
      ) : null}

      {/* Quick-add suggestions */}
      <div
        style={{
          display: "flex",
          gap: "var(--space-xs)",
          overflowX: "auto",
          padding: "var(--space-xs) 0",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {RECURRING_SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => setDraft((d) => ({ ...d, label: s.label, category: s.category }))}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "var(--space-xs) var(--space-sm)",
              minHeight: 36,
              borderRadius: "var(--radius-pill)",
              border:
                draft.label === s.label
                  ? `1.5px solid ${CATEGORY_BY_KEY[s.category].colorHex}`
                  : "1.5px solid transparent",
              backgroundColor:
                draft.label === s.label
                  ? `${CATEGORY_BY_KEY[s.category].colorHex}22`
                  : "var(--surface-raised)",
              color:
                draft.label === s.label
                  ? CATEGORY_BY_KEY[s.category].colorHex
                  : "var(--text-muted)",
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
          htmlFor="recurring-label"
          style={{
            fontSize: "var(--text-caption)",
            fontWeight: "var(--font-weight-medium)",
            color: "var(--text-muted)",
          }}
        >
          Label
        </label>
        <input
          id="recurring-label"
          type="text"
          placeholder="Room rent"
          maxLength={40}
          value={draft.label}
          onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
          inputMode="text"
          autoComplete="on"
          autoCorrect="on"
          autoCapitalize="words"
          spellCheck={true}
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
          placeholder="12,000"
        />

        <label
          htmlFor="recurring-day"
          style={{
            fontSize: "var(--text-caption)",
            fontWeight: "var(--font-weight-medium)",
            color: "var(--text-muted)",
          }}
        >
          Due day (1–31)
        </label>
        <input
          id="recurring-day"
          type="number"
          inputMode="numeric"
          pattern="[0-9]*"
          min={1}
          max={31}
          placeholder="1"
          value={draft.dueDay}
          onChange={(e) =>
            setDraft((d) => ({ ...d, dueDay: e.target.value.replace(/\D/g, "").slice(0, 2) }))
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

        <span
          style={{
            fontSize: "var(--text-caption)",
            fontWeight: "var(--font-weight-medium)",
            color: "var(--text-muted)",
            marginTop: "var(--space-xs)",
          }}
        >
          Category
        </span>
        <div
          role="radiogroup"
          aria-label="Category"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "var(--space-xs)",
          }}
        >
          {CATEGORIES.map((cat) => {
            const selected = draft.category === cat.key;
            return (
              <button
                key={cat.key}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setDraft((d) => ({ ...d, category: cat.key }))}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "var(--space-xs) var(--space-sm)",
                  minHeight: 36,
                  borderRadius: "var(--radius-pill)",
                  border: selected ? `1.5px solid ${cat.colorHex}` : "1.5px solid transparent",
                  backgroundColor: selected ? `${cat.colorHex}22` : "var(--surface-raised)",
                  color: selected ? cat.colorHex : "var(--text-muted)",
                  fontSize: "var(--text-caption)",
                  fontWeight: "var(--font-weight-medium)",
                  cursor: "pointer",
                }}
              >
                <IonIcon icon={CATEGORY_ICONS[cat.key]} aria-hidden="true" />
                {cat.label}
              </button>
            );
          })}
        </div>

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
          {busy
            ? "Saving…"
            : editingId != null
              ? "Save changes"
              : activePayments.length === 0
                ? "Add recurring"
                : "Add another"}
        </button>

        {editingId != null ? (
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setDraft({ ...EMPTY_DRAFT });
            }}
            style={{
              minHeight: "var(--hit-target-min)",
              padding: "var(--space-sm) var(--space-md)",
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--surface-raised)",
              color: "var(--text-muted)",
              border: "1px solid var(--divider)",
              fontSize: "var(--text-body)",
              fontWeight: "var(--font-weight-medium)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        ) : null}
      </div>
    </StepLayout>
  );
};

export default RecurringPayments;
