/**
 * screens/Log/SmsSuggestionsInbox.tsx — embeddable SMS suggestion cards.
 *
 * Source of truth: CLAUDE.md §15.6 (Suggestion Inbox).
 *
 * This component renders pending SMS-parsed suggestions as cards.
 * It can be embedded on the Home screen (above the insight carousel)
 * and on the Log tab (as a prominent section).
 *
 * Responsibilities:
 *   - Read pending suggestions from the smsSuggestionsStore.
 *   - Show each suggestion as a card with direction indicator, amount,
 *     counterparty, time, and account info.
 *   - Provide one-tap accept (debit → prefill DailyLog, credit →
 *     prefill AddIncome) and one-tap dismiss per suggestion.
 *   - Show a "See all →" link when the count exceeds `maxVisible`.
 *   - Render nothing when there are no pending suggestions (§15.6:
 *     no "You have no suggestions" noise).
 *
 * Design rules:
 *   - Uses Ionic components + CSS custom properties from the design
 *     system (§3).
 *   - Haptics follow Appendix F: selection on dismiss, success on accept.
 *   - All writes go through smsSuggestionsStore — never via the repo.
 *   - The accept callback is delegated to the parent (onAcceptDebit /
 *     onAcceptCredit) because opening the prefilled DailyLog or
 *     AddIncome sheet is the parent's responsibility.
 */

import React, { useCallback } from "react";
import { IonIcon } from "@ionic/react";

import { useSmsSuggestionsStore } from "../../stores/smsSuggestionsStore";
import type { SmsSuggestion } from "../../stores/smsSuggestionsStore";

import { formatINR } from "../../utils/formatters";
import { haptics } from "../../utils/haptics";
import { Icons } from "../../theme/icons";

/* ------------------------------------------------------------------
 * Props
 * ------------------------------------------------------------------ */

export interface SmsSuggestionsInboxProps {
  /** Maximum suggestions to show before a "See all" link. Default: 3. */
  maxVisible?: number;

  /** Called when the user accepts a debit suggestion (to open DailyLogScreen prefilled). */
  onAcceptDebit?: (suggestion: SmsSuggestion) => void;

  /** Called when the user accepts a credit suggestion (to open AddIncomeSheet prefilled). */
  onAcceptCredit?: (suggestion: SmsSuggestion) => void;

  /** Called when the user taps "See all →". */
  onSeeAll?: () => void;
}

/* ------------------------------------------------------------------
 * Time formatting helper (relative, short)
 * ------------------------------------------------------------------ */

function formatShortTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return "";

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60_000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    // Older than 24h — show date + time
    const day = date.getDate();
    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const month = monthNames[date.getMonth()];
    const hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, "0");
    const period = hours >= 12 ? "PM" : "AM";
    const hour12 = hours % 12 === 0 ? 12 : hours % 12;

    return `${day} ${month}, ${hour12}:${minutes} ${period}`;
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------
 * Suggestion card component
 * ------------------------------------------------------------------ */

interface SuggestionCardProps {
  suggestion: SmsSuggestion;
  onAccept: (suggestion: SmsSuggestion) => void;
  onDismiss: (id: number) => void;
}

