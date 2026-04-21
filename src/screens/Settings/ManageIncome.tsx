/**
 * screens/Settings/ManageIncome.tsx — manage income sources.
 *
 * Source of truth: CLAUDE.md §9.5 (Settings → Income Sources) and
 * §6.1 (onboarding income form — this screen reuses the same shape).
 *
 * Responsibilities:
 *   - List every income source (active + inactive) with edit, toggle,
 *     and delete affordances per row.
 *   - Add a new source via an inline form that mirrors the onboarding
 *     step's field set.
 *   - Enforce the "don't delete the last active income source after
 *     onboarding" guardrail (§10 Phase 10 spec): we warn clearly
 *     rather than silently blocking, so the user can see why.
 *
 * Design rules:
 *   - Writes go through financeStore — never via the repo directly.
 *   - Toggling a source active/inactive is a soft-delete-ish flip;
 *     scoring already filters on isActive.
 *   - The edit flow reuses the add form via a bottom sheet, so the
 *     schema of "what makes a valid income source" has exactly one
 *     place to live.
 */
import React, { useState } from "react";
import { useHistory } from "react-router-dom";
import { IonContent, IonIcon, IonPage } from "@ionic/react";

import BottomSheet from "../../components/ui/BottomSheet";
import CurrencyInput from "../../components/ui/CurrencyInput";

import { useFinanceStore } from "../../stores/financeStore";
import type { IncomeSource } from "../../stores/financeStore";
import { useUserStore } from "../../stores/userStore";

import { Icons } from "../../theme/icons";
import { formatINR } from "../../utils/formatters";
import { haptics } from "../../utils/haptics";

/** Ordinal suffix ("1st" / "2nd" / …) — local copy to keep this file self-contained. */
function ordinalSuffix(day: number): string {
  const j = day % 10;
  const k = day % 100;
  if (j === 1 && k !== 11) return "st";
  if (j === 2 && k !== 12) return "nd";
  if (j === 3 && k !== 13) return "rd";
  return "th";
}

interface DraftForm {
  label: string;
  amount: number | null;
  creditDay: string;
  isActive: boolean;
}

const EMPTY_DRAFT: DraftForm = {
  label: "",
  amount: null,
  creditDay: "",
  isActive: true,
};

function validateDraft(draft: DraftForm): string | null {
  const label = draft.label.trim();
  if (label.length === 0) return "Give this income a label.";
  if (label.length > 40) return "Label too long — trim to 40 characters.";
  if (draft.amount == null || draft.amount <= 0) return "Enter an amount.";
  const day = Number(draft.creditDay);
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    return "Credit day must be between 1 and 31.";
  }
  return null;
}

