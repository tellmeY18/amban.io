/**
 * components/layout/BottomNav.tsx — four-tab bottom navigation.
 *
 * Source of truth: CLAUDE.md §4 (App Architecture) and §9.1 (Home Screen
 * bottom navigation layout). The four root tabs are:
 *   1. Home      — /home
 *   2. Log       — /log
 *   3. Insights  — /insights
 *   4. Settings  — /settings
 *
 * Design rules:
 *   - Pure presentational component. Route matching is done via
 *     react-router's `useLocation`; navigation fires through `useHistory`.
 *     No store reads here — the nav has no finance state of its own.
 *   - Token-driven styling. Every colour, spacing, and elevation value
 *     comes from src/theme/tokens.css so light/dark flips are free.
 *   - Respects the safe-area inset on iOS so the home indicator doesn't
 *     clip the touch targets on notched devices.
 *   - Each tab is a <button>, not an <a>, because Ionic's router handles
 *     navigation imperatively and we want the tap target to have the
 *     correct role without double-handling.
 *   - Active tab swaps the outline icon for the filled variant per the
 *     icons.ts convention; the label colour shifts to --color-primary.
 *   - Haptic selection tick fires on every tap — matches Appendix F's
 *     "selection" category for lightweight navigation moments.
 *
 * This file is imported by AppShell (Phase 6). It's safe to render
 * earlier in the style guide, where nothing about the navigation will
 * route — taps still fire, they just land on placeholder pages.
 */

import { IonIcon } from "@ionic/react";
import { useHistory, useLocation } from "react-router-dom";
import { useCallback, useMemo } from "react";
import type { CSSProperties } from "react";

import { Icons } from "../../theme/icons";
import { haptics } from "../../utils/haptics";

/** Stable identifier for each tab. Used by tests and analytics (never shipped). */
export type NavTabId = "home" | "log" | "insights" | "settings";

interface NavTabDefinition {
  id: NavTabId;
  /** Route path the tab navigates to. */
  path: string;
  /** Visible label rendered below the icon. */
  label: string;
  /** Ionicon for the inactive (resting) state. */
  icon: string;
  /** Ionicon for the active (selected) state. */
  iconActive: string;
  /**
   * Matcher predicate. Returns true when the given pathname should
   * highlight this tab. Kept as a function so nested routes (e.g.
   * `/log/history`) can still light up the Log tab.
   */
  matches: (pathname: string) => boolean;
}

/**
 * Tab definitions in left-to-right display order. The order is fixed —
 * changing it would break muscle memory. Add new tabs at the end, never
 * in the middle.
 */
const NAV_TABS: ReadonlyArray<NavTabDefinition> = [
  {
    id: "home",
    path: "/home",
    label: "Home",
    icon: Icons.nav.home,
    iconActive: Icons.nav.homeActive,
    matches: (pathname) => pathname === "/" || pathname.startsWith("/home"),
  },
  {
    id: "log",
    path: "/log",
    label: "Log",
    icon: Icons.nav.log,
    iconActive: Icons.nav.logActive,
    matches: (pathname) => pathname.startsWith("/log"),
  },
  {
    id: "insights",
    path: "/insights",
    label: "Insights",
    icon: Icons.nav.insights,
    iconActive: Icons.nav.insightsActive,
    matches: (pathname) => pathname.startsWith("/insights"),
  },
  {
    id: "settings",
    path: "/settings",
    label: "Settings",
    icon: Icons.nav.settings,
    iconActive: Icons.nav.settingsActive,
    matches: (pathname) => pathname.startsWith("/settings"),
  },
];

export interface BottomNavProps {
  /**
   * Optional override for the "currently active" tab. When omitted the
   * nav derives the active tab from `useLocation()`. Useful for the
   * StyleGuide preview where the router location isn't meaningful.
   */
  activeOverride?: NavTabId;
  /**
   * Optional handler fired whenever a tab is tapped. Receives the id
   * before navigation happens. Used by the StyleGuide to demo the
   * selection haptic without routing away from the demo screen.
   */
  onTabSelect?: (id: NavTabId) => void;
  /** Passthrough class for screen-specific tweaks. */
  className?: string;
}

