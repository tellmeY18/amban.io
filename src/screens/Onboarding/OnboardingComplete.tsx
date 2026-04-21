/**
 * screens/Onboarding/OnboardingComplete.tsx — Onboarding Step 6.
 *
 * Source of truth: CLAUDE.md §6.1 (Onboarding → Completion reveal):
 *   - Animated reveal of the first Amban Score.
 *   - "Your daily budget is ₹X,XXX" — big celebratory display.
 *   - Brief 3-line explanation of what the score means.
 *   - "Let's go →" CTA navigates to Home and flips `onboarding_complete`.
 *
 * Design rules:
 *   - Uses `useAmbanScore()` for the first score calculation. The score
 *     is already valid at this point — every upstream input (income,
 *     balance, recurring) has been captured by the previous steps.
 *   - The big number count-up is a tiny in-file animation. Respects
 *     OS-level reduce-motion (via `prefersReducedMotion`) — when set,
 *     the final number renders instantly.
 *   - Flipping `onboarding_complete` to true is the LAST step. We want
 *     any upstream save failure (name, balance, etc.) to leave the
 *     user inside onboarding so they can retry — not kicked into an
 *     app with half-empty data. `userStore.completeOnboarding` handles
 *     the SQLite + Preferences dual-write.
 *   - After the flag flips, the router's App.tsx-level gate swaps the
 *     authenticated stack in on its next render. We don't manually
 *     push("/home") — the Switch redirect handles it.
 */
import { useEffect, useRef, useState } from "react";
import { useHistory } from "react-router-dom";

import StepLayout from "./StepLayout";
import { useAmbanScore } from "../../hooks/useAmbanScore";
import { useUserStore } from "../../stores/userStore";
import { formatINR } from "../../utils/formatters";
import { haptics, prefersReducedMotion } from "../../utils/haptics";

/** Animation duration for the score count-up, in ms. */
const COUNT_UP_MS = 900;

/**
 * Linear-ish count-up from 0 to `target`. Uses rAF so it respects the
 * browser's frame pacing and pauses cleanly on tab blur. The first
 * frame after mount skips the animation entirely under reduce-motion.
 */
function useCountUp(target: number, durationMs: number, enabled: boolean): number {
  const [value, setValue] = useState(enabled ? 0 : target);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setValue(target);
      return;
    }
    startRef.current = null;

    const tick = (now: number) => {
      if (startRef.current == null) startRef.current = now;
      const elapsed = now - startRef.current;
      const ratio = Math.min(1, elapsed / durationMs);
      // easeOutCubic — fast start, gentle land.
      const eased = 1 - Math.pow(1 - ratio, 3);
      setValue(Math.round(target * eased));
      if (ratio < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, durationMs, enabled]);

  return value;
}

const OnboardingComplete: React.FC = () => {
  const history = useHistory();
  const name = useUserStore((s) => s.name);
  const completeOnboarding = useUserStore((s) => s.completeOnboarding);

  const score = useAmbanScore();
  const reduceMotion = prefersReducedMotion();
  const animate = !reduceMotion && score.ready;
  const displayed = useCountUp(Math.round(score.score), COUNT_UP_MS, animate);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fire a soft celebratory haptic once the reveal is on screen.
  useEffect(() => {
    if (!score.ready) return;
    void haptics.success();
  }, [score.ready]);

  const handleFinish = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await completeOnboarding();
      // The router picks up the flag on the next render and swaps
      // the authenticated stack in; the explicit push is a belt-and-
      // braces fallback for the brief window before that reconciles.
      history.replace("/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't finish. Try again.");
      setBusy(false);
    }
  };

  const greeting = name ? `You're set, ${name}.` : "You're set.";

  return (
    <StepLayout
      stepIndex={5}
      hideBack
      title={greeting}
      subtitle="Here's your first Amban Score."
      ctaLabel="Let's go"
      ctaBusy={busy}
      onCta={handleFinish}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--space-md)",
          padding: "var(--space-xl) var(--space-md)",
          borderRadius: "var(--radius-lg)",
          backgroundColor: "var(--surface-raised)",
          boxShadow: "var(--shadow-elevated)",
          textAlign: "center",
        }}
        aria-live="polite"
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
            color: "var(--color-score-excellent)",
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {score.ready ? formatINR(displayed) : "—"}
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

        {score.ready ? (
          <div
            style={{
              display: "flex",
              gap: "var(--space-md)",
              marginTop: "var(--space-md)",
              flexWrap: "wrap",
              justifyContent: "center",
              color: "var(--text-muted)",
              fontSize: "var(--text-caption)",
            }}
          >
            <span>📅 {score.daysLeft} days until next income</span>
            {score.upcomingRecurring > 0 ? (
              <span>📤 {formatINR(score.upcomingRecurring)} in bills</span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-sm)",
          padding: "var(--space-md)",
          borderRadius: "var(--radius-md)",
          backgroundColor: "var(--color-primary-light)",
          color: "var(--color-primary-dark)",
        }}
      >
        <p
          style={{ margin: 0, fontSize: "var(--text-body)", lineHeight: "var(--line-height-body)" }}
        >
          This is your safe-to-spend number for today.
        </p>
        <p
          style={{ margin: 0, fontSize: "var(--text-body)", lineHeight: "var(--line-height-body)" }}
        >
          Log what you spend every evening — amban adjusts the number.
        </p>
        <p
          style={{ margin: 0, fontSize: "var(--text-body)", lineHeight: "var(--line-height-body)" }}
        >
          Everything stays on this device. Always.
        </p>
      </div>

      {error ? (
        <p
          role="alert"
          style={{
            fontSize: "var(--text-caption)",
            color: "var(--color-score-warning)",
            margin: 0,
          }}
        >
          {error}
        </p>
      ) : null}
    </StepLayout>
  );
};

export default OnboardingComplete;
