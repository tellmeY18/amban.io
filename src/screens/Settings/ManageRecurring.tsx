/**
 * screens/Settings/ManageRecurring.tsx — manage recurring payments.
 *
 * Source of truth: CLAUDE.md §9.5 (Settings → Recurring Payments) and
 * §6.1 (onboarding recurring form — this screen reuses the same
 * schema). Phase 10 (Balance & Finance Management) adds the "mark as
 * paid" affordance on top.
 *
 * Responsibilities:
 *   - List every recurring payment (active + inactive) with edit,
 *     toggle, and delete affordances per row.
 *   - Add a new recurring payment via an inline form (bottom sheet).
 *   - "Mark as paid" quick action for payments inside the WARN window
 *     (Appendix D). Opens the balance-update sheet pre-debited by the
 *     payment amount so the user doesn't double-deduct (§13.7).
 *
 * Design rules:
 *   - Writes go through financeStore; never via the repo directly.
 *   - Category is mandatory — every row must map to exactly one
 *     Appendix C category. The form default is
 *     DEFAULT_RECURRING_CATEGORY.
 *   - Toggle is a soft-delete flip; scoring already filters on
 *     isActive.
 */
import React, { useMemo, useState } from "react";
import { useHistory } from "react-router-dom";
import { IonContent, IonIcon, IonPage } from "@ionic/react";
import { differenceInCalendarDays } from "date-fns";

import BottomSheet from "../../components/ui/BottomSheet";
import CurrencyInput from "../../components/ui/CurrencyInput";

import {
  CATEGORIES,
  CATEGORY_BY_KEY,
  DEFAULT_RECURRING_CATEGORY,
} from "../../constants/categories";
import type { CategoryKey } from "../../constants/categories";
import { UPCOMING_PAYMENT_WARN_DAYS } from "../../constants/insightThresholds";

import { useFinanceStore } from "../../stores/financeStore";
import type { RecurringPayment } from "../../stores/financeStore";

import { CATEGORY_ICONS, Icons } from "../../theme/icons";
import { formatINR } from "../../utils/formatters";
import { getActualDueDate, today as todayStartOfDay } from "../../utils/dateHelpers";
import { haptics } from "../../utils/haptics";

function ordinalSuffix(day: number): string {
  const j = day % 10;
  const k = day % 100;
  if (j === 1 && k !== 11) return "st";
  if (j === 2 && k !== 12) return "nd";
  if (j === 3 && k !== 13) return "rd";
  return "th";
}

/**
 * Days until the next occurrence of a payment's due day. Payments
 * whose due day has already passed this month roll to next month —
 * this matches how the Home strip surfaces them.
 */
function nextDueDays(payment: RecurringPayment, today: Date): number {
  const thisMonth = getActualDueDate(payment.dueDay, today);
  if (differenceInCalendarDays(thisMonth, today) >= 0) {
    return differenceInCalendarDays(thisMonth, today);
  }
  const nextMonthRef = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const next = getActualDueDate(payment.dueDay, nextMonthRef);
  return differenceInCalendarDays(next, today);
}

interface DraftForm {
  label: string;
  amount: number | null;
  dueDay: string;
  category: CategoryKey;
  isActive: boolean;
}

const EMPTY_DRAFT: DraftForm = {
  label: "",
  amount: null,
  dueDay: "",
  category: DEFAULT_RECURRING_CATEGORY,
  isActive: true,
};

function validateDraft(draft: DraftForm): string | null {
  const label = draft.label.trim();
  if (label.length === 0) return "Give this payment a label.";
  if (label.length > 40) return "Label too long — trim to 40 characters.";
  if (draft.amount == null || draft.amount <= 0) return "Enter an amount.";
  const day = Number(draft.dueDay);
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    return "Due day must be between 1 and 31.";
  }
  return null;
}

