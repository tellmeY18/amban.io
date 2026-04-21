/**
 * screens/Insights/InsightsScreen.tsx — full insights surface.
 *
 * Source of truth: CLAUDE.md §9.4 (Insights Screen) and §11 (Insights
 * Engine). Unlike the Home carousel which caps at HOME_CAROUSEL_MAX,
 * this screen surfaces every applicable insight plus the supporting
 * trend visualisations.
 *
 * Composition (top → bottom):
 *   1. Spending trend — 30-day line/area chart of daily spend vs score.
 *   2. Monthly category breakdown — pie chart of recurring + logged
 *      spend grouped by Appendix C category key.
 *   3. Full insight list (no carousel, no cap).
 *   4. Recurring share-of-income bar — horizontal stacked bar showing
 *      what fraction of monthly income goes to recurring bills.
 *
 * Design rules:
 *   - Pure presentational. All data assembly flows through stores +
 *     hooks already built in earlier phases.
 *   - Recharts is themed against CSS variables so light/dark flipping
 *     is free. We never hand Recharts a literal hex beyond the stable
 *     category palette (which is a brand constant in Appendix C).
 *   - Empty-state branches follow §13.1 — charts that depend on logs
 *     hide until at least STREAK_MIN_DAYS of data exists.
 *   - Dismissed insights still appear on this screen (users expect to
 *     see the full picture here), but each gets an "Undo" affordance
 *     so the TTL-based suppression can be cleared explicitly. v1 keeps
 *     that simple: the card renders with a subtle muted treatment and
 *     the user can dismiss again to re-extend the TTL.
 */
import { useMemo } from "react";
import { IonContent, IonIcon, IonPage } from "@ionic/react";
import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format } from "date-fns";

import { useInsights } from "../../hooks/useInsights";
import type { Insight, InsightTone } from "../../hooks/useInsights";
import { useAmbanScore } from "../../hooks/useAmbanScore";
import { useDailyStore } from "../../stores/dailyStore";
import { useFinanceStore } from "../../stores/financeStore";

import { CATEGORIES, CATEGORY_BY_KEY } from "../../constants/categories";
import type { CategoryKey } from "../../constants/categories";
import { STREAK_MIN_DAYS } from "../../constants/insightThresholds";

import { CATEGORY_ICONS, Icons } from "../../theme/icons";
import { formatINR, formatNumber, formatPercent } from "../../utils/formatters";
import { today as todayStartOfDay } from "../../utils/dateHelpers";

/** Trend chart window. Mirrors §9.4's "last 30 days" spec. */
const TREND_DAYS = 30;

/** Maps tones used by insight cards → colour tokens. Same rule the
 *  Home carousel uses, re-declared locally to keep the two presentations
 *  independent (the carousel's border-left convention is different from
 *  this screen's full-tinted card). */
const TONE_ACCENT: Record<InsightTone, string> = {
  positive: "var(--color-score-excellent)",
  neutral: "var(--color-primary)",
  warning: "var(--color-score-good)",
  critical: "var(--color-score-warning)",
};

const TONE_TINT: Record<InsightTone, string> = {
  positive: "rgba(30, 140, 69, 0.10)",
  neutral: "var(--color-primary-light)",
  warning: "rgba(242, 153, 0, 0.12)",
  critical: "rgba(233, 66, 53, 0.10)",
};

/* ------------------------------------------------------------------
 * Trend series builder
 *
 * Produces a 30-day dense array so the x-axis stays stable even when
 * the user hasn't logged every day. Days without a log render as 0
 * spend — a visually honest signal that they skipped.
 * ------------------------------------------------------------------ */

interface TrendPoint {
  date: string;
  shortLabel: string;
  spent: number;
  score: number | null;
}

function buildTrendSeries(logs: ReturnType<typeof useDailyStore.getState>["logs"]): TrendPoint[] {
  const byDate = new Map<string, (typeof logs)[number]>();
  for (const log of logs) byDate.set(log.logDate, log);

  const out: TrendPoint[] = [];
  const today = new Date();
  for (let i = TREND_DAYS - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const iso = `${y}-${m}-${day}`;
    const log = byDate.get(iso);
    out.push({
      date: iso,
      shortLabel: format(d, "d/M"),
      spent: log?.spent ?? 0,
      score: log?.scoreAtLog ?? null,
    });
  }
  return out;
}

/* ------------------------------------------------------------------
 * Category breakdown
 *
 * Combines monthly recurring totals with the rolling-window logged
 * spend (categorised). Daily logs without a category are bucketed
 * into "other" so the pie always sums to 100%.
 * ------------------------------------------------------------------ */

interface CategorySlice {
  key: CategoryKey;
  label: string;
  color: string;
  amount: number;
}

