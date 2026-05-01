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
 *       9999        — test-fire (dev diagnostics, outside normal ranges)
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
 * Boot-completed re-registration (Android):
 *   `RECEIVE_BOOT_COMPLETED` is declared in the AndroidManifest.xml.
 *   Capacitor's local-notifications plugin registers a BootReceiver
 *   that re-schedules pending alarms after a device reboot. If we
 *   discover the plugin does NOT handle this, we will need to add a
 *   custom BroadcastReceiver in
 *   `android/app/src/main/java/io/amban/app/BootReceiver.java`
 *   that calls back into the WebView to trigger `rescheduleAll()`.
 *   For v0.2.0 we rely on the plugin's built-in behaviour and verify
 *   via the schedule-verification diagnostic.
 *
 * Android 13+ POST_NOTIFICATIONS permission:
 *   Starting with API 33 (Android 13), apps must request the runtime
 *   permission `android.permission.POST_NOTIFICATIONS` before local
 *   notifications will display. Capacitor's plugin wraps this via
 *   `requestPermissions()`. We track whether we've already asked via
 *   the `amban.notifications_runtime_asked` Preferences key so that
 *   upgrading users who completed onboarding before v0.2.0 get a
 *   one-time automatic permission request on first launch.
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

import { Preferences } from "@capacitor/preferences";

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
  /**
   * Force a full reschedule, bypassing the fingerprint dedupe. Useful
   * for diagnostics and the dev-only "force reschedule" button.
   */
  forceRescheduleAll: () => Promise<void>;
  /** Cancel everything in our ID ranges. Does not flip the master toggle. */
  cancelAll: () => Promise<void>;
  /** Open the OS settings page for the app (best-effort). */
  openSystemSettings: () => Promise<void>;
  /** Whether the last reschedule was verified (daily prompt is pending). */
  lastScheduleVerified: boolean;
  /** Number of amban notifications currently pending in the OS. */
  scheduledCount: number;
  /**
   * Fire a test notification in ~10 seconds (ID 9999, outside normal
   * ranges). Intended for dev/QA diagnostics only.
   */
  testFireNotification: () => Promise<void>;
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
  () => "Time to close the books! How much did today cost? 📝",
  () => "Before you call it a night — what did you spend today? 💭",
  () => "Your future self thanks you for logging today. How much? 🙏",
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
/** ID used by the test-fire diagnostic. Outside all normal ranges. */
const TEST_FIRE_ID = 9999;

/** Preferences key for persisting schedule verification result. */
const SCHEDULE_VERIFIED_KEY = "amban.last_schedule_verified" as PreferenceKey;

/**
 * Verify that the daily prompt notification is actually registered in
 * the OS pending list. Returns true when confirmed, false when the
 * daily prompt is missing or the plugin call fails.
 *
 * This is the schedule-verification diagnostic: if the OS or an
 * aggressive OEM silently dropped our alarm, we'll know on the next
 * app resume and can surface the issue in the diagnostics section.
 */
async function verifySchedule(): Promise<{ verified: boolean; count: number }> {
  if (!isNative()) return { verified: true, count: 0 };
  try {
    const pending = await LocalNotifications.getPending();
    const ours = (pending?.notifications ?? []).filter((n) => isAmbanNotificationId(n.id));
    const dailyExists = ours.some((n) => n.id === DAILY_PROMPT_ID);
    if (!dailyExists) {
      console.warn("[amban.notifications] Daily prompt not found in pending notifications");
    }
    return { verified: dailyExists, count: ours.length };
  } catch {
    return { verified: false, count: 0 };
  }
}

