/**
 * screens/Home/components/UpcomingPayments.tsx — upcoming bills strip.
 *
 * Source of truth: CLAUDE.md §9.1 (Home Screen → Upcoming Payments Strip)
 * and Appendix D (UPCOMING_PAYMENT_WARN_DAYS).
 *
 * Responsibilities:
 *   - Render every active recurring payment whose next due date falls
 *     within the next 7 calendar days as a horizontally-scrollable chip.
 *   - Each chip shows: category icon, label, amount, and a "in N days"
 *     badge. Payments inside the WARN window get a warning treatment.
 *   - Render nothing when there are no upcoming payments in the window
 *     — the empty-state belongs to Home itself, not to this strip.
 *
 * Design rules:
 *   - Pure presentational, pulls its own slice from financeStore.
 *   - Due-date math routes through utils/dateHelpers (getActualDueDate)
 *     so the 30/31-day edge case is handled in exactly one place.
 *   - Horizontal scroll uses a plain overflow-x container — no
 *     third-party carousel. The strip is short (≤5 chips in practice)
 *     and drag-scroll behaviour is native everywhere we ship.
 */
import { useMemo } from "react";
import { IonIcon } from "@ionic/react";
import { differenceInCalendarDays } from "date-fns";

import { useFinanceStore } from "../../../stores/financeStore";
import type { RecurringPayment } from "../../../stores/financeStore";
import { CATEGORY_BY_KEY } from "../../../constants/categories";
import { UPCOMING_PAYMENT_WARN_DAYS } from "../../../constants/insightThresholds";
import { CATEGORY_ICONS } from "../../../theme/icons";
import { formatINR } from "../../../utils/formatters";
import { getActualDueDate, today as todayStartOfDay } from "../../../utils/dateHelpers";

/** How far out to surface payments on Home. Mirrors §9.1's 7-day rule. */
const HORIZON_DAYS = 7;

interface UpcomingEntry {
  payment: RecurringPayment;
  dueDate: Date;
  daysUntil: number;
}

/**
 * Resolve every active recurring payment to its next upcoming due
 * date. Payments whose due day has already passed this month are
 * rolled forward to next month (§13.7 skip-if-passed applies to
 * scoring, not to display — for the user, a payment that was due
 * yesterday is next due next month).
 */
function nextDueDate(payment: RecurringPayment, today: Date): Date {
  const thisMonth = getActualDueDate(payment.dueDay, today);
  if (differenceInCalendarDays(thisMonth, today) >= 0) return thisMonth;
  // Already passed this month → roll to the same day next month.
  const nextMonthRef = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  return getActualDueDate(payment.dueDay, nextMonthRef);
}

function relativeLabel(daysUntil: number): string {
  if (daysUntil === 0) return "today";
  if (daysUntil === 1) return "tomorrow";
  return `in ${daysUntil} days`;
}

const UpcomingPayments: React.FC = () => {
  const recurring = useFinanceStore((s) => s.recurringPayments);

  const entries = useMemo<UpcomingEntry[]>(() => {
    const today = todayStartOfDay();
    const out: UpcomingEntry[] = [];
    for (const payment of recurring) {
      if (!payment.isActive) continue;
      const dueDate = nextDueDate(payment, today);
      const daysUntil = differenceInCalendarDays(dueDate, today);
      if (daysUntil < 0 || daysUntil > HORIZON_DAYS) continue;
      out.push({ payment, dueDate, daysUntil });
    }
    // Soonest first — the chip nearest the edge should feel the most
    // urgent. Ties break on amount descending (bigger bills matter more).
    out.sort((a, b) => {
      if (a.daysUntil !== b.daysUntil) return a.daysUntil - b.daysUntil;
      return b.payment.amount - a.payment.amount;
    });
    return out;
  }, [recurring]);

  if (entries.length === 0) return null;

  return (
    <section
      aria-label="Upcoming payments this week"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-sm)",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          padding: "0 var(--space-xs)",
        }}
      >
        <h2
          style={{
            fontSize: "var(--text-h3)",
            fontWeight: "var(--font-weight-semibold)",
            color: "var(--text-strong)",
            margin: 0,
          }}
        >
          Upcoming this week
        </h2>
        <span
          style={{
            fontSize: "var(--text-caption)",
            color: "var(--text-muted)",
          }}
        >
          {entries.length} {entries.length === 1 ? "bill" : "bills"}
        </span>
      </header>

      <div
        style={{
          display: "flex",
          gap: "var(--space-sm)",
          overflowX: "auto",
          padding: "var(--space-xs)",
          margin: "0 calc(-1 * var(--space-xs))",
          // Nudge native momentum scrolling on iOS.
          WebkitOverflowScrolling: "touch",
          scrollSnapType: "x proximity",
        }}
      >
        {entries.map(({ payment, daysUntil }) => {
          const category = CATEGORY_BY_KEY[payment.category];
          const isWarn = daysUntil <= UPCOMING_PAYMENT_WARN_DAYS;
          const accent = isWarn ? "var(--color-score-warning)" : category.colorHex;
          const tint = isWarn ? "rgba(233, 66, 53, 0.08)" : `${category.colorHex}14`;

          return (
            <article
              key={payment.id}
              aria-label={`${payment.label}, ${formatINR(payment.amount)}, ${relativeLabel(daysUntil)}`}
              style={{
                flex: "0 0 auto",
                minWidth: 180,
                maxWidth: 240,
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-xs)",
                padding: "var(--space-md)",
                borderRadius: "var(--radius-md)",
                backgroundColor: "var(--surface-raised)",
                boxShadow: "var(--shadow-card)",
                border: `1px solid ${isWarn ? "rgba(233, 66, 53, 0.35)" : "transparent"}`,
                scrollSnapAlign: "start",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "var(--space-sm)",
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
                    backgroundColor: tint,
                    color: accent,
                  }}
                >
                  <IonIcon icon={CATEGORY_ICONS[payment.category]} />
                </span>
                <span
                  style={{
                    fontSize: "var(--text-micro)",
                    fontWeight: "var(--font-weight-semibold)",
                    color: accent,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    padding: "2px var(--space-sm)",
                    borderRadius: "var(--radius-pill)",
                    backgroundColor: tint,
                  }}
                >
                  {relativeLabel(daysUntil)}
                </span>
              </div>
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
            </article>
          );
        })}
      </div>
    </section>
  );
};

export default UpcomingPayments;
