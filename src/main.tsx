/**
 * main.tsx — process entry point.
 *
 * Source of truth: CLAUDE.md §4 (App Architecture) and §12 (Local
 * Storage Strategy — "on app boot, each store loads its slice from
 * SQLite before the first screen renders").
 *
 * Responsibilities:
 *   - Load the design-token CSS and self-hosted fonts BEFORE mounting
 *     any React tree so the first paint lands on the right typography
 *     and surface tokens.
 *   - Pre-flight the on-device theme by reading the cached theme
 *     preference from Capacitor Preferences and writing <html
 *     data-theme> synchronously. This is the "no flash of wrong
 *     theme" trick — the ThemeProvider still owns the authoritative
 *     state, but we prime <html> before React takes over.
 *   - Run `bootstrapApp()` to open SQLite, apply migrations, and
 *     hydrate every Zustand store. The pipeline never throws; it
 *     resolves to a BootResult the root can branch on.
 *   - Pick the render branch based on the boot outcome:
 *       Ready               → mount <App />, the normal experience.
 *       MigrationFailed     → mount the escape-hatch screen with a
 *                             Reset App affordance per Appendix I.
 *       UnexpectedError     → mount a generic error screen with a
 *                             Retry affordance.
 *   - Keep the splash visible while boot runs, then hide it on the
 *     next frame after the chosen branch has had a chance to paint.
 *
 * Rules of the road:
 *   - Never import screens or stores directly here. main.tsx is a
 *     thin orchestrator; domain logic belongs downstream.
 *   - Every DOM mutation in this file is guarded against SSR
 *     (`typeof document !== 'undefined'`) even though the app only
 *     ships to native + browser runtimes today. Cheap future-proofing.
 *   - The boot pipeline is called EXACTLY ONCE per process. Retry
 *     paths re-render the error branch, which re-mounts an internal
 *     <BootGate> that calls boot again — the pipeline itself is
 *     idempotent (see src/boot.ts), so this is safe.
 */

import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { BootStage, bootstrapApp } from "./boot";
import type { BootResult } from "./boot";
import { resetApp } from "./db/reset";
import { PreferenceKey } from "./db/preferences";

/* Self-hosted fonts (no CDN per local-only policy). Loading these at
 * the entry point means every screen — including the boot splash /
 * error fallback — reads the right family on first paint. */
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";

/* Design tokens — must load before Ionic theme overrides so that the
 * variable bridge in theme/variables.css can reference them. */
import "./theme/tokens.css";
import "./theme/globals.css";

/* ------------------------------------------------------------------
 * First-paint theme priming
 *
 * The Capacitor Preferences API is async even on web, so we can't
 * resolve the cached theme before the first React render without
 * awaiting — and awaiting would leave the splash showing longer.
 * Instead we read the cache via a synchronous hop into localStorage,
 * which is the same backing store Capacitor uses on web. Native
 * platforms skip this path; the splash covers the brief async read
 * that happens when <ThemeProvider> mounts.
 *
 * This is pure UX polish. If anything goes wrong we silently fall
 * back to the "system" preference — which is what the provider would
 * default to anyway.
 * ------------------------------------------------------------------ */

function primeThemeAttributeSync(): void {
  if (typeof document === "undefined" || typeof window === "undefined") return;

  let cached: string | null = null;
  try {
    // Capacitor Preferences on web proxies through localStorage with
    // a known key shape. Reading the same key synchronously sidesteps
    // the async plugin API without relying on it working on native.
    cached = window.localStorage?.getItem(PreferenceKey.ThemePreferenceCache) ?? null;
  } catch {
    // localStorage can throw in private browsing modes. Never fatal.
    cached = null;
  }

  const effective =
    cached === "light" || cached === "dark"
      ? cached
      : (() => {
          // No cached preference (first launch or native platform
          // before ThemeProvider mounts) — fall back to the OS hint.
          try {
            return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
          } catch {
            return "light";
          }
        })();

  document.documentElement.setAttribute("data-theme", effective);
  document.documentElement.style.colorScheme = effective;
}

primeThemeAttributeSync();

/* ------------------------------------------------------------------
 * Splash / error styling
 *
 * Inline styles so the boot path doesn't depend on any CSS module
 * loading. If this file can run, these screens can render.
 * ------------------------------------------------------------------ */

const FALLBACK_WRAPPER_STYLE: React.CSSProperties = {
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
  fontFamily: "var(--font-body)",
};

const FALLBACK_ACTION_STYLE: React.CSSProperties = {
  minHeight: "var(--hit-target-min)",
  padding: "var(--space-sm) var(--space-lg)",
  borderRadius: "var(--radius-md)",
  fontFamily: "var(--font-body)",
  fontSize: "var(--text-body)",
  fontWeight: 600,
  border: "none",
  background: "var(--color-primary)",
  color: "#ffffff",
  cursor: "pointer",
};

const FALLBACK_GHOST_STYLE: React.CSSProperties = {
  ...FALLBACK_ACTION_STYLE,
  background: "transparent",
  color: "var(--text-strong)",
  border: "1px solid var(--divider)",
};

/* ------------------------------------------------------------------
 * Splash — shown while the boot pipeline is running.
 *
 * Deliberately minimal: the native launch splash is still visible on
 * cold start, so this only needs to cover the handoff between the
 * launch image disappearing and the first real screen painting.
 * ------------------------------------------------------------------ */

