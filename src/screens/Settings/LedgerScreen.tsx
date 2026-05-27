/**
 * screens/Settings/LedgerScreen.tsx — Balance ledger / audit trail.
 *
 * Shows every balance-affecting event as a bank-statement-style list.
 * Entries are editable: tap an entry to edit its amount or label.
 */

import { useEffect, useState } from "react";
import { useHistory } from "react-router-dom";
import { IonContent, IonIcon, IonPage } from "@ionic/react";

import BottomSheet from "../../components/ui/BottomSheet";
import CurrencyInput from "../../components/ui/CurrencyInput";
import { ledgerRepo } from "../../db/repositories";
import type { LedgerRecord } from "../../db/repositories";
import { Icons } from "../../theme/icons";
import { formatINR } from "../../utils/formatters";
import { haptics } from "../../utils/haptics";

/* ─── Helpers ─────────────────────────────────────────────────────── */

function iconForType(type: LedgerRecord["type"]): { icon: string; color: string } {
  switch (type) {
    case "income_credit":
      return { icon: Icons.income.briefcase, color: "var(--color-score-excellent)" };
    case "spend":
      return { icon: Icons.nav.log, color: "var(--text-muted)" };
    case "balance_set":
      return { icon: Icons.finance.wallet, color: "var(--color-primary)" };
    case "manual_credit":
      return { icon: Icons.finance.cash, color: "var(--color-score-excellent)" };
  }
}

function typeLabel(type: LedgerRecord["type"]): string {
  switch (type) {
    case "income_credit":
      return "Income";
    case "spend":
      return "Spend";
    case "balance_set":
      return "Balance set";
    case "manual_credit":
      return "Credit";
  }
}

