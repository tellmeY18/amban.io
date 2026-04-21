# ROADMAP.md — amban.io

> The execution plan to take amban.io from an empty directory to a shippable initial release on iOS and Android.
>
> This roadmap is ordered. Each phase depends on the previous. No versioning here — everything described below rolls up into the first public build. Testing, dogfooding, and feedback loops are intentionally left out; they're handled separately.
>
> The single source of truth for *what* to build is [`CLAUDE.md`](./CLAUDE.md). This file is strictly *how* and *in what order*.

---

## Table of Contents

1. [Phase 0 — Pre-Flight](#phase-0--pre-flight)
2. [Phase 1 — Project Bootstrap](#phase-1--project-bootstrap)
3. [Phase 2 — Design System Foundation](#phase-2--design-system-foundation)
4. [Phase 3 — Local Persistence Layer](#phase-3--local-persistence-layer)
5. [Phase 4 — State Management Scaffolding](#phase-4--state-management-scaffolding)
6. [Phase 5 — Core Business Logic](#phase-5--core-business-logic)
7. [Phase 6 — Navigation & App Shell](#phase-6--navigation--app-shell)
8. [Phase 7 — Onboarding Flow](#phase-7--onboarding-flow)
9. [Phase 8 — Home Screen & Score Surface](#phase-8--home-screen--score-surface)
10. [Phase 9 — Daily Log & History](#phase-9--daily-log--history)
11. [Phase 10 — Balance & Finance Management](#phase-10--balance--finance-management)
12. [Phase 11 — Insights Engine](#phase-11--insights-engine)
13. [Phase 12 — Local Notifications](#phase-12--local-notifications)
14. [Phase 13 — Settings & Lifecycle](#phase-13--settings--lifecycle)
15. [Phase 14 — Polish & Micro-interactions](#phase-14--polish--micro-interactions)
16. [Phase 15 — Native Shells: iOS & Android](#phase-15--native-shells-ios--android)
17. [Phase 16 — Release Engineering](#phase-16--release-engineering)
18. [Phase 17 — Store Submission](#phase-17--store-submission)
19. [Cross-cutting Tracks](#cross-cutting-tracks)
20. [Definition of Done for Initial Release](#definition-of-done-for-initial-release)

---

## Phase 0 — Pre-Flight

Set the ground rules before writing any code. Finish this phase in a single sitting.

- **Confirm the spec.** Re-read `CLAUDE.md` end-to-end. Make a short list of any open questions and resolve them against the appendices. The spec must be frozen before Phase 1.
- **Toolchain baseline.** Lock in the versions you'll build against: Node LTS, pnpm (or npm), Xcode, Android Studio, JDK 17, CocoaPods, a physical Android device, and an iPhone + provisioning profile. Document the versions in a `.tool-versions` or the README.
- **Accounts & identifiers.** Have an Apple Developer account, a Google Play Console account, and confirm the bundle id `io.amban.app` is free and registered. Register the domain `amban.io` if not already owned.
- **Repo.** Create the Git repository, add `CLAUDE.md`, `ROADMAP.md`, a `LICENSE`, and a `.gitignore` tuned for Node + iOS + Android + Capacitor.
- **Branching model.** Decide: trunk-based with short-lived feature branches is the right default for a solo-led project. Protect `main`.
- **Working agreements.** Pick a commit style (Conventional Commits is ideal), a PR template, and a "one-touch" local dev command. Write them into the README.

Exit criteria: You can clone the repo on a fresh machine and know exactly what to install.

---

## Phase 1 — Project Bootstrap

Stand up the empty shell of the app and prove it boots in the browser, on iOS, and on Android.

- **Scaffold the Ionic + React + Vite project.** Use the Ionic starter for React with TypeScript. Pick the blank template, not the tabs template — the navigation is custom.
- **Install dependencies per `CLAUDE.md` §2.** Core runtime, Capacitor plugins (`@capacitor/local-notifications`, `@capacitor-community/sqlite`, `@capacitor/preferences`, `@capacitor/haptics`, `@capacitor/status-bar`, `@capacitor/keyboard`), Zustand, `date-fns`, Recharts, Ionicons.
- **Install dev tooling.** TypeScript strict mode, ESLint (with `@typescript-eslint` + React hooks plugin), Prettier, Husky + lint-staged for pre-commit, EditorConfig.
- **Folder skeleton.** Create the exact tree from `CLAUDE.md` §4, populate every file with a stub export so imports resolve and no directory is empty.
- **Add Capacitor.** Initialize Capacitor with app name `amban`, bundle id `io.amban.app`, and webDir `dist`. Add the iOS and Android platforms.
- **Hello-world smoke tests.** Prove three things work before moving on:
  1. `npm run dev` serves a page in the browser.
  2. An iOS simulator build boots and shows the same page.
  3. An Android emulator build boots and shows the same page.
- **CI-in-a-file.** Add a simple GitHub Actions (or equivalent) workflow that runs typecheck + lint + build on every push. Keep it minimal.

Exit criteria: Empty app boots on both platforms. Lint, typecheck, and build all pass clean.

---

## Phase 2 — Design System Foundation

Before any screen is built, make the visual language real.

- **Global CSS tokens.** Encode every custom property from `CLAUDE.md` §3 (colors, typography, spacing, radii, shadows) into a single `theme.css` loaded at the root.
- **Typography setup.** Self-host DM Sans and Inter via Fontsource (avoid Google Fonts network calls — this is a local-only app). Define display vs body text classes.
- **Theme switcher.** Implement a provider that toggles between `light`, `dark`, and `system`, writing the chosen theme onto `<html>` as a `data-theme` attribute. Dark mode tokens apply automatically via the attribute selector.
- **Status bar + splash.** Wire `@capacitor/status-bar` to match the active theme. Configure the splash background in `capacitor.config.ts` to the primary color per Appendix H.
- **Primitive UI components.** Build each once, style them against tokens, and verify they render in a `StyleGuide` route that is removed before release:
  - `Card`, `Badge`, `BottomSheet`, `CurrencyInput`, `DatePicker`, `ProgressRing`.
- **Layout scaffolding.** `AppShell` and `BottomNav` per §4 with four tabs: Home, Log, Insights, Settings. Nav items should visibly respond to active state, but routing is stubbed in Phase 6.
- **Icon set.** Pick the Ionicons used in Appendix C and re-export them through a single `icons.ts` so swaps are trivial.
- **Haptics + reduce-motion gate.** Centralize haptic calls (Appendix F) behind a single utility that no-ops when the user has reduce-motion on or on web.
- **Accessibility pass.** Verify contrast on both themes, confirm minimum hit target size, and add a global focus ring style.

Exit criteria: The `StyleGuide` route showcases every primitive in light and dark, with haptics wired and reduce-motion respected.

---

## Phase 3 — Local Persistence Layer

Storage is the backbone of this app. Get it right before building features on top.

- **SQLite bootstrap.** Initialize `@capacitor-community/sqlite`. Handle the three environments the plugin cares about: native iOS, native Android, and the web fallback (jeep-sqlite) for local dev. Gate the web path behind the existing dev-only code paths.
- **Schema file.** Translate `CLAUDE.md` §5 verbatim into `src/db/schema.sql` as `001_init.sql` inside `migrations/`.
- **Connection singleton.** `db.ts` exposes a single `getDb()` that opens the database once, applies pending migrations inside a transaction, and memoizes the connection.
- **Migration runner.** Per Appendix J: read the current `schema_version` from Preferences, run every unapplied migration file in numeric order, bump the version on success, roll back on failure, and expose the failure state so the app can render the "Reset App" escape hatch.
- **Seed rows.** On first successful migration, seed the singleton rows: `user` (blank), `settings` (defaults: notification time `21:00`, notifications enabled, theme `system`).
- **Typed repository layer.** One module per table with explicit functions (`getUser`, `upsertUser`, `addIncomeSource`, `listRecurringPayments`, `insertDailyLog`, etc.). No raw SQL strings leak outside `db/`.
- **Preferences wrapper.** Thin typed facade around `@capacitor/preferences` so keys are defined in one enum (onboarding complete, last notification schedule date, dismissed insights, schema version, etc.).
- **Reset pipeline.** Implement the full destructive reset per Appendix I as a single callable — drop tables, reapply schema, clear preferences, cancel all notifications. Not wired to UI yet.
- **Dev-only inspector.** A hidden screen (accessible from the style guide) that dumps current DB contents as JSON. Removed before release.

Exit criteria: Every table can be written, read, updated, deleted via the repository layer. Migrations apply cleanly on a fresh install and are idempotent on re-launch.

---

## Phase 4 — State Management Scaffolding

Wire Zustand stores on top of the repository layer. Stores are the only thing UI talks to.

- **Store shapes.** Implement `userStore`, `financeStore`, `dailyStore`, `settingsStore` with the exact shapes defined in `CLAUDE.md` §5.
- **Hydration.** On app boot, each store loads its slice from SQLite before the first screen renders. Use a single "bootstrap" function awaited in `main.tsx` behind a splash.
- **Write-through pattern.** Every mutator on a store writes to SQLite first, then updates in-memory state. Reads are always from memory.
- **Derived selectors.** Keep derived values (effective balance, next income date, days left) out of the stores. Put them in selectors or hooks so they recompute on dependency change.
- **Lifecycle hooks.** Subscribe to Capacitor's `appStateChange` so the app rehydrates and recalculates on resume (per §8.3). Wire a midnight tick so the date-dependent state flips at 00:00 local time.
- **Store dev-tools.** Add a dev-only middleware that logs store changes in development builds.

Exit criteria: A dev button in the style guide can write a fake income source, restart the app, and see it persist.

---

## Phase 5 — Core Business Logic

The math that powers everything. Build it pure, pull it into hooks, touch no UI.

- **Date helpers.** `dateHelpers.ts` contains: `getNextIncomeDate`, `getActualDueDate` (handles the 30/31 edge case per §13.4), `differenceInCalendarDaysClamped`, `endOfMonthSafe`. All pure, all `date-fns`-backed.
- **Scoring.** Implement `calculateAmbanScore` per Appendix B: effective balance = latest snapshot − spend since snapshot; subtract upcoming recurring payments that fall between today and the next income date; divide by days left (min 1); clamp to zero.
- **Formatters.** `formatINR` per Appendix A, plus compact formatter for large numbers and a shared date-label formatter ("Today", "Yesterday", "Mon, 4 Aug").
- **Edge cases from §13.** Encode each one as a branch in the scoring module or as a flag returned alongside the score: first-day, income-day-is-today, multiple income sources colliding, negative balance warning, multi-day missing logs, already-paid-this-month recurring.
- **`useAmbanScore` hook.** Reads the relevant stores, calls `calculateAmbanScore`, returns `{ score, status, daysLeft, effectiveBalance, upcomingRecurring, nextIncomeDate, warnings[] }`.
- **Score status helper.** Converts score ratio vs historical average into `healthy | watch | critical`. On first launch with no history, always returns `healthy`.
- **Score history writer.** Whenever `useAmbanScore` produces a score and the user logs a spend, persist the `score_at_log` alongside the `daily_logs` row.

Exit criteria: Given any set of stored finances, the hook returns the correct score. Demonstrable via the dev-only inspector before any screen exists.

---

## Phase 6 — Navigation & App Shell

Now that logic and storage are solid, turn on navigation.

- **Router.** Ionic React router with four root tabs — Home, Log, Insights, Settings — plus a nested stack for Onboarding that sits outside the tab bar.
- **Gating.** On boot, read `onboarding_complete` from Preferences. If false, mount the onboarding stack; if true, mount the tab bar.
- **Deep link scheme.** Register `amban://` per Appendix H. In v1, the only meaningful deep link is `amban://log` (jumped to from the daily notification).
- **Back-button behaviour.** Android hardware back must follow the Ionic stack conventions; Home tab pressing back exits the app.
- **Global error boundary.** One boundary at the app root that catches render errors and shows a minimal screen with a "Reset App" link (reuses the migration-failure screen).
- **Loading choreography.** A single splash → boot sequence that waits on: database ready, stores hydrated, theme applied, fonts loaded.

Exit criteria: You can navigate between all four tabs and the onboarding stack manually via a dev toggle. No real screens yet — placeholders are fine.

---

## Phase 7 — Onboarding Flow

Build once, the user sees it once. It has to feel premium.

- **Stepper primitive.** A shared layout for all five steps: progress indicator, back button, title, body, sticky primary CTA. Keyboard-safe on both platforms.
- **Step 1 — Welcome.** Brand, tagline, single "Get Started" CTA. No form.
- **Step 2 — Basic Details.** Name input, optional emoji picker. Store on blur, proceed on CTA.
- **Step 3 — Income Sources.** Repeatable add form per §6.1. At least one source required. Enforce: label non-empty, amount > 0, credit day 1–31.
- **Step 4 — Bank Balance.** Single number input. On save, insert a `balance_snapshots` row dated today.
- **Step 5 — Recurring Payments.** Repeatable add form. Zero is valid; a "Skip for now" secondary CTA. Each row must include a category from Appendix C.
- **Step 6 — Notifications.** Time picker defaulting to 21:00. Toggle to enable. Request OS permission here; handle denial gracefully (show a note, let them proceed).
- **Step 7 — Completion reveal.** Compute the first Amban Score and animate it in. Three-line explanation of what the score means. "Let's go" CTA navigates to Home and flips `onboarding_complete` to true.
- **Resumability (§13.8).** Persist the current step + partial inputs to Preferences after every field change. On relaunch mid-onboarding, resume from the last incomplete step.
- **Input UX.** Numeric keypads everywhere for amounts, auto-advance between repeated fields, haptic tick on step completion.

Exit criteria: A fresh-install → completed onboarding → Home render path works end-to-end, including a force-quit mid-flow.

---

## Phase 8 — Home Screen & Score Surface

The screen the user sees every day. This is the emotional centre of the app.

- **ScoreCard.** Renders the big number, the "per day" suffix, a textual status label (not colour-only, per Appendix G), and a one-line summary under it. Colour resolves from the score status.
- **Supporting metrics row.** Balance, next income date, upcoming bills sum — taken from the score hook.
- **Greeting.** Time-of-day greeting using the stored name and optional emoji.
- **Yesterday's spend panel.** If there's a log for yesterday, show the diff vs that day's score. If not, show a CTA to log it.
- **Upcoming payments strip.** Horizontal scroll of payments due within the next 7 days, each a chip with label, amount, and "in N days" badge. Chips inside `UPCOMING_PAYMENT_WARN_DAYS` (Appendix D) get a warning treatment.
- **Income day banner (§6.4).** Conditional banner appears only when today matches an income source's credit day and the user hasn't updated their balance yet today. CTA opens the balance-update sheet prefilled with `currentBalance + incomeAmount`.
- **Placeholder insight carousel.** Reserve the slot; real insights land in Phase 11.
- **Live recalc.** Home subscribes to app-foreground and midnight events so the score is always current without a manual refresh.

Exit criteria: With realistic seeded data, Home looks and feels identical to the mock in §9.1 across both themes.

---

## Phase 9 — Daily Log & History

- **Daily Log screen.** Large numeric input, quick-amount chips, optional notes, optional category tagging. Save writes a `daily_logs` row (unique per date — existing log for today is updated in place).
- **Post-save feedback.** Toast variant (success / neutral / warning) chosen by comparing logged spend to the current score. Pair with the matching haptic from Appendix F.
- **Backfill flow (§13.6).** Entry point on Home when the last log is >1 day old: date picker + amount per missed day, submitted in one transaction.
- **Log History screen.** Reverse-chronological list grouped by week. Each row shows date, amount, and a traffic-light dot vs the score at log time. Tap to expand for notes.
- **Mini bar chart.** 30-day bars at the top of history using Recharts. Bars coloured by score-relative status.
- **Edit / delete.** Long-press or swipe on a history row to edit the amount and notes, or delete the log. Respect the "unique per date" invariant.
- **Accessibility.** Every bar has a screen-reader label ("Tuesday 3 June, spent 1,200 rupees, under score").

Exit criteria: Logging a spend updates the score on Home within one frame. History correctly reflects every mutation.

---

## Phase 10 — Balance & Finance Management

- **Manage Income.** Settings sub-screen listing income sources with edit, delete, and active toggle. Add-new reuses the onboarding form.
- **Manage Recurring.** Same pattern for recurring payments, with category visible on each row.
- **Update Balance sheet.** Accessible from Settings, from the income-day banner, and from a dedicated Home action. Shows last snapshot amount + date, takes a new amount, writes a `balance_snapshots` row, and triggers immediate recalc.
- **Manual Credits.** Simple add flow writing to `manual_credits`. Affects the effective balance exactly like a balance snapshot — document which convention the codebase chose.
- **Recurring "mark as paid" affordance.** When a payment is within `UPCOMING_PAYMENT_WARN_DAYS`, offer a quick action that opens the balance-update sheet pre-debited by that payment's amount. Prevents the §13.7 double-deduct.
- **Validation & guardrails.** Prevent deleting the last active income source while onboarding is complete (would make scoring undefined). Warn clearly, don't silently block.

Exit criteria: A user can fully reshape their financial setup without ever re-entering onboarding, and the score reacts correctly to each change.

---

## Phase 11 — Insights Engine

- **`insightGenerators.ts`.** One pure function per insight from §11.1–§11.9. Each returns either `null` (not applicable) or a structured payload with `{ id, priority, headline, supporting, icon }`.
- **Thresholds wiring.** Every magic number reads from `constants/insightThresholds.ts` per Appendix D.
- **`useInsights` hook.** Runs all generators, filters out dismissed insights (checking the TTL from Appendix D), sorts by priority per §11.10, and caps at `HOME_CAROUSEL_MAX`.
- **Insight card component.** One visual template that renders any insight payload. Includes a swipe-to-dismiss gesture that writes to the dismissed list.
- **Home carousel.** Real carousel replaces the Phase 8 placeholder. Auto-rotates at `HOME_CAROUSEL_ROTATE_MS`; pauses on touch and when reduce-motion is on.
- **Insights screen.** Full-page version with four sections per §9.4: spending trend line chart, monthly category pie, full insight list (no dismissal cap), recurring-as-share-of-income bar.
- **Empty-state rules (§13.1).** Insights depending on logs are hidden until enough data exists. Copy the minimum-data threshold from Appendix D (`STREAK_MIN_DAYS`, `AVG_WINDOW_DAYS` etc.).
- **Chart styling.** Recharts themed against CSS variables so light/dark switch is free.

Exit criteria: With a 30-day seed of varied logs, every insight has been observed firing at least once under realistic data.

---

## Phase 12 — Local Notifications

- **Permission pathway.** The initial ask happens in onboarding Step 6. A denied-state path: on Home, if notifications are disabled but the user expects them, offer a one-tap to open OS settings.
- **Scheduler module.** `useNotifications` encapsulates `scheduleAllNotifications` per §10.4 using the ID scheme from Appendix E. Always cancel the full ID range before rescheduling.
- **Daily prompt.** Scheduled with `every: 'day'` at the user's chosen hour/minute. Body rotates across the five templates from §10.1 — pick one deterministically per day so the same message isn't repeated across reschedules.
- **Upcoming payment reminders.** One notification per active recurring payment, fired `UPCOMING_PAYMENT_NOTIFY_DAYS` before the due date. Re-scheduled on every payment edit.
- **Salary day nudge.** One notification per active income source on its credit day.
- **Reschedule triggers.** Run the scheduler after: onboarding completion, any change to income/recurring/settings, app foreground, and app install upgrade.
- **Dedupe guard.** Preferences key `last_notification_schedule_date` — skip rescheduling if it already ran today and nothing changed.
- **Deep link.** Tapping the daily prompt opens the Daily Log screen (`amban://log`). Other notifications open the Home screen.
- **Quiet the platform-specific quirks.** Android 13+ runtime permission, iOS provisional notifications behaviour, and OEMs that aggressively kill background tasks — document known limitations in a single `docs/NOTIFICATIONS.md`.

Exit criteria: A full day on a real device shows exactly one daily prompt, any scheduled payment and salary nudges, and nothing else.

---

## Phase 13 — Settings & Lifecycle

- **Settings screen.** Every row from §9.5 wired up: profile name/emoji, manage income, manage recurring, update balance, notification time + toggle, theme picker, reset app.
- **Notification settings.** Changing time or toggling off immediately calls the scheduler (off = cancel all).
- **Theme.** Writing the chosen theme updates the `settings` row and the `<html>` attribute in the same tick.
- **Reset app.** Full Appendix I flow: type-to-confirm, destructive haptic, drop-and-recreate DB, clear Preferences, cancel all notifications, reset stores, navigate to Welcome.
- **App version & acknowledgements.** Tiny read-only section at the bottom: app name, build number, credits, links to the on-device privacy statement.
- **On-device privacy statement.** A static page reiterating that nothing leaves the device — useful for the app store listing and for users who check.

Exit criteria: Every user-facing setting can be changed, persists across a cold start, and survives a reinstall via the export path (deferred) or requires a clean reset (acceptable for v1).

---

## Phase 14 — Polish & Micro-interactions

This phase is where the app stops feeling like a prototype.

- **Motion pass.** Auditable list: tab transitions, bottom-sheet spring, score number count-up on onboarding reveal, insight card swipe-dismiss, list-row press-state. Each must gracefully no-op under reduce-motion.
- **Haptics audit.** Walk through Appendix F and confirm every listed interaction fires its intended haptic and only that haptic — no duplicates, no missing ones.
- **Empty states.** Every list (income, recurring, logs, insights) has a crafted empty state with copy and a primary action.
- **Loading states.** Any DB read that might take >50ms shows a skeleton, not a spinner. Keep them visually quiet.
- **Copy polish.** Consolidate every user-facing string into `strings.ts` per Appendix G. Edit for tone: friendly, Indian English, no finance-bro jargon.
- **Keyboard handling.** `@capacitor/keyboard` — the score card shouldn't be hidden by the keyboard in any flow. Test on the smallest supported device.
- **Safe-area handling.** All screens respect the notch and the home indicator on iOS, and the gesture area on Android.
- **Performance pass.** Cold start under 2s on a mid-tier Android. Home render under 16ms on the same device. Profile, fix the worst offenders, re-profile.
- **Dark mode pass.** Every screen, every component, every chart verified in dark mode.

Exit criteria: The app feels finished. A stranger could pick it up and never notice a rough edge.

---

## Phase 15 — Native Shells: iOS & Android

The web build is done. Now the wrappers.

- **iOS shell.**
  - Set display name, bundle id, min iOS 14, portrait-only, version `1.0.0`, build `1`.
  - Configure the app icon (every required size) and splash from the brand assets per Appendix H.
  - Info.plist additions: local notification usage, no tracking, no background modes beyond what `@capacitor/local-notifications` needs.
  - Code signing with the distribution certificate and App Store provisioning profile.
  - Disable all non-essential capabilities.
- **Android shell.**
  - Set application id, min SDK 23, target SDK to the latest Play-required level, portrait-only, version `1.0.0`, version code `1`.
  - Adaptive icon + splash.
  - AndroidManifest additions: `POST_NOTIFICATIONS` permission (Android 13+), `SCHEDULE_EXACT_ALARM` only if required by the notifications plugin, `VIBRATE` for haptics.
  - Generate a release keystore; store the keystore and passwords outside the repo.
  - ProGuard / R8 enabled; confirm SQLite and Capacitor classes aren't stripped.
- **Per-platform smoke.** Fresh install on real hardware (one iPhone, one Android) walking the full onboarding → a week of simulated logs → notifications firing → app killed and relaunched.
- **Orientation lock & status bar.** Verified on both platforms.
- **Icon & splash sanity.** Side-by-side comparison of the installed icon against the brand reference.

Exit criteria: Signed release builds of both platforms install and run on hardware with zero console errors.

---

## Phase 16 — Release Engineering

Get the repository ready to produce shippable artifacts on demand.

- **Build scripts.** One-shot commands: `build:ios`, `build:android`, `release:ios`, `release:android`. Each does the web build, the Capacitor sync, and the native archive.
- **Version bumping.** A single script that bumps `package.json`, iOS marketing version + build number, and Android version name + code together. No drift allowed.
- **Release notes file.** `CHANGELOG.md` — the first entry is the initial release.
- **Secrets handling.** Keystore passwords, App Store Connect API key, Apple ID — stored in a local `.env.release` (gitignored) and injected into the release scripts.
- **Asset pipeline.** `store/` directory with every required screenshot size for iOS and Android, the app preview video (optional), the feature graphic for Play, and the privacy-policy source. Treat these as code; generate from a master file where possible.
- **Privacy policy.** Host a minimal policy at `amban.io/privacy`. One page, says "this app doesn't collect anything." Link it from store listings.
- **Build provenance.** Tag the exact git commit that produced each submitted build. Keep the symbol files and mapping files archived alongside.

Exit criteria: Running a single command produces a submittable `.ipa` and a submittable `.aab`, repeatable on a clean checkout.

---

## Phase 17 — Store Submission

- **App Store Connect.**
  - Create the app record with bundle id `io.amban.app`.
  - Fill metadata: name, subtitle, promotional text, description, keywords, support URL, marketing URL, privacy URL.
  - Upload screenshots for each required device class.
  - Fill the privacy questionnaire honestly: no data collected, no tracking.
  - Export compliance: standard HTTPS-only answer, no custom crypto.
  - Upload the archive via the release script, attach to the version, submit for review.
- **Google Play Console.**
  - Create the app, set category "Finance".
  - Fill store listing: title, short description, full description, graphic assets.
  - Content rating questionnaire.
  - Data safety form: mirror the iOS answers.
  - Target audience & ads declaration (no ads).
  - Upload the AAB to the production track, roll out to 100% or a staged rollout at your discretion.
- **Post-submission watch.** Monitor reviewer messages daily. Have the source tree tagged and ready to produce a patched build if either store asks for changes.
- **Launch readiness.**
  - `amban.io` landing page live with a single CTA per platform.
  - Privacy page live.
  - Repository tagged with the release commit.
  - `CHANGELOG.md` entry finalized.

Exit criteria: Both apps are "Ready for Sale" / "Published". The listing screenshots match the app. The privacy statements match the code.

---

## Cross-cutting Tracks

These tracks run continuously alongside every phase. They don't have their own section in the sequence, but the release isn't done if they're behind.

- **Code health.** No `any` in production code. No TODOs in merged PRs — convert to tracked issues. Typecheck, lint, and build must be green on `main` at all times.
- **Documentation.** The README stays current with setup instructions. `CLAUDE.md` is updated whenever an implementation decision contradicts it, never the other way round. Every non-obvious module gets a short header comment explaining why it exists.
- **Accessibility.** Each phase passes the Appendix G checklist for the screens it ships.
- **Security & privacy.** No network calls, ever. Add a CI check that fails the build if `fetch`, `XMLHttpRequest`, or any analytics SDK appears in the bundle.
- **Local data integrity.** Every schema change ships with a migration. Every migration is tested against a database seeded from the previous schema.
- **Device matrix.** Minimum baseline: one small-screen iPhone (SE class), one large iPhone, one mid-tier Android, one low-end Android. Every phase is sanity-checked on all four before moving on.
- **Asset hygiene.** Icons, fonts, and images stay inside the repo. No CDN dependencies at runtime.

---

## Definition of Done for Initial Release

The app ships when **all** of the following are true:

1. A fresh install on iOS and Android walks through onboarding without a single error.
2. After onboarding, the Home screen correctly shows the Amban Score, balance, days left, and upcoming bills from user-entered data.
3. Logging a spend updates the score immediately and persists across app restarts.
4. The daily spend notification fires at the configured time on both platforms; tapping it opens the Daily Log screen.
5. Upcoming payment and salary-day notifications fire on their correct dates.
6. Every edge case in `CLAUDE.md` §13 is reachable and behaves as specified.
7. Every insight in `CLAUDE.md` §11 has been observed under realistic data.
8. Both light and dark themes are visually complete on every screen.
9. Reset App fully wipes the device to a fresh-install state.
10. Zero network requests leave the device at any point in any flow.
11. Signed production builds for both platforms are produced by a single command from a clean checkout.
12. Both store listings are approved and the apps are downloadable.

When those twelve lights are green, ship it. Everything else is for the next release.