function buildScheduledSet(inputs: ScheduleInputs): LocalNotificationSchema[] {
  const out: LocalNotificationSchema[] = [];
  const today = todayLocalStartOfDay();

  // Daily prompt — one-shot exact alarm at the next occurrence of
  // the configured time. One-shot alarms use setExactAndAllowWhileIdle()
  // on Android, which survives Doze mode and process kills — unlike
  // repeating alarms which use setInexactRepeating() and are subject
  // to OS batching and OEM killing. The app reschedules the next
  // day's alarm on every foreground resume and cold start.
  const [hourRaw, minuteRaw] = inputs.notificationTime.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (Number.isInteger(hour) && Number.isInteger(minute)) {
    const now = new Date();
    const fireAt = new Date(today);
    fireAt.setHours(hour, minute, 0, 0);
    // If the target time has already passed today, schedule for tomorrow.
    if (fireAt.getTime() <= now.getTime()) {
      fireAt.setDate(fireAt.getDate() + 1);
    }
    out.push({
      id: DAILY_PROMPT_ID,
      title: "amban",
      body: pickDailyTemplate(inputs.name, fireAt),
      schedule: {
        at: fireAt,
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
  const onboardingComplete = useUserStore((s) => s.onboardingComplete);

  const [permission, setPermission] = useState<NotificationPermission>("unknown");
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastScheduleVerified, setLastScheduleVerified] = useState(true);
  const [scheduledCount, setScheduledCount] = useState(0);
  const lastFingerprintRef = useRef<string | null>(null);
  const upgradePermissionCheckedRef = useRef(false);

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
      // Record that we've asked for runtime permission (Android 13+).
      // Uses the string literal to avoid merge conflicts with the
      // agent adding PreferenceKey.NotificationsRuntimeAsked.
      await Preferences.set({ key: "amban.notifications_runtime_asked", value: "1" });
      return mapped;
    } catch (e) {
      console.warn("[amban.notifications] requestPermissions failed:", e);
      setPermission("unknown");
      return "unknown";
    }
  }, []);

  /* ----- Android 13+ upgrade permission flow ---------------------- */

  // Users who completed onboarding before v0.2.0 may not have been
  // asked for the POST_NOTIFICATIONS runtime permission (introduced
  // in Android 13 / API 33). On first launch of v0.2.0+, if the user
  // is past onboarding but we haven't recorded an ask, trigger the
  // permission flow automatically once.
  useEffect(() => {
    if (!isNative() || upgradePermissionCheckedRef.current) return;
    if (!onboardingComplete) return;
    upgradePermissionCheckedRef.current = true;

    void (async () => {
      const { value: alreadyAsked } = await Preferences.get({
        key: "amban.notifications_runtime_asked",
      });
      if (alreadyAsked === "1") return;

      // Haven't asked yet — this is an upgrading user. Trigger the
      // permission flow. Even if they deny, we record the ask so we
      // don't nag on every subsequent launch.
      console.info("[amban.notifications] Upgrading user detected — requesting POST_NOTIFICATIONS");
      await requestPermission();
    })();
  }, [onboardingComplete, requestPermission]);

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
      // Even if the fingerprint matches today's stored value, we must
      // reschedule if the daily prompt has already fired (it was a
      // one-shot alarm and is no longer in the pending list). Without
      // this, the user wouldn't get tomorrow's notification.
      const verification = await verifySchedule();
      if (verification.verified) {
        // Daily prompt is still pending — nothing to do.
        return;
      }
      // Daily prompt has already fired or was dropped — fall through
      // to reschedule the next occurrence.
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

      // Post-schedule verification — confirm the daily prompt landed.
      const verification = await verifySchedule();
      setLastScheduleVerified(verification.verified);
      setScheduledCount(verification.count);
      await prefs.setString(SCHEDULE_VERIFIED_KEY, verification.verified ? "1" : "0");
      if (!verification.verified) {
        console.warn(
          "[amban.notifications] Schedule verification failed: daily prompt missing from pending list",
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[amban.notifications] schedule failed:", msg);
      setLastError(msg);
    }
  }, [refreshPermission]);

  const forceRescheduleAll = useCallback(async () => {
    // Bypass the fingerprint dedupe by clearing it first.
    lastFingerprintRef.current = null;
    await prefs.remove(FINGERPRINT_KEY);
    await rescheduleAll();
  }, [rescheduleAll]);

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

  /* ----- Test-fire (dev diagnostics) ------------------------------- */

  const testFireNotification = useCallback(async () => {
    if (!isNative()) return;
    try {
      await LocalNotifications.schedule({
        notifications: [
          {
            id: TEST_FIRE_ID,
            title: "amban.io (test)",
            body: "This is a test notification. If you see this, notifications work! 🎉",
            schedule: { at: new Date(Date.now() + 10_000) },
            extra: { target: "log" },
          },
        ],
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[amban.notifications] test-fire failed:", msg);
      setLastError(msg);
    }
  }, []);

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
    forceRescheduleAll,
    cancelAll,
    openSystemSettings,
    lastScheduleVerified,
    scheduledCount,
    testFireNotification,
  };
}
