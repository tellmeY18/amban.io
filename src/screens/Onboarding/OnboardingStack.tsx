/**
 * screens/Onboarding/OnboardingStack.tsx — onboarding router stack.
 *
 * Source of truth: CLAUDE.md §6.1 (Onboarding Flow) and §13.8
 * (Onboarding Incomplete / App Kill Mid-Onboarding).
 *
 * Responsibilities:
 *   - Mount the six onboarding steps as nested routes under /onboarding.
 *   - Provide a resumability layer: on every step transition, the
 *     current step index is written to Capacitor Preferences via
 *     `onboardingFlags.setStep()`. On re-launch the stack reads the
 *     persisted value and redirects to the last incomplete step.
 *   - Never render the BottomNav or authenticated-app chrome. The
 *     onboarding stack is deliberately isolated — a user in the
 *     middle of setup should not be able to tab away into an empty
 *     Home screen.
 *
 * Rules of the road:
 *   - Steps are numbered 0..5 matching the spec:
 *       0 — Welcome
 *       1 — Basic Details (name + emoji)
 *       2 — Income Sources
 *       3 — Bank Balance
 *       4 — Recurring Payments
 *       5 — Completion reveal
 *     The index persisted to Preferences is the "highest step reached",
 *     so a relaunch resumes at that step (not beyond it).
 *   - The final step itself flips `onboarding_complete = true` in
 *     SQLite AND mirrors the flag into Preferences (via userStore's
 *     completeOnboarding). The router's App.tsx-level gate picks up
 *     the change on the next render and swaps over to AppShell.
 */
import { useEffect, useState } from "react";
import { IonRouterOutlet } from "@ionic/react";
import { Redirect, Route, Switch, useHistory } from "react-router-dom";

import Welcome from "./Welcome";
import BasicDetails from "./BasicDetails";
import IncomeSources from "./IncomeSources";
import BankBalance from "./BankBalance";
import RecurringPayments from "./RecurringPayments";
import OnboardingComplete from "./OnboardingComplete";

import { onboardingFlags } from "../../db/preferences";

/**
 * Path → step index map. Used both for the resumability redirect and
 * for persisting "highest step reached" as the user advances.
 */
export const ONBOARDING_STEPS = [
  { index: 0, path: "/onboarding/welcome" },
  { index: 1, path: "/onboarding/basic" },
  { index: 2, path: "/onboarding/income" },
  { index: 3, path: "/onboarding/balance" },
  { index: 4, path: "/onboarding/recurring" },
  { index: 5, path: "/onboarding/complete" },
] as const;

export type OnboardingStepIndex = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * Advance helper — called by each step's primary CTA. Writes the new
 * highest-reached index to Preferences, then navigates to the next
 * route in the stack. Safe to call more than once per step; the
 * persisted value is monotonic, so "forward only" is enforced.
 */
export async function advanceOnboarding(
  history: ReturnType<typeof useHistory>,
  fromStep: OnboardingStepIndex,
): Promise<void> {
  const next = Math.min(fromStep + 1, 5) as OnboardingStepIndex;
  const persisted = await onboardingFlags.getStep();
  if (next > persisted) {
    await onboardingFlags.setStep(next);
  }
  const target = ONBOARDING_STEPS.find((s) => s.index === next);
  if (target) history.push(target.path);
}

/**
 * Resume gate — resolves the persisted step index once on mount and
 * kicks the user to the right entry point. While resolving we render
 * nothing (the parent's boot splash is still visible).
 */
const OnboardingStack: React.FC = () => {
  const [resumePath, setResumePath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const step = await onboardingFlags.getStep();
      if (cancelled) return;
      const clamped = Math.min(Math.max(step, 0), 5) as OnboardingStepIndex;
      const match = ONBOARDING_STEPS.find((s) => s.index === clamped);
      setResumePath(match?.path ?? "/onboarding/welcome");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!resumePath) return null;

  return (
    <IonRouterOutlet>
      <Switch>
        <Route exact path="/onboarding/welcome" component={Welcome} />
        <Route exact path="/onboarding/basic" component={BasicDetails} />
        <Route exact path="/onboarding/income" component={IncomeSources} />
        <Route exact path="/onboarding/balance" component={BankBalance} />
        <Route exact path="/onboarding/recurring" component={RecurringPayments} />
        <Route exact path="/onboarding/complete" component={OnboardingComplete} />
        <Route exact path="/onboarding">
          <Redirect to={resumePath} />
        </Route>
        <Route>
          <Redirect to={resumePath} />
        </Route>
      </Switch>
    </IonRouterOutlet>
  );
};

export default OnboardingStack;
