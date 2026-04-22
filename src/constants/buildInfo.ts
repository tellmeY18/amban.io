/**
 * constants/buildInfo.ts — single source of truth for app version/build metadata.
 *
 * Values are injected at build time by Vite's `define` config (see vite.config.ts)
 * from `package.json` and the CI-provided commit SHA. Falls back to safe defaults
 * in dev so the About panel never reads `undefined`.
 *
 * Read by:
 *   - screens/Settings/SettingsScreen.tsx (About row)
 *   - screens/Settings/PrivacyStatement.tsx (footer line)
 */

declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
declare const __APP_BUILD_DATE__: string;

const safe = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.length > 0 ? value : fallback;

export const BUILD_INFO = {
  /** Semver string from package.json (e.g. "0.1.1"). */
  version: safe(typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : undefined, "0.1.1-dev"),

  /** Short git SHA of the commit that produced the bundle. */
  commit: safe(typeof __APP_COMMIT__ !== "undefined" ? __APP_COMMIT__ : undefined, "local"),

  /** ISO timestamp for when the bundle was built. */
  buildDate: safe(
    typeof __APP_BUILD_DATE__ !== "undefined" ? __APP_BUILD_DATE__ : undefined,
    new Date().toISOString(),
  ),

  /** Stable display name — never localised, never shortened. */
  appName: "amban",
} as const;

/** Compact "amban · 0.1.1 (abc1234)" string for the About row. */
export const formatBuildLabel = (): string => {
  const { appName, version, commit } = BUILD_INFO;
  return commit === "local"
    ? `${appName} · ${version}`
    : `${appName} · ${version} (${commit.slice(0, 7)})`;
};