/**
 * Renders the sticky four-tab bar at the bottom of the app. The host
 * (AppShell) is responsible for pushing enough padding to the main
 * content area so the nav never occludes scrollable content.
 */
const BottomNav: React.FC<BottomNavProps> = ({ activeOverride, onTabSelect, className }) => {
  const history = useHistory();
  const location = useLocation();

  // Resolve which tab is active. An explicit override wins; otherwise
  // we match against the current pathname.
  const activeId = useMemo<NavTabId>(() => {
    if (activeOverride) return activeOverride;
    const match = NAV_TABS.find((tab) => tab.matches(location.pathname));
    return match?.id ?? "home";
  }, [activeOverride, location.pathname]);

  const handleTap = useCallback(
    (tab: NavTabDefinition) => {
      // Selection tick for every tab tap. Appendix F categorises tab
      // switching as a "selection" moment — light, non-committal.
      void haptics.selection();
      onTabSelect?.(tab.id);
      // Avoid a history entry per re-tap of the same tab; Ionic's own
      // router does not consider that a navigation either.
      if (location.pathname !== tab.path) {
        history.push(tab.path);
      }
    },
    [history, location.pathname, onTabSelect],
  );

  const navStyle = useMemo<CSSProperties>(
    () => ({
      position: "fixed",
      left: 0,
      right: 0,
      bottom: 0,
      display: "flex",
      alignItems: "stretch",
      justifyContent: "space-around",
      height: "var(--bottom-nav-height)",
      // Pad up to the home indicator / gesture area on iOS.
      paddingBottom: "env(safe-area-inset-bottom, 0px)",
      backgroundColor: "var(--surface-raised)",
      borderTop: "1px solid var(--divider)",
      // Lifts the bar visually off the content. We don't use the heavy
      // --shadow-elevated token — the nav shouldn't scream for attention.
      boxShadow: "0 -1px 0 rgba(0, 0, 0, 0.02), 0 -8px 20px rgba(0, 0, 0, 0.04)",
      zIndex: 10,
    }),
    [],
  );

  return (
    <nav className={className} style={navStyle} role="navigation" aria-label="Primary">
      {NAV_TABS.map((tab) => {
        const isActive = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => handleTap(tab)}
            aria-label={tab.label}
            aria-current={isActive ? "page" : undefined}
            // Inline style keeps the component self-contained; swap to
            // CSS Modules later if any of this grows a second variant.
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "var(--space-xs)",
              minHeight: "var(--hit-target-min)",
              minWidth: "var(--hit-target-min)",
              padding: "var(--space-sm) var(--space-xs)",
              background: "transparent",
              border: "none",
              color: isActive ? "var(--color-primary)" : "var(--text-muted)",
              cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
              transition:
                "color var(--motion-fast) var(--motion-ease), transform var(--motion-fast) var(--motion-ease)",
              // A subtle lift on the active tab helps the filled icon
              // read as selected without needing an accent pill.
              transform: isActive ? "translateY(-1px)" : "translateY(0)",
            }}
          >
            <IonIcon
              icon={isActive ? tab.iconActive : tab.icon}
              aria-hidden="true"
              style={{
                fontSize: "1.5rem",
                // Override the Ionic default so the icon inherits the
                // button colour (tokens, not hardcoded).
                color: "currentColor",
              }}
            />
            <span
              style={{
                fontSize: "var(--text-micro)",
                fontWeight: isActive ? "var(--font-weight-semibold)" : "var(--font-weight-medium)",
                letterSpacing: "0.02em",
                lineHeight: 1,
              }}
            >
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};

export default BottomNav;

/**
 * Exported for tests and for the StyleGuide overlay that wants to
 * render every tab state side-by-side. Not intended as a general API.
 */
export { NAV_TABS };
