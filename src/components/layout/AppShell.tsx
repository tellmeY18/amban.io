/**
 * components/layout/AppShell.tsx — top-level chrome wrapper.
 *
 * Source of truth: CLAUDE.md §4 (App Architecture) and §9.1 (Home Screen
 * — the bottom navigation sits at the root of the authenticated app).
 *
 * Responsibilities:
 *   - Render the four-tab <BottomNav> beneath every post-onboarding screen.
 *   - Provide a single content container that respects the safe-area
 *     insets on iOS (notch + home indicator) and Android (gesture area)
 *     and leaves enough bottom padding for the nav bar.
 *   - Catch render errors with a local boundary so a single screen crash
 *     cannot blank out the entire app. The full "migration failure / reset"
 *     escape hatch lands in Phase 6; this is the scaffold it plugs into.
 *
 * What this component does NOT do (yet):
 *   - Splash / boot orchestration. That's Phase 6, once the database and
 *     stores have real hydrate() implementations. Today the shell just
 *     renders — nothing to wait on.
 *   - Onboarding gating. The router decides between the onboarding stack
 *     and this shell; AppShell is rendered only on the authenticated side.
 *   - Deep-link handling. Also Phase 6.
 *
 * Design rules:
 *   - Keep the shell boring. It should add structure, never personality.
 *     Personality lives in the screens it hosts.
 *   - Never read a Zustand store here. AppShell must be reusable from the
 *     StyleGuide route where stores may be empty or mocked.
 *   - All visual values come from src/theme/tokens.css — never hardcode.
 */

import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

import BottomNav from "./BottomNav";
import type { NavTabId } from "./BottomNav";

export interface AppShellProps {
  /**
   * Screen content. Typically an <IonRouterOutlet> mounted by App.tsx,
   * but the StyleGuide route passes plain JSX directly.
   */
  children: ReactNode;
  /**
   * Hide the bottom navigation. Used by screens that deserve the full
   * viewport height (future: fullscreen charts, onboarding reveal). The
   * default is to always show the nav.
   */
  hideNav?: boolean;
  /**
   * Override for which tab the nav should highlight. When omitted the
   * nav derives the active tab from the router's location. Useful for
   * the StyleGuide where the router is parked on a demo route.
   */
  activeTab?: NavTabId;
  /**
   * Optional handler proxied to <BottomNav>. The StyleGuide uses this
   * to react to tab taps without actually navigating.
   */
  onTabSelect?: (id: NavTabId) => void;
  /** Passthrough class for screen-specific tweaks. */
  className?: string;
}

interface BoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Minimal render-error boundary scoped to the shell. Catches failures
 * in the authenticated tree and shows a static fallback with copy that
 * matches the rest of the app's tone.
 *
 * This is intentionally local and bare — the full escape-hatch screen
 * (with "Reset App" action, per CLAUDE.md Appendix I) lives in Phase 6
 * once the reset pipeline is wired. Until then, this boundary exists
 * so a bad render doesn't turn the whole canvas white.
 */
class ShellErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // amban is local-only — no Sentry, no crash reporting (CLAUDE.md §12
    // "No External Calls Policy"). Log to the console so the failure is
    // visible in Xcode / Android Studio during development and in
    // `cap run` sessions. Production builds strip these via minifier.
    console.error("[amban] shell boundary caught:", error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <main
        role="alert"
        aria-live="assertive"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--space-md)",
          minHeight: "100dvh",
          padding: "var(--space-xl) var(--space-lg)",
          textAlign: "center",
          color: "var(--text-strong)",
          backgroundColor: "var(--surface-base)",
        }}
      >
        <h1
          style={{
            fontSize: "var(--text-h1)",
            fontWeight: "var(--font-weight-bold)",
            margin: 0,
          }}
        >
          Something went sideways.
        </h1>
        <p
          style={{
            fontSize: "var(--text-body)",
            color: "var(--text-muted)",
            maxWidth: "36ch",
          }}
        >
          A screen failed to render. Your data is safe — nothing was sent anywhere. Try restarting
          the app.
        </p>
        {this.state.error ? (
          <pre
            style={{
              marginTop: "var(--space-md)",
              padding: "var(--space-sm) var(--space-md)",
              backgroundColor: "var(--surface-sunken)",
              color: "var(--text-muted)",
              fontSize: "var(--text-caption)",
              borderRadius: "var(--radius-sm)",
              maxWidth: "100%",
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {this.state.error.message}
          </pre>
        ) : null}
      </main>
    );
  }
}

/**
 * The authenticated-surface wrapper. Mount once at the top of the
 * post-onboarding router branch; screens render as children.
 */
const AppShell: React.FC<AppShellProps> = ({
  children,
  hideNav = false,
  activeTab,
  onTabSelect,
  className,
}) => {
  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100dvh",
        width: "100%",
        backgroundColor: "var(--surface-base)",
        color: "var(--text-strong)",
        // Respect the notch and gesture area at the top; the nav takes
        // care of the bottom safe-area inset itself.
        paddingTop: "env(safe-area-inset-top, 0px)",
      }}
    >
      <ShellErrorBoundary>
        <main
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            width: "100%",
            // Leave room for the fixed bottom nav so scrollable content
            // doesn't hide under it. When the nav is hidden, no padding
            // is added. The extra safe-area inset keeps modern gesture
            // bars from clipping the last row of content.
            paddingBottom: hideNav
              ? "env(safe-area-inset-bottom, 0px)"
              : "calc(var(--bottom-nav-height) + env(safe-area-inset-bottom, 0px))",
          }}
        >
          {children}
        </main>
      </ShellErrorBoundary>

      {hideNav ? null : <BottomNav activeOverride={activeTab} onTabSelect={onTabSelect} />}
    </div>
  );
};

export default AppShell;
