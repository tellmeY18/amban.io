# Changelog

All notable changes to amban.io are recorded in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Releases are tagged as `vX.Y.Z` and published through the GitHub Actions
release workflow (see `ROADMAP.md`). `v0.1.0` was the first tagged alpha;
`v0.1.1` is the current alpha.

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

## [0.1.1] — 2026-04-22

Second alpha release. Primary theme: the daily log finally matches how
people actually spend. Secondary theme: a full accessibility audit with
grouped tracking issues. Same side-load distribution as v0.1.0 — no
Play Store yet (Phase 17 remains out of scope for the alpha track).

### Added

- **Two-tier logging model** — migration `002_spend_entries.sql`
  introduces a `spend_entries` table (N rows per day, each with its own
  amount / category / note / timestamp) plus a `confirmed_at` column on
  `daily_logs`. Entries auto-roll into `daily_logs.spent` via
  `spendEntriesRepo.rollUp()` on every mutation so scoring never lags
  behind the entries list. Pure-additive — no v0.1.0 row is rewritten.
- **`spendEntriesRepo`** in `src/db/repositories.ts` — typed CRUD plus
  `rollUp` (writes the day's sum back to `daily_logs`), `sumForDate`,
  `listForDate` / `listBetween`, and `count` for the insights engine.
- **`dailyLogsRepo.setConfirmed`** and the `confirmed?: boolean` flag
  on `DailyLogInput` — so the end-of-day sheet can stamp
  `confirmed_at` explicitly without accidentally sealing the day
  during routine entry rollups.
- **Daily Log screen — full rewrite** (`src/screens/Log/DailyLogScreen.tsx`).
  Entry-first UX: running-total hero banner → "Add spend entry"
  primary CTA → per-entry list (category avatar, amount, label,
  time) → end-of-day "I'm done for today" confirmation sheet.
  Each entry opens its own bottom sheet with amount (additive
  quick-amount chips), category chips, notes, and edit/delete.
  Post-confirmation the day shows an "Editable till midnight" badge
  and users can still add/edit/delete entries until local 23:59.
  Score-diff tone (under/on/over) is shown live above the entries
  list and on the confirmation sheet. The backfill sheet (§13.6)
  is preserved and still writes via `dailyStore.backfillLogs`.
- **`dailyStore`** rewritten to carry `entries`, `entriesByDate`,
  `todayEntries`, and `todayEntriesTotal` alongside the existing
  `logs` / `todayLog`. New actions: `addEntry`, `updateEntry`,
  `deleteEntry`, `confirmDay`, `unconfirmDay`. The legacy day-total
  operations (`logSpend`, `updateLog`, `deleteLog`, `backfillLogs`)
  are retained as the explicit escape hatch for history edits and
  backfill flows that bypass the entries rollup.
- **Log history — per-entry breakdown**. The expanded row now shows a
  read-only "Entries (N)" list pulled from `entriesByDate[date]`
  with category icons and amounts. Backfilled days (no entries,
  just a `daily_logs` row) render a quiet italic
  "No per-entry detail for this day." A green "Confirmed" tick
  badge surfaces on days where `confirmed_at` is set.
- **Accessibility audit & tracking** — new `ACCESS.md` (40 findings
  against WCAG 2.1/2.2 AA + `CLAUDE.md` Appendix G + Android
  guidance) and 10 grouped tracking issues filed on GitHub
  (issues #1–#10) covering focus visibility, hit targets, motion /
  zoom, non-text content, colour-only status, labels + landmarks,
  live regions, form semantics, and contrast tokens. Issue #10 is
  the cross-check tracker that maps every finding from the
  two-tier logging rewrite and the privacy-statement page onto
  issues #1–#9 so nothing from this release regresses silently.
- **`DbDump.spendEntries`** — the dev inspector and the data-export
  pipeline (`src/utils/exportData.ts`) now include a 90-day rolling
  window of entries alongside the existing tables, with the export
  format staying at `exportVersion: 1` (entries fold into the
  generic schema-agnostic shape).

### Changed

- **License: AGPL-3.0-or-later → GPL-3.0-or-later** across
  `package.json`, `package-lock.json`, `README.md`, `CHANGELOG.md`,
  and the in-app privacy statement. The `LICENSE` file itself was
  already verbatim GPLv3 — the audit confirmed it, the mention of
  "Affero" in §13 is the canonical GPLv3 interop clause.
- **Version bump** — `package.json` → `0.1.1`,
  `android/app/build.gradle` → `versionName "0.1.1"`, `versionCode 2`.
- `src/screens/Log/DailyLogScreen.tsx` formatting — Prettier-clean
  after the rewrite (CI format gate caught it).

### Fixed

- **Single-category-per-day friction** — the biggest usability issue
  from the v0.1.0 dogfood pass. A user can no longer be forced to
  mentally roll ₹120 chai + ₹800 groceries + ₹60 auto into one
  number before tapping save; they're three entries, three
  categories, three notes, one confirmed total.
- **`daily_logs.confirmed_at` semantics** — routine entry rollups
  never seal the day. Confirmation is an explicit user action.
  Re-confirm preserves the first-confirmation timestamp via
  `COALESCE(daily_logs.confirmed_at, excluded.confirmed_at)` in
  the upsert — so the audit trail of "when did the user first say
  they were done" survives later edits.
- **Prettier format** on `src/screens/Log/DailyLogScreen.tsx` — the
  rewrite initially tripped the CI format gate. Resolved in the
  same commit range.

### Migration notes

- A fresh install runs migrations 001 + 002 in a single transaction
  — end state is identical to a device that upgraded from v0.1.0.
- An upgrading device runs only 002. No existing rows are
  rewritten. Backfilled days from v0.1.0 survive unchanged (they
  simply show the "No per-entry detail for this day." hint when
  expanded in History).
- Per `CLAUDE.md` Appendix J, `001_init.sql` and `002_spend_entries.sql`
  are immutable from here on. Any further change ships as `003_*.sql`.

---

## [Unreleased]

### Added

- Initial project documentation: `CLAUDE.md` (product spec), `ROADMAP.md`
  (execution plan), and `README.md` (setup + working agreements).
- GPL-3.0-or-later license.
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