/**
 * theme/ThemeProvider.tsx — active theme orchestrator.
 *
 * Source of truth: CLAUDE.md §3 (Design System) + Appendix H (status bar
 * follows the active theme).
 *
 * Responsibilities:
 *   - Own the current theme preference (`light` | `dark` | `system`).
 *   - Resolve the preference to an effective mode (`light` | `dark`) by
 *     consulting `prefers-color-scheme` when the user has chosen `system`.
 *   - Write the effective mode onto <html> as `data-theme`, which every
 *     token override in src/theme/tokens.css and src/theme/variables.css
 *     keys off. This keeps theming CSS-driven — no JS-side colour math.
 *   - Sync the native status bar style + background so the system chrome
 *     matches the app surface on both iOS and Android.
 *   - Expose a React context so any component can read the current theme
 *     and flip it (Settings screen, future theme-picker in the style guide).
 *
 * Design rules:
 *   - This provider does NOT persist the user's choice. Persistence lives
 *     in settingsStore (Phase 4) which will call `setTheme()` after it
 *     writes through to SQLite. On app boot, the store will push its
 *     hydrated value in via `setTheme()`. Until then, we default to
 *     `system` which is the correct zero-config behaviour.
 *   - The status-bar call is best-effort. On web (Vite dev server) the
 *     plugin is a no-op and must never throw a visible error.
 *   - The `system` preference subscribes to `prefers-color-scheme` so the
 *     app flips when the OS flips, without a relaunch.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { Capacitor } from "@capacitor/core";
import { StatusBar, Style as StatusBarStyle } from "@capacitor/status-bar";

/** User-facing theme preference. Persisted in the settings table. */
export type ThemePreference = "light" | "dark" | "system";

/** Effective theme after resolving `system` against OS preference. */
export type EffectiveTheme = "light" | "dark";

export interface ThemeContextValue {
  /** The stored preference as chosen by the user (or the default). */
  preference: ThemePreference;
  /** The resolved mode actually applied to `<html data-theme>`. */
  effective: EffectiveTheme;
  /** Update the preference. Does NOT persist — Settings layer handles that. */
  setTheme: (preference: ThemePreference) => void;
  /** Convenience: cycles light → dark → system → light. Used by the style guide. */
  cycleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Background tokens used to match the status bar to the active surface. */
const STATUS_BAR_BG: Record<EffectiveTheme, string> = {
  // Mirrors --color-bg from src/theme/tokens.css. Kept in sync by eye —
  // if the token ever diverges from the raw hex, update both.
  light: "#F8F9FA",
  dark: "#121212",
};

/**
 * Resolves a preference against the current OS preference. Pure helper so
 * it can be unit-tested without mounting the provider.
 */
function resolveEffective(preference: ThemePreference): EffectiveTheme {
  if (preference === "light" || preference === "dark") {
    return preference;
  }
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
}

/**
 * Applies the effective theme to the <html> element. A function instead
 * of an effect so the first paint already carries the right attribute —
 * no flash of wrong-theme content on cold start.
 */
function applyThemeAttribute(effective: EffectiveTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", effective);
  // `color-scheme` lets the browser pick matching scrollbars and form
  // control defaults — cheap polish that costs nothing to set here.
  document.documentElement.style.colorScheme = effective;
}

/**
 * Syncs the native status bar to match the effective theme. Best-effort:
 * runs only on native platforms, swallows any plugin error so a missing
 * capability never surfaces to the user.
 */
async function syncStatusBar(effective: EffectiveTheme): Promise<void> {
  const platform = Capacitor.getPlatform();
  if (platform !== "ios" && platform !== "android") return;
  try {
    await StatusBar.setStyle({
      // "Light" style = light text on dark bg; "Dark" = dark text on light bg.
      style: effective === "dark" ? StatusBarStyle.Light : StatusBarStyle.Dark,
    });
    if (platform === "android") {
      await StatusBar.setBackgroundColor({ color: STATUS_BAR_BG[effective] });
    }
  } catch {
    // Non-fatal: see module header. A missing/denied plugin is fine.
  }
}

export interface ThemeProviderProps {
  /**
   * Initial preference before the settings store hydrates. Defaults to
   * `system`, which is the right behaviour for first-launch and for the
   * brief window before SQLite returns.
   */
  initialPreference?: ThemePreference;
  children: ReactNode;
}

/**
 * Wraps the app and keeps the document + status bar in sync with the
 * active theme. Mount once at the root, just inside <IonApp>.
 */
export const ThemeProvider: React.FC<ThemeProviderProps> = ({
  initialPreference = "system",
  children,
}) => {
  const [preference, setPreference] = useState<ThemePreference>(initialPreference);
  const [effective, setEffective] = useState<EffectiveTheme>(() =>
    resolveEffective(initialPreference),
  );

  // Apply the attribute synchronously on every effective-mode change so
  // CSS custom properties flip in the same frame as the state update.
  useEffect(() => {
    applyThemeAttribute(effective);
    void syncStatusBar(effective);
  }, [effective]);

  // Re-resolve whenever the preference changes.
  useEffect(() => {
    setEffective(resolveEffective(preference));
  }, [preference]);

  // When the user has chosen `system`, follow live OS flips.
  useEffect(() => {
    if (preference !== "system") return;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => setEffective(resolveEffective("system"));

    // Older Safari uses addListener/removeListener; modern browsers use
    // addEventListener. Prefer the modern API, fall back gracefully.
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", handler);
      return () => mql.removeEventListener("change", handler);
    }
    mql.addListener(handler);
    return () => mql.removeListener(handler);
  }, [preference]);

  const setTheme = useCallback((next: ThemePreference) => {
    setPreference(next);
  }, []);

  const cycleTheme = useCallback(() => {
    setPreference((current) =>
      current === "light" ? "dark" : current === "dark" ? "system" : "light",
    );
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, effective, setTheme, cycleTheme }),
    [preference, effective, setTheme, cycleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

/**
 * Hook accessor. Throws when used outside <ThemeProvider> — that's a
 * programming error, not a runtime condition, so throwing is correct.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme() must be used inside <ThemeProvider>.");
  }
  return ctx;
}

/**
 * Re-export the pure resolver so tests and non-React call sites (e.g.
 * the settings store's boot hydration) can compute the effective mode
 * without mounting the provider.
 */
export { resolveEffective };