function formatDateHeading(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

interface DayGroup {
  date: string;
  entries: LedgerRecord[];
}

function groupByDate(entries: LedgerRecord[]): DayGroup[] {
  const map = new Map<string, LedgerRecord[]>();
  for (const entry of entries) {
    const key = entry.occurredAt.slice(0, 10);
    const group = map.get(key);
    if (group) group.push(entry);
    else map.set(key, [entry]);
  }
  return Array.from(map.entries()).map(([date, items]) => ({ date, entries: items }));
}

/* ─── Component ───────────────────────────────────────────────────── */

const LedgerScreen: React.FC = () => {
  const history = useHistory();

  const [entries, setEntries] = useState<LedgerRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Edit sheet state
  const [editingEntry, setEditingEntry] = useState<LedgerRecord | null>(null);
  const [editDelta, setEditDelta] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const loadEntries = async () => {
    try {
      const data = await ledgerRepo.list(200, 0);
      setEntries(data);
    } catch {
      /* silent — empty state shows */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadEntries();
  }, []);

  const handleRowTap = (entry: LedgerRecord) => {
    void haptics.selection();
    setEditingEntry(entry);
    setEditDelta(Math.abs(entry.delta));
    setEditLabel(entry.label);
  };

  const handleSave = async () => {
    if (!editingEntry || editDelta === null) return;
    setBusy(true);
    try {
      const sign = editingEntry.delta >= 0 ? 1 : -1;
      await ledgerRepo.update(editingEntry.id, {
        delta: sign * editDelta,
        label: editLabel.trim() || editingEntry.label,
      });
      void haptics.tapMedium();
      setEditingEntry(null);
      await loadEntries();
    } catch {
      /* silent */
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!editingEntry) return;
    setBusy(true);
    try {
      await ledgerRepo.delete(editingEntry.id);
      void haptics.error();
      setEditingEntry(null);
      await loadEntries();
    } catch {
      /* silent */
    } finally {
      setBusy(false);
    }
  };

  const groups = groupByDate(entries);

  return (
    <IonPage>
      <IonContent fullscreen>
        <main
          className="amban-screen"
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}
        >
          {/* Header */}
          <header
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-sm)",
              padding: "var(--space-md) var(--space-xs)",
            }}
          >
            <button
              type="button"
              aria-label="Back"
              onClick={() => history.goBack()}
              style={{
                minWidth: 36,
                minHeight: 36,
                borderRadius: "var(--radius-sm)",
                backgroundColor: "var(--surface-raised)",
                color: "var(--text-strong)",
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <IonIcon icon={Icons.action.back} style={{ fontSize: "1.25rem" }} />
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
              Balance Ledger
            </h1>
          </header>

          {/* Entry list */}
          {!loading && entries.length === 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "var(--space-sm)",
                padding: "var(--space-2xl) var(--space-md)",
                textAlign: "center",
              }}
            >
              <IonIcon
                icon={Icons.finance.wallet}
                style={{ fontSize: "2.5rem", color: "var(--text-muted)" }}
              />
              <span style={{ fontSize: "var(--text-body)", color: "var(--text-muted)" }}>
                No transactions yet
              </span>
            </div>
          )}

          {groups.map((group) => (
            <section
              key={group.date}
              style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}
            >
              {/* Date heading */}
              <span
                style={{
                  fontSize: "var(--text-caption)",
                  fontWeight: "var(--font-weight-semibold)",
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  padding: "var(--space-xs) var(--space-xs) 0",
                }}
              >
                {formatDateHeading(group.date)}
              </span>

              {/* Entries card */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  borderRadius: "var(--radius-md)",
                  backgroundColor: "var(--surface-card)",
                  boxShadow: "var(--shadow-card)",
                  overflow: "hidden",
                }}
              >
                {group.entries.map((entry, idx) => {
                  const { icon, color } = iconForType(entry.type);
                  const isPositive = entry.delta >= 0;

                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => handleRowTap(entry)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--space-sm)",
                        padding: "var(--space-sm) var(--space-md)",
                        background: "none",
                        border: "none",
                        borderTop: idx > 0 ? "1px solid var(--color-divider)" : "none",
                        cursor: "pointer",
                        textAlign: "left",
                        width: "100%",
                        minHeight: 52,
                        WebkitTapHighlightColor: "transparent",
                      }}
                    >
                      {/* Icon */}
                      <span
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: "var(--radius-sm)",
                          backgroundColor: "var(--surface-raised)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <IonIcon icon={icon} style={{ fontSize: "1rem", color }} />
                      </span>

                      {/* Label + type */}
                      <span
                        style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}
                      >
                        <span
                          style={{
                            fontSize: "var(--text-body)",
                            fontWeight: "var(--font-weight-medium)",
                            color: "var(--text-strong)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {entry.label}
                        </span>
                        <span
                          style={{
                            fontSize: "var(--text-caption)",
                            color: "var(--text-muted)",
                          }}
                        >
                          {typeLabel(entry.type)}
                        </span>
                      </span>

                      {/* Amount + balance after */}
                      <span
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-end",
                          flexShrink: 0,
                        }}
                      >
                        <span
                          style={{
                            fontSize: "var(--text-body)",
                            fontWeight: "var(--font-weight-semibold)",
                            fontVariantNumeric: "tabular-nums",
                            color: isPositive
                              ? "var(--color-score-excellent)"
                              : "var(--text-strong)",
                          }}
                        >
                          {isPositive ? "+" : ""}
                          {formatINR(entry.delta)}
                        </span>
                        <span
                          style={{
                            fontSize: "var(--text-caption)",
                            color: "var(--text-muted)",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          Bal: {formatINR(entry.balanceAfter)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </main>

        {/* Edit bottom sheet */}
        <BottomSheet
          open={editingEntry !== null}
          onDismiss={() => setEditingEntry(null)}
          title="Edit entry"
        >
          {editingEntry && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-md)",
                padding: "var(--space-sm) 0",
              }}
            >
              <CurrencyInput value={editDelta} onChange={setEditDelta} label="Amount" autoFocus />

              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
                <label
                  style={{
                    fontSize: "var(--text-caption)",
                    fontWeight: "var(--font-weight-semibold)",
                    color: "var(--text-muted)",
                  }}
                >
                  Label
                </label>
                <input
                  type="text"
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  style={{
                    width: "100%",
                    minHeight: 44,
                    padding: "var(--space-sm) var(--space-md)",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "var(--surface-raised)",
                    border: "1px solid var(--color-divider)",
                    fontSize: "var(--text-body)",
                    color: "var(--text-strong)",
                    outline: "none",
                  }}
                />
              </div>

              <button
                type="button"
                disabled={busy || editDelta === null}
                onClick={() => void handleSave()}
                style={{
                  minHeight: 48,
                  padding: "var(--space-sm) var(--space-md)",
                  borderRadius: "var(--radius-md)",
                  backgroundColor: "var(--color-primary)",
                  color: "#fff",
                  border: "none",
                  fontWeight: "var(--font-weight-semibold)",
                  fontSize: "var(--text-body)",
                  cursor: busy ? "wait" : "pointer",
                  opacity: busy ? 0.6 : 1,
                }}
              >
                Save
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => void handleDelete()}
                style={{
                  minHeight: 44,
                  padding: "var(--space-sm) var(--space-md)",
                  borderRadius: "var(--radius-md)",
                  backgroundColor: "transparent",
                  color: "salmon",
                  border: "none",
                  fontWeight: "var(--font-weight-medium)",
                  fontSize: "var(--text-body)",
                  cursor: busy ? "wait" : "pointer",
                }}
              >
                Delete entry
              </button>
            </div>
          )}
        </BottomSheet>
      </IonContent>
    </IonPage>
  );
};

export default LedgerScreen;