const BootSplash: React.FC = () => (
  <main style={FALLBACK_WRAPPER_STYLE} aria-busy="true" aria-live="polite">
    <span
      style={{
        fontFamily: "var(--font-display)",
        fontSize: "var(--text-h1)",
        fontWeight: 700,
        letterSpacing: "-0.01em",
      }}
    >
      amban
    </span>
    <small style={{ color: "var(--text-muted)" }}>Getting your number ready…</small>
  </main>
);

/* ------------------------------------------------------------------
 * Migration-failure escape hatch (Appendix I)
 *
 * The only forward path is a destructive reset. No other screen is
 * safe to mount because the database itself is in an unknown state.
 * ------------------------------------------------------------------ */

const MigrationFailureScreen: React.FC<{ error: string | null; onRetry: () => void }> = ({
  error,
  onRetry,
}) => {
  const [working, setWorking] = useState(false);

  const handleReset = async () => {
    if (working) return;
    setWorking(true);
    try {
      await resetApp();
    } finally {
      // Either way, give the user a path back to a working app.
      onRetry();
    }
  };

  return (
    <main style={FALLBACK_WRAPPER_STYLE} role="alert">
      <h1 style={{ fontSize: "var(--text-h1)", fontWeight: 700, margin: 0 }}>
        We couldn't open your data.
      </h1>
      <p style={{ color: "var(--text-muted)", maxWidth: "40ch" }}>
        Something went wrong setting up the local database. Your data is only on this device, so a
        reset is the fastest way out. This will clear everything and start fresh.
      </p>
      {error ? (
        <pre
          style={{
            marginTop: "var(--space-sm)",
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
          {error}
        </pre>
      ) : null}
      <div
        style={{
          display: "flex",
          gap: "var(--space-sm)",
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        <button type="button" style={FALLBACK_GHOST_STYLE} onClick={onRetry} disabled={working}>
          Retry
        </button>
        <button
          type="button"
          style={FALLBACK_ACTION_STYLE}
          onClick={handleReset}
          disabled={working}
        >
          {working ? "Resetting…" : "Reset app"}
        </button>
      </div>
    </main>
  );
};

/* ------------------------------------------------------------------
 * Generic unexpected-error screen
 *
 * Reached when a non-migration stage (e.g. store hydration) threw.
 * The database is intact, so the right affordance is "retry" rather
 * than "reset".
 * ------------------------------------------------------------------ */

const UnexpectedErrorScreen: React.FC<{ error: string | null; onRetry: () => void }> = ({
  error,
  onRetry,
}) => (
  <main style={FALLBACK_WRAPPER_STYLE} role="alert">
    <h1 style={{ fontSize: "var(--text-h1)", fontWeight: 700, margin: 0 }}>
      Something went sideways.
    </h1>
    <p style={{ color: "var(--text-muted)", maxWidth: "40ch" }}>
      The app couldn't finish starting up. Your data is safe — nothing leaves this device.
    </p>
    {error ? (
      <pre
        style={{
          marginTop: "var(--space-sm)",
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
        {error}
      </pre>
    ) : null}
    <button type="button" style={FALLBACK_ACTION_STYLE} onClick={onRetry}>
      Try again
    </button>
  </main>
);

/* ------------------------------------------------------------------
 * BootGate — runs the pipeline and switches the render branch.
 *
 * Lives inside the React tree (rather than in an imperative
 * top-of-file await) so we can use hooks for retry state without
 * juggling two different mount paths.
 * ------------------------------------------------------------------ */

const BootGate: React.FC = () => {
  const [result, setResult] = useState<BootResult | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setResult(null);

    (async () => {
      const outcome = await bootstrapApp();
      if (cancelled) return;
      setResult(outcome);

      // Perf breadcrumb — visible in `cap run` logs and the browser
      // devtools console. Stripped by the minifier in prod builds.
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.info(
          `[amban.boot] stage=${outcome.stage} duration=${outcome.durationMs.toFixed(0)}ms`,
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = () => setAttempt((n) => n + 1);

  if (!result) return <BootSplash />;

  switch (result.stage) {
    case BootStage.Ready:
      return <App />;

    case BootStage.MigrationFailed:
      return <MigrationFailureScreen error={result.error} onRetry={retry} />;

    case BootStage.UnexpectedError:
      return <UnexpectedErrorScreen error={result.error} onRetry={retry} />;

    default:
      // Any non-terminal stage arriving here is a bug in boot.ts —
      // the pipeline should never resolve with Idle/Database/Hydration
      // as the final state. Show the generic error screen rather than
      // blanking out.
      return (
        <UnexpectedErrorScreen
          error={`Boot pipeline resolved at non-terminal stage: ${result.stage}`}
          onRetry={retry}
        />
      );
  }
};

/* ------------------------------------------------------------------
 * Mount
 *
 * Strict mode stays on in dev — the double-invoke surfaces effect
 * cleanup bugs early. Boot is idempotent, so a second run during
 * strict-mode double-render is harmless.
 * ------------------------------------------------------------------ */

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container #root not found in index.html");
}

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <BootGate />
  </React.StrictMode>,
);
