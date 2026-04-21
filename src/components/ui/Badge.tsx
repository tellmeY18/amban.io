/**
 * components/ui/Badge.tsx — small pill-shaped label.
 * Phase 1 scaffolding only; full styling lands in Phase 2.
 * Used for upcoming-payment "in N days", category chips, and streak counters.
 */

import type { ReactNode, CSSProperties } from "react";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

const TONE_STYLES: Record<BadgeTone, CSSProperties> = {
  neutral: { backgroundColor: "var(--surface-sunken)", color: "var(--text-muted)" },
  info:    { backgroundColor: "var(--color-primary-light)", color: "var(--color-primary-dark)" },
  success: { backgroundColor: "rgba(30,140,69,0.12)", color: "var(--color-score-excellent)" },
  warning: { backgroundColor: "rgba(242,153,0,0.14)", color: "var(--color-score-good)" },
  danger:  { backgroundColor: "rgba(233,66,53,0.12)", color: "var(--color-score-warning)" },
};

const Badge: React.FC<BadgeProps> = ({ tone = "neutral", className, children }) => (
  <span
    className={className}
    style={{
      display: "inline-flex",
      alignItems: "center",
      padding: "2px var(--space-sm)",
      borderRadius: "var(--radius-pill)",
      fontSize: "var(--text-caption)",
      fontWeight: "var(--font-weight-medium)",
      lineHeight: 1.4,
      ...TONE_STYLES[tone],
    }}
  >
    {children}
  </span>
);

export default Badge;
