/**
 * screens/Onboarding/StepLayout.tsx — shared layout for onboarding steps.
 *
 * Source of truth: CLAUDE.md §6.1 (Onboarding Flow) and Appendix G
 * (Accessibility Guidelines — focus order, hit targets, dynamic type).
 *
 * Every onboarding step renders through this layout so the chrome
 * (progress indicator, back button, title, sticky primary CTA) stays
 * visually and behaviourally identical across the whole flow. If a
 * step needs something special, extend the layout — don't fork it.
 *
 * Design rules:
 *   - Sticky primary CTA at the bottom so the thumb-reach zone is
 *     always consistent. The CTA respects `env(safe-area-inset-bottom)`
 *     on iOS and the gesture area on Android.
 *   - Progress indicator is a simple 6-segment strip. No numbers —
 *     the shape is enough information, and we avoid the "you are on
 *     step 3 of 6" vibe that reads as bureaucracy.
 *   - Back button in the top-left mirrors the native back gesture.
 *     The Welcome step (index 0) hides it because there's nowhere to
 *     go back to.
 *   - Every layout instance is a valid <IonPage> so Ionic's page
 *     transitions fire between steps. The content itself is a plain
 *     scrollable column — no IonHeader / IonToolbar, since the
 *     onboarding flow has its own compact top strip.
 */
import { IonIcon, IonPage } from "@ionic/react";
import { useHistory } from "react-router-dom";
import type { CSSProperties, ReactNode } from "react";
import { useMemo } from "react";
import { useEffect } from "react";

import { Icons } from "../../theme/icons";
import { haptics } from "../../utils/haptics";

export interface StepLayoutProps {
  /** 0..5 — matches ONBOARDING_STEPS in OnboardingStack. */
  stepIndex: 0 | 1 | 2 | 3 | 4 | 5;
  /** Title shown beneath the progress strip. */
  title: string;
  /** Optional body copy shown under the title. */
  subtitle?: string;
  /** Primary CTA label. Defaults to "Continue". */
  ctaLabel?: string;
  /**
   * True to disable the primary CTA (e.g. form incomplete). When true
   * the CTA is rendered with a muted colour and `aria-disabled`.
   */
  ctaDisabled?: boolean;
  /**
   * True while an async action is in flight (e.g. saving to SQLite).
   * Swaps the CTA label for a "…" affordance and disables interaction.
   */
  ctaBusy?: boolean;
  /** Fires when the primary CTA is tapped. */
  onCta: () => void | Promise<void>;
  /**
   * Optional secondary action shown beneath the CTA (e.g. "Skip for
   * now"). Hidden when undefined.
   */
  secondary?: {
    label: string;
    onSelect: () => void | Promise<void>;
  };
  /**
   * Hide the back button. Welcome uses this; every other step should
   * leave it visible so users can correct earlier entries.
   */
  hideBack?: boolean;
  /** Step body content. */
  children: ReactNode;
}

const TOTAL_STEPS = 6;

