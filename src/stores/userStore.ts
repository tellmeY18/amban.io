/**
 * stores/userStore.ts — user profile + onboarding state.
 *
 * Source of truth: CLAUDE.md §5 (Data Models → Zustand Store Shapes)
 * and §6.1 (Onboarding Flow).
 *
 * Responsibilities:
 *   - Hydrate from the `user` table on app boot via userRepo.get().
 *   - Write through to SQLite on every mutation — SQLite is always
 *     the source of truth; in-memory state is a cache of it.
 *   - Expose the onboardingComplete flag that gates routing in Phase 6.
 *   - Keep the onboarding_complete preference mirror in sync so the
 *     router can gate synchronously on boot without waiting on SQLite
 *     to open (per §13.8 resumability).
 *
 * Design rules:
 *   - UI reads from this store, never from the DB directly. Any new
 *     selector should live here or in a hook, not as a stray repo call.
 *   - Write-through order: SQLite first, then in-memory. A failed
 *     write must NOT update the in-memory state — the two views
 *     staying consistent is the whole point of the pattern.
 *   - `hydrate` is the ONE method allowed to bypass write-through;
 *     it's the boot path that pulls state out of SQLite into memory.
 *   - `reset` is called by the destructive reset pipeline in db/reset.ts.
 *     It does NOT touch SQLite — the pipeline handles that separately.
 */

import { create } from "zustand";

import { onboardingFlags } from "../db/preferences";
import { userRepo } from "../db/repositories";

export interface UserState {
  /** Display name, captured in onboarding Step 2. */
  name: string;
  /** ISO 4217 currency code. v1 is INR-only but stored for future use. */
  currency: string;
  /** Optional emoji picked during onboarding. */
  emoji: string | null;
  /** True once the user has completed every onboarding step. */
  onboardingComplete: boolean;
  /** True after the initial hydrate from SQLite resolves. */
  hydrated: boolean;
}

export interface UserActions {
  /**
   * Pull state from SQLite into memory. Called once during app boot.
   * Bypasses write-through by design. Safe to call more than once —
   * a re-hydrate from disk is sometimes useful after a conflict.
   */
  hydrate: () => Promise<void>;

  /**
   * Patch the user profile. Writes to SQLite first, then updates
   * in-memory state. Creates the user row on first call via upsert —
   * this is how onboarding Step 2 lands.
   */
  setUser: (data: Partial<Pick<UserState, "name" | "currency" | "emoji">>) => Promise<void>;

  /**
   * Mark onboarding as complete. Updates BOTH the SQLite row AND the
   * Capacitor Preferences mirror so the router can gate on first paint
   * before SQLite is open.
   */
  completeOnboarding: () => Promise<void>;

  /**
   * Reset to initial state. In-memory only — the destructive reset
   * pipeline (db/reset.ts) wipes SQLite separately.
   */
  reset: () => void;
}

export type UserStore = UserState & UserActions;

const INITIAL_STATE: UserState = {
  name: "",
  currency: "INR",
  emoji: null,
  onboardingComplete: false,
  hydrated: false,
};

export const useUserStore = create<UserStore>((set, get) => ({
  ...INITIAL_STATE,

  hydrate: async () => {
    // The user row is absent until onboarding Step 2 creates it.
    // A null here is the signal that onboarding hasn't started —
    // leave the store at its initial blank state and flip `hydrated`.
    const record = await userRepo.get();
    if (!record) {
      set({ ...INITIAL_STATE, hydrated: true });
      return;
    }

    set({
      name: record.name,
      currency: record.currency,
      emoji: record.emoji,
      onboardingComplete: record.onboardingComplete,
      hydrated: true,
    });
  },

  setUser: async (data) => {
    const state = get();

    // Resolve the full target shape BEFORE writing. This makes the
    // upsert deterministic and keeps the SQLite row's columns in sync
    // whether we're creating or updating.
    const next = {
      name: data.name ?? state.name,
      currency: data.currency ?? state.currency,
      emoji: data.emoji === undefined ? state.emoji : data.emoji,
    };

    // A name is required at the SQLite layer (NOT NULL). Guard here
    // so onboarding Step 2 can't accidentally land an empty row.
    if (!next.name || next.name.trim().length === 0) {
      throw new Error("userStore.setUser: name is required");
    }

    // Write-through. Upsert handles both first-time create (onboarding
    // Step 2) and subsequent edits (Settings → profile). The
    // onboardingComplete flag is threaded through so re-saving profile
    // details after onboarding doesn't regress the flag.
    await userRepo.upsert({
      name: next.name,
      currency: next.currency,
      emoji: next.emoji,
      onboardingComplete: state.onboardingComplete,
    });

    set((prev) => ({
      ...prev,
      name: next.name,
      currency: next.currency,
      emoji: next.emoji,
    }));
  },

  completeOnboarding: async () => {
    // SQLite first, so a crash between the two writes leaves the
    // authoritative source reflecting reality. The Preferences mirror
    // is an optimisation for boot-path gating — if it's briefly stale
    // the worst case is an extra SQLite read on next launch.
    await userRepo.markOnboardingComplete();
    await onboardingFlags.markComplete();

    set((prev) => ({ ...prev, onboardingComplete: true }));
  },

  reset: () => {
    // In-memory only. The reset pipeline in db/reset.ts handles the
    // SQLite wipe and preferences clear; calling those here would
    // double-fire and race the pipeline's ordering guarantees.
    set({ ...INITIAL_STATE, hydrated: true });
  },
}));
