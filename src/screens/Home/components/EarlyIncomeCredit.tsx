/**
 * screens/Home/components/EarlyIncomeCredit.tsx — Early income credit trigger.
 *
 * Shown on the Home screen when there are active income sources that
 * haven't been credited yet this cycle. Lets the user mark an income
 * as received early with one tap — auto-updates balance and shifts
 * the score's "next income date" to the following month.
 *
 * Design:
 *   - Shows as a compact section below the score card.
 *   - Each pending income source gets a row with label, amount, and
 *     a "Received" button.
 *   - On tap: marks as credited, auto-updates balance, triggers haptic.
 *   - Once all sources are credited for this cycle, the section hides.
 */

import React, { useMemo, useState } from "react";
import { IonIcon } from "@ionic/react";

import { useFinanceStore } from "../../../stores/financeStore";
import type { IncomeSource } from "../../../stores/financeStore";
import { isCreditedThisCycle, today as todayStartOfDay } from "../../../utils/dateHelpers";
import { formatINR } from "../../../utils/formatters";
import { haptics } from "../../../utils/haptics";
import { Icons } from "../../../theme/icons";

/**
 * Returns income sources that are active but NOT yet credited for the
 * current billing cycle — these are the ones the user can mark as
 * received early.
 */
function pendingIncomeSources(sources: IncomeSource[]): IncomeSource[] {
  const now = todayStartOfDay();
  return sources.filter(
    (s) => s.isActive && !isCreditedThisCycle(s.lastCreditedDate, s.creditDay, now),
  );
}

/** Ordinal suffix for day display. */
function ordinalSuffix(day: number): string {
  const j = day % 10;
  const k = day % 100;
  if (j === 1 && k !== 11) return "st";
  if (j === 2 && k !== 12) return "nd";
  if (j === 3 && k !== 13) return "rd";
  return "th";
}

const EarlyIncomeCredit: React.FC = () => {
  const incomeSources = useFinanceStore((s) => s.incomeSources);
  const markIncomeAsCredited = useFinanceStore((s) => s.markIncomeAsCredited);

  const pending = useMemo(() => pendingIncomeSources(incomeSources), [incomeSources]);

  // Track which source is currently being processed (loading state).
  const [busyId, setBusyId] = useState<number | null>(null);

  const handleMarkReceived = async (source: IncomeSource) => {
    if (busyId !== null) return;
    setBusyId(source.id);
    try {
      await markIncomeAsCredited(source.id);
      void haptics.success();
    } finally {
      setBusyId(null);
    }
  };

  // Don't render anything if all income is already credited this cycle.
  if (pending.length === 0) return null;

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-sm)",
      }}
    >
      <span
        style={{
          fontSize: "var(--text-caption)",
          fontWeight: "var(--font-weight-semibold)",
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        Pending income
      </span>

      {pending.map((source) => (
        <article
          key={source.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-md)",
            padding: "var(--space-sm) var(--space-md)",
            borderRadius: "var(--radius-md)",
            backgroundColor: "var(--surface-card)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          {/* Icon */}
          <span
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              borderRadius: "var(--radius-sm)",
              backgroundColor: "rgba(30, 140, 69, 0.10)",
              flexShrink: 0,
            }}
          >
            <IonIcon
              icon={Icons.income.briefcase}
              style={{ fontSize: "1.1rem", color: "var(--color-score-excellent)" }}
              aria-hidden="true"
            />
          </span>

          {/* Label + meta */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 1,
              flex: 1,
              minWidth: 0,
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
            <span
              style={{
                fontSize: "var(--text-caption)",
                color: "var(--text-muted)",
              }}
            >
              {formatINR(source.amount)} · Due {source.creditDay}
              {ordinalSuffix(source.creditDay)}
            </span>
          </div>

          {/* Action button */}
          <button
            type="button"
            onClick={() => handleMarkReceived(source)}
            disabled={busyId !== null}
            style={{
              flexShrink: 0,
              minHeight: 36,
              padding: "var(--space-xs) var(--space-sm)",
              borderRadius: "var(--radius-md)",
              backgroundColor:
                busyId === source.id ? "var(--surface-sunken)" : "var(--color-score-excellent)",
              color: busyId === source.id ? "var(--text-muted)" : "#ffffff",
              border: "none",
              fontSize: "var(--text-caption)",
              fontWeight: "var(--font-weight-semibold)",
              cursor: busyId !== null ? "not-allowed" : "pointer",
              transition: "background-color 0.15s ease",
            }}
          >
            {busyId === source.id ? "Updating…" : "Received"}
          </button>
        </article>
      ))}
    </section>
  );
};

export default EarlyIncomeCredit;