const EditSheet: React.FC<{
  open: boolean;
  editing: RecurringPayment | null;
  onDismiss: () => void;
  onSubmit: (draft: Omit<RecurringPayment, "id">) => Promise<void>;
}> = ({ open, editing, onDismiss, onSubmit }) => {
  const [draft, setDraft] = useState<DraftForm>(
    editing
      ? {
          label: editing.label,
          amount: editing.amount,
          dueDay: String(editing.dueDay),
          category: editing.category,
          isActive: editing.isActive,
        }
      : EMPTY_DRAFT,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    setDraft(
      editing
        ? {
            label: editing.label,
            amount: editing.amount,
            dueDay: String(editing.dueDay),
            category: editing.category,
            isActive: editing.isActive,
          }
        : EMPTY_DRAFT,
    );
    setError(null);
  }, [editing, open]);

  const handleSave = async () => {
    const err = validateDraft(draft);
    if (err) {
      setError(err);
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        label: draft.label.trim(),
        amount: draft.amount ?? 0,
        dueDay: Number(draft.dueDay),
        category: draft.category,
        isActive: draft.isActive,
      });
      onDismiss();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onDismiss={onDismiss}
      title={editing ? "Edit recurring" : "Add recurring"}
      initialBreakpoint={0.9}
    >
      <label
        htmlFor="rec-label-edit"
        style={{
          fontSize: "var(--text-caption)",
          fontWeight: "var(--font-weight-medium)",
          color: "var(--text-muted)",
        }}
      >
        Label
      </label>
      <input
        id="rec-label-edit"
        type="text"
        maxLength={40}
        value={draft.label}
        onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
        style={{
          minHeight: "var(--hit-target-min)",
          padding: "var(--space-sm) var(--space-md)",
          borderRadius: "var(--radius-md)",
          backgroundColor: "var(--surface-sunken)",
          border: "1px solid transparent",
          fontSize: "var(--text-body)",
          color: "var(--text-strong)",
          outline: "none",
          width: "100%",
        }}
      />
      <CurrencyInput
        label="Amount"
        value={draft.amount}
        onChange={(v) => setDraft((d) => ({ ...d, amount: v }))}
      />
      <label
        htmlFor="rec-day-edit"
        style={{
          fontSize: "var(--text-caption)",
          fontWeight: "var(--font-weight-medium)",
          color: "var(--text-muted)",
        }}
      >
        Due day (1–31)
      </label>
      <input
        id="rec-day-edit"
        type="number"
        inputMode="numeric"
        pattern="[0-9]*"
        min={1}
        max={31}
        value={draft.dueDay}
        onChange={(e) =>
          setDraft((d) => ({ ...d, dueDay: e.target.value.replace(/\D/g, "").slice(0, 2) }))
        }
        style={{
          minHeight: "var(--hit-target-min)",
          padding: "var(--space-sm) var(--space-md)",
          borderRadius: "var(--radius-md)",
          backgroundColor: "var(--surface-sunken)",
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
        }}
      >
        Category
      </span>
      <div
        role="radiogroup"
        aria-label="Category"
        style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-xs)" }}
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
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-md)",
          padding: "var(--space-sm) 0",
        }}
      >
        <span style={{ fontSize: "var(--text-body)", color: "var(--text-strong)" }}>Active</span>
        <input
          type="checkbox"
          checked={draft.isActive}
          onChange={(e) => setDraft((d) => ({ ...d, isActive: e.target.checked }))}
          style={{ width: 20, height: 20 }}
        />
      </label>

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

      <button
        type="button"
        onClick={handleSave}
        disabled={busy}
        style={{
          minHeight: "var(--hit-target-min)",
          padding: "var(--space-sm) var(--space-lg)",
          borderRadius: "var(--radius-md)",
          backgroundColor: busy ? "var(--surface-sunken)" : "var(--color-primary)",
          color: busy ? "var(--text-muted)" : "#ffffff",
          border: "none",
          fontWeight: "var(--font-weight-semibold)",
          cursor: busy ? "not-allowed" : "pointer",
        }}
      >
        {busy ? "Saving…" : "Save"}
      </button>
    </BottomSheet>
  );
};

/**
 * Mark-as-paid sheet. Opens the balance-update affordance pre-debited
 * by the payment's amount so the user doesn't double-deduct (§13.7).
 */