const StepLayout: React.FC<StepLayoutProps> = ({
  stepIndex,
  title,
  subtitle,
  ctaLabel = "Continue",
  ctaDisabled = false,
  ctaBusy = false,
  onCta,
  secondary,
  hideBack = false,
  children,
}) => {
  const history = useHistory();

  // Scroll to top whenever the step changes so the header is always
  // in view on mount. Matches native page-transition expectations.
  useEffect(() => {
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, [stepIndex]);

  const segmentFilled = useMemo(
    () => Array.from({ length: TOTAL_STEPS }).map((_, i) => i <= stepIndex),
    [stepIndex],
  );

  const handleBack = () => {
    void haptics.selection();
    if (history.length > 1) history.goBack();
  };

  const handleCta = async () => {
    if (ctaDisabled || ctaBusy) return;
    void haptics.tapLight();
    await onCta();
  };

  const pageStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    minHeight: "100dvh",
    backgroundColor: "var(--surface-base)",
    color: "var(--text-strong)",
    paddingTop: "env(safe-area-inset-top, 0px)",
  };

  return (
    <IonPage>
      <div style={pageStyle}>
        {/* Top strip: back + progress */}
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-md)",
            padding: "var(--space-md) var(--space-md) var(--space-sm)",
          }}
        >
          {hideBack ? (
            <span style={{ width: 40, height: 40 }} aria-hidden="true" />
          ) : (
            <button
              type="button"
              onClick={handleBack}
              aria-label="Go back"
              style={{
                width: 40,
                height: 40,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "var(--radius-pill)",
                backgroundColor: "var(--surface-sunken)",
                color: "var(--text-strong)",
                minHeight: 40,
                minWidth: 40,
              }}
            >
              <IonIcon
                icon={Icons.action.chevronBack}
                aria-hidden="true"
                style={{ fontSize: "1.25rem" }}
              />
            </button>
          )}

          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={TOTAL_STEPS}
            aria-valuenow={stepIndex + 1}
            aria-label={`Step ${stepIndex + 1} of ${TOTAL_STEPS}`}
          >
            {segmentFilled.map((filled, idx) => (
              <span
                key={idx}
                aria-hidden="true"
                style={{
                  flex: 1,
                  height: 4,
                  borderRadius: "var(--radius-pill)",
                  backgroundColor: filled ? "var(--color-primary)" : "var(--divider)",
                  transition: "background-color var(--motion-fast) var(--motion-ease)",
                }}
              />
            ))}
          </div>
        </header>

        {/* Body */}
        <section
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            padding: "var(--space-lg) var(--space-md) var(--space-md)",
            gap: "var(--space-lg)",
            overflowY: "auto",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-sm)",
            }}
          >
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "var(--text-h1)",
                fontWeight: "var(--font-weight-bold)",
                letterSpacing: "-0.01em",
                margin: 0,
              }}
            >
              {title}
            </h1>
            {subtitle ? (
              <p
                style={{
                  color: "var(--text-muted)",
                  fontSize: "var(--text-body)",
                  lineHeight: "var(--line-height-body)",
                  margin: 0,
                }}
              >
                {subtitle}
              </p>
            ) : null}
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-md)",
              flex: 1,
            }}
          >
            {children}
          </div>
        </section>

        {/* Sticky CTA footer */}
        <footer
          style={{
            position: "sticky",
            bottom: 0,
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-sm)",
            padding: "var(--space-md)",
            paddingBottom: "calc(var(--space-md) + env(safe-area-inset-bottom, 0px))",
            backgroundColor: "var(--surface-base)",
            borderTop: "1px solid var(--divider)",
          }}
        >
          <button
            type="button"
            onClick={handleCta}
            disabled={ctaDisabled || ctaBusy}
            aria-disabled={ctaDisabled || ctaBusy}
            style={{
              minHeight: "var(--hit-target-min)",
              padding: "var(--space-sm) var(--space-lg)",
              borderRadius: "var(--radius-md)",
              backgroundColor:
                ctaDisabled || ctaBusy ? "var(--surface-sunken)" : "var(--color-primary)",
              color: ctaDisabled || ctaBusy ? "var(--text-muted)" : "#ffffff",
              fontFamily: "var(--font-body)",
              fontSize: "var(--text-body)",
              fontWeight: "var(--font-weight-semibold)",
              border: "none",
              cursor: ctaDisabled || ctaBusy ? "not-allowed" : "pointer",
              transition:
                "background-color var(--motion-fast) var(--motion-ease), opacity var(--motion-fast) var(--motion-ease)",
            }}
          >
            {ctaBusy ? "Saving…" : ctaLabel}
          </button>
          {secondary ? (
            <button
              type="button"
              onClick={() => {
                void haptics.selection();
                void secondary.onSelect();
              }}
              style={{
                minHeight: "var(--hit-target-min)",
                padding: "var(--space-sm) var(--space-lg)",
                borderRadius: "var(--radius-md)",
                backgroundColor: "transparent",
                color: "var(--text-muted)",
                fontFamily: "var(--font-body)",
                fontSize: "var(--text-body)",
                fontWeight: "var(--font-weight-medium)",
                border: "none",
                cursor: "pointer",
              }}
            >
              {secondary.label}
            </button>
          ) : null}
        </footer>
      </div>
    </IonPage>
  );
};

export default StepLayout;
