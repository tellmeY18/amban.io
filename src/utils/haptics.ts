/**
 * utils/haptics.ts — centralized haptic feedback.
 *
 * Source of truth: CLAUDE.md Appendix F (Haptics & Micro-interactions).
 *
 * Every haptic call in the app flows through this module. Callers use
 * the named helpers (`haptics.success()`, `haptics.tapLight()`, etc.)
 * so the interaction → haptic mapping from Appendix F lives in exactly
 * one place and can be audited in Phase 14.
 *
 * Design rules:
 *   - Never call `@capacitor/haptics` directly from components. Always
 *     route through this module — the grep target is the whole point.
 *   - Respect the user's reduce-motion preference. When the OS requests
 *     reduced motion, every helper in here becomes a no-op. Haptics are
 *     a motion-adjacent affordance, and users who opt out of motion
 *     tend to also want a quieter device experience.
 *   - Be web-safe. On the Vite dev server (non-Capacitor web context)
 *     the plugin throws on some platforms; we swallow errors instead of
 *     letting a missing plugin crash the app during development.
 *   - Never throw. A failed haptic is never a user-facing failure.
 */

import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

/**
 * Reads the OS-level reduce-motion preference. Returns false on
 * environments without `matchMedia` (server rendering, older WebViews).
 *
 * Not memoised — the value is read on every haptic call so the gate
 * reflects live OS changes without needing a subscription.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * True when haptics can actually fire. The Capacitor Haptics plugin is
 * only meaningful on native iOS/Android; on the web it's a no-op at
 * best and a throw at worst. We gate on the platform AND on reduce-
 * motion so both opt-outs are honoured.
 */
function canFire(): boolean {
  if (prefersReducedMotion()) return false;
  const platform = Capacitor.getPlatform();
  return platform === "ios" || platform === "android";
}

/**
 * Low-level invoker that wraps every plugin call in a try/catch so a
 * missing plugin, a denied permission, or a device that silently
 * refuses to vibrate never bubbles up as a render error.
 */
async function safeCall(fn: () => Promise<unknown>): Promise<void> {
  if (!canFire()) return;
  try {
    await fn();
  } catch {
    // Haptic failures are non-fatal by design. See module header.
  }
}

/**
 * Named haptic helpers. The mapping below is the canonical lookup for
 * Appendix F — if a mapping changes there, update it here and nowhere
 * else.
 *
 * Usage:
 *   import { haptics } from "@/utils/haptics";
 *   haptics.success();         // daily spend saved under score
 *   haptics.warning();         // daily spend saved over score
 *   haptics.tapLight();        // onboarding step completed
 *   haptics.tapMedium();       // balance updated
 *   haptics.selection();       // swipe-dismiss insight, quick-amount tap
 *   haptics.error();           // reset app confirmed
 */
export const haptics = {
  /** Light impact — onboarding step completed. Appendix F. */
  tapLight(): Promise<void> {
    return safeCall(() => Haptics.impact({ style: ImpactStyle.Light }));
  },

  /** Medium impact — balance updated, primary CTA committed. Appendix F. */
  tapMedium(): Promise<void> {
    return safeCall(() => Haptics.impact({ style: ImpactStyle.Medium }));
  },

  /** Heavy impact — reserved for big, rare moments (score reveal). */
  tapHeavy(): Promise<void> {
    return safeCall(() => Haptics.impact({ style: ImpactStyle.Heavy }));
  },

  /** Success notification — daily spend saved under the score. */
  success(): Promise<void> {
    return safeCall(() => Haptics.notification({ type: NotificationType.Success }));
  },

  /** Warning notification — daily spend saved over the score. */
  warning(): Promise<void> {
    return safeCall(() => Haptics.notification({ type: NotificationType.Warning }));
  },

  /** Error notification — reset app confirmed, destructive action fired. */
  error(): Promise<void> {
    return safeCall(() => Haptics.notification({ type: NotificationType.Error }));
  },

  /**
   * Selection tick — quick-amount chip tap, insight swipe-dismiss, any
   * "I picked something" interaction that doesn't commit a state change.
   */
  selection(): Promise<void> {
    return safeCall(() => Haptics.selectionStart());
  },
} as const;

/**
 * Re-exported for tests and for the rare screen that needs to branch
 * on the reduce-motion preference for non-haptic reasons (e.g. pausing
 * the insight carousel). Most code should not need this.
 */
export { prefersReducedMotion };

/**
 * Type alias for consumers that want to accept a haptic helper by
 * name rather than by reference.
 */
export type HapticKind = keyof typeof haptics;
