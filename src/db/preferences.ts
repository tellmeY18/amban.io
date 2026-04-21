/**
 * db/preferences.ts — typed facade over @capacitor/preferences.
 *
 * Source of truth: CLAUDE.md §12 (Local Storage Strategy → Secondary:
 * Capacitor Preferences) and Appendix J (Migration Strategy).
 *
 * Why a facade:
 *   - Every key the app reads or writes is declared here ONCE as a
 *     member of the `PreferenceKey` enum-like object. Grep for a key
 *     and you see every call site. Rename a key and TypeScript flags
 *     every usage automatically.
 *   - Values are serialized / deserialized consistently. The underlying
 *     plugin speaks strings only; this module shields the rest of the
 *     app from having to remember that.
 *   - Failures are swallowed intentionally. Preferences are best-effort
 *     key-value storage — never the source of truth for user data. If
 *     a read fails, callers receive the default; if a write fails, we
 *     log and move on. The authoritative store is SQLite (see db.ts).
 *   - On the Vite dev server the Capacitor plugin falls back to
 *     localStorage automatically, so this facade works uniformly on
 *     native iOS, native Android, and the web build.
 *
 * Rules of the road:
 *   - Do NOT call `Preferences.get/set/remove/clear` anywhere else in
 *     the app. Go through the helpers in this file so the key catalog
 *     stays the single source of truth.
 *   - Do NOT store user finance data here. Preferences are for tiny,
 *     non-sensitive flags: schema version, onboarding progress,
 *     dismissed insights, last-scheduled date, etc. Anything that
 *     belongs in a table belongs in SQLite.
 *   - Keep values small. The plugin backs onto UserDefaults (iOS) and
 *     SharedPreferences (Android), neither of which is meant for blobs.
 */

import { Preferences } from "@capacitor/preferences";

/**
 * Catalog of every preference key the app uses.
 *
 * Keys are prefixed with `amban.` so they never collide with any other
 * library that might reach into the same storage backend on the web
 * fallback path (localStorage is a flat namespace per origin).
 *
 * Ordering groups related keys together; the string values are what
 * actually hits storage and must never change once shipped — add a
 * new key and a migration step, don't rename.
 */
export const PreferenceKey = {
  // ---- Migration / lifecycle ----
  /** Integer string — the last applied SQLite migration number. */
  SchemaVersion: "amban.schema_version",
  /** ISO timestamp — when migrations last finished successfully. */
  LastMigrationAt: "amban.last_migration_at",
  /** '1' when the migration runner crashed mid-run; blocks normal boot. */
  MigrationFailed: "amban.migration_failed",
  /** Error message captured when migrations failed. Cleared on success. */
  MigrationError: "amban.migration_error",

  // ---- Onboarding ----
  /** '1' once the user has completed every onboarding step. */
  OnboardingComplete: "amban.onboarding_complete",
  /** Integer string — highest onboarding step the user has reached. */
  OnboardingStep: "amban.onboarding_step",
  /** JSON blob — partial onboarding inputs (resumability per §13.8). */
  OnboardingDraft: "amban.onboarding_draft",

  // ---- Notifications ----
  /** ISO date — last day on which the scheduler ran a full reschedule. */
  LastNotificationScheduleDate: "amban.last_notification_schedule_date",
  /** '1' if the user has ever granted notification permission. */
  NotificationsPermissionGranted: "amban.notifications_permission_granted",

  // ---- Insights ----
  /** JSON array — dismissed insight records (id + timestamp). */
  DismissedInsights: "amban.dismissed_insights",

  // ---- App metadata ----
  /** Semver string — last app version that completed boot. */
  LastSeenAppVersion: "amban.last_seen_app_version",

  // ---- Theme bootstrap ----
  /**
   * Cached theme preference read synchronously on first paint BEFORE
   * SQLite is ready. Settings store remains the source of truth; this
   * mirror only exists to avoid a theme flash on cold start.
   */
  ThemePreferenceCache: "amban.theme_preference_cache",
} as const;

export type PreferenceKey = (typeof PreferenceKey)[keyof typeof PreferenceKey];

/* ------------------------------------------------------------------
 * Low-level string I/O
 *
 * These are intentionally not exported — callers use the typed helpers
 * further down. Keeping the raw path private preserves the contract
 * that every read/write flows through the serializer.
 * ------------------------------------------------------------------ */

async function readString(key: PreferenceKey): Promise<string | null> {
  try {
    const { value } = await Preferences.get({ key });
    return value;
  } catch (error) {
    // Log and fall through. Preferences are best-effort — a read
    // failure must not crash boot or any subsequent user flow.
    console.warn(`[amban.prefs] read failed for ${key}:`, error);
    return null;
  }
}

async function writeString(key: PreferenceKey, value: string): Promise<void> {
  try {
    await Preferences.set({ key, value });
  } catch (error) {
    console.warn(`[amban.prefs] write failed for ${key}:`, error);
  }
}

async function removeKey(key: PreferenceKey): Promise<void> {
  try {
    await Preferences.remove({ key });
  } catch (error) {
    console.warn(`[amban.prefs] remove failed for ${key}:`, error);
  }
}

/* ------------------------------------------------------------------
 * Typed accessors
 *
 * One helper per primitive so call sites read cleanly and TypeScript
 * narrows the return type automatically.
 * ------------------------------------------------------------------ */

