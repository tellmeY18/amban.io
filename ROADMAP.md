# ROADMAP.md — amban.io

> Execution plan for amban.io. The single source of truth for *what* to build is [`CLAUDE.md`](./CLAUDE.md). This file is strictly *how* and *in what order*.

---

## Current Status

**v0.1.3 shipped.** Debug-signed Android APK distributed via GitHub Actions release workflow. Full onboarding → Home → Log → Insights → Settings loop working end-to-end. Migration runner stabilised (per-migration transactions, comment-stripping preprocessor, mirrored schema version).

**v0.2.0 in progress.** Focus areas:

- **Database resilience** (Phase 18, active) — the headline. In-place upgrades must be provably non-destructive before anything else ships.
- **Burst income** (Phase 19) — promote manual credits to a first-class user surface.
- **SMS Capture** (Phase 20) — privacy-first, on-device-only transaction parsing from bank SMS (Android).
- **Notifications hardening** (Phase 21) — make the daily prompt actually fire on real devices.
- **Instrumented E2E testing** (Phase 22) — automated release gate on emulated Android.

**Deferred to v0.3+:** Phase 14 (polish/micro-interactions), Phase 17 (store submission), iOS native work from Phase 15, live SMS BroadcastReceiver, home-screen widget.

---

## Phase Status

Legend: ✅ done · 🟡 in progress · ⬜ not started

| Phase | Status | Summary |
|---|---|---|
| 0 — Pre-Flight | ✅ | Repo, tooling, accounts, branching model |
| 1 — Project Bootstrap | ✅ | Ionic + React + Vite + Capacitor scaffolded, CI wired |
| 2 — Design System Foundation | ✅ | Tokens, themes, primitives, AppShell, haptics, a11y |
| 3 — Local Persistence Layer | ✅ | SQLite + Preferences + repositories + migration runner + reset pipeline |
| 4 — State Management | ✅ | Zustand stores with hydration, write-through, boot orchestrator |
| 5 — Core Business Logic | ✅ | Score formula, date helpers, edge cases, `useAmbanScore` hook |
| 6 — Navigation & App Shell | ✅ | Router, deep-links, lifecycle subscribers, error boundary |
| 7 — Onboarding Flow | ✅ | Six-step onboarding with resumability and write-through |
| 8 — Home Screen & Score Surface | ✅ | ScoreCard, banners, upcoming payments, insight carousel slot |
| 9 — Daily Log & History | ✅ | Log screen, backfill, history with charts, edit/delete |
| 10 — Balance & Finance Management | ✅ | Income/recurring CRUD, balance updates, mark-as-paid |
| 11 — Insights Engine | ✅ | All nine generators, carousel, full insights screen |
| 12 — Local Notifications | ✅ | Scheduler, templates, dedupe, deep-link, reschedule triggers |
| 13 — Settings & Lifecycle | ✅ | Build metadata, privacy page, export data, all settings wired |
| **14 — Polish & Micro-interactions** | ⬜ | Deferred to v0.3 |
| **15 — Native Shells** | 🟡 | Android done for alpha; iOS still pending |
| 16 — Release Engineering | ✅ | Alpha-scope: GitHub Actions release workflow shipping APKs |
| **16.1 — In-App Updater (Alpha)** | 🟡 | v0.2.0 — background APK download + one-tap install |
| **17 — Store Submission** | ⬜ | Deferred — alpha is side-load only |
| **18 — Database Resilience** | 🟡 | v0.2.0 headline — in progress |
| **19 — Burst Income / Manual Credits** | ⬜ | v0.2.0 |
| **20 — SMS Capture (Android)** | ⬜ | v0.2.0 |
| **21 — Notifications Hardening** | ⬜ | v0.2.0 |
| **22 — Android Instrumented E2E** | ⬜ | v0.2.0 |

---

## Phase 14 — Polish & Micro-interactions

> Deferred to v0.3. Tracked here so scope is visible.

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

## Phase 15 — Native Shells (remaining: iOS)

> Android shell shipped in alpha. iOS is the remaining work.

