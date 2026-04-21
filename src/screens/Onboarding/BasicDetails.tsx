/**
 * screens/Onboarding/BasicDetails.tsx — Onboarding Step 2.
 *
 * Source of truth: CLAUDE.md §6.1 (Onboarding → Basic Details):
 *   - Name (text input, required)
 *   - Optional profile emoji picker (fun, not serious)
 *   - No email/phone — fully anonymous
 *
 * Design rules:
 *   - Writes to SQLite via `userStore.setUser` on CTA tap, not on
 *     every keystroke. Onboarding step transitions are the commit
 *     boundary — half-entered names never land on disk.
 *   - The emoji picker is a curated shortlist, not a full picker.
 *     Keeps the decision tiny and the UI focused.
 */
import { useEffect, useState } from "react";
import { useHistory } from "react-router-dom";

import StepLayout from "./StepLayout";
import { advanceOnboarding } from "./OnboardingStack";
import { useUserStore } from "../../stores/userStore";

/** Curated emoji shortlist. Keep it small — picking from 10 feels
 *  friendly, picking from 1,000 feels like admin. */
const EMOJI_CHOICES = ["🙂", "😎", "🌟", "🚀", "💸", "🧘", "🌱", "🔥", "🎯", "👋"];

const BasicDetails: React.FC = () => {
  const history = useHistory();
  const storedName = useUserStore((s) => s.name);
  const storedEmoji = useUserStore((s) => s.emoji);
  const setUser = useUserStore((s) => s.setUser);

  const [name, setName] = useState(storedName);
  const [emoji, setEmoji] = useState<string | null>(storedEmoji);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If the store hydrates / changes under us (unlikely but possible
  // on a re-entry after reset), reflect the canonical values.
  useEffect(() => {
    setName(storedName);
    setEmoji(storedEmoji);
  }, [storedName, storedEmoji]);

  const trimmed = name.trim();
  const canContinue = trimmed.length > 0 && trimmed.length <= 40;

  const handleContinue = async () => {
    if (!canContinue || busy) return;
    setBusy(true);
    setError(null);
    try {
      await setUser({ name: trimmed, emoji });
      await advanceOnboarding(history, 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepLayout
      stepIndex={1}
      title="Who are you?"
      subtitle="Just a name — no email, no phone, nothing shared."
      ctaLabel="Continue"
      ctaDisabled={!canContinue}
      ctaBusy={busy}
      onCta={handleContinue}
    >
      <label
        htmlFor="onboarding-name"
        style={{
          fontSize: "var(--text-caption)",
          fontWeight: "var(--font-weight-medium)",
          color: "var(--text-muted)",
          letterSpacing: "0.01em",
        }}
      >
        Your name
      </label>
      <input
        id="onboarding-name"
        type="text"
        autoFocus
        autoComplete="given-name"
        autoCapitalize="words"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="next"
        maxLength={40}
        placeholder="Arjun"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void handleContinue();
          }
        }}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? "onboarding-name-error" : undefined}
        style={{
          minHeight: "var(--hit-target-min)",
          padding: "var(--space-sm) var(--space-md)",
          borderRadius: "var(--radius-md)",
          backgroundColor: "var(--surface-sunken)",
          border: `1px solid ${error ? "var(--color-score-warning)" : "transparent"}`,
          fontFamily: "var(--font-display)",
          fontSize: "var(--text-h2)",
          fontWeight: "var(--font-weight-semibold)",
          color: "var(--text-strong)",
          outline: "none",
          width: "100%",
          transition: "border-color var(--motion-fast) var(--motion-ease)",
        }}
      />
      {error ? (
        <p
          id="onboarding-name-error"
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

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-sm)",
          marginTop: "var(--space-lg)",
        }}
      >
        <span
          style={{
            fontSize: "var(--text-caption)",
            fontWeight: "var(--font-weight-medium)",
            color: "var(--text-muted)",
            letterSpacing: "0.01em",
          }}
        >
          Pick a vibe (optional)
        </span>
        <div
          role="radiogroup"
          aria-label="Profile emoji"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "var(--space-sm)",
          }}
        >
          {/* "None" option first so users can explicitly opt out. */}
          <button
            type="button"
            role="radio"
            aria-checked={emoji == null}
            onClick={() => setEmoji(null)}
            style={{
              minWidth: 44,
              minHeight: 44,
              padding: "var(--space-sm) var(--space-md)",
              borderRadius: "var(--radius-pill)",
              backgroundColor:
                emoji == null ? "var(--color-primary-light)" : "var(--surface-sunken)",
              color: emoji == null ? "var(--color-primary-dark)" : "var(--text-muted)",
              border: "none",
              fontSize: "var(--text-caption)",
              fontWeight: "var(--font-weight-medium)",
            }}
          >
            None
          </button>
          {EMOJI_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              role="radio"
              aria-checked={emoji === choice}
              aria-label={`Emoji ${choice}`}
              onClick={() => setEmoji(choice)}
              style={{
                minWidth: 44,
                minHeight: 44,
                borderRadius: "var(--radius-pill)",
                backgroundColor:
                  emoji === choice ? "var(--color-primary-light)" : "var(--surface-sunken)",
                border:
                  emoji === choice ? "2px solid var(--color-primary)" : "2px solid transparent",
                fontSize: "1.25rem",
                cursor: "pointer",
                transition:
                  "background-color var(--motion-fast) var(--motion-ease), border-color var(--motion-fast) var(--motion-ease)",
              }}
            >
              {choice}
            </button>
          ))}
        </div>
      </div>
    </StepLayout>
  );
};

export default BasicDetails;
