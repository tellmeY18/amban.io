# CLAUDE.md — amban.io Finance Tracker

> Spec and dev guide for the amban.io mobile-first finance tracker (CapacitorJS + Ionic).

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Design System](#3-design-system)
4. [App Architecture](#4-app-architecture)
5. [Data Models](#5-data-models)
6. [User Flows](#6-user-flows)
7. [Core Business Logic](#7-core-business-logic)
8. [The Amban Score](#8-the-amban-score)
9. [Screens & UI Spec](#9-screens--ui-spec)
10. [Notifications](#10-notifications)
11. [Insights Engine](#11-insights-engine)
12. [Local Storage Strategy](#12-local-storage-strategy)
13. [Edge Cases & Rules](#13-edge-cases--rules)
14. [Database Resilience & Migration Discipline](#14-database-resilience--migration-discipline)
15. [SMS Capture & Auto-Suggestions (Android)](#15-sms-capture--auto-suggestions-android)
16. [In-App Updater (Alpha Distribution, Android)](#16-in-app-updater-alpha-distribution-android)
17. [Future Scope](#17-future-scope)
18. [Android Instrumented E2E Testing](#18-android-instrumented-e2e-testing)
19. [Appendices](#appendices)

---

## 1. Project Overview

**App Name:** amban.io
**Tagline:** *Know your number. Own your day.*
**Platform:** iOS + Android via CapacitorJS (Ionic)
**Data Policy:** 100% local. No network calls. No accounts. No cloud sync.

### Core Loop

1. Set up finances once (income, balance, recurring costs).
2. Every day, amban shows your safe-to-spend number (**Daily Amban Score**).
3. Every evening, log what you actually spent.
4. Over time, amban builds insight into your lifestyle cost.

---

## 2. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | React (Vite) | Paired with Ionic React for UI primitives |
| Mobile Runtime | CapacitorJS | iOS + Android binary generation |
| UI Library | Ionic React + custom components | Material-inspired, custom CSS |
| Local DB | `@capacitor-community/sqlite` | Structured storage via SQLite |
| Notifications | `@capacitor/local-notifications` | Daily spend prompts |
| State Management | Zustand | Lightweight, no boilerplate |
| Date/Time | `date-fns` | |
| Charts | Recharts | Trend visualizations |
| Icons | Ionicons (bundled with Ionic) | |
| Styling | CSS Modules + CSS Custom Properties | No Tailwind; hand-crafted design tokens |

### Capacitor Plugins

`@capacitor/local-notifications`, `@capacitor-community/sqlite`, `@capacitor/preferences`, `@capacitor/haptics`, `@capacitor/status-bar`, `@capacitor/keyboard`

---

## 3. Design System

### Philosophy

Custom Material Design 3 aesthetic — sharper edges, financial data-first, premium Indian fintech feel (Jupiter/Fi Money style) but lighter and faster.

### Color Palette

```css
:root {
  --color-primary: #1A73E8;
  --color-primary-light: #E8F0FE;
  --color-primary-dark: #1557B0;

  --color-score-excellent: #1E8C45;  /* Green: healthy */
  --color-score-good: #F29900;       /* Amber: watch it */
  --color-score-warning: #E94235;    /* Red: critical */

  --color-bg: #F8F9FA;
  --color-surface: #FFFFFF;
  --color-surface-variant: #F1F3F4;
  --color-text-primary: #202124;
  --color-text-secondary: #5F6368;
  --color-text-disabled: #BDC1C6;
  --color-divider: #E0E0E0;

  /* Dark Mode */
  --color-bg-dark: #121212;
  --color-surface-dark: #1E1E1E;
  --color-surface-variant-dark: #2A2A2A;
  --color-text-primary-dark: #E8EAED;
  --color-text-secondary-dark: #9AA0A6;
}
```

### Typography

- Display font: `'DM Sans'` (headings, score numbers)
- Body font: `'Inter'` (body text)
- Scale: `--text-score: 3.5rem`, `--text-h1: 1.75rem`, `--text-h2: 1.25rem`, `--text-h3: 1rem`, `--text-body: 0.875rem`, `--text-caption: 0.75rem`, `--text-micro: 0.625rem`

### Spacing & Radius

- Spacing: `xs:4px`, `sm:8px`, `md:16px`, `lg:24px`, `xl:32px`, `2xl:48px`
- Radius: `sm:8px`, `md:12px`, `lg:16px`, `xl:24px`, `pill:999px`
- Shadows: `--shadow-card: 0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.05)`, `--shadow-elevated: 0 4px 16px rgba(0,0,0,0.12)`

### Score Color Rule

| Ratio (today / 30-day avg) | Color | Label |
|---|---|---|
| ≥ 90% | `--color-score-excellent` | Healthy |
| 60–89% | `--color-score-good` | Watch it |
| < 60% | `--color-score-warning` | Critical |

---

## 4. App Architecture

```
src/
├── main.tsx
├── App.tsx
├── db/
│   ├── schema.sql
│   ├── db.ts
│   └── migrations/
├── stores/
│   ├── userStore.ts
│   ├── financeStore.ts
│   ├── dailyStore.ts
│   └── settingsStore.ts
├── hooks/
│   ├── useAmbanScore.ts
│   ├── useInsights.ts
│   └── useNotifications.ts
├── screens/
│   ├── Onboarding/
│   ├── Home/
│   ├── Log/
│   ├── Insights/
│   ├── Settings/
│   └── Profile/
├── components/
│   ├── ui/ (Card, Badge, BottomSheet, CurrencyInput, DatePicker, ProgressRing)
│   └── layout/ (AppShell, BottomNav)
├── utils/
│   ├── scoring.ts
│   ├── dateHelpers.ts
│   ├── formatters.ts
│   └── insightGenerators.ts
└── constants/
    ├── categories.ts
    └── insightThresholds.ts
```

---

## 5. Data Models

### SQLite Schema

```sql
CREATE TABLE IF NOT EXISTS user (
  id INTEGER PRIMARY KEY DEFAULT 1,
  name TEXT NOT NULL,
  currency TEXT DEFAULT 'INR',
  created_at TEXT NOT NULL,
  onboarding_complete INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS income_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  amount REAL NOT NULL,
  credit_day INTEGER NOT NULL,       -- 1–31
  is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS balance_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amount REAL NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recurring_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  amount REAL NOT NULL,
  due_day INTEGER NOT NULL,          -- 1–31
  category TEXT NOT NULL,
  is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS daily_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_date TEXT NOT NULL UNIQUE,     -- YYYY-MM-DD
  spent REAL NOT NULL DEFAULT 0,
  notes TEXT,
  score_at_log REAL,
  logged_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS manual_credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  amount REAL NOT NULL,
  credited_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  notification_time TEXT DEFAULT '21:00',
  notifications_enabled INTEGER DEFAULT 1,
  theme TEXT DEFAULT 'system',
  onboarding_version INTEGER DEFAULT 1
);
```

### Zustand Store Shapes

See `src/stores/*.ts` for full implementations. Key interfaces:

- **UserStore:** `name`, `currency`, `onboardingComplete`
- **FinanceStore:** `currentBalance`, `lastBalanceUpdate`, `incomeSources[]`, `recurringPayments[]`
- **DailyStore:** `logs[]`, `todayLog`, `logSpend()`, `fetchLogs()`

---

## 6. User Flows

### 6.1 Onboarding (First Launch)

Steps: Welcome → Name/Emoji → Income Sources (≥1 required) → Bank Balance → Recurring Payments (skippable) → Notification Setup → Score Reveal → Home

Key rules:
- At least ONE income source required to proceed past Step 2.
- Balance snapshot date = today.
- Permission request happens at Notification step.
- `onboarding_complete` only set after all steps done.

### 6.2 Daily Use

Morning: Home shows score, yesterday's spend, upcoming payments, insight cards.
Evening: Notification fires → Daily Log screen → amount + optional notes → save → score recalculates.

Post-save feedback: green toast (under score), blue (on target), amber (over score).

### 6.3 Balance Update

Settings → Update Balance → new amount → inserts `balance_snapshot` → score recalculates.

### 6.4 Income Credit (Automatic)

On `creditDay`: banner on Home → "Yes, update balance" (prefills `current + income`) or "Not yet" (dismisses).

### 6.5 Recurring Payment Warning

When `dueDay` within 3 days: chip on Home, purely informational.

### 6.6 Burst Income / Manual Credit Flow

> **Active Phase 19 work.**

```
Log tab → "+ Add income" (secondary action next to spend)
  • Amount input (₹)
  • Label (free text, e.g. "Freelance — logo design", "Refund — Amazon")
  • Date (defaults to today; back-dating allowed within the loaded window)
  • Save → inserts into `manual_credits`
```

Rules:
- Manual credits with `credited_at >= latestBalanceSnapshot.recorded_at` are added to the effective balance used by the score (mirroring the snapshot-relative semantics of `spendSinceLastSnapshot`).
- They are **never** auto-applied to the balance snapshot itself — the snapshot stays append-only and user-controlled.
- Manual credits show up in Log History interleaved with spends, distinguished by sign and a green tone-token.
- Editing or deleting a manual credit triggers a score recalc just like a daily log mutation.
- Same haptic ladder as spend logging: success on save, medium-impact on edit, error on delete-confirm.

This flow is the income-side mirror of the existing daily spend log; reuse the same `CurrencyInput`, the same backfill sheet pattern, and the same toast/haptic vocabulary so the user doesn't context-switch.

---

## 7. Core Business Logic

### 7.1 Balance Tracking

```
effectiveBalance = latestBalanceSnapshot
                  - SUM(recurringPaymentsDueBeforeNextIncome)
                  - SUM(dailySpendLogged since lastBalanceSnapshot)
```

> **Key Rule:** Recurring payments due *before the next income credit date* are pre-deducted. This prevents the score from being falsely optimistic.

### 7.2 Days Left Calculation

```
nextIncomeDate = next occurrence of any income source's creditDay (earliest across all sources)
daysLeft = differenceInCalendarDays(nextIncomeDate, today)  // min 1
```

### 7.3 Pre-Deducting Recurring Payments

```
upcomingRecurring = recurringPayments WHERE dueDay >= today AND dueDay <= nextIncomeDate
                   AND NOT already paid this month
totalUpcomingRecurring = SUM(amounts)
```

### 7.4 Daily Spend Deduction

```
spendSinceLastSnapshot = SUM(daily_logs WHERE log_date >= lastBalanceSnapshotDate)
```

---

## 8. The Amban Score

### 8.1 Formula

```
ambanScore = (effectiveBalance - totalUpcomingRecurring) / daysLeft
```

Where:
- `effectiveBalance = latestBalanceSnapshot.amount - spendSinceLastSnapshot`
- `totalUpcomingRecurring = SUM of recurring payments due before next income`
- `daysLeft = calendar days until next income (min 1)`

Result: **₹/day** — the safe daily spending amount. Clamped at ₹0 (never negative).

### 8.2 Score Display

Format: `₹ X,XXX per day`. Color based on ratio to 30-day average (see §3 Score Color Rule). On first launch (no history): always Green.

### 8.3 Score Recalculation Triggers

1. App foreground resume
2. After daily spend log saved
3. After balance update
4. After income source or recurring payment change
5. At midnight (silent)

### 8.4 Score History

`score_at_log` stored on every daily log — builds trend data for charts and insights.

---

## 9. Screens & UI Spec

> Implementation complete. Key behavioral rules preserved below. See code for full layouts.

### 9.1 Home Screen

- Score Card (top): greeting + big score number + balance/next-income/upcoming-bills metadata
- Yesterday's Spend: logged status with comparison to score, or "Log now" CTA
- Upcoming Payments: horizontal scrollable chips (next 7 days)
- Insight Carousel: 1–3 swipeable cards, auto-rotates every 5s
- Bottom Nav: `[Home] [Log] [Insights] [Settings]`

### 9.2 Daily Log Screen

- Large numeric input with quick-amount chips (additive: tapping ₹500 twice = ₹1,000)
- Optional notes field
- Post-save toast: green (under) / blue (on target) / amber (over)

### 9.3 Log History

List grouped by week, color dot per row (vs score), expandable for notes. 30-day mini bar chart at top.

### 9.4 Insights Screen

Spending Trend line chart, Monthly Summary pie, Projection Cards, Recurring Breakdown bar.

### 9.5 Settings Screen

Profile, Income Sources, Recurring Payments, Update Balance, Notification Time, Theme, Reset App.

---

## 10. Notifications

### Types & Timing

| Type | When | ID |
|---|---|---|
| Daily spend prompt | User-configured time (default 9 PM), repeats daily | `1000` |
| Upcoming payment | 2 days before `dueDay` | `2000 + payment.id` |
| Salary day | On `creditDay` | `3000 + source.id` |

### Message Templates

**Daily** (rotate randomly):
- "Hey [Name]! 👋 How much did you spend today?"
- "End of day check-in 📊 Log your spend to keep your score accurate."
- "Quick question — what did today cost you? 💸"
- "Don't lose track! Log today's spend before you sleep. 🌙"
- "Your amban score is waiting to be updated. What did you spend? 📱"

**Upcoming payment:** "📅 [Label] (₹[Amount]) is due in 2 days. Make sure your balance is ready."

**Salary day:** "🎉 It's salary day! Did ₹[Amount] land in your account? Update your balance to get an accurate score."

### Scheduling Rules

- On every schedule pass, cancel all existing IDs in range before rescheduling.
- Reschedule on: app launch, settings change, income/recurring payment change.
- See `useNotifications.ts` for implementation.

---

## 11. Insights Engine

Each insight has: **headline**, **supporting number**, **emoji/icon**. Shown as cards in Home carousel and Insights screen.

### 11.1 Lifestyle Cost

`idealIncome = (avgDailySpend * 30) + totalMonthlyRecurring + (avgDailySpend * 30 * 0.20)`

### 11.2 Savings Rate

`savingsRate = ((monthlyIncome - monthlySpend) / monthlyIncome) * 100`
Color: >30% green, 15–30% amber, <15% red.

### 11.3 Streak

`spendingStreak = consecutive days where spent <= ambanScore` (min 3 days to show)

### 11.4 Biggest Cost

`topRecurring` as % of `monthlyIncome`

### 11.5 Projected Month-End Balance

`projectedBalance = currentBalance - upcomingRecurring - (avgDailySpend * daysLeft) + upcomingIncome`

### 11.6 Best & Worst Day

Min/max `spent` from last 30 daily logs.

### 11.7 Lifestyle Upgrade

Triggered when avg spend > score for 7+ consecutive days. Shows extra income needed.

### 11.8 Coffee Math

Map `avgDailySpend` to equivalent common products (chai, movie tickets, restaurant meals).

### 11.9 Income Day Countdown

Shown only when ≤7 days until next income.

### 11.10 Priority / Display Rules

- Max 3 insight cards on Home carousel.
- Sort: warnings > time-sensitive > informational.
- Swipe-dismiss suppresses for 24h.

---

## 12. Local Storage Strategy

- **SQLite** (`@capacitor-community/sqlite`): All structured data.
- **Capacitor Preferences**: `onboarding_complete`, `last_notification_schedule_date`, `dismissed_insights`, `app_version`, migration state keys.
- **No External Calls Policy:** Zero analytics, zero network requests, no crash reporting.

---

## 13. Edge Cases & Rules

### 13.1 First Day (No Logs Yet)

- Score is calculated purely from balance + recurring + income date.
- Insights that require logs (streak, avg spend, best/worst day) are hidden.
- Show a prompt: "Log your first spend today to unlock insights!"

### 13.2 Income Day = Today

If today is the user's `creditDay`:
- Show the salary day banner.
- `daysLeft` = days until NEXT month's income (approx 28–31 days).
- Score will reflect full month's budget starting today.

### 13.3 Multiple Income Sources

- `nextIncomeDate` = earliest upcoming credit date across all sources.
- All income sources are independent — they don't stack for the score calculation (only the next one matters for daysLeft).
- Exception: If two income sources credit on the same day, their amounts combine.

### 13.4 Recurring Payment Due Day > Days in Month

e.g. `dueDay = 31` but month has 30 days → use last day of the month.

```typescript
function getActualDueDate(dueDay: number, month: Date): Date {
  const lastDay = endOfMonth(month).getDate();
  return setDate(month, Math.min(dueDay, lastDay));
}
```

### 13.5 Balance Goes Negative

If `effectiveBalance - upcomingRecurring < 0`:
- Score = ₹0 (clamp at 0, never show negative)
- Show a red warning banner: "⚠️ Your projected balance may not cover upcoming bills."

### 13.6 No Daily Log for Multiple Days

If the user hasn't logged for N days (N > 1):
- The score calculation does not assume any spend for those days.
- Show a gentle nudge: "You haven't logged in [N] days. Your score may not reflect actual spend."
- Optionally, allow batch logging: "Log missed days" → date-picker + amount per day.

### 13.7 Recurring Payment Already Paid This Month

If a recurring payment's `dueDay` has passed and the user has already updated their balance (implying it's been paid), do NOT pre-deduct it again. The assumption: balance snapshot captures post-payment state.

**Rule:** Only pre-deduct a recurring payment if `dueDay >= today` AND `dueDay <= nextIncomeDate`.

### 13.8 Onboarding Incomplete / App Kill Mid-Onboarding

- Store each onboarding step's completion in Preferences.
- On relaunch, resume from last incomplete step.
- `onboarding_complete` flag only set to true after Step 5 (notifications).

---

## 14. Database Resilience & Migration Discipline

> **The single most important non-feature in amban.io.** Users have lived with this app for months. A broken migration on app upgrade means lost income data, broken score history, and a betrayal of the local-first promise (there is no cloud to recover from). This section is the contract every release must honour.

### 14.1 Non-Negotiable Guarantees

1. **A clean install must succeed.** First-launch on a brand-new device opens the DB, applies every migration in order, and lands on the Welcome screen. No retry required.
2. **An upgrade must never lose data.** Installing a newer version over an older version applies only the *unapplied* migrations and preserves every existing row. The user must not see their balance, logs, income, or recurring payments reset.
3. **A failed migration must be recoverable without data loss in the common case.** Transient failures (locked DB, OS interrupt) self-heal on next launch. The destructive "Reset App" path is the *escape hatch*, never the default.
4. **Migrations are append-only and immutable.** Once `00X_*.sql` ships in a tagged release, its contents are frozen. Bug fixes ship as new migrations.
5. **The runner does not depend on the SQLite plugin's SQL splitter.** `stripSqlComments` + statement normalisation runs before any SQL hits the native binding (see v0.1.3 fix).

### 14.2 Versioning Model

- Schema version is owned by **two** mirrored stores so a corrupted Preferences cache cannot brick a working DB and vice versa:
  - SQLite: `schema_migrations` table (one row per applied migration with `version`, `applied_at`, `checksum`).
  - Preferences: `PreferenceKey.SchemaVersion` integer (the highest applied version).
- On boot, the runner reconciles the two: the SQLite table is the source of truth; the Preferences value is updated to match. If Preferences disagrees, no harm — it gets corrected.
- The legacy `settings.onboarding_version` column is **deprecated** as a migration tracker (kept only as an onboarding-flow marker for resumability).

```sql
-- Shipped in 003_schema_migrations.sql for v0.2.0.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,        -- SHA-256 of the normalised SQL
  applied_at TEXT NOT NULL
);
```

### 14.3 Migration File Rules

- Numbered `NNN_short_name.sql`, three-digit zero-padded, monotonically increasing.
- Each file is registered in `src/db/migrations/index.ts` with `{ version, name, sql, checksum }`. **The catalogue is asserted at boot** — if a file exists on disk that the catalogue doesn't know about (or vice versa), the build fails in dev and the boot path renders the migration-failure screen in prod.
- A CI integration test (`scripts/verify-migrations.ts`) reconciles the on-disk migration files against the catalogue **and** runs every migration sequentially against an empty DB on a real native binding (Android emulator job in CI). This guardrail blocks the v0.1.2 / v0.1.3 class of bug at PR time, not at release time.
- Allowed operations: `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN`, `CREATE INDEX IF NOT EXISTS`, idempotent `INSERT OR IGNORE` seeds, data backfills wrapped in `INSERT OR IGNORE` / `UPDATE … WHERE` guards.
- Forbidden: `DROP TABLE` against a populated table, destructive `ALTER TABLE` shapes, anything that depends on a specific prior data state without an idempotent guard.
- **Table renames / column drops** use the rebuild-and-rename pattern in a single migration: create new shape, copy data with explicit column mapping, drop old, rename new — all inside the runner's transaction.

### 14.4 Runner Behaviour

```typescript
// Pseudo-code; real impl lives in src/db/db.ts
async function runMigrations(db) {
  await db.execute(SCHEMA_MIGRATIONS_DDL);                 // bootstrap the tracker table
  const applied = await readAppliedVersions(db);           // Set<number>
  const pending = MIGRATION_CATALOG.filter(m => !applied.has(m.version));
  if (pending.length === 0) return;

  for (const m of pending) {                               // one transaction per migration
    const sql = stripSqlComments(m.sql);
    try {
      await db.execute('BEGIN');
      await db.execute(sql, /* transaction= */ false);     // single-statement-aware
      await db.run(
        'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?,?,?,?)',
        [m.version, m.name, m.checksum, nowIso()],
      );
      await db.execute('COMMIT');
    } catch (err) {
      await db.execute('ROLLBACK');
      await prefs.setBool(PreferenceKey.MigrationFailed, true);
      await prefs.setString(PreferenceKey.MigrationError, formatErr(err, sql));
      throw err; // BootGate renders MigrationFailed screen
    }
  }
  await prefs.setNumber(PreferenceKey.SchemaVersion, MIGRATION_CATALOG.at(-1).version);
}
```

Key properties:
- **Per-migration transaction** (not per-batch): a failure in migration `N` leaves migrations `1…N-1` durably applied. Next launch resumes at `N`.
- **`stripSqlComments` first.** Block and line comments are removed (string-literal-state-aware) before the native binding sees the SQL. This is the v0.1.3 fix, kept permanent.
- **`PRAGMA foreign_keys = ON`** is set on every fresh connection, *outside* the migration transaction.
- **Error preview.** The first 500 chars of the offending normalised statement are persisted in `PreferenceKey.MigrationError` so the escape-hatch screen and `adb logcat` show what choked, not just "migration failed".

### 14.5 Pre-Migration Backup (v0.2.0+)

Before applying any pending migration on an existing install, the runner takes a **point-in-time snapshot**:

- A copy of the live SQLite file is written next to it as `amban.db.bak-vN` where `N` is the *current* (pre-migration) schema version.
- Only the latest backup is retained; older `.bak-*` files are pruned.
- On a successful migration run, the backup is kept until the next launch (one-launch grace period) then pruned.
- On a failed migration run, the BootGate offers a third option alongside *Retry* and *Reset App*: **"Restore last backup"** — closes the connection, replaces `amban.db` with the `.bak-*`, and reboots the app to the previous schema. The user keeps their data; they're back on the prior app version's schema until a fixed migration ships.
- Backups are encrypted-at-rest only insofar as the OS protects app-private storage (no extra crypto — keep it dumb).

### 14.6 Boot Path Outcomes

`bootstrapApp()` in `src/boot.ts` returns one of:

| Stage | Trigger | UI |
|---|---|---|
| `Ready` | DB open + all migrations applied + stores hydrated | App renders |
| `MigrationFailed` | Any migration threw | Full-screen escape hatch with Retry / Restore Backup / Reset App |
| `UnexpectedError` | Anything else (DB open failed, hydration crashed) | Generic error with Try Again / Reset App |

The escape-hatch screen is **non-dismissable** — the user cannot navigate past it into a half-broken app. It exposes:
- A short, friendly explanation.
- The persisted error preview (collapsible, copyable for support).
- App version + commit SHA from `constants/buildInfo.ts`.
- Three CTAs: Retry, Restore Backup (if a `.bak-*` exists), Reset App (typed-confirmation).

### 14.7 Reset App vs Restore Backup

| Action | Data Outcome | When to Use |
|---|---|---|
| **Retry** | None | First response; transient failures self-heal here. |
| **Restore Backup** | Reverts schema + data to pre-upgrade state; user stays on old app version's behaviour until a fixed build lands. | Migration is buggy. User keeps everything. |
| **Reset App** | Total wipe (Appendix I). | Backup is corrupted or absent and the user can't wait for a fix. |

### 14.8 Test Plan (CI Gate)

Every release must pass these checks before tagging:

1. **Fresh install matrix.** Empty DB → run all migrations → schema version equals `MIGRATION_CATALOG.at(-1).version`. Asserted on the native Android binding in CI.
2. **Upgrade matrix.** For every prior shipped version (v0.1.0, v0.1.1, v0.1.2, v0.1.3, v0.2.0-rc-N, …), seed a DB at that version's schema, run the runner against current `HEAD`, assert all rows survive and schema version advances.
3. **Catalogue drift.** Asserts `MIGRATION_CATALOG` matches the on-disk `migrations/` directory exactly (same versions, same checksums).
4. **Comment-heavy SQL.** A regression test re-applying migration 002 (the v0.1.2 culprit) must pass on the native binding, not just SQL.js.
5. **Backup round-trip.** Take a backup, corrupt the live DB, restore, verify all rows.

No release ships without a green run on this suite.

---

## 15. SMS Capture & Auto-Suggestions (Android)

> Privacy-first, opt-in, on-device-only. amban does not transmit a single SMS character anywhere — it reads, parses locally, and presents suggestions for the user to confirm.

### 15.1 What This Solves

Users already log spends manually. But every UPI debit, card swipe, and credit produces a transactional SMS from their bank. Reading those messages locally lets amban *suggest* entries the user can confirm with one tap, dramatically reducing friction.

### 15.2 Platform Scope (v0.2.0)

- **Android only.** iOS does not expose SMS to third-party apps and never will. The Settings entry point is hidden on iOS.
- Plugin: a thin custom Capacitor plugin `@amban/sms-reader` (lives in `android/app/src/main/java/io/amban/app/sms/`) — wraps `android.provider.Telephony.Sms` reads. No third-party SMS-parser SDK; we own the regex.
- Permission: `android.permission.READ_SMS` — runtime-requested with a clear pre-permission rationale screen.

### 15.3 Permission UX

1. SMS Capture is **off by default**. The user finds it under Settings → Connected Sources → SMS Capture.
2. Toggling it on shows a full-screen rationale before the OS dialog: what we read, what we do with it, what we never do (network, share, sell).
3. On grant: schedule a one-time scan of the last 7 days (configurable up to 30) and surface the suggestions inbox.
4. On deny: settings row stays toggled off; no nag. A single "Try again" affordance is fine.
5. Toggling off later: cancels the on-resume scan, retains parsed suggestions until the user clears them, never re-reads SMS until re-granted.

### 15.4 Trigger Model (v0.2.0)

- **App-foreground scan.** On every app resume (and on cold start once permission is granted), scan SMS received since `last_sms_scan_at` (Preferences key, defaulted to `now - 24h` on first scan).
- **Idempotent.** Each parsed SMS produces a stable `messageId` (Telephony provider's `_id` plus body hash); duplicates are skipped.
- **No background service in v0.2.** Live capture / push-on-receive (`SmsReceiver` BroadcastReceiver) and a Quick-Settings tile are deferred to v0.3 — see Future Scope.

### 15.5 Parser

- Lives in `src/utils/smsParser.ts`. Pure function: `parseSms({ sender, body, receivedAt }) → ParsedTxn | null`.
- Templates cover the major Indian banks + UPI providers: HDFC, ICICI, SBI, Axis, Kotak, IDFC, GPay, PhonePe, Paytm, BHIM. Each template is a named regex with capture groups for `amount`, `direction` (`debit` | `credit`), `merchantOrCounterparty`, `account` (last 4), `referenceId`.
- Rejection rules: marketing/promotional senders (alpha-only senders that don't match the bank allowlist), OTP messages, balance enquiries with no transaction.
- Confidence score `0..1` per parse; suggestions below `SMS_MIN_CONFIDENCE` (Appendix D) are dropped silently.

### 15.6 Suggestion Inbox

A card on Home above the insight carousel and a dedicated row in the Log tab shows pending suggestions.

Per suggestion:
- **One-tap accept.** Debit suggestions → prefill Daily Log with amount + merchant in notes. Credit suggestions → prefill Manual Credit sheet with amount + counterparty in label.
- **One-tap dismiss.** Marks the suggestion as `dismissed` so it never re-surfaces.
- **Edit before confirm.** Tapping the row (not the buttons) opens a sheet with editable fields; saving accepts.
- Empty state: nothing rendered (no "You have no SMS suggestions" — that's noise).

### 15.7 Storage Schema

```sql
-- Shipped in 004_sms_suggestions.sql for v0.2.0.
CREATE TABLE IF NOT EXISTS sms_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL UNIQUE,        -- stable id from Telephony provider
  received_at TEXT NOT NULL,              -- ISO timestamp of the SMS
  sender TEXT NOT NULL,                   -- e.g. 'HDFCBK', 'AX-PHONPE'
  direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  amount REAL NOT NULL CHECK (amount > 0),
  counterparty TEXT,                      -- merchant or remitter name; nullable
  account_last4 TEXT,                     -- last 4 of account/card; nullable
  reference_id TEXT,                      -- bank ref/UPI ref; nullable
  confidence REAL NOT NULL,               -- 0..1
  status TEXT NOT NULL DEFAULT 'pending'  -- 'pending' | 'accepted' | 'dismissed'
      CHECK (status IN ('pending', 'accepted', 'dismissed')),
  linked_log_id INTEGER,                  -- daily_logs.id when accepted as spend
  linked_credit_id INTEGER,               -- manual_credits.id when accepted as income
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sms_suggestions_status
  ON sms_suggestions (status, received_at DESC);
```

### 15.8 Privacy Contract

Written verbatim into the in-app rationale screen and the privacy page:

- amban reads SMS *only on this device*.
- amban never sends SMS contents over the network — there is no network code in the build.
- amban only persists the parsed fields above. The original SMS body is **not** stored.
- The user can revoke permission at any time from Android Settings; the app respects the change immediately.
- Reset App wipes every parsed suggestion alongside everything else.

### 15.9 Edge Cases

- **Multiple SIMs / dual-SIM.** All SMS sources are read; `account_last4` distinguishes them in the UI.
- **SMS deleted from inbox after parse.** Suggestion remains in our store — we don't re-validate against the inbox.
- **User accepts a debit suggestion that overlaps with a manual log.** The accept flow opens the Daily Log prefilled but additive (per the existing quick-amount-chip behaviour); the user sees today's running total before confirming.
- **Bank changes their SMS template.** Confidence drops; we silently fail to parse those messages. Ship a dev-only screen behind the style guide that lists unparsed bank-allowlisted senders so future template patches can land from real-world samples.

---

## 16. In-App Updater (Alpha Distribution, Android)

> **Eliminate friction for alpha testers.** No browser, no GitHub navigation. The app checks for updates on launch, downloads in the background, and asks the user to tap to install.

### 16.1 Purpose

Alpha users currently have to manually visit GitHub Releases to download new APKs. This is the single biggest friction point for the test cohort. The in-app updater makes upgrades a one-tap affair: open the app → see a banner → tap Download → tap Install. Done.

### 16.2 Network Exception

This is the **single authorized network call** in amban.io. It contacts ONLY:
- `api.github.com` — to fetch the latest release metadata
- `github.com` — to download the APK asset

No user data is transmitted. The request sends zero headers beyond what's needed for the GitHub API. If the network is unavailable, the check fails silently — no error shown to the user. The app remains fully functional offline.

### 16.3 Architecture

| Layer | Location | Responsibility |
|---|---|---|
| Native plugin | `android/app/src/main/java/io/amban/app/updater/AppUpdaterPlugin.java` | HTTP calls, file download, install intent |
| TypeScript bridge | `src/utils/appUpdater.ts` | Version comparison, state machine |
| React hook | `src/hooks/useAppUpdater.ts` | Exposes state + actions to UI |
| UI component | `src/components/UpdateBanner.tsx` | Banner on Home screen |

### 16.4 Flow

1. On every app foreground (cold start or resume), silently `GET https://api.github.com/repos/tellmeY18/amban.io/releases/latest`
2. Compare `tag_name` (e.g. `"v0.2.0"`) with `BUILD_INFO.version` using semver comparison
3. If remote is newer → show `UpdateBanner` on Home: "Update available: vX.Y.Z"
4. User taps "Download" → APK downloads to app-private cache with progress bar
5. Download completes → banner changes to "Tap to install vX.Y.Z"
6. User taps → Android package installer opens with the downloaded APK via FileProvider
7. If network fails at any point → banner never appears. Zero friction for offline use.

### 16.5 Permissions

- **`INTERNET`** — already present in `AndroidManifest.xml`.
- **`REQUEST_INSTALL_PACKAGES`** — needed for triggering the package installer intent. Runtime check needed on Android 8+ (API 26+). If not granted, deep-link user to system Settings to enable "Install unknown apps" for amban.

### 16.6 Native Plugin Methods

```typescript
interface AppUpdaterPlugin {
  checkForUpdate(): Promise<{
    available: boolean;
    version: string;
    downloadUrl: string;
    releaseNotes: string;
  }>;

  downloadApk(options: { url: string; version: string }): Promise<{ filePath: string }>;
  // Emits 'downloadProgress' events: { progress: number } (0–100)

  installApk(options: { filePath: string }): Promise<void>;
  // Triggers ACTION_VIEW intent with APK URI via FileProvider

  canInstallApks(): Promise<{ granted: boolean }>;
  // Checks REQUEST_INSTALL_PACKAGES permission

  openInstallSettings(): Promise<void>;
  // Opens "Install unknown apps" system settings for this app
}
```

### 16.7 UI States

| State | Banner Content | Actions |
|---|---|---|
| Hidden | *(not rendered)* | — |
| Update available | "Update available vX.Y.Z" | "Download" button |
| Downloading | Progress bar (0–100%) | — |
| Ready to install | "Ready to install vX.Y.Z" | "Install" button |
| Error | "Download failed. Tap to retry." | Tap to retry |

### 16.8 Placement & Styling

`UpdateBanner` is fixed at the very top of the Home screen, above `GreetingHeader`. Non-dismissable — it remains visible until the user updates. Styled as a compact banner using `--color-primary` background with white text.

### 16.9 Check Frequency

Once per app foreground event, **max once per hour** (debounced via `lastUpdateCheckAt` timestamp in Preferences). This prevents hammering the GitHub API on rapid app switches.

### 16.10 Version Comparison

Semver comparison. The remote `tag_name` is stripped of its `'v'` prefix and compared to `BUILD_INFO.version`. If remote > local, an update is available. Pre-release tags (e.g. `-rc.1`) are handled correctly.

### 16.11 File Storage

- APK stored in `context.getCacheDir()` as `amban-update-vX.Y.Z.apk`.
- Old APK files matching `amban-update-*.apk` are cleaned up on successful install or on the next update check.
- FileProvider path: add `<cache-path name="apk_updates" path="." />` to `file_paths.xml`.

### 16.12 iOS Handling

The entire updater surface is gated behind `Capacitor.getPlatform() === 'android'`. iOS does not allow sideloading; no UI, no hook initialization, no network call on iOS builds.

### 16.13 Error Handling

- Network unavailable → check fails silently. No banner, no error.
- Download interrupted → banner shows "Download failed. Tap to retry." Tapping retries from scratch.
- `REQUEST_INSTALL_PACKAGES` not granted → banner shows "Install" but tapping opens system settings with a toast explaining what to enable. On return, auto-retries the install.
- GitHub API rate-limited (unlikely for 1 call/hour) → treated as network failure. Silent.

---

## 17. Future Scope

| Feature | Notes |
|---|---|
| Live SMS capture (BroadcastReceiver) | Push-on-receive instead of foreground-resume scan (v0.3) |
| Quick Settings tile / home-screen widget | Add spend or accept SMS suggestion without opening app |
| iOS Notification Service Extension | Read banking notifications (iOS-equivalent of SMS capture) |
| Category-wise budget caps | "Don't spend more than ₹5,000/month on dining" |
| Widget (iOS/Android) | Home screen widget showing today's Amban Score |
| iCloud / Google Drive Sync | Optional encrypted backup to personal cloud |
| Multiple Accounts | Track separate bank accounts |
| Goal Setting | "I want to save ₹1,00,000 by December" |
| Annual Review Screen | Year-in-review scrollable summary |

---

## 18. Android Instrumented E2E Testing

> **The release gate that proves the app works as a user would use it — on a real (emulated) Android device, end-to-end, before any build ships.**

amban.io is local-only: there is no server to mock, no API to stub, and no cloud to replay. The only way to know it works is to drive the actual compiled app on an actual Android runtime. This section defines the instrumented test strategy that must be green before any release tag is cut.

### 18.1 Goals

1. **Every user-facing flow** defined in §6 is exercised end-to-end on an emulated Android device.
2. **Every edge case** in §13 has at least one instrumented test proving the specified behaviour.
3. **Every Capacitor plugin integration** (SQLite, Preferences, Local Notifications, Haptics, SMS Reader) is exercised through the real native binding — not web mocks.
4. **Every database migration** is verified on the native SQLite binding via the §14.8 upgrade matrix, promoted from a script to a proper instrumented test suite.
5. **Regression-proof.** No release ships without this suite green on CI. A red test blocks the tag.

### 18.2 Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Test framework | Android Instrumented Tests (AndroidJUnit4) | Runs on-device / on-emulator via `connectedAndroidTest` Gradle task |
| UI automation | Espresso + Espresso-Web | Espresso-Web drives the Capacitor WebView; Espresso handles native dialogs (permission prompts, system UI) |
| Emulator | Android Emulator (API 30 minimum, API 34 recommended) | Managed via AVD or GitHub Actions `reactivecircus/android-emulator-runner` |
| Assertions | JUnit 4 + Hamcrest | Standard Android test assertions |
| Screenshot diffing | *(Future — v0.3)* | Not in v0.2; visual regression is manual for now |
| CI runner | GitHub Actions (`ubuntu-latest` + hardware-accelerated emulator) | KVM-enabled runner for acceptable emulator speed |

### 18.3 Emulator Configuration

```
Device profile:   Pixel 6 (1080×2400, 411 dpi)
System image:     system-images;android-34;google_apis;x86_64
RAM:              4096 MB
Heap:             512 MB
Internal storage: 4 GB
SD card:          512 MB (SMS content provider needs writable storage)
Locale:           en-IN
Timezone:         Asia/Kolkata
GPU:              host (CI: swiftshader_indirect)
```

A second emulator profile targets the minimum supported API (API 23, Android 6.0) to verify backward compatibility — run on a nightly schedule, not on every PR.

### 18.4 Test Suite Organisation

```
android/app/src/androidTest/java/io/amban/app/
├── e2e/
│   ├── OnboardingFlowTest.java        // §6.1 full onboarding
│   ├── DailyUseFlowTest.java          // §6.2 morning open → log → updated score
│   ├── BalanceUpdateFlowTest.java      // §6.3 balance correction
│   ├── IncomeCreditFlowTest.java       // §6.4 salary-day banner + prefill
│   ├── RecurringPaymentFlowTest.java   // §6.5 upcoming warning display
│   ├── ManualCreditFlowTest.java       // §6.6 burst income
│   ├── SmsCaptureFlowTest.java         // §15 permission → scan → accept → dismiss
│   └── ResetAppFlowTest.java           // Appendix I wipe + re-onboarding
├── scoring/
│   ├── AmbanScoreTest.java            // §8.1 formula on native binding
│   ├── ScoreEdgeCasesTest.java        // §13.1–13.8 all edge cases
│   └── ScoreRecalcTriggersTest.java   // §8.3 recalc on log/balance/income/recurring
├── db/
│   ├── FreshInstallMigrationTest.java  // §14.8 check 1: empty → latest
│   ├── UpgradeMatrixTest.java          // §14.8 check 2: each prior version → latest
│   ├── CatalogueDriftTest.java         // §14.8 check 3: catalogue == disk
│   ├── CommentHeavySqlTest.java        // §14.8 check 4: regression
│   └── BackupRoundTripTest.java        // §14.8 check 5: backup/restore
├── notifications/
│   ├── NotificationScheduleTest.java  // Appendix E ID ranges, daily/recurring/salary
│   ├── PermissionFlowTest.java        // Android 13+ POST_NOTIFICATIONS
│   └── DeepLinkTest.java              // amban://log routes to Daily Log
├── sms/
│   ├── SmsReaderPluginTest.java       // Native plugin: permission + read
│   ├── SmsParserAccuracyTest.java     // Parser fixtures on native runtime
│   └── SmsSuggestionLifecycleTest.java // pending → accepted/dismissed lifecycle
├── settings/
│   ├── ThemeToggleTest.java           // Light/Dark/System + status bar
│   ├── ExportDataTest.java            // JSON export content verification
│   └── PrivacyZeroNetworkTest.java    // Assert zero outbound network during full flow
└── helpers/
    ├── WebViewHelper.java             // Espresso-Web utilities for Capacitor WebView
    ├── DbSeeder.java                  // Seed SQLite with known state for each prior version
    └── EmulatorSmsInjector.java       // Insert SMS into Telephony provider for parser tests
```

### 18.5 Key Test Scenarios

#### Onboarding E2E (§6.1)
1. Cold launch on wiped emulator → Welcome screen renders.
2. Enter name → proceeds to Income step.
3. Add one income source (label, amount, credit day) → BankBalance step enabled.
4. Enter bank balance → RecurringPayments step.
5. Skip recurring payments → Notification setup.
6. Set notification time → Onboarding Complete screen.
7. Score card displays a non-zero ₹/day number.
8. Navigate to Home → all sections render without crash.
9. Kill the app, relaunch → Home (not Welcome) renders.

#### Daily Log + Score Recalc (§6.2, §8.3)
1. Seed: onboarded user with known balance, income, recurring.
2. Open Home → capture displayed score.
3. Navigate to Log → enter ₹1,000 → save.
4. Assert: score decreases by approximately `₹1,000 / daysLeft`.
5. Assert: `daily_logs` table has one row with today's date.
6. Assert: post-save toast matches the tone rule (under/over/on-target).

#### SMS Capture (§15)
1. Inject sample HDFC debit SMS into the emulator's Telephony provider.
2. Grant `READ_SMS` permission via Espresso's `GrantPermissionRule` or UiAutomator.
3. Enable SMS Capture in Settings → trigger scan.
4. Assert: suggestion inbox shows the injected SMS with correct amount/direction.
5. Tap "Add as spend" → Daily Log opens prefilled.
6. Save → assert `sms_suggestions.status = 'accepted'` and `linked_log_id` populated.
7. Dismiss a second suggestion → assert it never reappears.

#### Edge Case: Negative Balance (§13.5)
1. Seed: balance ₹5,000, recurring ₹20,000 due before next income.
2. Assert: score displays ₹0 (clamped, never negative).
3. Assert: red warning banner visible on Home.

#### Edge Case: No Log for Multiple Days (§13.6)
1. Seed: last log 4 days ago.
2. Assert: stale-logs nudge visible on Home.
3. Tap "Log missed days" → backfill sheet opens with date picker.

#### Zero Network Assertion
1. Set emulator to airplane mode (or use `adb shell svc wifi disable` + `svc data disable`).
2. Run the *entire* onboarding + daily log + insights + settings + export flow.
3. Assert: no step fails due to network. No `java.net.UnknownHostException` or `ERR_INTERNET_DISCONNECTED` in logcat.

### 18.6 SMS Injection for Tests

Instrumented tests cannot rely on real SMS being present. The emulator's Telephony content provider is writable:

```java
// helpers/EmulatorSmsInjector.java
ContentValues values = new ContentValues();
values.put(Telephony.Sms.ADDRESS, "HDFCBK");
values.put(Telephony.Sms.BODY,
    "INR 420.00 debited from a/c **1234 on 15-01-25 to SWIGGY. Ref 501234567890. Avl bal INR 38,030.00");
values.put(Telephony.Sms.DATE, System.currentTimeMillis());
values.put(Telephony.Sms.TYPE, Telephony.Sms.MESSAGE_TYPE_INBOX);
values.put(Telephony.Sms.READ, 0);

context.getContentResolver().insert(Telephony.Sms.CONTENT_URI, values);
```

A fixture set of 20+ anonymised SMS bodies covering HDFC, ICICI, SBI, Axis, GPay, PhonePe, and Paytm lives in `android/app/src/androidTest/assets/sms_fixtures.json`. Each fixture specifies the `sender`, `body`, and expected parse result (`amount`, `direction`, `counterparty`, `confidence`).

### 18.7 CI Integration

```yaml
# .github/workflows/e2e-android.yml (outline)
name: Android E2E
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  instrumented-tests:
    runs-on: ubuntu-latest          # must have KVM for emulator
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: 17 }
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc }
      - run: npm ci
      - run: npm run build
      - run: npx cap sync android
      - uses: reactivecircus/android-emulator-runner@v2
        with:
          api-level: 34
          target: google_apis
          arch: x86_64
          profile: pixel_6
          ram-size: 4096M
          emulator-options: -no-window -gpu swiftshader_indirect -no-snapshot -noaudio -no-boot-anim
          script: |
            cd android && ./gradlew connectedAndroidTest --stacktrace
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: test-reports
          path: android/app/build/reports/androidTests/
```

**Release gate rule:** The `e2e-android` workflow must be green before `git tag`. The release workflow refuses to run if the latest E2E run on the same commit SHA is not green.

### 18.8 Nightly Extended Matrix

Beyond the per-PR suite, a nightly GitHub Actions cron job runs the full suite against:

| API Level | Profile | Purpose |
|---|---|---|
| 23 (Android 6.0) | Nexus 5 | Minimum supported API |
| 28 (Android 9) | Pixel 3 | Pre-notification-channel baseline |
| 30 (Android 11) | Pixel 4 | Scoped storage boundary |
| 33 (Android 13) | Pixel 6 | `POST_NOTIFICATIONS` runtime permission boundary |
| 34 (Android 14) | Pixel 7 | Latest stable |

Failures on the nightly matrix create a GitHub issue tagged `e2e-nightly-failure` with the emulator profile, failing test, and logcat excerpt attached.

### 18.9 Local Development Workflow

```bash
# Start the emulator
emulator -avd Pixel_6_API_34 -no-snapshot -gpu host

# Build the web layer, sync into native project
npm run build && npx cap sync android

# Run the full instrumented suite
cd android && ./gradlew connectedAndroidTest

# Run a single test class
./gradlew connectedAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=io.amban.app.e2e.OnboardingFlowTest

# Run tests matching a pattern
./gradlew connectedAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=io.amban.app.sms.SmsReaderPluginTest
```

Test results land in `android/app/build/reports/androidTests/connected/` — HTML report auto-opens on failure.

### 18.10 Test Data Discipline

- **No hardcoded dates.** Every test that involves date arithmetic accepts `today` as a parameter or uses a clock abstraction.
- **Isolated state per test.** Each test class wipes the DB and Preferences in `@Before`. No test depends on another test's side effects.
- **Fixture files over inline data.** SMS fixtures, migration SQL snapshots, and seeded DB states live in `androidTest/assets/` — never inline in Java.
- **Deterministic amounts.** Use coprime amounts (₹1,111, ₹2,222, ₹3,333) so assertions can distinguish which entry produced which number without ambiguity.

---

## Appendix B: Score Calculation

The canonical formula (implementation in `utils/scoring.ts`):

1. **Find next income date** — earliest upcoming `creditDay` across all sources; if already passed this month, use next month.
2. **Days left** — `max(1, differenceInCalendarDays(nextIncomeDate, today))`
3. **Effective balance** — `latestSnapshot - spendSinceLastSnapshot`
4. **Upcoming recurring** — filter payments where `dueDay` is between today and nextIncomeDate (using `getActualDueDate` for month-end clamping).
5. **Score** — `max(0, (effectiveBalance - upcomingRecurring) / daysLeft)`

---

## Appendix C: Spend Categories

| Key | Label | Icon (Ionicon) | Color Token |
|---|---|---|---|
| `housing` | Housing & Rent | `home-outline` | `#4285F4` |
| `utilities` | Utilities | `flash-outline` | `#F29900` |
| `insurance` | Insurance | `shield-checkmark-outline` | `#1E8C45` |
| `subscriptions` | Subscriptions | `play-circle-outline` | `#AB47BC` |
| `emi` | EMI / Loans | `card-outline` | `#E94235` |
| `food` | Food & Dining | `restaurant-outline` | `#FB8C00` |
| `transport` | Transport | `car-outline` | `#26A69A` |
| `shopping` | Shopping | `bag-handle-outline` | `#EC407A` |
| `health` | Health | `medkit-outline` | `#66BB6A` |
| `other` | Other | `ellipsis-horizontal-outline` | `#9AA0A6` |

Rules: Recurring payments must select exactly one category. Daily log category is optional (`null` if unset). Category keys are the stable enum — never change them.

---

## Appendix D: Insight Thresholds

| Constant | Value | Used By |
|---|---|---|
| `SAVINGS_RATE_GREEN` | 30 (%) | Savings Rate Insight |
| `SAVINGS_RATE_AMBER` | 15 (%) | Savings Rate Insight |
| `SCORE_HEALTHY_RATIO` | 0.90 | Score Color Rule |
| `SCORE_GOOD_RATIO` | 0.60 | Score Color Rule |
| `AVG_WINDOW_DAYS` | 30 | Daily average spend window |
| `STREAK_MIN_DAYS` | 3 | Min days before showing streak |
| `OVERSPEND_STREAK_DAYS` | 7 | Lifestyle Upgrade trigger |
| `SAVINGS_BUFFER_PCT` | 20 (%) | Lifestyle Cost buffer |
| `UPCOMING_PAYMENT_WARN_DAYS` | 3 | Warning chip on Home |
| `UPCOMING_PAYMENT_NOTIFY_DAYS` | 2 | Notification lead time |
| `INCOME_COUNTDOWN_DAYS` | 7 | Income countdown insight |
| `INSIGHT_DISMISS_TTL_HOURS` | 24 | Dismissed insight suppression |
| `HOME_CAROUSEL_MAX` | 3 | Max insights on Home |
| `HOME_CAROUSEL_ROTATE_MS` | 5000 | Auto-rotate interval |

---

## Appendix E: Notification ID Scheme

| Range | Purpose | ID Formula |
|---|---|---|
| `1000` | Daily spend prompt | Fixed `1000` |
| `2000–2999` | Upcoming recurring payment | `2000 + recurringPayment.id` |
| `3000–3999` | Salary day nudge | `3000 + incomeSource.id` |
| `4000–4999` | Reserved (future) | — |

Rules: Cancel entire range before rescheduling. Never hand-pick IDs outside ranges. Disable = cancel all.

---

## Appendix F: Haptics & Micro-interactions

| Interaction | Haptic |
|---|---|
| Onboarding step completed | `Impact { style: Light }` |
| Daily spend saved (under score) | `Notification { type: Success }` |
| Daily spend saved (over score) | `Notification { type: Warning }` |
| Balance updated | `Impact { style: Medium }` |
| Swipe-dismiss insight | `Selection` |
| Reset app confirmed | `Notification { type: Error }` |
| Number pad quick-amount tap | `Selection` |

Respect OS-level reduce-motion settings. Disable carousel auto-rotate and card entrance animations when reduced motion is on.

---

## Appendix G: Accessibility Guidelines

- **Contrast:** WCAG AA on both themes. Score numbers: AAA.
- **Hit targets:** Minimum 44×44 px.
- **Dynamic type:** `rem` units. Score card scales up to 1.3× then locks.
- **Screen readers:** Every icon-only button has `aria-label`. Score card: *"Today's Amban score, 2,340 rupees per day, healthy."*
- **Colour reliance:** Status conveyed via text label, not colour alone.
- **Focus order:** Visual order; primary CTA last.
- **Localisation:** English + INR only (v1). All strings in `strings.ts`.

---

## Appendix H: App Metadata & Branding

| Field | Value |
|---|---|
| App Display Name | `amban` |
| Bundle ID (iOS) | `io.amban.app` |
| Application ID (Android) | `io.amban.app` |
| Scheme | `amban://` |
| Minimum iOS | 14.0 |
| Minimum Android | API 23 (Android 6.0) |
| Orientation | Portrait only |
| Status bar style | Matches theme |
| Splash background | `#1A73E8` |
| App icon | Rounded square, white "a" monogram on primary gradient |
| Update API | `https://api.github.com/repos/tellmeY18/amban.io/releases/latest` |
| APK asset pattern | `amban-v*.apk` or `amban-v*-debug.apk` |

---

## Appendix I: Reset & Data Wipe Behaviour

"Reset App" is destructive and irreversible:

1. User types `RESET` to enable CTA.
2. On confirm: drop all SQLite tables + recreate, clear all Preferences, cancel all notifications, reset Zustand stores.
3. Navigate to Welcome screen (fresh install state).

No data retained. No undo.

---

## Appendix K: E2E Test Matrix

| # | Flow / Edge Case | Spec Ref | Test Class | Asserts |
|---|---|---|---|---|
| 1 | Fresh onboarding: name → income → balance → recurring → notifications → score | §6.1 | `OnboardingFlowTest` | Score > 0, Home renders, relaunch stays on Home |
| 2 | Onboarding resume after kill mid-flow | §13.8 | `OnboardingFlowTest` | Resumes at last incomplete step |
| 3 | Daily spend log reduces score | §6.2, §8.3 | `DailyUseFlowTest` | Score delta ≈ spend/daysLeft |
| 4 | Quick-amount chips are additive | §9.2 | `DailyUseFlowTest` | Tapping ₹500 twice = ₹1,000 |
| 5 | Backfill missed days | §13.6 | `DailyUseFlowTest` | N rows in daily_logs, stale-logs warning clears |
| 6 | Balance update recalculates score | §6.3, §8.3 | `BalanceUpdateFlowTest` | Score changes, new snapshot row |
| 7 | Salary-day banner + prefilled balance update | §6.4 | `IncomeCreditFlowTest` | Banner visible on credit day, balance prefilled |
| 8 | Upcoming recurring payment chip strip | §6.5 | `RecurringPaymentFlowTest` | Chip visible within WARN_DAYS |
| 9 | Burst income adds to effective balance | §6.6 | `ManualCreditFlowTest` | Score increases, manual_credits row inserted |
| 10 | Score ≥ 90% avg → green status | §8.2 | `AmbanScoreTest` | Status = "healthy" |
| 11 | Score 60–89% avg → amber status | §8.2 | `AmbanScoreTest` | Status = "watch" |
| 12 | Score < 60% avg → red status | §8.2 | `AmbanScoreTest` | Status = "critical" |
| 13 | First day (no logs) → green, insights hidden | §13.1 | `ScoreEdgeCasesTest` | Green status, log-dependent insights absent |
| 14 | Income day = today → daysLeft = next month's cycle | §13.2 | `ScoreEdgeCasesTest` | daysLeft ≈ 28–31 |
| 15 | Multiple income sources → earliest next date wins | §13.3 | `ScoreEdgeCasesTest` | daysLeft uses soonest source |
| 16 | Recurring due day 31 in a 30-day month → clamped | §13.4 | `ScoreEdgeCasesTest` | Due date = last day of month |
| 17 | Negative effective balance → score clamped at ₹0 | §13.5 | `ScoreEdgeCasesTest` | Score = 0, red warning banner |
| 18 | Recurring already paid → not double-deducted | §13.7 | `ScoreEdgeCasesTest` | Recurring not in upcomingRecurring |
| 19 | Fresh install migration (empty → latest) | §14.8.1 | `FreshInstallMigrationTest` | Schema version = latest |
| 20 | Upgrade from each prior version | §14.8.2 | `UpgradeMatrixTest` | All rows survive, version advances |
| 21 | Migration catalogue matches disk | §14.8.3 | `CatalogueDriftTest` | No orphaned files or catalogue entries |
| 22 | Comment-heavy SQL migration | §14.8.4 | `CommentHeavySqlTest` | Migration 002 applies on native binding |
| 23 | Backup → corrupt → restore round-trip | §14.8.5 | `BackupRoundTripTest` | All rows intact after restore |
| 24 | SMS permission grant + scan | §15.3, §15.4 | `SmsCaptureFlowTest` | Permission granted, suggestions populated |
| 25 | SMS suggestion accept as spend | §15.6 | `SmsSuggestionLifecycleTest` | status=accepted, linked_log_id set |
| 26 | SMS suggestion accept as income | §15.6 | `SmsSuggestionLifecycleTest` | status=accepted, linked_credit_id set |
| 27 | SMS suggestion dismiss → never re-surfaces | §15.6 | `SmsSuggestionLifecycleTest` | status=dismissed, not in pending |
| 28 | SMS parser accuracy ≥ 90% on fixture set | §15.5 | `SmsParserAccuracyTest` | ≥ 18/20 fixtures parsed correctly |
| 29 | Notification daily prompt scheduled | §10.1 | `NotificationScheduleTest` | id=1000 present in pending |
| 30 | Notification deep-link → /log | §10.1 | `DeepLinkTest` | DailyLogScreen renders |
| 31 | POST_NOTIFICATIONS runtime permission (API 33+) | §10 | `PermissionFlowTest` | Permission dialog appears, grant works |
| 32 | Theme toggle: light/dark/system | §9.5 | `ThemeToggleTest` | data-theme attribute correct |
| 33 | Export data produces valid JSON | §12 | `ExportDataTest` | JSON parses, contains expected keys |
| 34 | Zero network during complete flow | §12 | `PrivacyZeroNetworkTest` | No outbound connections in logcat |
| 35 | Reset App → full wipe → re-onboarding | Appendix I | `ResetAppFlowTest` | All tables empty, Welcome screen |
| 36 | All 9 insight generators produce output with valid seed data | §11 | `InsightsScreen` (manual / future) | Each insight type observable |

---

*This document is the single source of truth for amban.io development. When in doubt, ship simpler.*