const SuggestionCard: React.FC<SuggestionCardProps> = ({ suggestion, onAccept, onDismiss }) => {
  const isDebit = suggestion.direction === "debit";

  return (
    <article
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-sm)",
        padding: "var(--space-md)",
        borderRadius: "var(--radius-md)",
        backgroundColor: "var(--surface-card)",
        boxShadow: "var(--shadow-card)",
        border: `1px solid ${isDebit ? "rgba(233, 66, 53, 0.15)" : "rgba(30, 140, 69, 0.15)"}`,
      }}
    >
      {/* Top row: direction icon + amount + time */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-sm)",
        }}
      >
        {/* Direction indicator */}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: "var(--radius-pill)",
            backgroundColor: isDebit ? "rgba(233, 66, 53, 0.12)" : "rgba(30, 140, 69, 0.12)",
            color: isDebit ? "var(--color-score-warning)" : "var(--color-score-excellent)",
            fontSize: "1rem",
            flexShrink: 0,
          }}
          aria-hidden="true"
        >
          <IonIcon icon={isDebit ? Icons.status.trendingDown : Icons.status.trendingUp} />
        </span>

        {/* Amount */}
        <span
          style={{
            flex: 1,
            fontSize: "var(--text-h2)",
            fontFamily: "var(--font-display)",
            fontWeight: "var(--font-weight-bold, 700)",
            color: isDebit ? "var(--color-score-warning)" : "var(--color-score-excellent)",
          }}
        >
          {isDebit ? "−" : "+"}
          {formatINR(suggestion.amount)}
        </span>

        {/* Time */}
        <span
          style={{
            fontSize: "var(--text-caption)",
            color: "var(--text-muted)",
            flexShrink: 0,
          }}
        >
          {formatShortTime(suggestion.receivedAt)}
        </span>
      </div>

      {/* Middle row: counterparty + account info */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-sm)",
          fontSize: "var(--text-body)",
          color: "var(--text-secondary, var(--text-muted))",
        }}
      >
        {suggestion.counterparty && (
          <span
            style={{
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {suggestion.counterparty}
          </span>
        )}
        {suggestion.accountLast4 && (
          <span
            style={{
              fontSize: "var(--text-caption)",
              color: "var(--text-muted)",
              flexShrink: 0,
            }}
          >
            ••{suggestion.accountLast4}
          </span>
        )}
      </div>

      {/* Action buttons */}
      <div
        style={{
          display: "flex",
          gap: "var(--space-sm)",
          marginTop: "var(--space-xs)",
        }}
      >
        <button
          type="button"
          onClick={() => onAccept(suggestion)}
          style={{
            flex: 1,
            minHeight: 40,
            padding: "var(--space-xs) var(--space-md)",
            borderRadius: "var(--radius-sm)",
            backgroundColor: isDebit ? "rgba(233, 66, 53, 0.1)" : "rgba(30, 140, 69, 0.1)",
            color: isDebit ? "var(--color-score-warning)" : "var(--color-score-excellent)",
            border: "none",
            fontSize: "var(--text-caption)",
            fontWeight: "var(--font-weight-semibold, 600)",
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
          }}
          aria-label={
            isDebit
              ? `Add ${formatINR(suggestion.amount)} as spend`
              : `Add ${formatINR(suggestion.amount)} as income`
          }
        >
          {isDebit ? "Add as spend" : "Add as income"}
        </button>

        <button
          type="button"
          onClick={() => onDismiss(suggestion.id)}
          style={{
            minHeight: 40,
            padding: "var(--space-xs) var(--space-md)",
            borderRadius: "var(--radius-sm)",
            backgroundColor: "var(--surface-sunken)",
            color: "var(--text-muted)",
            border: "none",
            fontSize: "var(--text-caption)",
            fontWeight: "var(--font-weight-semibold, 600)",
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
          }}
          aria-label={`Dismiss suggestion for ${formatINR(suggestion.amount)}`}
        >
          Dismiss
        </button>
      </div>
    </article>
  );
};

/* ------------------------------------------------------------------
 * Main inbox component
 * ------------------------------------------------------------------ */

const SmsSuggestionsInbox: React.FC<SmsSuggestionsInboxProps> = ({
  maxVisible = 3,
  onAcceptDebit,
  onAcceptCredit,
  onSeeAll,
}) => {
  const pending = useSmsSuggestionsStore((s) => s.pending);
  const dismiss = useSmsSuggestionsStore((s) => s.dismiss);

  const handleAccept = useCallback(
    (suggestion: SmsSuggestion) => {
      void haptics.success();
      if (suggestion.direction === "debit") {
        onAcceptDebit?.(suggestion);
      } else {
        onAcceptCredit?.(suggestion);
      }
    },
    [onAcceptDebit, onAcceptCredit],
  );

  const handleDismiss = useCallback(
    async (id: number) => {
      void haptics.selection();
      try {
        await dismiss(id);
      } catch (err) {
        console.warn("[SmsSuggestionsInbox] dismiss failed:", err);
      }
    },
    [dismiss],
  );

  // Empty state: render nothing (§15.6 — no noise)
  if (pending.length === 0) return null;

  const visible = pending.slice(0, maxVisible);
  const hasMore = pending.length > maxVisible;

  return (
    <section
      aria-label="SMS suggestions"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-sm)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-sm)",
          padding: "0 var(--space-xs)",
        }}
      >
        <span style={{ fontSize: "var(--text-body)" }}>💡</span>
        <span
          style={{
            fontSize: "var(--text-body)",
            fontWeight: "var(--font-weight-semibold, 600)",
            color: "var(--text-strong)",
            flex: 1,
          }}
        >
          {pending.length} suggestion{pending.length !== 1 ? "s" : ""} from your SMS
        </span>
      </div>

      {/* Suggestion cards */}
      {visible.map((suggestion) => (
        <SuggestionCard
          key={suggestion.id}
          suggestion={suggestion}
          onAccept={handleAccept}
          onDismiss={handleDismiss}
        />
      ))}

      {/* "See all" link */}
      {hasMore && (
        <button
          type="button"
          onClick={onSeeAll}
          style={{
            alignSelf: "flex-start",
            background: "none",
            border: "none",
            padding: "var(--space-xs)",
            color: "var(--color-primary)",
            fontSize: "var(--text-body)",
            fontWeight: "var(--font-weight-semibold, 600)",
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          See all {pending.length} suggestions →
        </button>
      )}
    </section>
  );
};

export default SmsSuggestionsInbox;
