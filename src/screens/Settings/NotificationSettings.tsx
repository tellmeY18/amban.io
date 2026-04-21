/**
 * screens/Settings/NotificationSettings.tsx — notification preferences.
 *
 * Source of truth: CLAUDE.md §9.5 (Settings → Notification Time), §10
 * (Notifications), and Appendix F (Haptics).
 *
 * Responsibilities:
 *   - Master toggle for all amban-scheduled local notifications.
 *   - Time picker for the daily spend prompt (HH:MM 24h, displayed in
 *     12h with AM/PM per Indian UX convention).
 *   - Surfaces the current OS permission state and offers a "fix it"
 *     affordance when permission is denied but the toggle is on.
 *   - Changing any setting triggers a scheduler re-run via the
 *     `useNotifications` hook — off cancels every scheduled ID,
 *     on + new time reschedules the daily prompt at the new minute.
 *
 * Design rules:
 *   - The store is the source of truth for the preference. The
 *     scheduler hook reads the store and pushes to the OS. We never
 *     call `LocalNotifications.schedule` from this screen directly.
 *   - The time picker is a plain <input type="time"> — the widget is
 *     native on both iOS and Android WebViews and matches the dense
 *     form aesthetic of the rest of Settings. IonDatetime is overkill
 *     here (it's a full-screen picker) and would read as ceremonial.
 *   - No confirmation modal for turning notifications off. The toggle
 *     is reversible, and adding a modal to a binary switch is noise.
 */

import { useEffect, useState } from "react";
import { useHistory } from "react-router-dom";
import { IonContent, IonIcon, IonPage } from "@ionic/react";

import { useSettingsStore } from "../../stores/settingsStore";
import { useNotifications } from "../../hooks/useNotifications";

import { Icons } from "../../theme/icons";
import { formatTime12h } from "../../utils/formatters";
import { haptics } from "../../utils/haptics";

/**
 * Normalise an arbitrary input-value into the canonical HH:MM form the
 * settings store accepts. Some WebViews emit "H:MM" (single-digit
 * hour), so we pad defensively before the store validator runs.
 */
function normaliseTime(raw: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

const SectionHeader: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h2
    style={{
      fontSize: "var(--text-caption)",
      fontWeight: "var(--font-weight-semibold)",
      color: "var(--text-muted)",
      textTransform: "uppercase",
      letterSpacing: "0.06em",
      margin: "var(--space-md) var(--space-xs) var(--space-xs)",
    }}
  >
    {children}
  </h2>
);