const MarkPaidSheet: React.FC<{
  open: boolean;
  payment: RecurringPayment | null;
  onDismiss: () => void;
}> = ({ open, payment, onDismiss }) => {
  const latestBalance = useFinanceStore((s) => s.latestBalance);
  const setBalance = useFinanceStore((s) => s.setBalance);
  const prefill = Math.max(0, (latestBalance?.amount ?? 0) - (payment?.amount ?? 0));
  const [draft, setDraft] = useState<number | null>(prefill);
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    setDraft(prefill);
  }, [prefill, open]);

  const handleSave = async () => {
    if (draft == null || busy) return;
    setBusy(true);
    try {
      await setBalance(draft);
      void haptics.tapMedium();
      onDismiss();
    } finally {
      setBusy(false);
    }
  };

  if (!payment) return null;

  return (
    <BottomSheet open={open} onDismiss={onDismiss} title="Mark as paid" initialBreakpoint={0.5}>
      <p
        style={{
          margin: 0,
          fontSize: "var(--text-body)",
          color: "var(--text-muted)",
          lineHeight: "var(--line-height-body)",
        }}
      >
        We've deducted {formatINR(payment.amount)} from your last balance. Adjust it if it doesn't
        match what's in your account.
      </p>
      <CurrencyInput label="New balance" value={draft} onChange={setDraft} autoFocus />
      <button
        type="button"
        onClick={handleSave}
        disabled={draft == null || busy}
        style={{
          minHeight: "var(--hit-target-min)",
          padding: "var(--space-sm) var(--space-lg)",
          borderRadius: "var(--radius-md)",
          backgroundColor: draft == null || busy ? "var(--surface-sunken)" : "var(--color-primary)",
          color: draft == null || busy ? "var(--text-muted)" : "#ffffff",
          border: "none",
          fontWeight: "var(--font-weight-semibold)",
          cursor: draft == null || busy ? "not-allowed" : "pointer",
        }}
      >
        {busy ? "Saving…" : "Save balance"}
      </button>
    </BottomSheet>
  );
};

