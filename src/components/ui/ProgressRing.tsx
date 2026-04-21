/**
 * components/ui/ProgressRing.tsx — circular progress indicator.
 *
 * Source of truth: CLAUDE.md §3 (Design System) and Appendix G
 * (Accessibility Guidelines).
 *
 * Used by:
 *   - Onboarding step progress (filled fraction = step / totalSteps).
 *   - Home's implicit "safe-to-spend" visual (filled fraction = spent / score).
 *   - Insights screen for recurring-as-share-of-income in compact form.
 *
 * Design rules:
 *   - Pure SVG. No canvas, no third-party charts. Stroke colour reads from
 *     a CSS variable by default so theming is free across light/dark.
 *   - Progress is in [0, 1]. Out-of-range inputs are clamped — callers
 *     don't need a precondition check. Negative inputs render as 0.
 *   - Respects OS reduce-motion: when requested, the stroke snaps to the
 *     target position instead of tweening. The gate lives in a single
 *     utility (src/utils/haptics.ts) so every motion-y primitive queries
 *     one source of truth.
 *   - Accessible: when given an aria-label, the component renders as a
 *     `progressbar` with the current value exposed to screen readers.
 *     Without a label it's treated as decorative (aria-hidden) — the
 *     parent component is expected to carry the semantics.
 *   - No layout side effects. The component occupies exactly `size` ×
 *     `size` pixels. Sizing is a parent concern, not ours.
 */

import { useMemo } from "react";
import type { CSSProperties } from "react";

import { prefersReducedMotion } from "../../utils/haptics";

export interface ProgressRingProps {
  /** Value in [0, 1]. Out-of-range inputs are clamped. */
  progress: number;
  /**
   * Stroke colour. Pass a CSS variable reference (e.g.
   * `var(--color-score-excellent)`) so the ring themes automatically.
   * Defaults to the primary token.
   */
  color?: string;
  /**
   * Track (unfilled) colour. Defaults to the divider token so the ring
   * reads as a subtle frame in both themes.
   */
  trackColor?: string;
  /** Diameter in pixels. Defaults to 80. */
  size?: number;
  /** Stroke width in pixels. Defaults to 6. */
  strokeWidth?: number;
  /**
   * Optional aria-label. When provided, the ring is announced as a
   * progressbar; when omitted the ring is decorative.
   */
  "aria-label"?: string;
  /**
   * Optional content rendered at the geometric centre of the ring
   * (score number, step counter, etc.). The parent controls its
   * typography — we just position it.
   */
  children?: React.ReactNode;
  /** Passthrough class for screen-specific tweaks. */
  className?: string;
  /** Inline style escape hatch — use sparingly. */
  style?: CSSProperties;
}

/** Clamp a number into [min, max]. Tiny helper, inlined for clarity. */
function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

const ProgressRing: React.FC<ProgressRingProps> = ({
  progress,
  color = "var(--color-primary)",
  trackColor = "var(--divider)",
  size = 80,
  strokeWidth = 6,
  "aria-label": ariaLabel,
  children,
  className,
  style,
}) => {
  // Geometry. All derived in one memo so a resize doesn't retrigger
  // per-render math — the values are stable until props actually change.
  const geom = useMemo(() => {
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    return {
      center: size / 2,
      radius,
      circumference,
    };
  }, [size, strokeWidth]);

  const clamped = clamp(progress, 0, 1);
  const dashOffset = geom.circumference * (1 - clamped);

  const interactive = typeof ariaLabel === "string" && ariaLabel.length > 0;
  const reduceMotion = prefersReducedMotion();

  const ringStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    width: size,
    height: size,
    flexShrink: 0,
    ...style,
  };

  return (
    <span
      className={className}
      style={ringStyle}
      role={interactive ? "progressbar" : undefined}
      aria-label={interactive ? ariaLabel : undefined}
      aria-valuemin={interactive ? 0 : undefined}
      aria-valuemax={interactive ? 100 : undefined}
      aria-valuenow={interactive ? Math.round(clamped * 100) : undefined}
      aria-hidden={interactive ? undefined : true}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        // Flip coordinate system so progress grows from the 12 o'clock
        // position clockwise — the intuitive reading for a ring meter.
        style={{ transform: "rotate(-90deg)", display: "block" }}
        focusable="false"
        // SVG itself is always decorative; the wrapper carries semantics.
        aria-hidden="true"
      >
        {/* Track — unfilled portion, always full circumference. */}
        <circle
          cx={geom.center}
          cy={geom.center}
          r={geom.radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />

        {/* Progress — filled arc. dashoffset drives the fill fraction. */}
        <circle
          cx={geom.center}
          cy={geom.center}
          r={geom.radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={geom.circumference}
          strokeDashoffset={dashOffset}
          style={{
            // Tween the fill when motion is allowed; snap otherwise.
            // The duration references the motion token so a global
            // retune propagates for free.
            transition: reduceMotion
              ? "none"
              : "stroke-dashoffset var(--motion-base) var(--motion-ease-out)",
          }}
        />
      </svg>

      {children != null ? (
        <span
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            // The parent owns the text styling; we only constrain layout.
            pointerEvents: "none",
          }}
        >
          {children}
        </span>
      ) : null}
    </span>
  );
};

export default ProgressRing;
