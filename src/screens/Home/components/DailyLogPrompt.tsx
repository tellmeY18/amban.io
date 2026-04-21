/**
 * screens/Home/components/DailyLogPrompt.tsx — yesterday's spend panel.
 *
 * Source of truth: CLAUDE.md §9.1 (Home Screen → Middle Section):
 *   - If yesterday was logged: "Yesterday you spent ₹1,800 — ₹540 under
 *     your score 🙌"
 *   - If not: "You haven't logged yesterday yet. Log now →"
 *
 * Design rules:
 *   - Pure presentational. Consumes the dailyStore + today's score so
 *     the caller doesn't have to thread state in.
 *   - A single tappable card. Tapping navigates to /log (the primary
 *     intended action in both branches).
 *   - Tone resolves from the diff vs the score-at-log time (the
 *     snapshot of the user's budget when they logged), not the
 *     current live score. That matches the intent of §8.4.
 *   - Also handles the "today was logged" case with a small positive
 *     note, so the panel doesn't go stale after an evening log.
 */
import { useMemo } from "react";
import { useHistory } from "react-router-dom";
import { IonIcon } from "@ionic/react";

import { useDailyStore } from "../../../stores/dailyStore";
import type { DailyLog } from "../../../stores/dailyStore";
import { Icons } from "../../../theme/icons";
import { formatINR } from "../../../utils/formatters";
import { haptics } from "../../../utils/haptics";

/** Yesterday's date as YYYY-MM-DD in the device's local calendar. */
function yesterdayIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Pick yesterday's log out of the store's newest-first list.
 * Cheap linear scan — the list is bounded by `loadedDays` (default 90)
 * and the match is almost always in the first two entries.
 */
function findYesterdayLog(logs: DailyLog[]): DailyLog | null {
  const iso = yesterdayIso();
  for (const log of logs) {
    if (log.logDate === iso) return log;
    if (log.logDate < iso) break;
  }
  return null;
}

const cardStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-md)",
  width: "100%",
  padding: "var(--space-md)",
  borderRadius: "var(--radius-md)",
  backgroundColor: "var(--surface-raised)",
  boxShadow: "var(--shadow-card)",
  textAlign: "left",
  cursor: "pointer",
  border: "none",
  color: "var(--text-strong)",
  minHeight: "var(--hit-target-min)",
  WebkitTapHighlightColor: "transparent",
};

