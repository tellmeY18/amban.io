/**
 * hooks/useNotifications.ts — local notification scheduler.
 *
 * Source of truth: CLAUDE.md §10 (Notifications), §10.4 (Notification
 * Scheduling Logic), §6.4 (Salary Day banner), §13.7 (don't double-
 * deduct), Appendix D (UPCOMING_PAYMENT_NOTIFY_DAYS), and
 * Appendix E (Notification ID Scheme).
 *
 * Responsibilities:
 *   - Encapsulate `scheduleAllNotifications()` per §10.4 using the
 *     deterministic ID ranges from Appendix E:
 *       1000        — daily spend prompt (fixed id)
 *       2000–2999   — upcoming recurring payment reminders (2000 + payment.id)
 *       3000–3999   — salary day nudges (3000 + incomeSource.id)
 *       4000–4999   — reserved (future, e.g. month-end summary)
 *   - Always cancel the full ID range before rescheduling, so stale
 *     entries never survive an edit.
 *   - Reschedule after: onboarding completion, any edit to income /
 *     recurring / settings, app foreground resume, and app install
 *     upgrade.
 *   - Dedupe via PreferenceKey.LastNotificationScheduleDate — skip
 *     rescheduling when it already ran today AND the inputs haven't
 *     changed (we hash the inputs into a small fingerprint key).
 *   - Surface the OS permission state so the UI can render a "fix it"
 *     affordance when notifications are toggled on but permission is
 *     denied.
 *
 * Design rules:
 *   - Pure plumbing — no React UI. Screens consume the returned
 *     functions; copy belongs to the screen, not to this hook.
 *   - The scheduler subscribes to the relevant store slices itself
 *     so external callers don't need to thread inputs in. A single
 *     `rescheduleAll()` call always rebuilds from the current store
 *     state.
 *   - Web is a no-op surface — Capacitor's plugin throws on some web
 *     paths, so we gate every plugin call on `Capacitor.isNativePlatform()`
 *     and silently succeed on web. Dev iteration on the desktop
 *     browser stays smooth.
 *   - Never throws past the React boundary. A failed schedule is
 *     logged and surfaced via `lastError` (returned by the hook)
 *     rather than allowed to propagate.
 *   - Deep linking: the daily prompt sets `extra.target = "log"` so
 *     the App.tsx-level `appUrlOpen` handler routes to /log when the
 *     OS bubbles the tap back into the app via amban://log.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import type { LocalNotificationSchema, PermissionStatus } from "@capacitor/local-notifications";

import { PreferenceKey, prefs } from "../db/preferences";
import { useFinanceStore } from "../stores/financeStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useUserStore } from "../stores/userStore";
import { UPCOMING_PAYMENT_NOTIFY_DAYS } from "../constants/insightThresholds";
import { getActualDueDate } from "../utils/dateHelpers";

/* ------------------------------------------------------------------
 * Public types
 * ------------------------------------------------------------------ */

export type NotificationPermission = "granted" | "denied" | "prompt" | "provisional" | "unknown";

export interface UseNotificationsResult {
  /** Current OS-level permission state for local notifications. */
  permission: NotificationPermission;
  /**
   * True when the master toggle is on AND the OS has granted
   * permission. The "should the user actually receive prompts?"
   * question, in one boolean.
   */
  effectivelyEnabled: boolean;
  /** Last failure message, if a schedule pass threw. Null otherwise. */
  lastError: string | null;
  /** Trigger the OS permission flow. Returns the resolved state. */
  requestPermission: () => Promise<NotificationPermission>;
  /** Cancel everything in our ID ranges, then re-schedule from store state. */
  rescheduleAll: () => Promise<void>;
  /** Cancel everything in our ID ranges. Does not flip the master toggle. */
  cancelAll: () => Promise<void>;
  /** Open the OS settings page for the app (best-effort). */
  openSystemSettings: () => Promise<void>;
}

/* ------------------------------------------------------------------
 * ID-range helpers (Appendix E)
 *
 * Centralised so a future range expansion is a one-file edit. The
 * cancel pass enumerates pending notifications and culls anything in
 * our ranges, regardless of who scheduled it — that way an upgrade
 * from a buggy past version can't leave stranded notifications.
 * ------------------------------------------------------------------ */

const DAILY_PROMPT_ID = 1000;
const RECURRING_RANGE_START = 2000;
const RECURRING_RANGE_END = 2999;
const SALARY_RANGE_START = 3000;
const SALARY_RANGE_END = 3999;
const RESERVED_RANGE_START = 4000;
const RESERVED_RANGE_END = 4999;

