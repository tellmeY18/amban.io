# Changelog

All notable changes to amban.io are recorded in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions are not assigned while the project is pre-release; the first tagged
release will be `v0.1.0` (see `ROADMAP.md`).

---

## [0.1.0] — 2026-04-22

First tagged alpha release. An unsigned debug APK for this version is
published as a GitHub Release asset; no Play Store listing yet (Phase 17
is intentionally out of scope for the alpha).

### Added — product

- **Phases 3–13 complete end-to-end** (see `ROADMAP.md` for the granular
  breakdown): local SQLite persistence layer with migration runner and
  repositories; Zustand store scaffolding with write-through mutators and
  parallel hydration; pure-function scoring engine (`utils/scoring.ts`)
  plus date helpers honouring the §13 edge cases; onboarding-vs-authenticated
  router split with `amban://` deep links and lifecycle subscribers; the
  six-step onboarding flow; Home screen with `ScoreCard`, warning banner,
  income-day banner, upcoming-payments strip, and insight carousel;
  Daily Log screen with backfill sheet and Log History with Recharts bar
  chart; Balance & Finance Management (`ManageIncome`, `ManageRecurring`,
  append-only balance snapshots, "mark as paid" affordance); the full
  nine-generator Insights engine; Local Notifications scheduler honouring
  Appendix E ID ranges with deterministic daily-prompt rotation and
  fingerprint-based dedupe.
- **Settings → About** now reads real build metadata (version, commit
  SHA, build date) injected at build time by Vite's `define` config.
- **On-device privacy statement** (`/settings/privacy`) — a static page
  that reiterates the no-network, no-cloud, no-tracking promise and
  points to the reset flow for on-device data wipe.
- **Export data** — `utils/exportData.ts` produces a single versioned
  JSON document containing every SQLite table row plus every amban-scoped
  Capacitor Preferences key. Offered to the user via the Web Share API
  where available and falls back to an anchor-download. Read-only; a
  future import path will ship separately.

### Added — infrastructure

- **`flake.nix`** — reproducible Nix dev shell providing Temurin JDK 21,
  the Android SDK (platforms 34/35/36, build-tools 34/35/36, cmdline-tools,
  platform-tools), Gradle, Node 22, Python, and Git. Exports
  `JAVA_HOME` / `ANDROID_HOME` / `PATH` on shell entry. Used by both
  local builds and the release workflow so CI and developer machines
  build byte-identically.
- **`.github/workflows/release.yml`** — release pipeline that triggers
  on tags matching `v*` (and on `workflow_dispatch` for dry runs).
  Installs Nix, runs the full quality gate (typecheck + lint + build +
  bundle privacy grep), syncs Capacitor, assembles the debug APK via
  Gradle, stages it with a versioned filename + SHA-256 sidecar, and
  uploads it as both a workflow artifact and a GitHub Release asset
  (prerelease-flagged for alpha).
- **Android manifest hardening** — added `POST_NOTIFICATIONS`,
  `SCHEDULE_EXACT_ALARM`, `USE_EXACT_ALARM`, `VIBRATE`, and
  `RECEIVE_BOOT_COMPLETED` permissions; locked the launcher activity
  to `android:screenOrientation="portrait"` per Appendix H; registered
  the `amban://` deep-link intent filter so notification taps route
  into `/log`.
- **Version alignment** — `package.json` bumped to `0.1.0`;
  `android/app/build.gradle` `versionName` set to `0.1.0`.
- **Node baseline** — `.nvmrc` and the Nix shell bumped to Node 22 to
  satisfy the Capacitor 8 CLI requirement.

### Changed

- `Settings → About` no longer hard-codes a fake `amban · 1.0.0` string;
  it now pulls from `constants/buildInfo.ts`, which reads values
  injected at build time (`__APP_VERSION__`, `__APP_COMMIT__`,
  `__APP_BUILD_DATE__`) via `vite.config.ts`. Falls back to
  `0.0.0-dev` / `local` if Git or the env vars aren't available so
  local dev builds never crash on undefined metadata.

---

## [Unreleased]

### Added

- Initial project documentation: `CLAUDE.md` (product spec), `ROADMAP.md`
  (execution plan), and `README.md` (setup + working agreements).