const ManageRecurring: React.FC = () => {
  const history = useHistory();
  const recurring = useFinanceStore((s) => s.recurringPayments);
  const addRecurring = useFinanceStore((s) => s.addRecurringPayment);
  const updateRecurring = useFinanceStore((s) => s.updateRecurringPayment);
  const deleteRecurring = useFinanceStore((s) => s.deleteRecurringPayment);
  const toggleRecurring = useFinanceStore((s) => s.toggleRecurringPayment);

  const [editing, setEditing] = useState<RecurringPayment | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [markingPaid, setMarkingPaid] = useState<RecurringPayment | null>(null);

  const today = useMemo(() => todayStartOfDay(), []);

  const rows = useMemo(
    () =>
      recurring
        .map((p) => ({
          payment: p,
          daysUntil: p.isActive ? nextDueDays(p, today) : null,
        }))
        .sort((a, b) => {
          if (a.payment.isActive !== b.payment.isActive) {
            return a.payment.isActive ? -1 : 1;
          }
          return (a.daysUntil ?? 99) - (b.daysUntil ?? 99);
        }),
    [recurring, today],
  );

  const handleAdd = () => {
    setEditing(null);
    setSheetOpen(true);
  };

  const handleEdit = (payment: RecurringPayment) => {
    setEditing(payment);
    setSheetOpen(true);
  };

  const handleSubmit = async (draft: Omit<RecurringPayment, "id">) => {
    if (editing) {
      await updateRecurring(editing.id, draft);
    } else {
      await addRecurring(draft);
    }
    void haptics.tapMedium();
  };

  return (
    <IonPage>
      <IonContent fullscreen>
        <main
          className="amban-screen"
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}
        >
          <header
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-sm)",
              padding: "var(--space-md) var(--space-xs) var(--space-sm)",
            }}
          >
            <button
              type="button"
              onClick={() => history.goBack()}
              aria-label="Go back"
              style={{
                minWidth: 40,
                minHeight: 40,
                borderRadius: "var(--radius-pill)",
                backgroundColor: "var(--surface-sunken)",
                color: "var(--text-strong)",
                border: "none",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <IonIcon icon={Icons.action.chevronBack} aria-hidden="true" />
            </button>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "var(--text-h1)",
                fontWeight: "var(--font-weight-bold)",
                color: "var(--text-strong)",
                margin: 0,
              }}
            >
              Recurring payments
            </h1>
          </header>

          {recurring.length === 0 ? (
            <article
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "var(--space-sm)",
                padding: "var(--space-xl) var(--space-md)",
                borderRadius: "var(--radius-md)",
                backgroundColor: "var(--surface-sunken)",
                textAlign: "center",
              }}
            >
              <span aria-hidden="true" style={{ fontSize: "1.5rem" }}>
                📆
              </span>
              <span
                style={{
                  fontSize: "var(--text-body)",
                  fontWeight: "var(--font-weight-semibold)",
                  color: "var(--text-strong)",
                }}
              >
                No recurring payments
              </span>
              <span style={{ fontSize: "var(--text-caption)", color: "var(--text-muted)" }}>
                Add rent, EMIs, subscriptions — anything that comes out every month.
              </span>
            </article>
          ) : (
            rows.map(({ payment, daysUntil }) => {
              const cat = CATEGORY_BY_KEY[payment.category];
              const showMarkPaid =
                payment.isActive && daysUntil != null && daysUntil <= UPCOMING_PAYMENT_WARN_DAYS;
              return (
                <article
                  key={payment.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--space-xs)",
                    padding: "var(--space-md)",
                    borderRadius: "var(--radius-md)",
                    backgroundColor: "var(--surface-raised)",
                    boxShadow: "var(--shadow-card)",
                    opacity: payment.isActive ? 1 : 0.6,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-sm)",
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 36,
                        height: 36,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: "var(--radius-pill)",
                        backgroundColor: `${cat.colorHex}22`,
                        color: cat.colorHex,
                        flexShrink: 0,
                      }}
                    >
                      <IonIcon icon={CATEGORY_ICONS[payment.category]} />
                    </span>
                    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
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
                        {payment.isActive ? "" : " · Inactive"}
                      </span>
                    </div>
                    <span
                      style={{
                        fontFamily: "var(--font-display)",
                        fontSize: "var(--text-h3)",
                        fontWeight: "var(--font-weight-semibold)",
                        color: "var(--text-strong)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {formatINR(payment.amount)}
                    </span>
                  </div>

                  <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => {
                        void toggleRecurring(payment.id);
                        void haptics.selection();
                      }}
                      style={{
                        minHeight: 36,
                        padding: "var(--space-xs) var(--space-sm)",
                        borderRadius: "var(--radius-pill)",
                        backgroundColor: "var(--surface-sunken)",
                        color: payment.isActive
                          ? "var(--color-score-excellent)"
                          : "var(--text-muted)",
                        border: "none",
                        fontSize: "var(--text-caption)",
                        fontWeight: "var(--font-weight-semibold)",
                      }}
                    >
                      {payment.isActive ? "Active" : "Inactive"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEdit(payment)}
                      style={{
                        minHeight: 36,
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
                      <IonIcon icon={Icons.action.edit} aria-hidden="true" />
                      Edit
                    </button>
                    {showMarkPaid ? (
                      <button
                        type="button"
                        onClick={() => setMarkingPaid(payment)}
                        style={{
                          minHeight: 36,
                          padding: "var(--space-xs) var(--space-sm)",
                          borderRadius: "var(--radius-pill)",
                          backgroundColor: "var(--color-primary-light)",
                          color: "var(--color-primary-dark)",
                          border: "none",
                          fontSize: "var(--text-caption)",
                          fontWeight: "var(--font-weight-semibold)",
                        }}
                      >
                        Mark as paid
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        void deleteRecurring(payment.id);
                        void haptics.tapMedium();
                      }}
                      style={{
                        minHeight: 36,
                        padding: "var(--space-xs) var(--space-sm)",
                        borderRadius: "var(--radius-pill)",
                        backgroundColor: "transparent",
                        color: "var(--color-score-warning)",
                        border: "1px solid var(--divider)",
                        fontSize: "var(--text-caption)",
                        fontWeight: "var(--font-weight-semibold)",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <IonIcon icon={Icons.action.delete} aria-hidden="true" />
                      Delete
                    </button>
                  </div>
                </article>
              );
            })
          )}

          <button
            type="button"
            onClick={handleAdd}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "var(--space-xs)",
              minHeight: "var(--hit-target-min)",
              padding: "var(--space-sm) var(--space-lg)",
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--color-primary)",
              color: "#ffffff",
              border: "none",
              fontWeight: "var(--font-weight-semibold)",
            }}
          >
            <IonIcon icon={Icons.action.add} aria-hidden="true" />
            Add recurring payment
          </button>
        </main>

        <EditSheet
          open={sheetOpen}
          editing={editing}
          onDismiss={() => setSheetOpen(false)}
          onSubmit={handleSubmit}
        />

        <MarkPaidSheet
          open={markingPaid !== null}
          payment={markingPaid}
          onDismiss={() => setMarkingPaid(null)}
        />
      </IonContent>
    </IonPage>
  );
};

export default ManageRecurring;
