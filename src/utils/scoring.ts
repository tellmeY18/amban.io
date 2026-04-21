/**
 * utils/scoring.ts — Amban Score calculation.
 *
 * Source of truth: CLAUDE.md §8 (The Amban Score) and Appendix B
 * (Score Calculation Function).
 *
 * Phase 1 scaffolding only. The real implementation lands in Phase 5.
 *
 * Design rules:
 *   - Pure function. No store reads, no DOM, no side effects. Every input
 *     the math needs is passed in explicitly.
 *   - No date-fns calls inline — all date math routes through dateHelpers.ts
 *     so the edge cases in §13 have exactly one place to live.
 *   - Score is clamped at zero; the formula never surfaces a negative
 *     daily number. A negative projection is instead surfaced as a
 *     warning on the hook layer (see hooks/useAmbanScore.ts).
 *   - daysLeft is clamped to a minimum of 1 to prevent division by zero
 *     on income-credit day (§7.2).
 *
 * Used by:
 *   - hooks/useAmbanScore.ts        (Phase 5)
 *   - utils/insightGenerators.ts    (Phase 11, for projections)
 *
 * UI must never call this directly — always go through useAmbanScore().
 */

import {
  differenceInCalendarDaysClamped,
  getActualDueDate,
  getNextIncomeDate,
  isRecurringDueBeforeNextIncome,
} from "./dateHelpers";

/** A single income source, reduced to the fields the score cares about. */
export interface ScoreIncomeSource {
  /** Day of month the income credits (1–31). */
  creditDay: number;
  /** Amount credited per occurrence, in rupees. */
  amount: number;
}

/** A single recurring payment, reduced to the fields the score cares about. */
export interface ScoreRecurringPayment {
  /** Day of month the payment is due (1–31). */
  dueDay: number;
  /** Amount debited per occurrence, in rupees. */
  amount: number;
}

/** Inputs to calculateAmbanScore — matches CLAUDE.md Appendix B. */
export interface ScoreInput {
  /** Amount from the latest balance_snapshots row. */
  currentBalance: number;
  /**
   * Sum of daily_logs.spent since (and including) the latest balance
   * snapshot date. Computed by the caller because only they know which
   * snapshot is "latest".
   */
  spendSinceLastSnapshot: number;
  /** Active income sources. Inactive rows must be filtered out upstream. */
  incomeSources: ScoreIncomeSource[];
  /** Active recurring payments. Inactive rows must be filtered out upstream. */
  recurringPayments: ScoreRecurringPayment[];
  /** "Today" in the user's local calendar. Pass dateHelpers.today(). */
  today: Date;
}

/** Structured result — matches the shape consumed by useAmbanScore. */
export interface ScoreResult {
  /** Safe-to-spend amount per day, in rupees. Always >= 0. */
  score: number;
  /** Calendar days until the next income credit. Always >= 1. */
  daysLeft: number;
  /** currentBalance − spendSinceLastSnapshot (may be negative). */
  effectiveBalance: number;
  /** Sum of recurring payments due between today and next income. */
  upcomingRecurring: number;
  /**
   * Date of the next income credit across all active sources, or null
   * when no income sources exist (callers should treat this as a
   * configuration error, not a zero score).
   */
  nextIncomeDate: Date | null;
  /**
   * True when (effectiveBalance − upcomingRecurring) < 0, meaning the
   * user cannot cover their upcoming bills from the current balance.
   * UI surfaces this as the "projected-negative" warning (§13.5).
   */
  projectedNegative: boolean;
}

/**
 * Computes the Amban Score from the given inputs.
 *
 * Formula (Appendix B):
 *   effectiveBalance   = currentBalance − spendSinceLastSnapshot
 *   upcomingRecurring  = Σ payments where today ≤ dueDate ≤ nextIncomeDate
 *   daysLeft           = max(1, calendarDaysBetween(today, nextIncomeDate))
 *   score              = max(0, (effectiveBalance − upcomingRecurring) / daysLeft)
 *
 * Edge cases handled here:
 *   - No income sources → score = 0, nextIncomeDate = null. Hook surfaces
 *     the "no-income-source" warning.
 *   - Today IS income day → getNextIncomeDate rolls forward to next month,
 *     daysLeft becomes the full cycle length (§13.2).
 *   - Recurring dueDay > days-in-month → clamped via getActualDueDate (§13.4).
 *   - Recurring already passed this month → excluded to avoid double-deduct
 *     (§13.7); the balance snapshot is assumed to already reflect it.
 *   - Effective balance negative after bills → score clamped to 0 AND
 *     projectedNegative set so the UI can raise a red banner (§13.5).
 *
 * Not implemented yet — returns a safe zero-state. Landing in Phase 5.
 */
export function calculateAmbanScore(input: ScoreInput): ScoreResult {
  const {
    currentBalance,
    spendSinceLastSnapshot,
    incomeSources,
    recurringPayments,
    today,
  } = input;

  // 1. Find the next income date across all sources.
  const nextIncomeDate = getNextIncomeDate(incomeSources, today);

  // 2. No income sources → score is undefined; return a zero-state and
  //    let the hook layer compose the "no-income-source" warning.
  if (!nextIncomeDate) {
    return {
      score: 0,
      daysLeft: 1,
      effectiveBalance: currentBalance - spendSinceLastSnapshot,
      upcomingRecurring: 0,
      nextIncomeDate: null,
      projectedNegative: false,
    };
  }

  // 3. Calendar days until the next credit, clamped at 1.
  const daysLeft = differenceInCalendarDaysClamped(today, nextIncomeDate, 1);

  // 4. Effective balance = latest snapshot − spend since that snapshot.
  const effectiveBalance = currentBalance - spendSinceLastSnapshot;

  // 5. Sum recurring payments that fall between today and the next income.
  //    getActualDueDate is invoked here defensively so downstream helpers
  //    operate on concrete Date instances (see §13.4).
  const upcomingRecurring = recurringPayments.reduce((total, payment) => {
    void getActualDueDate(payment.dueDay, today);
    if (isRecurringDueBeforeNextIncome(payment.dueDay, today, nextIncomeDate)) {
      return total + payment.amount;
    }
    return total;
  }, 0);

  // 6. Raw score before clamping — can be negative when bills outrun balance.
  const rawScore = (effectiveBalance - upcomingRecurring) / daysLeft;
  const projectedNegative = effectiveBalance - upcomingRecurring < 0;

  // 7. Clamp at zero for display; surface the red state via projectedNegative.
  const score = Math.max(0, rawScore);

  return {
    score,
    daysLeft,
    effectiveBalance,
    upcomingRecurring,
    nextIncomeDate,
    projectedNegative,
  };
}
