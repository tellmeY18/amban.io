/**
 * screens/Onboarding/BankBalance.tsx — Onboarding Step 4.
 *
 * Source of truth: CLAUDE.md §6.1 (Onboarding → Bank Balance):
 *   - Single number input (current bank balance)
 *   - Helper text clarifies this is a starting point, editable later
 *   - Important: today's date is captured as the balance snapshot date
 *
 * Design rules:
 *   - Writes through to SQLite via `financeStore.setBalance` which
 *     appends a new row to balance_snapshots dated today. This is the
 *     correct semantic — snapshots are append-only (see repositories.ts
 *     balanceSnapshotsRepo docs) and scoring always reads the latest.
 *   - We accept zero as a valid balance (a user who just got paid out
 *     might genuinely be at ₹0 and want the app to say so). Negative
 *     is rejected — SQLite stores a REAL but we don't want the UI to
 *     ever have to render a negative balance on Home.
 *   - The latest snapshot from the store is used to prefill the input
 *     on re-entry — if the user went back to this step after already
 *     setting a balance, they see their last entry rather than 0.
 */
import { useEffect, useState } from "react";
import { useHistory } from "react-router-dom";

import StepLayout from "./StepLayout";
import { advanceOnboarding } from "./OnboardingStack";
import CurrencyInput from "../../components/ui/CurrencyInput";
import { useFinanceStore } from "../../stores/financeStore";

const BankBalance: React.FC = () => {
  const history = useHistory();
  const latestBalance = useFinanceStore((s) => s.latestBalance);
  const setBalance = useFinanceStore((s) => s.setBalance);

  const [amount, setAmount] = useState<number | null>(latestBalance?.amount ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reflect upstream changes (rare here, but keeps the component honest
  // if the store rehydrates after a foreground resume mid-onboarding).
  useEffect(() => {
    if (latestBalance && amount == null) {
      setAmount(latestBalance.amount);
    }
  }, [latestBalance, amount]);

  const canContinue = amount != null && amount >= 0;

  const handleContinue = async () => {
    if (!canContinue || busy) return;
    setBusy(true);
    setError(null);
    try {
      await setBalance(amount ?? 0);
      await advanceOnboarding(history, 3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepLayout
      stepIndex={3}
      title="What's in your account?"
      subtitle="Your starting point. Update it anytime from Settings — it won't affect anything else."
      ctaLabel="Continue"
      ctaDisabled={!canContinue}
      ctaBusy={busy}
      onCta={handleContinue}
    >
      <CurrencyInput
        label="Current bank balance"
        value={amount}
        onChange={setAmount}
        placeholder="38,450"
        autoFocus
        error={error ?? undefined}
      />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-xs)",
          padding: "var(--space-md)",
          borderRadius: "var(--radius-md)",
          backgroundColor: "var(--color-primary-light)",
          color: "var(--color-primary-dark)",
        }}
      >
        <span
          style={{
            fontSize: "var(--text-caption)",
            fontWeight: "var(--font-weight-semibold)",
            letterSpacing: "0.02em",
            textTransform: "uppercase",
          }}
        >
          How this is used
        </span>
        <p
          style={{
            fontSize: "var(--text-body)",
            lineHeight: "var(--line-height-body)",
            margin: 0,
          }}
        >
          amban subtracts what you spend and any upcoming bills to tell you how much you can safely
          spend per day until your next income.
        </p>
      </div>

      <p
        style={{
          fontSize: "var(--text-caption)",
          color: "var(--text-muted)",
          margin: 0,
        }}
      >
        Nothing here leaves your device — this number is stored locally, and only you ever see it.
      </p>
    </StepLayout>
  );
};

export default BankBalance;
