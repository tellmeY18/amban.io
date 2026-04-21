/**
 * components/ui/Card.tsx — surface primitive.
 *
 * Phase 1 scaffolding only. A minimal, token-driven card that every other
 * screen composes against. The full style-guide variant lands in Phase 2
 * (Design System Foundation).
 *
 * Design rules:
 *   - Renders a plain <section> by default; pass `as` to use a different
 *     semantic tag (e.g. "article" for Insight cards, "button" for tappable
 *     summary cards on Home).
 *   - All spacing, radius, surface, and shadow values come from CSS tokens
 *     defined in src/theme/tokens.css. Never hard-code colors or shadows
 *     here — retune the tokens instead.
 *   - The `elevated` variant swaps --shadow-card for --shadow-elevated and
 *     is used for anything that needs to visually "lift" (bottom sheets,
 *     primary CTA cards, modal content). Default variant is flat.
 *   - Respects the 44×44 hit-target minimum from Appendix G when rendered
 *     as an interactive element (`as="button"` or with `onClick`).
 */

import type { CSSProperties, ElementType, ReactNode } from "react";

export type CardVariant = "flat" | "elevated";
export type CardPadding = "none" | "sm" | "md" | "lg";

export interface CardProps {
  /** Semantic element to render. Defaults to <section>. */
  as?: ElementType;
  /** Visual variant. Defaults to "flat". */
  variant?: CardVariant;
  /** Interior padding, token-backed. Defaults to "md". */
  padding?: CardPadding;
  /** Optional click handler. When present, the card becomes tappable. */
  onClick?: () => void;
  /** Passthrough class for screen-specific tweaks. */
  className?: string;
  /** Inline style escape hatch. Use sparingly; prefer CSS modules. */
  style?: CSSProperties;
  /** Accessible label when the card is interactive but has no text child. */
  "aria-label"?: string;
  /** Card content. */
  children: ReactNode;
}

const PADDING_TOKEN: Record<CardPadding, string> = {
  none: "0",
  sm: "var(--space-sm)",
  md: "var(--space-md)",
  lg: "var(--space-lg)",
};

/**
 * amban's base surface primitive. Keep this component boring — all the
 * visual personality lives in the tokens and in the specific feature
 * components that compose it (ScoreCard, InsightCard, etc.).
 */
const Card: React.FC<CardProps> = ({
  as: Tag = "section",
  variant = "flat",
  padding = "md",
  onClick,
  className,
  style,
  "aria-label": ariaLabel,
  children,
}) => {
  const interactive = typeof onClick === "function";

  const composedStyle: CSSProperties = {
    backgroundColor: "var(--surface-raised)",
    color: "var(--text-strong)",
    borderRadius: "var(--radius-lg)",
    padding: PADDING_TOKEN[padding],
    boxShadow: variant === "elevated" ? "var(--shadow-elevated)" : "var(--shadow-card)",
    transition:
      "transform var(--motion-fast) var(--motion-ease), box-shadow var(--motion-fast) var(--motion-ease)",
    ...(interactive
      ? {
          cursor: "pointer",
          minHeight: "var(--hit-target-min)",
          minWidth: "var(--hit-target-min)",
          WebkitTapHighlightColor: "transparent",
        }
      : null),
    ...style,
  };

  const handleKeyDown =
    interactive && Tag !== "button"
      ? (event: React.KeyboardEvent) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onClick?.();
          }
        }
      : undefined;

  return (
    <Tag
      className={className}
      style={composedStyle}
      onClick={interactive ? onClick : undefined}
      onKeyDown={handleKeyDown}
      role={interactive && Tag !== "button" ? "button" : undefined}
      tabIndex={interactive && Tag !== "button" ? 0 : undefined}
      aria-label={ariaLabel}
    >
      {children}
    </Tag>
  );
};

export default Card;