const DailyLogPrompt: React.FC = () => {
  const history = useHistory();
  const logs = useDailyStore((s) => s.logs);
  const todayLog = useDailyStore((s) => s.todayLog);
  const hydrated = useDailyStore((s) => s.hydrated);

  const yesterdayLog = useMemo(() => findYesterdayLog(logs), [logs]);

  const handleTap = () => {
    void haptics.selection();
    history.push("/log");
  };

  // Skeleton while hydrating so first paint isn't a stale placeholder.
  if (!hydrated) {
    return (
      <div
        aria-busy="true"
        style={{
          ...cardStyle,
          cursor: "default",
          backgroundColor: "var(--surface-sunken)",
          boxShadow: "none",
          height: 64,
        }}
      />
    );
  }

  // Branch 1: today already logged — celebrate briefly. The user's
  // primary action is still to open /log (to edit) so the card stays
  // tappable.
  if (todayLog) {
    const score = todayLog.scoreAtLog ?? null;
    const diff = score != null ? score - todayLog.spent : null;
    const tone: "positive" | "neutral" | "warning" =
      diff == null ? "neutral" : diff > 0 ? "positive" : diff < 0 ? "warning" : "neutral";
    const copy =
      diff == null
        ? `You logged ${formatINR(todayLog.spent)} for today.`
        : diff > 0
          ? `Today so far: ${formatINR(todayLog.spent)} — ${formatINR(Math.round(diff))} under your score.`
          : diff < 0
            ? `Today so far: ${formatINR(todayLog.spent)} — ${formatINR(Math.round(Math.abs(diff)))} over your score.`
            : `Today so far: ${formatINR(todayLog.spent)} — right on target.`;

    return (
      <button type="button" onClick={handleTap} style={cardStyle}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
          <span
            style={{
              fontSize: "var(--text-caption)",
              fontWeight: "var(--font-weight-semibold)",
              color:
                tone === "positive"
                  ? "var(--color-score-excellent)"
                  : tone === "warning"
                    ? "var(--color-score-warning)"
                    : "var(--text-muted)",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            {tone === "positive" ? "Nice 🙌" : tone === "warning" ? "Heads up" : "Logged"}
          </span>
          <span
            style={{
              fontSize: "var(--text-body)",
              fontWeight: "var(--font-weight-medium)",
              color: "var(--text-strong)",
            }}
          >
            {copy}
          </span>
          <span style={{ fontSize: "var(--text-caption)", color: "var(--text-muted)" }}>
            Tap to edit →
          </span>
        </div>
        <IonIcon
          icon={Icons.action.chevronForward}
          aria-hidden="true"
          style={{ color: "var(--text-muted)", fontSize: "1.25rem" }}
        />
      </button>
    );
  }

  // Branch 2: yesterday was logged but today isn't yet — the
  // post-evening "good job" moment.
  if (yesterdayLog) {
    const score = yesterdayLog.scoreAtLog ?? null;
    const diff = score != null ? score - yesterdayLog.spent : null;
    const tone: "positive" | "neutral" | "warning" =
      diff == null ? "neutral" : diff > 0 ? "positive" : diff < 0 ? "warning" : "neutral";
    const copy =
      diff == null
        ? `Yesterday you spent ${formatINR(yesterdayLog.spent)}.`
        : diff > 0
          ? `Yesterday you spent ${formatINR(yesterdayLog.spent)} — ${formatINR(Math.round(diff))} under your score 🙌`
          : diff < 0
            ? `Yesterday you spent ${formatINR(yesterdayLog.spent)} — ${formatINR(Math.round(Math.abs(diff)))} over your score.`
            : `Yesterday you spent ${formatINR(yesterdayLog.spent)} — right on target.`;

    return (
      <button type="button" onClick={handleTap} style={cardStyle}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
          <span
            style={{
              fontSize: "var(--text-caption)",
              fontWeight: "var(--font-weight-semibold)",
              color:
                tone === "positive"
                  ? "var(--color-score-excellent)"
                  : tone === "warning"
                    ? "var(--color-score-warning)"
                    : "var(--text-muted)",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            Yesterday
          </span>
          <span
            style={{
              fontSize: "var(--text-body)",
              fontWeight: "var(--font-weight-medium)",
              color: "var(--text-strong)",
            }}
          >
            {copy}
          </span>
          <span style={{ fontSize: "var(--text-caption)", color: "var(--text-muted)" }}>
            Log today's spend →
          </span>
        </div>
        <IonIcon
          icon={Icons.action.chevronForward}
          aria-hidden="true"
          style={{ color: "var(--text-muted)", fontSize: "1.25rem" }}
        />
      </button>
    );
  }

  // Branch 3: nothing logged yesterday or today — primary nudge.
  return (
    <button type="button" onClick={handleTap} style={cardStyle}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
        <span
          style={{
            fontSize: "var(--text-caption)",
            fontWeight: "var(--font-weight-semibold)",
            color: "var(--color-primary)",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          Stay on track
        </span>
        <span
          style={{
            fontSize: "var(--text-body)",
            fontWeight: "var(--font-weight-medium)",
            color: "var(--text-strong)",
          }}
        >
          You haven't logged yet. Tap to add today's spend.
        </span>
      </div>
      <IonIcon
        icon={Icons.action.chevronForward}
        aria-hidden="true"
        style={{ color: "var(--text-muted)", fontSize: "1.25rem" }}
      />
    </button>
  );
};

export default DailyLogPrompt;
