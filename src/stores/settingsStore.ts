/**
 * stores/settingsStore.ts — notification time, theme, and app preferences.
 *
 * Source of truth: CLAUDE.md §5 (Data Models → Zustand Store Shapes),
 * §9.5 (Settings screen), §10 (Notifications), and Appendix I (Reset).
 *
 * Responsibilities:
 *   - Hydrate from the `settings` singleton row on app boot.
 *   - Expose notification time + enabled flag so the scheduler
 *     (Phase 12) can (re)install the daily prompt whenever they change.
 *   - Drive the theme switcher. Writes the chosen preference to SQLite
 *     AND pushes it into the ThemeProvider so <html data-theme> flips
 *     in the same tick the user taps the control.
 *   - Mirror the theme preference into Capacitor Preferences so the
 *     next cold boot can apply the right theme on first paint, before
 *     SQLite has had a chance to open.
 *
 * Design rules:
 *   - UI reads from this store, never from the `settings` table
 *     directly. New selectors belong here or in a hook.
 *   - Write-through order: SQLite first, then in-memory. A failed
 *     write MUST NOT update the in-memory state.
 *   - `hydrate` is the ONLY method allowed to bypass write-through;
 *     it's the boot path pulling state from SQLite into memory.
 *   - `reset` is called by the destructive reset pipeline in
 *     db/reset.ts. It does NOT touch SQLite — the pipeline handles
 *     that separately.
 *   - This store does NOT re-run the notification scheduler itself.
 *     It just owns the persisted preference; the scheduler subscribes
 *     to store changes in Phase 12 and re-installs as needed. Keeping
 *     the seam explicit means the store stays testable without mocking
 *     the notifications plugin.
 *   - Anything that belongs in Capacitor Preferences (flags, dismissed
 *     insights, last-schedule date) is handled by the Preferences
 *     facade in src/db/preferences.ts, not by this store. The one
 *     exception is the theme mirror, because it's read synchronously
 *     on first paint before SQLite is open.
 */

import { create } from "zustand";

import { PreferenceKey, prefs } from "../db/preferences";
import { settingsRepo } from "../db/repositories";

/** Possible theme modes. 'system' follows the OS preference. */
export type ThemeMode = "light" | "dark" | "system";

/**
 * Validator for raw strings coming out of storage. A corrupt theme
 * column or a stale preference value must never leave the store in
 * an indeterminate state — degrade to `system` and move on.
 */
function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * Validator for the notification_time column. We accept `HH:MM` with
 * either a one- or two-digit hour (00–23) and two-digit minute (00–59).
 * Anything else degrades to the default.
 */
function isValidNotificationTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return (
    Number.isInteger(hour) &&
    hour >= 0 &&
    hour <= 23 &&
    Number.isInteger(minute) &&
    minute >= 0 &&
    minute <= 59
  );
}

export interface SettingsState {
  /** Daily spend notification time in 24h HH:MM format. */
  notificationTime: string;
  /** Master toggle for every local notification the app schedules. */
  notificationsEnabled: boolean;
  /** User-selected theme mode. */
  theme: ThemeMode;
  /** Onboarding version the user last saw — used for onboarding migrations. */
  onboardingVersion: number;
  /** True after the initial hydrate from SQLite resolves. */
  hydrated: boolean;
}

export interface SettingsActions {
  /**
   * Pull settings from SQLite into memory. Called once during app
   * boot. Bypasses write-through by design. Safe to call more than
   * once — a re-hydrate resolves conflicts that would otherwise
   * require a cold restart.
   */
  hydrate: () => Promise<void>;

  /**
   * Update the daily notification time (HH:MM, 24h). Rejects
   * malformed inputs before any SQLite call — the repo should never
   * have to defend against `"25:99"`.
   */
  setNotificationTime: (time: string) => Promise<void>;

  /**
   * Toggle notifications on or off. The scheduler (Phase 12) watches
   * this flag and cancels every scheduled ID range when it flips to
   * false. This store does NOT call the scheduler itself — see the
   * module header note about the scheduler seam.
   */
  setNotificationsEnabled: (enabled: boolean) => Promise<void>;