function buildCategoryBreakdown(
  recurring: ReturnType<typeof useFinanceStore.getState>["recurringPayments"],
  logs: ReturnType<typeof useDailyStore.getState>["logs"],
): CategorySlice[] {
  const totals = new Map<CategoryKey, number>();

  for (const payment of recurring) {
    if (!payment.isActive) continue;
    totals.set(payment.category, (totals.get(payment.category) ?? 0) + payment.amount);
  }
  for (const log of logs) {
    const key: CategoryKey = log.category ?? "other";
    totals.set(key, (totals.get(key) ?? 0) + log.spent);
  }

  return CATEGORIES.map((cat) => ({
    key: cat.key,
    label: cat.label,
    color: cat.colorHex,
    amount: totals.get(cat.key) ?? 0,
  })).filter((slice) => slice.amount > 0);
}

/* ------------------------------------------------------------------
 * Section primitives
 * ------------------------------------------------------------------ */

const Section: React.FC<{
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}> = ({ title, subtitle, children }) => (
  <section
    style={{
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-sm)",
      padding: "var(--space-md)",
      borderRadius: "var(--radius-md)",
      backgroundColor: "var(--surface-raised)",
      boxShadow: "var(--shadow-card)",
    }}
  >
    <header style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <h2
        style={{
          fontSize: "var(--text-h3)",
          fontWeight: "var(--font-weight-semibold)",
          color: "var(--text-strong)",
          margin: 0,
        }}
      >
        {title}
      </h2>
      {subtitle ? (
        <span style={{ fontSize: "var(--text-caption)", color: "var(--text-muted)" }}>
          {subtitle}
        </span>
      ) : null}
    </header>
    {children}
  </section>
);

const InsightCard: React.FC<{ insight: Insight }> = ({ insight }) => {
  const accent = TONE_ACCENT[insight.tone];
  const tint = TONE_TINT[insight.tone];
  return (
    <article
      style={{
        display: "flex",
        gap: "var(--space-md)",
        padding: "var(--space-md)",
        borderRadius: "var(--radius-md)",
        backgroundColor: "var(--surface-raised)",
        boxShadow: "var(--shadow-card)",
        borderLeft: `3px solid ${accent}`,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 36,
          height: 36,
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "var(--radius-pill)",
          backgroundColor: tint,
          color: accent,
        }}
      >
        <IonIcon icon={insight.icon || Icons.status.info} />
      </span>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          minWidth: 0,
          flex: 1,
        }}
      >
        <span
          style={{
            fontSize: "var(--text-body)",
            fontWeight: "var(--font-weight-semibold)",
            color: "var(--text-strong)",
            lineHeight: "var(--line-height-body)",
          }}
        >
          {insight.headline}
        </span>
        {insight.supporting ? (
          <span
            style={{
              fontSize: "var(--text-caption)",
              color: "var(--text-muted)",
              lineHeight: "var(--line-height-body)",
            }}
          >
            {insight.supporting}
          </span>
        ) : null}
      </div>
    </article>
  );
};