- **iOS shell.**
  - Set display name, bundle id, min iOS 14, portrait-only, version `1.0.0`, build `1`.
  - Configure the app icon (every required size) and splash from the brand assets per Appendix H.
  - Info.plist additions: local notification usage, no tracking, no background modes beyond what `@capacitor/local-notifications` needs.
  - Code signing with the distribution certificate and App Store provisioning profile.
  - Disable all non-essential capabilities.
- **Per-platform smoke.** Fresh install on real iPhone hardware walking the full onboarding → a week of simulated logs → notifications firing → app killed and relaunched.
- **Orientation lock & status bar.** Verified on iOS.
- **Icon & splash sanity.** Side-by-side comparison of the installed icon against the brand reference.

Exit criteria: Signed release build of iOS installs and runs on hardware with zero console errors.

---

## Phase 16.1 — In-App Updater (Alpha, v0.2.0)

> Android-only. Eliminate the biggest friction point for alpha testers: manually downloading APKs from GitHub Releases.

Reference: [`CLAUDE.md` §16](./CLAUDE.md#16-in-app-updater-alpha-distribution-android).

The app silently checks GitHub Releases on every foreground event (debounced to once per hour). If a newer version exists, a non-dismissable banner appears on the Home screen offering a one-tap download and install — no browser, no GitHub navigation, no manual APK hunting.

**Deliverables:**

- **Custom Capacitor plugin `AppUpdaterPlugin`.** Native code in `android/app/src/main/java/io/amban/app/updater/`. Methods: `checkForUpdate()`, `downloadApk()`, `installApk()`, `canInstallApks()`, `openInstallSettings()`. Handles HTTP calls to GitHub API, file download with progress events, and `ACTION_VIEW` install intent via FileProvider.
- **TypeScript bridge (`src/utils/appUpdater.ts`).** Version comparison logic (semver), state machine for update lifecycle, Preferences-backed debounce (`lastUpdateCheckAt`).
- **React hook (`src/hooks/useAppUpdater.ts`).** Exposes update state (`idle | available | downloading | ready | error`) and actions (`download`, `install`, `retry`) to the UI layer.
- **`UpdateBanner` component (`src/components/UpdateBanner.tsx`).** Compact banner fixed above `GreetingHeader` on Home. Shows version info, download progress bar, and contextual CTA (Download / Install / Retry). Non-dismissable. Uses `--color-primary` background with white text.
- **Manifest changes.** Add `<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />`. `INTERNET` already present.
- **`file_paths.xml` update.** Add `<cache-path name="apk_updates" path="." />` for FileProvider access to cached APKs.
- **iOS gating.** Entire surface behind `Capacitor.getPlatform() === 'android'`. No UI, no hook init, no network call on iOS.
- **Error handling.** Network unavailable → silent (no banner). Download interrupted → "Tap to retry." Install permission missing → deep-link to system settings + toast.

**Exit criteria:** A user on v0.1.3 opens the app after v0.2.0 is released to GitHub. Within seconds, a banner appears offering the update. Tapping Download shows progress. Tapping Install opens the system installer. Zero browser interaction required.

---

## Phase 17 — Store Submission

> Deferred — alpha is side-load only. Tracked here for when we're ready.

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

## Phase 18 — Database Resilience (v0.2.0)

> **The headline phase of v0.2.0.** Every other v0.2 deliverable is gated on this. Until upgrades are provably non-destructive against every prior shipped schema, nothing else ships.

Reference contract: [`CLAUDE.md` §14](./CLAUDE.md#14-database-resilience--migration-discipline).

- **Migration catalogue (`src/db/migrations/index.ts`).** Replace any implicit file-globbing with an explicit `MIGRATION_CATALOG` array of `{ version, name, sql, checksum }`. Assert at boot (and as a unit test) that the catalogue matches the on-disk `migrations/` directory exactly. Drift fails the build in dev and renders the `MigrationFailed` screen in prod — it never silently skips a migration.
- **`schema_migrations` tracker table.** Ship `003_schema_migrations.sql` per §14.2. The runner backfills this table from the existing `PreferenceKey.SchemaVersion` value on first launch of v0.2 so v0.1.x installs don't re-apply migrations 001/002.
- **Per-migration transactions.** Rewrite `runMigrations` per the §14.4 pseudo-code: one `BEGIN/COMMIT` per migration, not per batch. A failure in migration N leaves N-1 durably applied. The runner records `{version, name, checksum, applied_at}` into `schema_migrations` inside the same transaction as the migration itself.
- **Freeze the `stripSqlComments` preprocessor.** Move it to `src/db/sql/normalise.ts` with its own unit-test suite (block comments, line comments, comments inside string literals, comments adjacent to `CHECK` expressions — the v0.1.2 culprits). Every migration runs through it before reaching the native binding.
- **Pre-migration backup.** When pending migrations exist on an existing install, copy `amban.db` → `amban.db.bak-vN` *before* opening the transaction. Prune older `.bak-*` files. Retain the latest backup for one launch after a successful run; prune on the second clean launch. On failure, expose it to the BootGate.
- **BootGate v2.** Extend `MigrationFailed` to render three CTAs: Retry, **Restore Backup** (only when a `.bak-*` exists for the previous schema), and Reset App (typed-confirmation). Surface the persisted error preview from `PreferenceKey.MigrationError` collapsibly. Show app version + commit SHA from `constants/buildInfo.ts`.
- **`PreferenceKey` additions.** `SchemaVersion`, `MigrationFailed`, `MigrationError`, `LastMigrationBackupVersion`. Document each in the preferences enum's doc-comment.
- **Deprecate `settings.onboarding_version` as a migration tracker.** Keep the column for onboarding-flow resumability; stop reading/writing it as a schema-version source-of-truth.
- **CI gate (`scripts/verify-migrations.ts`).** New script wired into the release workflow that:
  1. Asserts catalogue ↔ disk parity (versions + checksums).
  2. Spins up an Android emulator job, seeds an empty DB, runs every migration in order, asserts the final schema version equals `MIGRATION_CATALOG.at(-1).version`.
  3. For each prior shipped schema (v0.1.0 → 0.1.3), seeds a DB at that version's shape with representative rows, runs the runner against `HEAD`, and asserts every row survives + the schema version advances.
  4. Re-applies the v0.1.2-culprit comment-heavy migration on the native binding (regression test).
  5. Backup round-trip: take a backup, mutate the live DB, restore, verify byte-equal restoration.
- **Tag `release.yml` with the new gate.** The release workflow blocks on `verify-migrations` going green before assembling the APK.

Exit criteria: A user on v0.1.3 installing the v0.2.0 APK over their existing app sees zero data loss, lands directly on Home with their balance/logs/income/recurring intact, and the `schema_migrations` table reports versions 001 – latest applied. The CI upgrade matrix is green for every prior shipped version.

---

## Phase 19 — Burst Income / Manual Credits (v0.2.0)

Reference: [`CLAUDE.md` §6.6](./CLAUDE.md#66-burst-income--manual-credit-flow).

The `manual_credits` table has existed since 001; the financeStore already has `addManualCredit` / `deleteManualCredit`. This phase makes it a real first-class user surface, mirroring the daily spend log.

- **"Add income" entry point on Log tab.** Secondary action next to the existing daily-spend CTA. New `LogTab.tsx` becomes a chooser when both surfaces are present; the spend flow stays the default tap target.
- **`AddIncomeSheet` component.** Reuses `CurrencyInput`, `DatePicker`, the same notes-style label field, and the same sticky-footer save pattern from `DailyLogScreen`. Date defaults to today; back-dating allowed within `dailyStore.loadedDays`. Save → `financeStore.addManualCredit`.
- **Score recalc semantics.** Confirm `useAmbanScore` already folds `creditsSinceSnapshot` into effective balance per Phase 5; if anything was bypassing manual credits in scoring, fix and add a regression test.
- **History interleaving.** `LogHistory` expands to render manual credits alongside daily logs in a single chronological list. Credits get a green tone-token, a `+₹` prefix, and the source label as the row title. Spends keep the existing `−₹` treatment.
- **Edit / delete.** Long-press / swipe parity with daily logs. Editing an amount or date triggers the same medium-impact haptic + score recalc; delete uses the error-tone confirmation haptic.
- **Empty-state copy.** When the user has logged spends but no manual credits, surface a one-time hint card on Log tab: "Got a freelance payment or refund? Tap + Add income." Dismissable, single appearance per install.
- **Onboarding tweak.** Step 5 (recurring payments) gets a one-line explainer at the bottom: "Got irregular income? You can add it any time from the Log tab." No new onboarding step — the surface should discover itself.
- **Insights interaction.** `useInsights` already considers manual credits where appropriate (Lifestyle Cost, Savings Rate, Projected Month-End). Walk each generator and confirm the math is right when manual credits exist; add a fixture-based test.
- **SMS Capture handoff.** When Phase 20's parser produces a credit-direction suggestion, accepting it routes through this same `AddIncomeSheet` prefilled with the parsed amount + counterparty.

Exit criteria: A user can add a one-off ₹5,000 freelance credit from the Log tab; their Amban Score increases on the next render; the credit shows on Log History interleaved with spends; editing the amount updates the score; deleting it reverts the score; insights that depend on monthly income reflect the change.

---

## Phase 20 — SMS Capture & Auto-Suggestions (v0.2.0)

> Android-only. iOS entry points stay hidden.

Reference: [`CLAUDE.md` §15](./CLAUDE.md#15-sms-capture--auto-suggestions-android).

- **Custom Capacitor plugin `@amban/sms-reader`.** Native code lives in `android/app/src/main/java/io/amban/app/sms/`. Methods: `requestPermission()`, `checkPermission()`, `readSince({ sinceIso, limit })` returning `{ messageId, sender, body, receivedAt, simSlot }[]`. Wraps `android.provider.Telephony.Sms` reads via a `ContentResolver` query, no third-party SDKs.
- **Manifest changes.** Add `<uses-permission android:name="android.permission.READ_SMS" />` with `tools:ignore="ProtectedPermissions"` annotation explaining why. Listed in `Settings → Connected Sources → SMS Capture` only — not asked at install time, not asked at onboarding.
- **`004_sms_suggestions.sql` migration.** Per §15.7 schema. Ships through the Phase 18 runner.
- **`smsSuggestionsRepo`.** New typed repository: `listPending`, `listAll`, `markAccepted({ id, linkedLogId? , linkedCreditId? })`, `markDismissed`, `upsertParsed`, `lastReceivedAt`. Snake↔camel mapped like every other repo.
- **Parser (`src/utils/smsParser.ts`).** Pure function per §15.5. Templates for HDFC, ICICI, SBI, Axis, Kotak, IDFC, GPay, PhonePe, Paytm, BHIM. Each template named, regex-only, returns `{ amount, direction, counterparty?, accountLast4?, referenceId?, confidence }`. Marketing/promotional sender allowlist gating. Unit tests per template against fixtures captured from real SMS bodies (anonymised).
- **Scan orchestrator (`src/utils/smsScan.ts`).** On app resume + cold start: reads `last_sms_scan_at` from prefs, calls plugin `readSince`, runs every message through the parser, drops null + sub-confidence parses, upserts surviving suggestions into `sms_suggestions` (idempotent on `message_id`), updates `last_sms_scan_at`. Time-budgeted (≤1s on a mid-tier device); larger backfills queued behind an idle callback.
- **`smsSuggestionsStore` (Zustand).** `pending: SmsSuggestion[]`, `hydrate()`, `accept(id, mode)`, `dismiss(id)`, `clearAll()`. Subscribed to by the inbox surfaces.
- **Suggestion inbox UI.** Per §15.6. Card on Home above the insight carousel (collapsible header, max 3 visible, "See all…" link to a full inbox screen at `/log/suggestions`). A row in the Log tab lists pending suggestions chronologically.
- **One-tap accept paths.**
  - Debit → opens `DailyLogScreen` prefilled with `amount` + counterparty in notes; on save, `markAccepted` + `linked_log_id` set.
  - Credit → opens `AddIncomeSheet` (Phase 19) prefilled with `amount` + counterparty as label; on save, `markAccepted` + `linked_credit_id` set.
  - Both routes are additive to existing entries (don't blow away today's already-logged amount).
- **Edit-before-confirm sheet.** Tapping the suggestion row body (not the action buttons) opens an editable sheet; saving routes through the same accept paths.
- **Settings surface.** New `Settings → Connected Sources → SMS Capture`:
  - Master toggle (off by default).
  - Permission status row.
  - Scan-window selector (last 7 / 14 / 30 days).
  - "Clear all suggestions" destructive action.
  - Privacy reaffirmation copy lifted verbatim from §15.8.
- **Permission UX.** Pre-permission rationale screen before the OS dialog. Denied path: settings row stays off, single "Try again" affordance, no nag. Revocation handled gracefully on next resume.
- **Reset App integration.** `resetApp()` (Appendix I) cancels any pending scan and clears `sms_suggestions` along with everything else.
- **iOS gating.** Settings row, store, scan orchestrator, and plugin import all behind a `Capacitor.getPlatform() === 'android'` check. iOS builds must not import the plugin.
- **Dev-only diagnostics.** Behind the existing `/styleguide` route (DEV-only): a screen listing recent SMS sender + body fingerprints that the parser couldn't classify. Helps grow the template library from real-world samples without telemetry.

Exit criteria: An Android user toggles SMS Capture on, grants permission, and on next resume sees an inbox with their recent UPI/card transactions parsed and ready to one-tap accept. Accepted debits land in `daily_logs`, accepted credits land in `manual_credits`, both link back to the source `sms_suggestions.id`. Dismissed suggestions never re-surface. Zero network calls leave the device. iOS builds compile and run with no SMS surfaces visible.

---

## Phase 21 — Notifications Hardening (v0.2.0)

The Phase 12 scheduler shipped wired but the daily prompt has not been observably firing on real devices. This phase hunts down every reason that's true.

- **Android 13+ runtime permission flow.** `POST_NOTIFICATIONS` is already in the manifest. Add an explicit `LocalNotifications.requestPermissions()` call at the moment the user first hits the notification step in onboarding (existing) **and** a re-ask on first launch after upgrade for users who completed onboarding pre-v0.2 (where the prompt may have been suppressed). Track the request via `PreferenceKey.NotificationsRuntimeAsked`.
- **Exact-alarm gating.** On Android 12+ (`SCHEDULE_EXACT_ALARM`), check `AlarmManager.canScheduleExactAlarms()` via a tiny native bridge. If false: schedule using inexact alarms, surface a non-blocking banner in `NotificationSettings` explaining the timing may drift by 10–15 minutes, with a "Open exact-alarm settings" CTA that deep-links to the OS toggle. Never block the user.
- **OEM battery-saver diagnostics.** Detect Xiaomi (MIUI), OPPO (ColorOS), Vivo (Funtouch), Realme, Samsung (One UI) via `Build.MANUFACTURER` and surface a one-time post-onboarding card explaining that these OEMs aggressively kill background tasks and offering a deep-link to the relevant battery-saver settings page. Dismissable, persisted dismissal, no nag.
- **Schedule verification.** Extend `useNotifications` with a `getScheduledFingerprint()` helper that re-reads `LocalNotifications.getPending()` after every reschedule and asserts the daily prompt's `id: 1000` is present with the expected fire time. Mismatch → dev-only console warning + a `PreferenceKey.LastSchedulerError` record consulted by the diagnostics screen.
- **Boot-completed handler.** `RECEIVE_BOOT_COMPLETED` is already in the manifest. Confirm Capacitor's notification plugin handles re-registration on device reboot; if not, add a small native receiver that re-runs `scheduleAllNotifications` on boot via a one-shot WorkManager job.
- **Dev-only test-fire affordance.** New row in `Settings → Notifications` (DEV builds only): "Send test notification in 10 seconds." Schedules a one-shot in the daily-prompt template so the user can verify the path without waiting until 9 PM.
- **Diagnostics screen.** New DEV-only `Settings → Notifications → Diagnostics` exposing: permission status, exact-alarm capability, last successful schedule timestamp, current pending notifications dump, last scheduler error, OEM detected. Shipped behind `import.meta.env.DEV` so it's not in release builds (but available in any internal QA build).
- **`docs/NOTIFICATIONS.md`.** Document Android 13+ permission, exact-alarm semantics, the OEM kill-list, and the test-fire procedure. Update when iOS lands.
- **On-device verification matrix.** Before tagging v0.2.0, verify on at least one device per OEM bucket (one Pixel, one Xiaomi, one Samsung, one OPPO/Vivo if available) that:
  1. Daily prompt fires at the configured time after a cold-start the previous day.
  2. Daily prompt fires after the app is fully killed (force-stopped — OEM-dependent).
  3. Daily prompt fires after a device reboot.
  4. Tapping the prompt deep-links into `/log` via `amban://log`.
  5. Upcoming-payment + salary-day notifications fire on their correct dates.
  6. Disabling the master toggle cancels every pending notification.
- **Notification copy refresh.** Walk §10.1 templates and confirm they're alive in the deterministic-rotation array; add 2–3 more variants so the rotation feels less tight to long-term users.

Exit criteria: A v0.2.0 user with notifications enabled receives the daily prompt at their configured time on every supported OEM bucket. The diagnostics screen shows the path is healthy. The OEM-specific battery-saver card appears once on affected devices and never again after dismissal. Tapping the prompt always opens the Daily Log screen.

---

## Phase 22 — Android Instrumented E2E Testing (v0.2.0)

> The automated release gate. If the suite is red, the tag doesn't ship.

Reference: [`CLAUDE.md` §17](./CLAUDE.md#17-android-instrumented-e2e-testing), [Appendix K](./CLAUDE.md#appendix-k-e2e-test-matrix).

This phase builds the full instrumented test suite that exercises every user-facing feature and edge case on an emulated Android device before release. amban.io is local-only — there is no server to mock. The only way to prove it works is to drive the compiled APK on a real Android runtime.

### Scaffolding & Helpers

- **Espresso-Web helper (`WebViewHelper.java`).** Utility class that wraps Espresso-Web interactions against the Capacitor WebView. Provides methods to wait for the WebView to be idle, find elements by `data-testid` / `aria-label` / CSS selector, type into WebView inputs, and assert visible text content. Every E2E test delegates WebView interaction through this helper.
- **DB seeder (`DbSeeder.java`).** Seeds SQLite with a known state (onboarded user, balance, income, recurring, daily logs) for each prior shipped schema version. Provides named factory methods (`seedOnboardedUser`, `seedWithLogs`, `seedAtSchemaVersion`) so tests stay declarative. Reads fixture files from `androidTest/assets/`.
- **SMS injector (`EmulatorSmsInjector.java`).** Inserts SMS rows into the emulator's `Telephony.Sms` content provider for parser and SMS-capture tests. Wraps `ContentResolver.insert()` with the fixtures from `androidTest/assets/sms_fixtures.json`.
- **Gradle test dependencies.** Add `androidTestImplementation` entries for `espresso-core`, `espresso-web`, `espresso-intents`, `uiautomator`, and `test-runner` to `android/app/build.gradle`.

### E2E Flow Tests

| Test Class | Spec Ref | What It Proves |
|---|---|---|
| `OnboardingFlowTest` | §6.1, §13.8 | Full onboarding end-to-end (name → income → balance → recurring → notifications → score). Kill-and-resume mid-flow. Relaunch lands on Home. |
| `DailyUseFlowTest` | §6.2, §8.3, §9.2, §13.6 | Log a spend, score drops by `spend/daysLeft`. Quick-amount chips are additive. Backfill missed days. Post-save toast tone matches rule. |
| `BalanceUpdateFlowTest` | §6.3, §8.3 | Update balance, score recalculates, new `balance_snapshots` row. |
| `IncomeCreditFlowTest` | §6.4 | Salary-day banner visible on credit day, balance update prefilled with `currentBalance + incomeAmount`. |
| `RecurringPaymentFlowTest` | §6.5 | Upcoming payment chips appear within `UPCOMING_PAYMENT_WARN_DAYS`. |
| `ManualCreditFlowTest` | §6.6 | Add burst income, score increases, `manual_credits` row inserted. |
| `SmsCaptureFlowTest` | §15 | Grant `READ_SMS`, enable capture, trigger scan, verify inbox, accept as spend/income, dismiss. |
| `ResetAppFlowTest` | Appendix I | Full wipe, all tables empty, Welcome screen, re-onboarding succeeds. |

### Scoring & Edge Case Tests

| Test Class | Spec Ref | What It Proves |
|---|---|---|
| `AmbanScoreTest` | §8.1, §8.2 | Score formula on the native SQLite binding. Status colour thresholds (healthy / watch / critical). |
| `ScoreEdgeCasesTest` | §13.1–§13.8 | First day (no logs) → green. Income day = today → full cycle. Multiple sources → earliest wins. Day-31 clamping. Negative balance → ₹0 clamped. Recurring already paid → not double-deducted. |
| `ScoreRecalcTriggersTest` | §8.3 | Score recalculates after: log save, balance update, income add/edit/delete, recurring add/edit/delete. |

### Database Migration Tests

| Test Class | Spec Ref | What It Proves |
|---|---|---|
| `FreshInstallMigrationTest` | §14.8 check 1 | Empty DB → all migrations → schema version = latest. |
| `UpgradeMatrixTest` | §14.8 check 2 | For each prior shipped version: seed, run migrations, assert all rows survive. |
| `CatalogueDriftTest` | §14.8 check 3 | `MIGRATION_CATALOG` matches on-disk `migrations/` exactly. |
| `CommentHeavySqlTest` | §14.8 check 4 | Migration 002 (the v0.1.2 culprit) applies on the native binding. |
| `BackupRoundTripTest` | §14.8 check 5 | Take backup, corrupt live DB, restore, verify all rows intact. |

### Notification Tests

| Test Class | Spec Ref | What It Proves |
|---|---|---|
| `NotificationScheduleTest` | §10, Appendix E | Daily prompt (id=1000) is present in pending notifications after schedule. Recurring and salary notifications in their ID ranges. |
| `PermissionFlowTest` | §10, Phase 21 | `POST_NOTIFICATIONS` runtime dialog appears on API 33+, grant works. |
| `DeepLinkTest` | §10.1 | `amban://log` routes to the Daily Log screen. |

### SMS Tests

| Test Class | Spec Ref | What It Proves |
|---|---|---|
| `SmsReaderPluginTest` | §15.2 | Native plugin permission check + read through the real `Telephony` provider. |
| `SmsParserAccuracyTest` | §15.5 | ≥ 90% (18/20) fixtures parsed correctly on the native runtime. |
| `SmsSuggestionLifecycleTest` | §15.6 | Accept as spend → `linked_log_id` set. Accept as income → `linked_credit_id` set. Dismiss → never in pending again. |

### Settings & Privacy Tests

| Test Class | Spec Ref | What It Proves |
|---|---|---|
| `ThemeToggleTest` | §9.5 | Light → dark → system toggles work; `data-theme` attribute correct. |
| `ExportDataTest` | Phase 13 | Exported JSON parses, contains expected top-level keys. |
| `PrivacyZeroNetworkTest` | §12 | Full flow (onboarding → log → insights → settings → export) with network disabled: zero failures, zero outbound connections in logcat. |

### CI Workflow (`e2e-android.yml`)

- Runs on every push to `main` and every PR targeting `main`.
- Steps: checkout → Java 17 → Node (`.nvmrc`) → `npm ci` → `npm run build` → `npx cap sync android` → spin up API 34 Pixel 6 emulator via `reactivecircus/android-emulator-runner@v2` (KVM-accelerated, headless, `swiftshader_indirect` GPU) → `./gradlew connectedAndroidTest` → upload HTML test reports as artifact.
- Timeout: 45 minutes.
- **Release gate rule:** the `e2e-android` workflow must be green on the same commit SHA before `git tag`. The release workflow checks this.

### Nightly Extended Matrix

A cron-triggered nightly job runs the full suite across five emulator profiles:

| API Level | Profile | Purpose |
|---|---|---|
| 23 (6.0) | Nexus 5 | Minimum supported API |
| 28 (9) | Pixel 3 | Pre-notification-channel baseline |
| 30 (11) | Pixel 4 | Scoped storage boundary |
| 33 (13) | Pixel 6 | `POST_NOTIFICATIONS` runtime permission boundary |
| 34 (14) | Pixel 7 | Latest stable |

Failures auto-create a GitHub issue tagged `e2e-nightly-failure` with the profile, failing test, and logcat excerpt.

### Test Data Discipline

- **No hardcoded dates.** Clock abstraction or parameterised `today`.
- **Isolated state.** `@Before` wipes DB + Preferences. No inter-test dependencies.
- **Fixture files over inline data.** SMS fixtures, migration snapshots, seeded DB states in `androidTest/assets/`.
- **Deterministic amounts.** Coprime values (₹1,111 / ₹2,222 / ₹3,333) so assertions are unambiguous.

### Local Dev Workflow

```amban.io/ROADMAP.md#L1-5
# Start the emulator
emulator -avd Pixel_6_API_34 -no-snapshot -gpu host

# Build web + sync into native project
npm run build && npx cap sync android
```

```amban.io/ROADMAP.md#L1-7
# Run the full suite
cd android && ./gradlew connectedAndroidTest

# Run a single test class
./gradlew connectedAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=io.amban.app.e2e.OnboardingFlowTest
```

Results in `android/app/build/reports/androidTests/connected/`.

Exit criteria: Every row in [Appendix K](./CLAUDE.md#appendix-k-e2e-test-matrix) is green on the CI emulator. The nightly extended matrix has run at least once clean across all five API levels. A developer can clone the repo, start an emulator, and run the full suite with three commands. No release tag ships without the `e2e-android` workflow green on that commit.

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

---

## Definition of Done for v0.2.0

v0.2.0 is in addition to (not a replacement for) the initial-release checklist above. It ships when **all** of the following are also true:

1. Installing v0.2.0 over any v0.1.x build preserves every row in every table; the user lands on Home with no visible reset.
2. The `verify-migrations` CI suite (§14.8) is green: catalogue parity, fresh-install matrix, upgrade matrix against every prior shipped schema, comment-heavy regression, backup round-trip.
3. The BootGate's `MigrationFailed` screen offers Retry, Restore Backup (when applicable), and Reset App — each one tested manually with a deliberately broken migration in a dev build.
4. Burst income flow (§6.6 / Phase 19) is reachable from the Log tab; adding/editing/deleting a manual credit moves the Amban Score in the expected direction within one frame.
5. SMS Capture (§15 / Phase 20) is shippable on Android: opt-in, parses real-world UPI + card SMS at ≥90% accuracy on the test fixture set, one-tap accept routes correctly to spend or income, zero network calls in the bundle.
6. The daily notification prompt has been observed firing on a real device for at least three consecutive days across the Pixel + one OEM bucket, with the deep-link routing into `/log`.
7. iOS build still compiles cleanly with all SMS surfaces gated off and no regressions in the existing Phase 13 surfaces.
8. The `e2e-android` CI workflow is green: every row in Appendix K passes on the API 34 emulator, and the nightly extended matrix (API 23–34) has completed at least one clean run.
9. A new contributor can clone the repo, start an emulator, and execute the full instrumented suite with `npm run build && npx cap sync android && cd android && ./gradlew connectedAndroidTest` — no manual setup beyond the emulator AVD.
