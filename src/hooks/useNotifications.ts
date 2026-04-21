/**
 * hooks/useNotifications.ts — Local notification scheduling hook.
 *
 * Phase 1 scaffolding only. The real implementation lands in Phase 12 per
 * CLAUDE.md §10 (Notifications) and Appendix E (Notification ID Scheme).
 *
 * Responsibilities once wired:
 *   - Encapsulate scheduleAllNotifications() per §10.4 using the deterministic
 *     ID ranges from Appendix E:
 *       1000       → daily spend prompt (fixed id)
 *       2000–2999  → upcoming recurring payment reminders (2000 + payment.id)
 *       3000–3999  → salary day nudges (3000 + incomeSource.id)
 *       4000–4999  → reserved for future use
 *   - Always cancel the full ID range before rescheduling, so stale entries
 *     never survive an edit.
 *   - Reschedule after: onboarding completion, any edit to income / recurring
 *     / settings, app foreground resume, and app install upgrade.
 *   - Dedupe via the `last_notification_schedule_date` key in Capacitor
 *     Preferences — skip rescheduling if it already ran today and nothing
 *     changed.
 *   - Expose the current permission state so the UI can surface a
 *     "notifications are off — open OS settings" affordance when denied.
 *
 * Deep linking: tapping the daily prompt opens amban://log (Daily Log
 * screen); every other notification opens the Home screen. Wired in Phase 6
 * (router) + Phase 12 (scheduler).
 */

export type NotificationPermission =
  | "granted"
  | "denied"
  | "prompt"
  | "provisional"
  | "unknown";

export interface UseNotificationsResult {
  permission: NotificationPermission;
  effectivelyEnabled: boolean;
  requestPermission: () => Promise<NotificationPermission>;
  rescheduleAll: () => Promise<void>;
  cancelAll: () => Promise<void>;
  openSystemSettings: () => Promise<void>;
}

/**
 * Returns the notification scheduling API plus the current permission state.
 *
 * Not implemented yet — returns inert values so consumers can type against
 * the real shape while Phase 12 is under construction.
 */
export function useNotifications(): UseNotificationsResult {
  // TODO(phase-12): implement per CLAUDE.md §10.4.

  return {
    permission: "unknown",
    effectivelyEnabled: false,
    requestPermission: async () => {
      throw new Error(
        "useNotifications.requestPermission() not implemented yet — landing in Phase 12.",
      );
    },
    rescheduleAll: async () => {
      throw new Error(
        "useNotifications.rescheduleAll() not implemented yet — landing in Phase 12.",
      );
    },
    cancelAll: async () => {
      throw new Error(
        "useNotifications.cancelAll() not implemented yet — landing in Phase 12.",
      );
    },
    openSystemSettings: async () => {
      throw new Error(
        "useNotifications.openSystemSettings() not implemented yet — landing in Phase 12.",
      );
    },
  };
}