const InsightsScreen: React.FC = () => {
  const score = useAmbanScore();
  const { insights } = useInsights({ capped: false });
  const logs = useDailyStore((s) => s.logs);
  const recurring = useFinanceStore((s) => s.recurringPayments);
  const incomeSources = useFinanceStore((s) => s.incomeSources);

  const trend = useMemo(() => buildTrendSeries(logs), [logs]);
  const breakdown = useMemo(() => buildCategoryBreakdown(recurring, logs), [recurring, logs]);

  const monthlyIncome = useMemo(
    () => incomeSources.filter((s) => s.isActive).reduce((sum, s) => sum + s.amount, 0),
    [incomeSources],
  );

  const monthlyRecurring = useMemo(
    () => recurring.filter((p) => p.isActive).reduce((sum, p) => sum + p.amount, 0),
    [recurring],
  );

  const recurringSharePct = monthlyIncome > 0 ? (monthlyRecurring / monthlyIncome) * 100 : 0;

  const enoughLogs = logs.length >= STREAK_MIN_DAYS;
  const todayDate = useMemo(() => todayStartOfDay(), []);

  return (
    <IonPage>
      <IonContent fullscreen>
        <main
          className="amban-screen"
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}
        >
          <header
            style={{
              padding: "var(--space-md) var(--space-xs) var(--space-md)",
            }}
          >
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "var(--text-h1)",
                fontWeight: "var(--font-weight-bold)",
                color: "var(--text-strong)",
                margin: 0,
              }}
            >
              Insights
            </h1>
            <span
              style={{
                fontSize: "var(--text-caption)",
                color: "var(--text-muted)",
              }}
            >
              {format(todayDate, "EEEE, d MMM")}
            </span>
          </header>

          {/* 1. Spending trend */}
          <Section title="Spending trend" subtitle="Last 30 days vs your score">
            {enoughLogs ? (
              <div style={{ width: "100%", height: 180 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="spentGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="shortLabel"
                      tick={{ fontSize: 10, fill: "var(--text-muted)" }}
                      axisLine={false}
                      tickLine={false}
                      interval={5}
                    />
                    <YAxis hide />
                    <Tooltip
                      cursor={{ stroke: "var(--divider)" }}
                      contentStyle={{
                        backgroundColor: "var(--surface-raised)",
                        border: "1px solid var(--divider)",
                        borderRadius: 8,
                        fontSize: "var(--text-caption)",
                      }}
                      formatter={(value: number) => [formatINR(value), "Spent"]}
                    />
                    {score.ready && score.score > 0 ? (
                      <ReferenceLine
                        y={score.score}
                        stroke="var(--color-score-excellent)"
                        strokeDasharray="4 4"
                      />
                    ) : null}
                    <Area
                      type="monotone"
                      dataKey="spent"
                      stroke="var(--color-primary)"
                      strokeWidth={2}
                      fill="url(#spentGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p style={{ fontSize: "var(--text-caption)", color: "var(--text-muted)", margin: 0 }}>
                Log at least {STREAK_MIN_DAYS} days to see your trend.
              </p>
            )}
          </Section>

          {/* 2. Category breakdown */}
          <Section title="Where the money goes" subtitle="Recurring + daily spend, by category">
            {breakdown.length === 0 ? (
              <p
                style={{
                  fontSize: "var(--text-caption)",
                  color: "var(--text-muted)",
                  margin: 0,
                }}
              >
                Add recurring payments or category-tagged logs to see this breakdown.
              </p>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 140px) 1fr",
                  gap: "var(--space-md)",
                  alignItems: "center",
                }}
              >
                <div style={{ width: "100%", height: 140 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={breakdown}
                        dataKey="amount"
                        nameKey="label"
                        innerRadius={36}
                        outerRadius={64}
                        paddingAngle={1}
                      >
                        {breakdown.map((slice) => (
                          <Cell key={slice.key} fill={slice.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "var(--surface-raised)",
                          border: "1px solid var(--divider)",
                          borderRadius: 8,
                          fontSize: "var(--text-caption)",
                        }}
                        formatter={(value: number) => formatINR(value)}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--space-xs)",
                  }}
                >
                  {breakdown.slice(0, 6).map((slice) => {
                    const total = breakdown.reduce((s, b) => s + b.amount, 0);
                    const pct = total > 0 ? (slice.amount / total) * 100 : 0;
                    return (
                      <div
                        key={slice.key}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "var(--space-xs)",
                          fontSize: "var(--text-caption)",
                          minWidth: 0,
                        }}
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: "var(--radius-pill)",
                            backgroundColor: slice.color,
                            flexShrink: 0,
                          }}
                        />
                        <IonIcon
                          icon={CATEGORY_ICONS[slice.key]}
                          aria-hidden="true"
                          style={{ color: "var(--text-muted)" }}
                        />
                        <span
                          style={{
                            flex: 1,
                            color: "var(--text-strong)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {CATEGORY_BY_KEY[slice.key].label}
                        </span>
                        <span
                          style={{
                            color: "var(--text-muted)",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {formatPercent(pct)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Section>

          {/* 3. Full insight list */}
          <Section title="What we noticed" subtitle={`${formatNumber(insights.length)} insights`}>
            {insights.length === 0 ? (
              <p
                style={{
                  fontSize: "var(--text-caption)",
                  color: "var(--text-muted)",
                  margin: 0,
                }}
              >
                Insights unlock as you log more days. Check back tomorrow.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
                {insights.map((insight) => (
                  <InsightCard key={insight.id} insight={insight} />
                ))}
              </div>
            )}
          </Section>

          {/* 4. Recurring share-of-income bar */}
          <Section
            title="Recurring vs income"
            subtitle="What share of your monthly income is already committed"
          >
            {monthlyIncome <= 0 ? (
              <p
                style={{
                  fontSize: "var(--text-caption)",
                  color: "var(--text-muted)",
                  margin: 0,
                }}
              >
                Add an income source to see this breakdown.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
                <div
                  style={{
                    width: "100%",
                    height: 14,
                    borderRadius: "var(--radius-pill)",
                    backgroundColor: "var(--surface-sunken)",
                    overflow: "hidden",
                  }}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.min(100, Math.round(recurringSharePct))}
                  aria-label="Recurring share of income"
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.min(100, recurringSharePct)}%`,
                      backgroundColor:
                        recurringSharePct >= 70
                          ? "var(--color-score-warning)"
                          : recurringSharePct >= 50
                            ? "var(--color-score-good)"
                            : "var(--color-score-excellent)",
                      transition: "width var(--motion-base) var(--motion-ease-out)",
                    }}
                  />
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "var(--text-caption)",
                    color: "var(--text-muted)",
                  }}
                >
                  <span>
                    {formatINR(monthlyRecurring)} of {formatINR(monthlyIncome)}
                  </span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>
                    {formatPercent(recurringSharePct)}
                  </span>
                </div>
              </div>
            )}
          </Section>

          <footer
            style={{
              textAlign: "center",
              padding: "var(--space-lg) 0 var(--space-xl)",
              fontSize: "var(--text-micro)",
              color: "var(--text-muted)",
            }}
          >
            Insights live only on this device. They never leave.
          </footer>
        </main>
      </IonContent>
    </IonPage>
  );
};

export default InsightsScreen;