const EditSheet: React.FC<{
  open: boolean;
  editing: IncomeSource | null;
  onDismiss: () => void;
  onSubmit: (draft: Omit<IncomeSource, "id">) => Promise<void>;
}> = ({ open, editing, onDismiss, onSubmit }) => {
  const [draft, setDraft] = useState<DraftForm>(
    editing
      ? {
          label: editing.label,
          amount: editing.amount,
          creditDay: String(editing.creditDay),
          isActive: editing.isActive,
        }
      : EMPTY_DRAFT,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset draft whenever the editing target changes.
  React.useEffect(() => {
    setDraft(
      editing
        ? {
            label: editing.label,
            amount: editing.amount,
            creditDay: String(editing.creditDay),
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
        creditDay: Number(draft.creditDay),
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
      title={editing ? "Edit income" : "Add income"}
      initialBreakpoint={0.75}
    >
      <label
        htmlFor="income-label-edit"
        style={{
          fontSize: "var(--text-caption)",
          fontWeight: "var(--font-weight-medium)",
          color: "var(--text-muted)",
        }}
      >
        Label
      </label>
      <input
        id="income-label-edit"
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
        htmlFor="income-day-edit"
        style={{
          fontSize: "var(--text-caption)",
          fontWeight: "var(--font-weight-medium)",
          color: "var(--text-muted)",
        }}
      >
        Credit day (1–31)
      </label>
      <input
        id="income-day-edit"
        type="number"
        inputMode="numeric"
        pattern="[0-9]*"
        min={1}
        max={31}
        value={draft.creditDay}
        onChange={(e) =>
          setDraft((d) => ({ ...d, creditDay: e.target.value.replace(/\D/g, "").slice(0, 2) }))
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

const ManageIncome: React.FC = () => {
  const history = useHistory();
  const sources = useFinanceStore((s) => s.incomeSources);
  const addSource = useFinanceStore((s) => s.addIncomeSource);
  const updateSource = useFinanceStore((s) => s.updateIncomeSource);
  const deleteSource = useFinanceStore((s) => s.deleteIncomeSource);
  const toggleSource = useFinanceStore((s) => s.toggleIncomeSource);
  const onboardingComplete = useUserStore((s) => s.onboardingComplete);

  const [editing, setEditing] = useState<IncomeSource | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [guardError, setGuardError] = useState<string | null>(null);

  const activeCount = sources.filter((s) => s.isActive).length;

  const handleAdd = () => {
    setEditing(null);
    setSheetOpen(true);
  };

  const handleEdit = (source: IncomeSource) => {
    setEditing(source);
    setSheetOpen(true);
  };

  const handleSubmit = async (draft: Omit<IncomeSource, "id">) => {
    if (editing) {
      await updateSource(editing.id, draft);
    } else {
      await addSource(draft);
    }
    void haptics.tapMedium();
  };

  const handleToggle = async (source: IncomeSource) => {
    // Guardrail: don't let the user kill the last active source
    // post-onboarding — that would make scoring undefined.
    if (source.isActive && activeCount === 1 && onboardingComplete) {
      setGuardError(
        "You need at least one active income source. Add another before turning this off.",
      );
      void haptics.warning();
      return;
    }
    setGuardError(null);
    await toggleSource(source.id);
    void haptics.selection();
  };

  const handleDelete = async (source: IncomeSource) => {
    if (source.isActive && activeCount === 1 && onboardingComplete) {
      setGuardError(
        "You need at least one active income source. Add another before deleting this one.",
      );
      void haptics.warning();
      return;
    }
    setGuardError(null);
    await deleteSource(source.id);
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
              Income sources
            </h1>
          </header>

          {guardError ? (
            <p
              role="alert"
              style={{
                padding: "var(--space-sm) var(--space-md)",
                borderRadius: "var(--radius-md)",
                backgroundColor: "rgba(233, 66, 53, 0.10)",
                color: "var(--color-score-warning)",
                fontSize: "var(--text-caption)",
                margin: 0,
              }}
            >
              {guardError}
            </p>
          ) : null}

          {sources.length === 0 ? (
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
                💼
              </span>
              <span
                style={{
                  fontSize: "var(--text-body)",
                  fontWeight: "var(--font-weight-semibold)",
                  color: "var(--text-strong)",
                }}
              >
                No income sources
              </span>
              <span style={{ fontSize: "var(--text-caption)", color: "var(--text-muted)" }}>
                Add at least one so amban can compute your score.
              </span>
            </article>
          ) : (
            sources.map((source) => (
              <article
                key={source.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-md)",
                  padding: "var(--space-md)",
                  borderRadius: "var(--radius-md)",
                  backgroundColor: "var(--surface-raised)",
                  boxShadow: "var(--shadow-card)",
                  opacity: source.isActive ? 1 : 0.6,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    minWidth: 0,
                    flex: 1,
                  }}
                >
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
                    {source.label}
                  </span>
                  <span style={{ fontSize: "var(--text-caption)", color: "var(--text-muted)" }}>
                    {formatINR(source.amount)} on the {source.creditDay}
                    {ordinalSuffix(source.creditDay)}
                    {source.isActive ? "" : " · Inactive"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleToggle(source)}
                  aria-label={source.isActive ? "Deactivate" : "Activate"}
                  style={{
                    minWidth: 40,
                    minHeight: 40,
                    borderRadius: "var(--radius-pill)",
                    backgroundColor: "var(--surface-sunken)",
                    color: source.isActive ? "var(--color-score-excellent)" : "var(--text-muted)",
                    border: "none",
                  }}
                >
                  <IonIcon
                    icon={source.isActive ? Icons.action.checkCircle : Icons.action.close}
                    aria-hidden="true"
                  />
                </button>
                <button
                  type="button"
                  onClick={() => handleEdit(source)}
                  aria-label="Edit"
                  style={{
                    minWidth: 40,
                    minHeight: 40,
                    borderRadius: "var(--radius-pill)",
                    backgroundColor: "var(--surface-sunken)",
                    color: "var(--text-muted)",
                    border: "none",
                  }}
                >
                  <IonIcon icon={Icons.action.edit} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(source)}
                  aria-label="Delete"
                  style={{
                    minWidth: 40,
                    minHeight: 40,
                    borderRadius: "var(--radius-pill)",
                    backgroundColor: "var(--surface-sunken)",
                    color: "var(--color-score-warning)",
                    border: "none",
                  }}
                >
                  <IonIcon icon={Icons.action.delete} aria-hidden="true" />
                </button>
              </article>
            ))
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
            Add income source
          </button>
        </main>

        <EditSheet
          open={sheetOpen}
          editing={editing}
          onDismiss={() => setSheetOpen(false)}
          onSubmit={handleSubmit}
        />
      </IonContent>
    </IonPage>
  );
};

export default ManageIncome;