- AGPL-3.0 license.
- Ionic React + Vite + TypeScript scaffold generated via the Ionic CLI
  blank starter, rebranded to `amban` with bundle id `io.amban.app`.
- Capacitor plugins installed and declared in `capacitor.config.ts`:
  `@capacitor-community/sqlite`, `@capacitor/local-notifications`,
  `@capacitor/preferences`, `@capacitor/haptics`, `@capacitor/status-bar`,
  `@capacitor/keyboard`, `@capacitor/app`.
- Runtime dependencies: `zustand`, `date-fns`, `recharts`, Ionicons, and
  self-hosted DM Sans + Inter via `@fontsource` (no CDN per §12).
- Folder skeleton per `CLAUDE.md` §4: `db/`, `stores/`, `hooks/`,
  `screens/` (Onboarding, Home, Log, Insights, Settings, Profile),
  `components/` (ui, layout), `utils/`, `constants/`.
- Design tokens (`src/theme/tokens.css`) encoding every colour, typography,
  spacing, radius, shadow, and motion value from `CLAUDE.md` §3, plus dark
  mode overrides driven by `<html data-theme>` and
  `prefers-color-scheme`. Token-to-Ionic variable mapping in
  `src/theme/variables.css`. Global resets and utilities in
  `src/theme/globals.css`.
- Initial SQLite migration `src/db/migrations/001_init.sql` mirroring the
  schema in `CLAUDE.md` §5, with indexes for the reads we already know
  will happen often.
- Stubbed Zustand stores (`userStore`, `financeStore`, `dailyStore`,
  `settingsStore`) with the exact shapes from `CLAUDE.md` §5, typed
  actions, and write-through placeholders that throw until Phase 4.
- Stubbed hooks (`useAmbanScore`, `useInsights`, `useNotifications`) with
  the public signatures the rest of the app will type against.
- Pure-function scaffolds for `utils/scoring.ts`, `utils/dateHelpers.ts`,
  `utils/insightGenerators.ts`, and `utils/formatters.ts` (formatters
  fully implemented per Appendix A; scoring and date helpers land in
  Phase 5).
- Constants: `constants/categories.ts` (Appendix C) and
  `constants/insightThresholds.ts` (Appendix D) as the single source of
  truth for every tunable.
- UI primitive stubs in `components/ui/` (`Card` implemented minimally;
  `Badge`, `BottomSheet`, `CurrencyInput`, `DatePicker`, `ProgressRing`
  stubbed) and layout stubs (`AppShell`, `BottomNav`).
- Placeholder screens for every route the router will eventually mount,
  so the skeleton is navigable end-to-end while later phases fill in the
  real UI.
- Dev tooling: Prettier config + ignore file, ESLint flat config with
  TypeScript rules, React hooks rules, and the **privacy gate** that
  forbids `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, and a
  curated list of analytics / crash-reporting / HTTP-client packages at
  the source level. EditorConfig for whitespace consistency. Husky +
  lint-staged pre-commit hook wired via `npm run prepare`.
- TypeScript strict mode with `noUncheckedIndexedAccess`,
  `noImplicitOverride`, `noUnusedLocals`, `noUnusedParameters`, and path
  aliases (`@/*`, `@db/*`, `@stores/*`, `@hooks/*`, `@screens/*`,
  `@components/*`, `@utils/*`, `@constants/*`, `@theme/*`).
- GitHub Actions CI workflow (`.github/workflows/ci.yml`) running
  typecheck, lint, format check, and production build on every push and
  PR to `main`, plus a belt-and-braces grep over the built bundle that
  fails the job if forbidden network hosts slip in via a transitive
  dependency.
- `.gitignore`, `.nvmrc`, `.tool-versions` for reproducible local setup.

### Changed

- Swapped the Ionic starter's default app identity (`io.ionic.starter`,
  `.tmp-amban`) for amban's (`io.amban.app`, `amban`). Updated
  `index.html`, `capacitor.config.ts`, `package.json`, and the splash /
  theme colour.
- Replaced the starter's Vitest / Cypress configuration with a
  single-purpose Vite config (testing is out of scope for this roadmap).

### Removed

- Starter-provided Cypress directory, Vitest setup, and
  `@testing-library/*` packages.
- Starter-provided `pages/Home` demo screen; replaced by
  `screens/Home/HomeScreen.tsx`.