/**
 * constants/insightThresholds.ts — tunables for the insights engine.
 *
 * Source of truth: CLAUDE.md Appendix D (Insight Thresholds).
 *
 * Every number the insights engine, score color rule, or Home carousel
 * depends on lives here. Do NOT inline these values anywhere else —
 * changing a threshold should be a one-file edit that ripples through
 * the whole app.
 *
 * Consumed by:
 *   - utils/scoring.ts             (score status ratios)
 *   - hooks/useAmbanScore.ts       (status derivation, warnings)
 *   - hooks/useInsights.ts         (dismissal TTL, carousel cap, rotate)
 *   - utils/insightGenerators.ts   (every §11.x generator)
 *   - screens/Home                 (upcoming payment warning chips)
 *   - hooks/useNotifications.ts    (upcoming payment lead time)
 */

// ------------------------------------------------------------
// Savings rate thresholds (§11.2)
//   rate >= GREEN → tone "positive"
//   rate >= AMBER → tone "neutral"
//   otherwise     → tone "warning"
// Expressed as whole-number percentages to match how the UI reads them.
// ------------------------------------------------------------

export const SAVINGS_RATE_GREEN = 30;
export const SAVINGS_RATE_AMBER = 15;

// ------------------------------------------------------------
// Score color rule (§3 — Score Color Rule)
//   ratio = todayScore / historicalAvgScore
//   ratio >= HEALTHY → status "healthy"
//   ratio >= GOOD    → status "watch"
//   otherwise        → status "critical"
// On first launch (no history), status is forced to "healthy".
// ------------------------------------------------------------

export const SCORE_HEALTHY_RATIO = 0.9;
export const SCORE_GOOD_RATIO = 0.6;

// ------------------------------------------------------------
// Rolling window for averages and "this month so far" math.
// Used by every insight that reads logs: streak, best/worst day,
// lifestyle cost, lifestyle upgrade, coffee math, etc.
// ------------------------------------------------------------

export const AVG_WINDOW_DAYS = 30;

// ------------------------------------------------------------
// Streak insight (§11.3)
//   Minimum consecutive "within score" days required before the
//   streak insight surfaces at all. Below this, the card is noise.
// ------------------------------------------------------------

export const STREAK_MIN_DAYS = 3;

// ------------------------------------------------------------
// Lifestyle upgrade trigger (§11.7)
//   When avg daily spend exceeds the score for this many days in
//   a row, the "you'd need ₹X more per month" warning fires.
// ------------------------------------------------------------

export const OVERSPEND_STREAK_DAYS = 7;

// ------------------------------------------------------------
// Lifestyle cost buffer (§11.1)
//   Extra headroom added on top of projected monthly spend when
//   computing the "ideal monthly income" figure. Expressed as a
//   whole-number percentage of projected spend.
// ------------------------------------------------------------

export const SAVINGS_BUFFER_PCT = 20;

// ------------------------------------------------------------
// Upcoming payment visibility (§9.1 + §10.2)
//   WARN_DAYS  → payment chips on Home get the warning treatment.
//   NOTIFY_DAYS → local notification lead time per §10.2.
// ------------------------------------------------------------

export const UPCOMING_PAYMENT_WARN_DAYS = 3;
export const UPCOMING_PAYMENT_NOTIFY_DAYS = 2;

// ------------------------------------------------------------
// Income countdown insight (§11.9)
//   Only show the "N days until your next income" card when the
//   next credit is within this many calendar days.
// ------------------------------------------------------------

export const INCOME_COUNTDOWN_DAYS = 7;

// ------------------------------------------------------------
// Insight dismissal TTL (§11.10)
//   When the user swipes to dismiss an insight, suppress it for
//   this many hours before allowing the generator to fire again.
// ------------------------------------------------------------

export const INSIGHT_DISMISS_TTL_HOURS = 24;

// ------------------------------------------------------------
// Home carousel behaviour
//   MAX            → hard cap on simultaneously-visible insights.
//   ROTATE_MS      → auto-advance interval; paused on touch and
//                    when the OS requests reduced motion.
// ------------------------------------------------------------

export const HOME_CAROUSEL_MAX = 3;
export const HOME_CAROUSEL_ROTATE_MS = 5000;

// ------------------------------------------------------------
// Coffee-math product costs (§11.8)
//   Lookup used by the playful "that's N cups of chai" line.
//   Stored here so a single edit retunes the copy everywhere.
// ------------------------------------------------------------

export const COFFEE_MATH_PRODUCTS = {
  /** Café Coffee Day chai reference point. */
  chai: 150,
  /** Multiplex movie ticket (rough national average). */
  movieTicket: 300,
  /** Mid-range restaurant meal for one. */
  restaurantMeal: 450,
} as const;

/**
 * Thresholds that gate which coffee-math template fires, in rupees of
 * average daily spend. Walked top-down; the first match wins. Keep the
 * entries ordered high → low so the most premium framing surfaces
 * whenever the user qualifies for it.
 */
export const COFFEE_MATH_THRESHOLDS: ReadonlyArray<{
  minAvgDailySpend: number;
  product: keyof typeof COFFEE_MATH_PRODUCTS;
}> = [
  { minAvgDailySpend: 2000, product: "restaurantMeal" },
  { minAvgDailySpend: 1000, product: "movieTicket" },
  { minAvgDailySpend: 500, product: "chai" },
];