const NotificationSettings: React.FC = () => {
  const history = useHistory();

  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled);
  const notificationTime = useSettingsStore((s) => s.notificationTime);
  const setNotificationsEnabled = useSettingsStore((s) => s.setNotificationsEnabled);
  const setNotificationTime = useSettingsStore((s) => s.setNotificationTime);

  const { permission, requestPermission, rescheduleAll, cancelAll, openSystemSettings } =
    useNotifications();

  // Local draft so the time input feels responsive (the store write is
  // async). On blur / commit we flush to the store and reschedule.
  const [draftTime, setDraftTime] = useState(notificationTime);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraftTime(notificationTime);
  }, [notificationTime]);

  const permissionDenied = permission === "denied";
  const permissionPrompt = permission === "prompt" || permission === "unknown";

  const handleToggle = async () => {
    const next = !notificationsEnabled;
    setBusy(true);
    setError(null);
    void haptics.selection();
    try {
      if (next && permissionPrompt) {
        // First-time opt-in: request permission BEFORE scheduling so
        // the OS prompt interrupts the flow rather than silently
        // failing on the schedule call.
        const outcome = await requestPermission();
        if (outcome === "denied") {
          setError("Notifications permission denied. Enable it in system settings to get prompts.");
          setBusy(false);
          return;
        }
      }

      await setNotificationsEnabled(next);
      if (next) {
        await rescheduleAll();
      } else {
        await cancelAll();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update notifications.");
    } finally {
      setBusy(false);
    }
  };

  const handleTimeCommit = async (raw: string) => {
    const normalised = normaliseTime(raw);
    if (!normalised) {
      setError("Pick a valid time.");
      return;
    }
    if (normalised === notificationTime) return;

    setBusy(true);
    setError(null);
    try {
      await setNotificationTime(normalised);
      if (notificationsEnabled) {
        await rescheduleAll();
      }
      void haptics.tapLight();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save time.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <IonPage>
      <IonContent fullscreen>
        <main
          className="amban-screen"
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}
        >
          <header
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-sm)",
              padding: "var(--space-md) var(--space-xs) var(--space-md)",
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
              Notifications
            </h1>
          </header>

          {/* Permission-denied banner */}
          {notificationsEnabled && permissionDenied ? (
            <article
              role="status"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-xs)",
                padding: "var(--space-md)",
                borderRadius: "var(--radius-md)",
                backgroundColor: "rgba(242, 153, 0, 0.12)",
                border: "1px solid rgba(242, 153, 0, 0.35)",
              }}
            >
              <span
                style={{
                  fontSize: "var(--text-body)",
                  fontWeight: "var(--font-weight-semibold)",
                  color: "var(--text-strong)",
                }}
              >
                Notifications are blocked by iOS/Android
              </span>
              <span
                style={{
                  fontSize: "var(--text-caption)",
                  color: "var(--text-muted)",
                  lineHeight: "var(--line-height-body)",
                }}
              >
                amban can't prompt you until you enable notifications in system settings.
              </span>
              <button
                type="button"
                onClick={() => {
                  void openSystemSettings();
                }}
                style={{
                  alignSelf: "flex-start",
                  marginTop: "var(--space-xs)",
                  minHeight: 36,
                  padding: "var(--space-xs) var(--space-md)",
                  borderRadius: "var(--radius-md)",
                  backgroundColor: "var(--color-score-good)",
                  color: "#ffffff",
                  border: "none",
                  fontSize: "var(--text-caption)",
                  fontWeight: "var(--font-weight-semibold)",
                  cursor: "pointer",
                }}
              >
                Open system settings
              </button>
            </article>
          ) : null}

          <SectionHeader>Daily prompt</SectionHeader>

          {/* Master toggle */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-md)",
              padding: "var(--space-md)",
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--surface-raised)",
              boxShadow: "var(--shadow-card)",
              minHeight: "var(--hit-target-min)",
            }}
          >
            <IonIcon
              icon={
                notificationsEnabled ? Icons.status.notifications : Icons.status.notificationsOff
              }
              aria-hidden="true"
              style={{ fontSize: "1.25rem", color: "var(--text-strong)", flexShrink: 0 }}
            />
            <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
              <span
                style={{
                  fontSize: "var(--text-body)",
                  fontWeight: "var(--font-weight-medium)",
                  color: "var(--text-strong)",
                }}
              >
                Evening reminder
              </span>
              <span style={{ fontSize: "var(--text-caption)", color: "var(--text-muted)" }}>
                A nudge to log your spend before bed.
              </span>
            </div>
            <label
              style={{
                position: "relative",
                display: "inline-block",
                width: 52,
                height: 30,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={notificationsEnabled}
                disabled={busy}
                onChange={handleToggle}
                aria-label="Toggle notifications"
                style={{ opacity: 0, width: 0, height: 0 }}
              />
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "var(--radius-pill)",
                  backgroundColor: notificationsEnabled
                    ? "var(--color-primary)"
                    : "var(--surface-sunken)",
                  transition: "background-color var(--motion-fast) var(--motion-ease)",
                }}
              />
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  top: 3,
                  left: notificationsEnabled ? 25 : 3,
                  width: 24,
                  height: 24,
                  borderRadius: "var(--radius-pill)",
                  backgroundColor: "#ffffff",
                  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.2)",
                  transition: "left var(--motion-fast) var(--motion-ease)",
                }}
              />
            </label>
          </div>

          {/* Time picker */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-md)",
              padding: "var(--space-md)",
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--surface-raised)",
              boxShadow: "var(--shadow-card)",
              minHeight: "var(--hit-target-min)",
              opacity: notificationsEnabled ? 1 : 0.5,
            }}
          >
            <IonIcon
              icon={Icons.status.time}
              aria-hidden="true"
              style={{ fontSize: "1.25rem", color: "var(--text-strong)", flexShrink: 0 }}
            />
            <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
              <span
                style={{
                  fontSize: "var(--text-body)",
                  fontWeight: "var(--font-weight-medium)",
                  color: "var(--text-strong)",
                }}
              >
                Time
              </span>
              <span style={{ fontSize: "var(--text-caption)", color: "var(--text-muted)" }}>
                {formatTime12h(notificationTime)}
              </span>
            </div>
            <input
              type="time"
              value={draftTime}
              disabled={!notificationsEnabled || busy}
              onChange={(e) => setDraftTime(e.target.value)}
              onBlur={(e) => void handleTimeCommit(e.target.value)}
              aria-label="Notification time"
              style={{
                minHeight: "var(--hit-target-min)",
                padding: "var(--space-xs) var(--space-sm)",
                borderRadius: "var(--radius-md)",
                backgroundColor: "var(--surface-sunken)",
                border: "1px solid transparent",
                fontFamily: "var(--font-display)",
                fontSize: "var(--text-body)",
                fontWeight: "var(--font-weight-semibold)",
                color: "var(--text-strong)",
                outline: "none",
                fontVariantNumeric: "tabular-nums",
              }}
            />
          </div>

          {error ? (
            <p
              role="alert"
              style={{
                padding: "var(--space-sm) var(--space-md)",
                borderRadius: "var(--radius-md)",
                backgroundColor: "rgba(233, 66, 53, 0.10)",
                color: "var(--color-score-warning)",
                fontSize: "var(--text-caption)",
                margin: 0,
              }}
            >
              {error}
            </p>
          ) : null}

          <SectionHeader>What you'll get</SectionHeader>

          <article
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-sm)",
              padding: "var(--space-md)",
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--surface-raised)",
              boxShadow: "var(--shadow-card)",
            }}
          >
            <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "flex-start" }}>
              <span aria-hidden="true" style={{ fontSize: "1.1rem" }}>
                💸
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span
                  style={{
                    fontSize: "var(--text-body)",
                    fontWeight: "var(--font-weight-semibold)",
                    color: "var(--text-strong)",
                  }}
                >
                  Daily spend check-in
                </span>
                <span style={{ fontSize: "var(--text-caption)", color: "var(--text-muted)" }}>
                  Every evening at your chosen time.
                </span>
              </div>
            </div>
            <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "flex-start" }}>
              <span aria-hidden="true" style={{ fontSize: "1.1rem" }}>
                📅
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span
                  style={{
                    fontSize: "var(--text-body)",
                    fontWeight: "var(--font-weight-semibold)",
                    color: "var(--text-strong)",
                  }}
                >
                  Upcoming bill reminders
                </span>
                <span style={{ fontSize: "var(--text-caption)", color: "var(--text-muted)" }}>
                  Two days before any recurring payment is due.
                </span>
              </div>
            </div>
            <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "flex-start" }}>
              <span aria-hidden="true" style={{ fontSize: "1.1rem" }}>
                🎉
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span
                  style={{
                    fontSize: "var(--text-body)",
                    fontWeight: "var(--font-weight-semibold)",
                    color: "var(--text-strong)",
                  }}
                >
                  Salary day nudge
                </span>
                <span style={{ fontSize: "var(--text-caption)", color: "var(--text-muted)" }}>
                  On each income credit day, so you can refresh your balance.
                </span>
              </div>
            </div>
          </article>

          <p
            style={{
              padding: "var(--space-md) var(--space-xs)",
              fontSize: "var(--text-micro)",
              color: "var(--text-muted)",
              textAlign: "center",
            }}
          >
            All notifications are scheduled locally on this device. amban never sends anything over
            the network.
          </p>
        </main>
      </IonContent>
    </IonPage>
  );
};

export default NotificationSettings;
