/**
 * screens/Log/LogHistory.tsx — historical daily logs.
 *
 * Source of truth: CLAUDE.md §9.3 (Log History Screen):
 *   - List view, grouped by week.
 *   - Each row: date + amount + colour dot (green/amber/red vs score).
 *   - Tap a row → expand to see notes, score at that time.
 *   - 30-day mini bar chart at top.
 *   - Long-press / swipe to edit or delete.
 *
 * Design rules:
 *   - Pure presentational. Reads from dailyStore and calls its
 *     mutators directly for edit/delete — no intermediate state layer.
 *   - Chart uses Recharts, themed against CSS variables so dark/light
 *     flips come for free.
 *   - "Under / on / over" dot colour is resolved from the stored
 *     scoreAtLog (what the user saw at the time), not the live score.
 *     That matches the intent of §8.4.
 *   - Delete is confirm-on-swipe — destructive operations on local-
 *     only data shouldn't require a second surface.
 */
import { useMemo, useState } from "react";
import { useHistory } from "react-router-dom";
import { IonContent, IonIcon, IonPage } from "@ionic/react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";
import { format, parseISO, startOfWeek } from "date-fns";

import BottomSheet from "../../components/ui/BottomSheet";
import CurrencyInput from "../../components/ui/CurrencyInput";

import { useDailyStore } from "../../stores/dailyStore";
import type { DailyLog } from "../../stores/dailyStore";
import { CATEGORY_BY_KEY } from "../../constants/categories";

import { Icons, CATEGORY_ICONS } from "../../theme/icons";
import { formatINR, formatDateLabel } from "../../utils/formatters";
import { haptics } from "../../utils/haptics";

/** How many days the top chart renders. Mirrors §9.3's 30-day spec. */
const CHART_DAYS = 30;

/** Tone buckets for the row dot. */
type LogTone = "positive" | "neutral" | "warning" | "unknown";

const TONE_COLOR: Record<LogTone, string> = {
  positive: "var(--color-score-excellent)",
  neutral: "var(--color-primary)",
  warning: "var(--color-score-warning)",
  unknown: "var(--divider)",
};

/**
 * Classify a log against its stored scoreAtLog. Unknown when the log
 * predates the scoreAtLog column (legacy rows, some backfills).
 */
function toneForLog(log: DailyLog): LogTone {
  if (log.scoreAtLog == null) return "unknown";
  if (log.spent < log.scoreAtLog) return "positive";
  if (log.spent === log.scoreAtLog) return "neutral";
  return "warning";
}

/**
 * Group logs by ISO week-start (Monday). Keys are formatted for
 * rendering; we keep the raw week-start Date in the header row so
 * weeks stay chronologically ordered even after edits.
 */
interface WeekGroup {
  weekStart: Date;
  label: string;
  logs: DailyLog[];
  totalSpent: number;
}

function groupByWeek(logs: DailyLog[]): WeekGroup[] {
  const buckets = new Map<string, WeekGroup>();
  for (const log of logs) {
    const d = parseISO(log.logDate);
    const start = startOfWeek(d, { weekStartsOn: 1 }); // Monday, per Indian convention
    const key = format(start, "yyyy-MM-dd");
    let group = buckets.get(key);
    if (!group) {
      group = {
        weekStart: start,
        label: `Week of ${format(start, "d MMM")}`,
        logs: [],
        totalSpent: 0,
      };
      buckets.set(key, group);
    }
    group.logs.push(log);
    group.totalSpent += log.spent;
  }
  return Array.from(buckets.values()).sort((a, b) => b.weekStart.getTime() - a.weekStart.getTime());
}

/**
 * Build a 30-day series ending today, filling missing days with zero.
 * Recharts renders a stable x-axis that way; otherwise bars bunch up
 * around the dates that happen to have logs.
 */