  /**
   * Switch the active theme preference. Writes through to SQLite,
   * mirrors into Capacitor Preferences (for the first-paint cache),
   * and updates in-memory state. The ThemeProvider subscribes to
   * the store and pushes the change onto <html data-theme> in the
   * same tick — callers don't need to do anything extra.
   */
  setTheme: (theme: ThemeMode) => Promise<void>;

  /**
   * Reset to defaults. In-memory only — the destructive reset
   * pipeline (db/reset.ts) wipes SQLite and Preferences separately.
   */
  reset: () => void;
}

export type SettingsStore = SettingsState & SettingsActions;

/**
 * Hard-coded fallback time. Mirrors the DEFAULT in migration 001 and
 * the DEFAULT_SETTINGS constant in repositories.ts — keep all three
 * in sync if you ever change it.
 */
export const DEFAULT_NOTIFICATION_TIME = "21:00";

const INITIAL_STATE: SettingsState = {
  notificationTime: DEFAULT_NOTIFICATION_TIME,
  notificationsEnabled: true,
  theme: "system",
  onboardingVersion: 1,
  hydrated: false,
};

export const useSettingsStore = create<SettingsStore>((set) => ({
  ...INITIAL_STATE,

  hydrate: async () => {
    // settingsRepo.get() self-heals a missing singleton row by
    // re-seeding defaults, so this call never returns null.
    const record = await settingsRepo.get();

    // Trust-but-verify at the boundary. A legacy install with an
    // unexpected theme string should not leave the UI in limbo.
    const theme: ThemeMode = isThemeMode(record.theme) ? record.theme : "system";
    const notificationTime = isValidNotificationTime(record.notificationTime)
      ? record.notificationTime
      : DEFAULT_NOTIFICATION_TIME;

    set({
      notificationTime,
      notificationsEnabled: record.notificationsEnabled,
      theme,
      onboardingVersion: record.onboardingVersion,
      hydrated: true,
    });

    // Refresh the first-paint mirror so a cold boot on the next
    // launch lands on the right theme before SQLite opens. Cheap —
    // a single preference write per boot.
    await prefs.setString(PreferenceKey.ThemePreferenceCache, theme);
  },

  /* -----------------------------
   * Notification time
   * ----------------------------- */

  setNotificationTime: async (time) => {
    if (!isValidNotificationTime(time)) {
      throw new Error(
        `settingsStore.setNotificationTime: invalid time "${time}" (expected HH:MM, 24h)`,
      );
    }

    await settingsRepo.update({ notificationTime: time });
    set((prev) => ({ ...prev, notificationTime: time }));
  },

  /* -----------------------------
   * Notifications master toggle
   * ----------------------------- */

  setNotificationsEnabled: async (enabled) => {
    await settingsRepo.update({ notificationsEnabled: enabled });
    set((prev) => ({ ...prev, notificationsEnabled: enabled }));
  },

  /* -----------------------------
   * Theme
   * ----------------------------- */

  setTheme: async (theme) => {
    if (!isThemeMode(theme)) {
      throw new Error(`settingsStore.setTheme: invalid theme "${String(theme)}"`);
    }

    // Write-through order: authoritative storage first, then cache,
    // then in-memory. If any step throws before the in-memory update,
    // the UI continues to reflect the previous state and the caller
    // receives the error — no partial apply, no flash.
    await settingsRepo.update({ theme });
    await prefs.setString(PreferenceKey.ThemePreferenceCache, theme);

    set((prev) => ({ ...prev, theme }));

    // ThemeProvider subscribes to this store via `useTheme()` hooks
    // at the component layer; it picks up the change in the same
    // render pass and pushes <html data-theme> + status-bar sync.
    // Nothing explicit to do here — the seam is intentional.
  },

  /* -----------------------------
   * Lifecycle
   * ----------------------------- */

  reset: () => {
    // In-memory only. The reset pipeline in db/reset.ts handles the
    // SQLite wipe and preferences clear; calling the repo here would
    // double-fire and race the pipeline's ordering guarantees.
    set({ ...INITIAL_STATE, hydrated: true });
  },
}));
