/**
 * screens/Home/components/ScoreCard.tsx — Amban Score hero card.
 *
 * Source of truth: CLAUDE.md §9.1 (Home Screen → Top Section) and §8
 * (The Amban Score). This is the single most important surface in the
 * app — the emotional centre, in the words of the roadmap.
 *
 * Responsibilities:
 *   - Render the big "₹X,XXX per day" number with the correct status
 *     colour resolved from `useAmbanScore().status`.
 *   - Surface a textual status label beneath the number so colour is
 *     never the sole carrier of meaning (Appendix G — accessibility).
 *   - Render a supporting metrics row: current balance, days until
 *     next income, upcoming bills sum.
 *   - Provide a skeleton variant while the score hook's `ready` flag
 *     is false so first paint never shows a zero to a user who is
 *     about to see a real number a frame later.
 *
 * Design rules:
 *   - Pure presentational component. Accepts the hook result as a
 *     prop so it's trivially testable and so the styleguide can
 *     render it with synthetic data.
 *   - All visual values come from tokens (tokens.css). The status
 *     colour is picked from the three `--color-score-*` tokens.
 *   - No imperative animation — the hero number uses tabular nums
 *     so digits stay visually anchored as the score updates.
 */

import type { CSSProperties } from "react";

import type { AmbanScoreResult, ScoreStatus } from "../../../hooks/useAmbanScore";
import { formatINR, formatNumber } from "../../../utils/formatters";

interface ScoreCardProps {
  /** The result from useAmbanScore(). The component reads the slices it needs. */
  score: AmbanScoreResult;
  /** Optional greeting line rendered above the score. */
  greeting?: string;
}

/** Maps status → CSS colour token. Single source of truth for the rule. */
const STATUS_COLOR: Record<ScoreStatus, string> = {
  healthy: "var(--color-score-excellent)",
  watch: "var(--color-score-good)",
  critical: "var(--color-score-warning)",
};

/** Maps status → one-word label. Accessibility: colour is never sole carrier. */
const STATUS_LABEL: Record<ScoreStatus, string> = {
  healthy: "Healthy",
  watch: "Watch it",
  critical: "Critical",
};

/** Maps status → subline copy explaining the colour. */
const STATUS_SUBLINE: Record<ScoreStatus, string> = {
  healthy: "Right on track.",
  watch: "A bit above your usual — keep an eye on it.",
  critical: "Well above your usual. Ease off today if you can.",
};

const cardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-md)",
  padding: "var(--space-lg)",
  borderRadius: "var(--radius-lg)",
  backgroundColor: "var(--surface-raised)",
  boxShadow: "var(--shadow-elevated)",
};

const MetricRow: React.FC<{ icon: string; label: string; value: string }> = ({
  icon,
  label,
  value,
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: "var(--space-xs)",
      fontSize: "var(--text-caption)",
      color: "var(--text-muted)",
      minWidth: 0,
    }}
  >
    <span aria-hidden="true">{icon}</span>
    <span
      style={{
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ color: "var(--text-muted)" }}>{label}:</span>{" "}
      <strong style={{ color: "var(--text-strong)", fontWeight: "var(--font-weight-semibold)" }}>
        {value}
      </strong>
    </span>
  </div>
);

const ScoreCard: React.FC<ScoreCardProps> = ({ score, greeting }) => {
  // Skeleton: render a muted placeholder while the hook is hydrating
  // so the page doesn't flash "₹0 per day" on cold boot.
  if (!score.ready) {
    return (
      <section style={cardStyle} aria-busy="true" aria-live="polite">
        {greeting ? (
          <span style={{ fontSize: "var(--text-body)", color: "var(--text-muted)" }}>
            {greeting}
          </span>
        ) : null}
        <div
          style={{
            height: "var(--text-score)",
            borderRadius: "var(--radius-md)",
            backgroundColor: "var(--surface-sunken)",
          }}
          aria-hidden="true"
        />
        <div
          style={{
            height: 14,
            width: "40%",
            borderRadius: "var(--radius-sm)",
            backgroundColor: "var(--surface-sunken)",
          }}
          aria-hidden="true"
        />
      </section>
    );
  }

  const color = STATUS_COLOR[score.status];
  const label = STATUS_LABEL[score.status];
  const subline = STATUS_SUBLINE[score.status];
  // Combined a11y label so screen readers hear one sentence instead of
  // parsing three stacked nodes (matches Appendix G recommendation).
  const a11yLabel = `Today's Amban score: ${formatINR(Math.round(score.score))} per day. Status: ${label}.`;

  return (
    <section style={cardStyle} aria-label={a11yLabel}>
      {greeting ? (
        <span
          style={{
            fontSize: "var(--text-body)",
            color: "var(--text-muted)",
            fontWeight: "var(--font-weight-medium)",
          }}
        >
          {greeting}
        </span>
      ) : null}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "var(--space-xs)",
          padding: "var(--space-md) 0",
        }}
      >
        <span
          style={{
            fontSize: "var(--text-caption)",
            fontWeight: "var(--font-weight-semibold)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
        >
          You can spend
        </span>
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "var(--text-score)",
            fontWeight: "var(--font-weight-bold)",
            letterSpacing: "-0.02em",
            color,
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatINR(Math.round(score.score))}
        </span>
        <span
          style={{
            fontSize: "var(--text-body)",
            color: "var(--text-muted)",
            fontWeight: "var(--font-weight-medium)",
          }}
        >
          per day
        </span>
        {/* Text status label — colour is not the sole signal. */}
        <span
          style={{
            marginTop: "var(--space-xs)",
            fontSize: "var(--text-caption)",
            fontWeight: "var(--font-weight-semibold)",
            color,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: "var(--text-caption)",
            color: "var(--text-muted)",
            textAlign: "center",
            maxWidth: "32ch",
          }}
        >
          {subline}
        </span>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--space-md)",
          justifyContent: "space-between",
          paddingTop: "var(--space-sm)",
          borderTop: "1px solid var(--divider)",
        }}
      >
        <MetricRow
          icon="💰"
          label="Balance"
          value={formatINR(Math.max(0, Math.round(score.effectiveBalance)))}
        />
        <MetricRow
          icon="📅"
          label="Next income"
          value={score.daysLeft === 1 ? "tomorrow" : `in ${formatNumber(score.daysLeft)} days`}
        />
        <MetricRow
          icon="📤"
          label="Upcoming"
          value={formatINR(Math.round(score.upcomingRecurring))}
        />
      </div>
    </section>
  );
};

export default ScoreCard;