function buildChartSeries(logs: DailyLog[]): Array<{
  date: string;
  shortLabel: string;
  spent: number;
  tone: LogTone;
}> {
  const byDate = new Map<string, DailyLog>();
  for (const log of logs) byDate.set(log.logDate, log);

  const out: Array<{ date: string; shortLabel: string; spent: number; tone: LogTone }> = [];
  const today = new Date();
  for (let i = CHART_DAYS - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const iso = `${y}-${m}-${day}`;
    const log = byDate.get(iso);
    out.push({
      date: iso,
      shortLabel: format(d, "d/M"),
      spent: log?.spent ?? 0,
      tone: log ? toneForLog(log) : "unknown",
    });
  }
  return out;
}

/** Bucketed edit-draft state for the inline edit sheet. */
interface EditDraft {
  id: number;
  spent: number | null;
  notes: string;
}

const LogHistory: React.FC = () => {
  const history = useHistory();
  const logs = useDailyStore((s) => s.logs);
  const hydrated = useDailyStore((s) => s.hydrated);
  const updateLog = useDailyStore((s) => s.updateLog);
  const deleteLog = useDailyStore((s) => s.deleteLog);
  const fetchLogs = useDailyStore((s) => s.fetchLogs);
  const loadedDays = useDailyStore((s) => s.loadedDays);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editing, setEditing] = useState<EditDraft | null>(null);
  const [busy, setBusy] = useState(false);

  const chartData = useMemo(() => buildChartSeries(logs), [logs]);
  const weeks = useMemo(() => groupByWeek(logs), [logs]);

  const handleExpand = (id: number) => {
    void haptics.selection();
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const handleEdit = (log: DailyLog) => {
    setEditing({ id: log.id, spent: log.spent, notes: log.notes ?? "" });
  };

  const handleDelete = async (log: DailyLog) => {
    if (busy) return;
    setBusy(true);
    try {
      await deleteLog(log.id);
      void haptics.tapMedium();
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editing || editing.spent == null || busy) return;
    setBusy(true);
    try {
      await updateLog(editing.id, {
        spent: editing.spent,
        notes: editing.notes.trim() || null,
      });
      void haptics.tapMedium();
      setEditing(null);
    } finally {
      setBusy(false);
    }
  };

  const handleLoadMore = () => {
    void fetchLogs(loadedDays + 90);
  };

  return (
    <IonPage>
      <IonContent fullscreen>
        <main
          className="amban-screen"
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}
        >
          <header
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-sm)",
              padding: "var(--space-md) var(--space-xs) var(--space-sm)",
            }}
          >
            <button
              type="button"
              onClick={() => history.goBack()}
              aria-label="Go back"
              style={{
                minWidth: 40,
                minHeight: 40,
                borderRadius: "var(--radius-pill)",
                backgroundColor: "var(--surface-sunken)",
                color: "var(--text-strong)",
                border: "none",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <IonIcon icon={Icons.action.chevronBack} aria-hidden="true" />
            </button>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "var(--text-h1)",
                fontWeight: "var(--font-weight-bold)",
                color: "var(--text-strong)",
                margin: 0,
              }}
            >
              History
            </h1>
          </header>

          {/* 30-day mini chart */}
          <section
            aria-label="Last 30 days of spend"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-xs)",
              padding: "var(--space-md)",
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--surface-raised)",
              boxShadow: "var(--shadow-card)",
            }}
          >
            <span
              style={{
                fontSize: "var(--text-caption)",
                fontWeight: "var(--font-weight-semibold)",
                color: "var(--text-muted)",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              Last 30 days
            </span>
            <div style={{ width: "100%", height: 140 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <XAxis
                    dataKey="shortLabel"
                    tick={{ fontSize: 10, fill: "var(--text-muted)" }}
                    axisLine={false}
                    tickLine={false}
                    interval={5}
                  />
                  <YAxis hide />
                  <Tooltip
                    cursor={{ fill: "var(--surface-sunken)" }}
                    contentStyle={{
                      backgroundColor: "var(--surface-raised)",
                      border: "1px solid var(--divider)",
                      borderRadius: 8,
                      fontSize: "var(--text-caption)",
                    }}
                    formatter={(value: number) => [formatINR(value), "Spent"]}
                    labelFormatter={(label) => String(label)}
                  />
                  <Bar dataKey="spent" radius={[4, 4, 0, 0]}>
                    {chartData.map((entry) => (
                      <Cell key={entry.date} fill={TONE_COLOR[entry.tone]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Empty state */}
          {hydrated && logs.length === 0 ? (
            <article
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "var(--space-sm)",
                padding: "var(--space-xl) var(--space-md)",
                borderRadius: "var(--radius-md)",
                backgroundColor: "var(--surface-sunken)",
                textAlign: "center",
              }}
            >
              <span aria-hidden="true" style={{ fontSize: "1.5rem" }}>
                📋
              </span>
              <span
                style={{
                  fontSize: "var(--text-body)",
                  fontWeight: "var(--font-weight-semibold)",
                  color: "var(--text-strong)",
                }}
              >
                No logs yet
              </span>
              <span
                style={{
                  fontSize: "var(--text-caption)",
                  color: "var(--text-muted)",
                }}
              >
                Log your first spend to start building history.
              </span>
              <button
                type="button"
                onClick={() => history.push("/log")}
                style={{
                  marginTop: "var(--space-sm)",
                  minHeight: "var(--hit-target-min)",
                  padding: "var(--space-sm) var(--space-lg)",
                  borderRadius: "var(--radius-md)",
                  backgroundColor: "var(--color-primary)",
                  color: "#ffffff",
                  border: "none",
                  fontWeight: "var(--font-weight-semibold)",
                }}
              >
                Log now
              </button>
            </article>
          ) : null}

          {/* Weekly-grouped list */}
          {weeks.map((week) => (
            <section
              key={week.label}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-xs)",
              }}
            >
              <header
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  padding: "0 var(--space-xs)",
                }}
              >
                <h2
                  style={{
                    fontSize: "var(--text-h3)",
                    fontWeight: "var(--font-weight-semibold)",
                    color: "var(--text-strong)",
                    margin: 0,
                  }}
                >
                  {week.label}
                </h2>
                <span
                  style={{
                    fontSize: "var(--text-caption)",
                    color: "var(--text-muted)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {formatINR(week.totalSpent)}
                </span>
              </header>
              {week.logs.map((log) => {
                const tone = toneForLog(log);
                const expanded = expandedId === log.id;
                const category = log.category ? CATEGORY_BY_KEY[log.category] : null;
                return (
                  <article
                    key={log.id}
                    aria-label={`${formatDateLabel(log.logDate)}, spent ${formatINR(log.spent)}`}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--space-xs)",
                      padding: "var(--space-md)",
                      borderRadius: "var(--radius-md)",
                      backgroundColor: "var(--surface-raised)",
                      boxShadow: "var(--shadow-card)",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => handleExpand(log.id)}
                      aria-expanded={expanded}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "var(--space-sm)",
                        width: "100%",
                        background: "transparent",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        color: "inherit",
                        minHeight: 0,
                      }}
                    >
                      <div
                        style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: "var(--radius-pill)",
                            backgroundColor: TONE_COLOR[tone],
                            flexShrink: 0,
                          }}
                        />
                        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                          <span
                            style={{
                              fontSize: "var(--text-body)",
                              fontWeight: "var(--font-weight-semibold)",
                              color: "var(--text-strong)",
                            }}
                          >
                            {formatDateLabel(log.logDate)}
                          </span>
                          {category ? (
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                fontSize: "var(--text-caption)",
                                color: "var(--text-muted)",
                              }}
                            >
                              <IonIcon
                                icon={CATEGORY_ICONS[log.category ?? "other"]}
                                aria-hidden="true"
                              />
                              {category.label}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <span
                        style={{
                          fontFamily: "var(--font-display)",
                          fontSize: "var(--text-h3)",
                          fontWeight: "var(--font-weight-semibold)",
                          color: "var(--text-strong)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {formatINR(log.spent)}
                      </span>
                    </button>

                    {expanded ? (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "var(--space-xs)",
                          paddingTop: "var(--space-sm)",
                          borderTop: "1px solid var(--divider)",
                        }}
                      >
                        {log.scoreAtLog != null ? (
                          <span
                            style={{
                              fontSize: "var(--text-caption)",
                              color: "var(--text-muted)",
                            }}
                          >
                            Score that day: {formatINR(Math.round(log.scoreAtLog))}
                          </span>
                        ) : null}
                        {log.notes ? (
                          <p
                            style={{
                              fontSize: "var(--text-caption)",
                              color: "var(--text-strong)",
                              lineHeight: "var(--line-height-body)",
                              margin: 0,
                            }}
                          >
                            {log.notes}
                          </p>
                        ) : null}
                        <div
                          style={{
                            display: "flex",
                            gap: "var(--space-sm)",
                            marginTop: "var(--space-xs)",
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => handleEdit(log)}
                            style={{
                              minHeight: 36,
                              padding: "var(--space-xs) var(--space-md)",
                              borderRadius: "var(--radius-md)",
                              backgroundColor: "var(--color-primary-light)",
                              color: "var(--color-primary-dark)",
                              border: "none",
                              fontSize: "var(--text-caption)",
                              fontWeight: "var(--font-weight-semibold)",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            <IonIcon icon={Icons.action.edit} aria-hidden="true" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(log)}
                            style={{
                              minHeight: 36,
                              padding: "var(--space-xs) var(--space-md)",
                              borderRadius: "var(--radius-md)",
                              backgroundColor: "transparent",
                              color: "var(--color-score-warning)",
                              border: "1px solid var(--divider)",
                              fontSize: "var(--text-caption)",
                              fontWeight: "var(--font-weight-semibold)",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            <IonIcon icon={Icons.action.delete} aria-hidden="true" />
                            Delete
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </section>
          ))}

          {logs.length >= loadedDays ? (
            <button
              type="button"
              onClick={handleLoadMore}
              style={{
                alignSelf: "center",
                minHeight: 40,
                padding: "var(--space-xs) var(--space-md)",
                borderRadius: "var(--radius-pill)",
                backgroundColor: "var(--surface-sunken)",
                color: "var(--text-muted)",
                border: "none",
                fontSize: "var(--text-caption)",
                fontWeight: "var(--font-weight-medium)",
              }}
            >
              Load more
            </button>
          ) : null}
        </main>

        <BottomSheet
          open={editing !== null}
          onDismiss={() => setEditing(null)}
          title="Edit log"
          initialBreakpoint={0.5}
        >
          <CurrencyInput
            label="Amount"
            value={editing?.spent ?? null}
            onChange={(v) => setEditing((prev) => (prev ? { ...prev, spent: v } : prev))}
            autoFocus
          />
          <label
            htmlFor="edit-notes"
            style={{
              fontSize: "var(--text-caption)",
              fontWeight: "var(--font-weight-medium)",
              color: "var(--text-muted)",
            }}
          >
            Notes
          </label>
          <textarea
            id="edit-notes"
            value={editing?.notes ?? ""}
            onChange={(e) =>
              setEditing((prev) => (prev ? { ...prev, notes: e.target.value } : prev))
            }
            rows={2}
            style={{
              width: "100%",
              minHeight: 60,
              padding: "var(--space-sm) var(--space-md)",
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--surface-sunken)",
              border: "1px solid transparent",
              fontSize: "var(--text-body)",
              color: "var(--text-strong)",
              fontFamily: "var(--font-body)",
              resize: "vertical",
              outline: "none",
            }}
          />
          <button
            type="button"
            onClick={handleSaveEdit}
            disabled={busy || editing?.spent == null}
            style={{
              minHeight: "var(--hit-target-min)",
              padding: "var(--space-sm) var(--space-lg)",
              borderRadius: "var(--radius-md)",
              backgroundColor:
                busy || editing?.spent == null ? "var(--surface-sunken)" : "var(--color-primary)",
              color: busy || editing?.spent == null ? "var(--text-muted)" : "#ffffff",
              border: "none",
              fontWeight: "var(--font-weight-semibold)",
              cursor: busy || editing?.spent == null ? "not-allowed" : "pointer",
            }}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </BottomSheet>
      </IonContent>
    </IonPage>
  );
};

export default LogHistory;
