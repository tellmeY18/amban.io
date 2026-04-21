/**
 * screens/Onboarding/Welcome.tsx — Onboarding Step 1.
 *
 * Source of truth: CLAUDE.md §6.1 (Onboarding Flow → Welcome Screen).
 *
 * The brand moment. Minimal copy, a single CTA, no form. This screen
 * sets the tone for the rest of the flow: friendly, confident, fast.
 *
 * Design rules:
 *   - No back button (this is step 0 — nothing to go back to).
 *   - Primary CTA uses the shared StepLayout so the footer position
 *     is muscle-memory consistent across the whole onboarding flow.
 *   - No store reads here — the user hasn't created anything yet.
 */
import StepLayout from "./StepLayout";
import { advanceOnboarding } from "./OnboardingStack";
import { useHistory } from "react-router-dom";

const Welcome: React.FC = () => {
  const history = useHistory();

  const handleContinue = async () => {
    await advanceOnboarding(history, 0);
  };

  return (
    <StepLayout
      stepIndex={0}
      hideBack
      title="Know your number."
      subtitle="Own your day."
      ctaLabel="Get started"
      onCta={handleContinue}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--space-lg)",
          flex: 1,
          padding: "var(--space-xl) var(--space-md)",
          textAlign: "center",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 96,
            height: 96,
            borderRadius: "var(--radius-xl)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background:
              "linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)",
            color: "#ffffff",
            fontFamily: "var(--font-display)",
            fontSize: "3rem",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            boxShadow: "var(--shadow-elevated)",
          }}
        >
          a
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-sm)",
            maxWidth: "32ch",
          }}
        >
          <p
            style={{
              fontSize: "var(--text-body)",
              color: "var(--text-muted)",
              lineHeight: "var(--line-height-body)",
            }}
          >
            amban tells you what you <em>can</em> spend today — not just what you already spent.
          </p>
          <p
            style={{
              fontSize: "var(--text-body)",
              color: "var(--text-muted)",
              lineHeight: "var(--line-height-body)",
            }}
          >
            100% on your device. No sign-up. No cloud.
          </p>
        </div>
      </div>
    </StepLayout>
  );
};

export default Welcome;
