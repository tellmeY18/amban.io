# Changelog

All notable changes to amban.io are recorded in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions are not assigned while the project is pre-release; the first tagged
release will be `v0.1.0` (see `ROADMAP.md`).

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