export const prefs = {
  /**
   * Read a raw string value. Returns the default when the key is unset
   * or when the underlying plugin call fails.
   */
  async getString(key: PreferenceKey, defaultValue: string | null = null): Promise<string | null> {
    const raw = await readString(key);
    return raw == null ? defaultValue : raw;
  },

  async setString(key: PreferenceKey, value: string): Promise<void> {
    await writeString(key, value);
  },

  /**
   * Read an integer. Invalid / missing values resolve to `defaultValue`.
   * We store numbers as strings because the plugin's contract is
   * string-only; parsing happens here so the rest of the app sees
   * real numbers.
   */
  async getNumber(key: PreferenceKey, defaultValue = 0): Promise<number> {
    const raw = await readString(key);
    if (raw == null || raw === "") return defaultValue;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : defaultValue;
  },

  async setNumber(key: PreferenceKey, value: number): Promise<void> {
    if (!Number.isFinite(value)) {
      console.warn(`[amban.prefs] refusing to store non-finite number for ${key}`);
      return;
    }
    await writeString(key, String(value));
  },

  /**
   * Read a boolean. We canonicalise on the strings `'1'` and `'0'` —
   * anything else is treated as the default, which prevents stray
   * legacy values (e.g. `'true'`) from ever flipping a flag silently.
   */
  async getBool(key: PreferenceKey, defaultValue = false): Promise<boolean> {
    const raw = await readString(key);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return defaultValue;
  },

  async setBool(key: PreferenceKey, value: boolean): Promise<void> {
    await writeString(key, value ? "1" : "0");
  },

  /**
   * Read a JSON-serialisable value. Returns the default on miss or on
   * parse failure — a corrupt blob must never halt boot. The generic
   * `T` is a promise, not a runtime check; callers that need a guard
   * should validate the parsed shape themselves.
   */
  async getJSON<T>(key: PreferenceKey, defaultValue: T): Promise<T> {
    const raw = await readString(key);
    if (raw == null || raw === "") return defaultValue;
    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      console.warn(`[amban.prefs] JSON parse failed for ${key}:`, error);
      return defaultValue;
    }
  },

  async setJSON<T>(key: PreferenceKey, value: T): Promise<void> {
    try {
      await writeString(key, JSON.stringify(value));
    } catch (error) {
      console.warn(`[amban.prefs] JSON stringify failed for ${key}:`, error);
    }
  },

  /** Remove a single key. No-op when the key isn't set. */
  async remove(key: PreferenceKey): Promise<void> {
    await removeKey(key);
  },

  /**
   * Removes every known amban preference key in one pass. Used by the
   * destructive reset pipeline (Appendix I). Does NOT call
   * `Preferences.clear()` — that would also wipe keys owned by other
   * libraries or plugins co-habiting the same storage.
   */
  async clearAll(): Promise<void> {
    const keys = Object.values(PreferenceKey);
    await Promise.all(keys.map((key) => removeKey(key as PreferenceKey)));
  },

  /**
   * Debug helper — returns every amban-scoped key/value pair currently
   * in storage. Intended for the dev-only inspector in the style guide.
   * Do NOT surface this in production UI; it's fine as a dev affordance
   * but the data inside (though modest) isn't meant for end users.
   */
  async dumpAll(): Promise<Record<string, string | null>> {
    const keys = Object.values(PreferenceKey);
    const entries = await Promise.all(
      keys.map(async (key) => {
        const value = await readString(key as PreferenceKey);
        return [key, value] as const;
      }),
    );
    return Object.fromEntries(entries);
  },
} as const;

/* ------------------------------------------------------------------
 * Convenience aliases for the most common flags.
 *
 * These are thin wrappers whose only value is stronger names at call
 * sites. They document intent ("am I in onboarding?") without hiding
 * the underlying key — if you need to change semantics, edit the
 * wrapper here rather than each caller.
 * ------------------------------------------------------------------ */

export const onboardingFlags = {
  /** True once every onboarding step is complete (§13.8). */
  isComplete: (): Promise<boolean> => prefs.getBool(PreferenceKey.OnboardingComplete, false),
  markComplete: (): Promise<void> => prefs.setBool(PreferenceKey.OnboardingComplete, true),

  /** Highest step index the user has reached. 0 = welcome, 6 = final reveal. */
  getStep: (): Promise<number> => prefs.getNumber(PreferenceKey.OnboardingStep, 0),
  setStep: (step: number): Promise<void> => prefs.setNumber(PreferenceKey.OnboardingStep, step),
} as const;

export const migrationFlags = {
  getVersion: (): Promise<number> => prefs.getNumber(PreferenceKey.SchemaVersion, 0),
  setVersion: (version: number): Promise<void> =>
    prefs.setNumber(PreferenceKey.SchemaVersion, version),

  markFailed: async (message: string): Promise<void> => {
    await prefs.setBool(PreferenceKey.MigrationFailed, true);
    await prefs.setString(PreferenceKey.MigrationError, message);
  },

  markSucceeded: async (): Promise<void> => {
    await prefs.setBool(PreferenceKey.MigrationFailed, false);
    await prefs.remove(PreferenceKey.MigrationError);
    await prefs.setString(PreferenceKey.LastMigrationAt, new Date().toISOString());
  },

  isFailed: (): Promise<boolean> => prefs.getBool(PreferenceKey.MigrationFailed, false),
  getError: (): Promise<string | null> => prefs.getString(PreferenceKey.MigrationError, null),
} as const;
