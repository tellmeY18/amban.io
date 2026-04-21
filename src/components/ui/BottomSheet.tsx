/**
 * components/ui/BottomSheet.tsx — modal drawer anchored to the bottom edge.
 *
 * Source of truth: CLAUDE.md §3 (Design System) — bottom sheets are the
 * primary surface for quick forms (Update Balance, backfill logs, etc.).
 *
 * Implementation notes:
 *   - Wraps <IonModal> with breakpoints to get the native drag-handle feel
 *     on iOS and Android. The amban-flavoured API is intentionally smaller
 *     than Ionic's so call sites don't leak Ionic-specific props.
 *   - Respects OS-level reduce-motion by disabling the show/dismiss
 *     animations when requested. Ionic's `animated` prop is the cleanest
 *     lever for this — we don't try to patch individual transitions.
 *   - Surface colours come from CSS tokens via the Ionic variable bridge
 *     in src/theme/variables.css, so light/dark flipping is free.
 *   - A title slot is offered because every use-case in the spec has one
 *     (§6.3 Balance Update, §9.5 Update Balance, §13.6 backfill). Callers
 *     that want a custom header can omit `title` and render their own.
 *   - The sheet closes on backdrop tap by default; pass
 *     `dismissOnBackdrop={false}` for destructive confirms (Appendix I).
 */

import { IonModal } from "@ionic/react";
import type { ReactNode } from "react";

import { prefersReducedMotion } from "../../utils/haptics";

export interface BottomSheetProps {
  /** Controlled open state. */
  open: boolean;
  /** Called when the user dismisses (backdrop, drag-down, or Esc). */
  onDismiss: () => void;
  /** Optional header title rendered inside the sheet body. */
  title?: string;
  /**
   * Initial height as a fraction of the viewport (0–1).
   * Defaults to 0.5 — the "medium detent" most forms need.
   */
  initialBreakpoint?: number;
  /**
   * Allowed snap points, ascending. Must include `initialBreakpoint`.
   * Defaults to [0, 0.5, 1] — closed, medium, full.
   * Note: including `0` lets the user drag-to-dismiss.
   */
  breakpoints?: number[];
  /** Block backdrop taps from closing the sheet. Defaults to false. */
  dismissOnBackdrop?: boolean;
  /** Accessible label for screen readers when no `title` is provided. */
  "aria-label"?: string;
  /** Sheet content. */
  children: ReactNode;
}

/** Default snap points — closed, half, full. */
const DEFAULT_BREAKPOINTS = [0, 0.5, 1];
const DEFAULT_INITIAL_BREAKPOINT = 0.5;

/**
 * Premium-feeling bottom sheet. Keep the consumer API tight — if a screen
 * needs more control, it's usually a signal to refactor the composition,
 * not to widen this prop surface.
 */
const BottomSheet: React.FC<BottomSheetProps> = ({
  open,
  onDismiss,
  title,
  initialBreakpoint = DEFAULT_INITIAL_BREAKPOINT,
  breakpoints = DEFAULT_BREAKPOINTS,
  dismissOnBackdrop = true,
  "aria-label": ariaLabel,
  children,
}) => {
  // Reduce-motion is read on every render so OS-level flips take effect
  // without remounting the provider tree. The cost is negligible.
  const animated = !prefersReducedMotion();

  return (
    <IonModal
      isOpen={open}
      onDidDismiss={onDismiss}
      breakpoints={breakpoints}
      initialBreakpoint={initialBreakpoint}
      backdropDismiss={dismissOnBackdrop}
      handle
      animated={animated}
      aria-label={title ?? ariaLabel}
      style={
        {
          // Expose the sheet surface via amban tokens so light/dark flips
          // come for free. The Ionic bridge in variables.css handles most
          // of this, but the sheet backdrop background is declared here
          // explicitly because Ionic renders it on a different element.
          "--background": "var(--surface-raised)",
          "--color": "var(--text-strong)",
          "--border-radius": "var(--radius-xl) var(--radius-xl) 0 0",
          "--handle-background": "var(--divider)",
        } as React.CSSProperties
      }
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title ?? ariaLabel}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-md)",
          padding: "var(--space-lg) var(--space-md)",
          // Respect the home indicator / gesture area on iOS.
          paddingBottom: "calc(var(--space-lg) + env(safe-area-inset-bottom))",
          overflowY: "auto",
          // The handle lives above this element; leave room for it.
          marginTop: "var(--space-sm)",
        }}
      >
        {title ? (
          <header
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: "var(--space-md)",
            }}
          >
            <h2
              style={{
                fontSize: "var(--text-h2)",
                fontWeight: "var(--font-weight-semibold)",
                color: "var(--text-strong)",
                margin: 0,
              }}
            >
              {title}
            </h2>
          </header>
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
          {children}
        </div>
      </div>
    </IonModal>
  );
};

export default BottomSheet;