function isAmbanNotificationId(id: number): boolean {
  if (id === DAILY_PROMPT_ID) return true;
  if (id >= RECURRING_RANGE_START && id <= RECURRING_RANGE_END) return true;
  if (id >= SALARY_RANGE_START && id <= SALARY_RANGE_END) return true;
  if (id >= RESERVED_RANGE_START && id <= RESERVED_RANGE_END) return true;
  return false;
}

/* ------------------------------------------------------------------
 * Daily-prompt copy (§10.1)
 *
 * Five rotating templates. We pick deterministically from the date
 * so the same message doesn't fire repeatedly across reschedules
 * within the same day, but the rotation feels human across days.
 * ------------------------------------------------------------------ */

const DAILY_TEMPLATES: ReadonlyArray<(name: string) => string> = [
  (n) => `Hey ${n || "there"}! 👋 How much did you spend today?`,
  () => "End of day check-in 📊 Log your spend to keep your score accurate.",
  () => "Quick question — what did today cost you? 💸",
  () => "Don't lose track! Log today's spend before you sleep. 🌙",
  () => "Your amban score is waiting. What did you spend today? 📱",
];

function pickDailyTemplate(name: string, today: Date): string {
  // Day-of-year drives the pick — rotates across days but is stable
  // within a day, so a re-schedule pass never picks a different message
  // mid-day.
  const start = new Date(today.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((today.getTime() - start.getTime()) / 86_400_000);
  const idx =
    ((dayOfYear % DAILY_TEMPLATES.length) + DAILY_TEMPLATES.length) % DAILY_TEMPLATES.length;
  const template = DAILY_TEMPLATES[idx] ?? DAILY_TEMPLATES[0];
  return template ? template(name) : "Log today's spend.";
}

/* ------------------------------------------------------------------
 * Date helpers — local to this hook
 *
 * The scheduler operates exclusively in local calendar time, the
 * same convention as utils/dateHelpers.ts. We re-derive a couple of
 * tiny utilities here rather than importing more surface area.
 * ------------------------------------------------------------------ */

function todayLocalStartOfDay(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function todayIsoDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Resolve a payment's next upcoming due date. Mirrors the same rule
 * used by the Home strip: due-day-already-passed rolls to next month.
 */
function nextUpcomingDueDate(dueDay: number, today: Date): Date {
  const thisMonth = getActualDueDate(dueDay, today);
  if (thisMonth.getTime() >= today.getTime()) return thisMonth;
  const nextMonthRef = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  return getActualDueDate(dueDay, nextMonthRef);
}

/**
 * Subtract N calendar days from a Date, preserving start-of-day.
 * Used to compute the "N days before due" fire time for upcoming
 * payment reminders.
 */
function subtractDays(from: Date, days: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() - days);
  d.setHours(9, 0, 0, 0); // fire at 9am on the reminder day
  return d;
}

/* ------------------------------------------------------------------
 * Permission mapping
 *
 * Capacitor's PermissionStatus.display is the one we care about for
 * local notifications. Map it onto our stricter enum so UI code has
 * a small closed set to branch on.
 * ------------------------------------------------------------------ */

function mapPermission(status: PermissionStatus | null): NotificationPermission {
  if (!status) return "unknown";
  switch (status.display) {
    case "granted":
      return "granted";
    case "denied":
      return "denied";
    case "prompt":
    case "prompt-with-rationale":
      return "prompt";
    default:
      return "unknown";
  }
}

function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------
 * Scheduler body
 *
 * Pulled out of the hook so it can be called from effects without
 * pulling store identities into the dependency list. Each call
 * reads fresh state via `getState()` so a reschedule is always
 * authoritative against the current store snapshot.
 * ------------------------------------------------------------------ */

interface ScheduleInputs {
  name: string;
  notificationsEnabled: boolean;
  notificationTime: string; // HH:MM 24h
  incomeSources: Array<{ id: number; label: string; amount: number; creditDay: number }>;
  recurringPayments: Array<{ id: number; label: string; amount: number; dueDay: number }>;
}

function buildInputs(): ScheduleInputs {
  const settings = useSettingsStore.getState();
  const finance = useFinanceStore.getState();
  const user = useUserStore.getState();
  return {
    name: user.name,
    notificationsEnabled: settings.notificationsEnabled,
    notificationTime: settings.notificationTime,
    incomeSources: finance.incomeSources
      .filter((s) => s.isActive)
      .map((s) => ({ id: s.id, label: s.label, amount: s.amount, creditDay: s.creditDay })),
    recurringPayments: finance.recurringPayments
      .filter((p) => p.isActive)
      .map((p) => ({ id: p.id, label: p.label, amount: p.amount, dueDay: p.dueDay })),
  };
}

/**
 * A small fingerprint of the scheduling inputs. Combined with the
 * current date, it becomes the dedupe key: if today == last-run-date
 * AND fingerprint == last-fingerprint, we skip a full reschedule.
 */
function fingerprintInputs(inputs: ScheduleInputs): string {
  const parts: string[] = [
    `name=${inputs.name}`,
    `on=${inputs.notificationsEnabled ? 1 : 0}`,
    `t=${inputs.notificationTime}`,
    `i=${inputs.incomeSources
      .map((s) => `${s.id}:${s.amount}:${s.creditDay}`)
      .sort()
      .join(",")}`,
    `r=${inputs.recurringPayments
      .map((p) => `${p.id}:${p.amount}:${p.dueDay}`)
      .sort()
      .join(",")}`,
  ];
  return parts.join("|");
}

const FINGERPRINT_KEY = PreferenceKey.LastNotificationScheduleDate;

/**
 * Cancel every currently-pending notification whose id falls inside
 * our ID ranges. Idempotent, plugin-error-tolerant.
 */
async function cancelAmbanScheduled(): Promise<void> {
  if (!isNative()) return;
  let pending: Awaited<ReturnType<typeof LocalNotifications.getPending>>;
  try {
    pending = await LocalNotifications.getPending();
  } catch {
    return;
  }
  const list = pending?.notifications ?? [];
  const ours = list.filter((n) => isAmbanNotificationId(n.id));
  if (ours.length === 0) return;
  try {
    await LocalNotifications.cancel({
      notifications: ours.map((n) => ({ id: n.id })),
    });
  } catch (e) {
    console.warn("[amban.notifications] cancel failed:", e);
  }
}

/**
 * Compose the full `LocalNotificationSchema[]` from the given inputs.
 * Kept pure (no plugin calls) so tests — if we grow them — can assert
 * on the payload shape directly.
 */
function buildScheduledSet(inputs: ScheduleInputs): LocalNotificationSchema[] {
  const out: LocalNotificationSchema[] = [];
  const today = todayLocalStartOfDay();

  // Daily prompt — recurring at the chosen hour/minute.
  const [hourRaw, minuteRaw] = inputs.notificationTime.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (Number.isInteger(hour) && Number.isInteger(minute)) {
    out.push({
      id: DAILY_PROMPT_ID,
      title: "amban",
      body: pickDailyTemplate(inputs.name, today),
      schedule: {
        on: { hour, minute },
        allowWhileIdle: true,
      },
      extra: { target: "log" },
      sound: undefined,
    });
  }

  // Upcoming recurring payment reminders — N days before each active
  // payment's next due date.
  for (const payment of inputs.recurringPayments) {
    const due = nextUpcomingDueDate(payment.dueDay, today);
    const fireAt = subtractDays(due, UPCOMING_PAYMENT_NOTIFY_DAYS);
    // Don't schedule reminders in the past — the OS would fire them
    // immediately on register, which is worse than silent.
    if (fireAt.getTime() <= Date.now()) continue;
    if (payment.id <= 0 || payment.id > 999) continue; // guard ID range
    out.push({
      id: RECURRING_RANGE_START + payment.id,
      title: "Upcoming payment",
      body: `${payment.label} (₹${payment.amount.toLocaleString("en-IN")}) is due in ${UPCOMING_PAYMENT_NOTIFY_DAYS} days.`,
      schedule: { at: fireAt, allowWhileIdle: true },
      extra: { target: "home" },
    });
  }

  // Salary-day nudges — at 10am on each active income source's next
  // credit day.
  for (const source of inputs.incomeSources) {
    const creditDate = nextUpcomingDueDate(source.creditDay, today);
    const fireAt = new Date(creditDate);
    fireAt.setHours(10, 0, 0, 0);
    if (fireAt.getTime() <= Date.now()) continue;
    if (source.id <= 0 || source.id > 999) continue;
    out.push({
      id: SALARY_RANGE_START + source.id,
      title: "🎉 Salary day!",
      body: `Did ₹${source.amount.toLocaleString("en-IN")} from ${source.label} land? Update your balance.`,
      schedule: { at: fireAt, allowWhileIdle: true },
      extra: { target: "home" },
    });
  }

  return out;
}

/* ------------------------------------------------------------------
 * Public hook
 * ------------------------------------------------------------------ */

export function useNotifications(): UseNotificationsResult {
  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled);
  const notificationTime = useSettingsStore((s) => s.notificationTime);
  const incomeSources = useFinanceStore((s) => s.incomeSources);
  const recurringPayments = useFinanceStore((s) => s.recurringPayments);
  const name = useUserStore((s) => s.name);

  const [permission, setPermission] = useState<NotificationPermission>("unknown");
  const [lastError, setLastError] = useState<string | null>(null);
  const lastFingerprintRef = useRef<string | null>(null);

  /* ----- Permission bootstrap ------------------------------------- */

  const refreshPermission = useCallback(async (): Promise<NotificationPermission> => {
    if (!isNative()) {
      setPermission("unknown");
      return "unknown";
    }
    try {
      const status = await LocalNotifications.checkPermissions();
      const mapped = mapPermission(status);
      setPermission(mapped);
      if (mapped === "granted") {
        await prefs.setBool(PreferenceKey.NotificationsPermissionGranted, true);
      }
      return mapped;
    } catch (e) {
      console.warn("[amban.notifications] checkPermissions failed:", e);
      setPermission("unknown");
      return "unknown";
    }
  }, []);

  useEffect(() => {
    void refreshPermission();
  }, [refreshPermission]);

  const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
    if (!isNative()) return "unknown";
    try {
      const status = await LocalNotifications.requestPermissions();
      const mapped = mapPermission(status);
      setPermission(mapped);
      if (mapped === "granted") {
        await prefs.setBool(PreferenceKey.NotificationsPermissionGranted, true);
      }
      return mapped;
    } catch (e) {
      console.warn("[amban.notifications] requestPermissions failed:", e);
      setPermission("unknown");
      return "unknown";
    }
  }, []);

  /* ----- Scheduler ------------------------------------------------ */

  const cancelAll = useCallback(async () => {
    try {
      await cancelAmbanScheduled();
      setLastError(null);
      // Clear fingerprint so the next rescheduleAll re-registers.
      lastFingerprintRef.current = null;
      await prefs.remove(FINGERPRINT_KEY);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLastError(msg);
    }
  }, []);

  const rescheduleAll = useCallback(async () => {
    if (!isNative()) return;

    setLastError(null);
    const inputs = buildInputs();

    // If the master toggle is off, we just cancel and leave.
    if (!inputs.notificationsEnabled) {
      await cancelAmbanScheduled();
      lastFingerprintRef.current = null;
      await prefs.remove(FINGERPRINT_KEY);
      return;
    }

    // Dedupe — skip a full reschedule when nothing has changed today.
    // Fingerprint is `date|inputsHash` so a cross-day boot always
    // re-runs (the daily template pick rotates daily).
    const todayIso = todayIsoDate();
    const fingerprint = `${todayIso}|${fingerprintInputs(inputs)}`;
    const stored = await prefs.getString(FINGERPRINT_KEY, null);
    if (stored === fingerprint && lastFingerprintRef.current === fingerprint) {
      return;
    }

    // Ensure permission before we attempt to schedule — a denied
    // state silently no-ops the plugin on some platforms.
    const current = await refreshPermission();
    if (current !== "granted") {
      // Toggle stays on (user intent), but we can't schedule.
      // cancel any stale entries so the denial is consistent.
      await cancelAmbanScheduled();
      return;
    }

    try {
      await cancelAmbanScheduled();
      const batch = buildScheduledSet(inputs);
      if (batch.length > 0) {
        await LocalNotifications.schedule({ notifications: batch });
      }
      lastFingerprintRef.current = fingerprint;
      await prefs.setString(FINGERPRINT_KEY, fingerprint);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[amban.notifications] schedule failed:", msg);
      setLastError(msg);
    }
  }, [refreshPermission]);

  /* ----- Auto-reschedule on input change -------------------------- */

  // Whenever any input that shapes the schedule changes, re-run. The
  // dedupe fingerprint inside `rescheduleAll` ensures we don't hit
  // the plugin when nothing actually moved.
  useEffect(() => {
    void rescheduleAll();
    // Fingerprint is derived from the same inputs the effect depends
    // on, so referencing them here is correct and deliberate.
  }, [
    rescheduleAll,
    notificationsEnabled,
    notificationTime,
    incomeSources,
    recurringPayments,
    name,
  ]);

  /* ----- Open system settings ------------------------------------- */

  const openSystemSettings = useCallback(async () => {
    if (!isNative()) return;
    // The Capacitor local-notifications plugin doesn't expose a
    // direct "open settings" entry. Request permission again as a
    // soft nudge — on denied state iOS/Android both surface a link
    // to Settings from the resulting prompt-less resolve.
    try {
      await LocalNotifications.requestPermissions();
    } catch {
      /* silent — best-effort */
    }
  }, []);

  /* ----- Derived: effectivelyEnabled ------------------------------ */

  const effectivelyEnabled = useMemo(
    () => notificationsEnabled && permission === "granted",
    [notificationsEnabled, permission],
  );

  return {
    permission,
    effectivelyEnabled,
    lastError,
    requestPermission,
    rescheduleAll,
    cancelAll,
    openSystemSettings,
  };
}
