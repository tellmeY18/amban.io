# CLAUDE.md — amban.io Finance Tracker
> A comprehensive spec and dev guide for building the amban.io mobile-first finance tracker using CapacitorJS + Ionic.

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
16. [Future Scope](#16-future-scope)
17. [Android Instrumented E2E Testing](#17-android-instrumented-e2e-testing)
18. [Appendices](#appendices)
    - [Appendix A: INR Formatting Utility](#appendix-a-inr-formatting-utility)
    - [Appendix B: Score Calculation Function](#appendix-b-score-calculation-function)
    - [Appendix C: Spend Categories](#appendix-c-spend-categories)
    - [Appendix D: Insight Thresholds](#appendix-d-insight-thresholds)
    - [Appendix E: Notification ID Scheme](#appendix-e-notification-id-scheme)
    - [Appendix F: Haptics & Micro-interactions](#appendix-f-haptics--micro-interactions)
    - [Appendix G: Accessibility Guidelines](#appendix-g-accessibility-guidelines)
    - [Appendix H: App Metadata & Branding](#appendix-h-app-metadata--branding)
    - [Appendix I: Reset & Data Wipe Behaviour](#appendix-i-reset--data-wipe-behaviour)
    - [Appendix J: Migration Strategy](#appendix-j-migration-strategy)
    - [Appendix K: E2E Test Matrix](#appendix-k-e2e-test-matrix)

---

## 1. Project Overview

**App Name:** amban.io  
**Tagline:** *Know your number. Own your day.*  
**Type:** Personal Finance Tracker — Mobile First  
**Platform:** iOS + Android via CapacitorJS (Ionic)  
**Data Policy:** 100% local. No network calls. No accounts. No cloud sync. Everything lives on the device.

### What Makes amban.io Different

Every other finance app focuses on what you *spent*. amban.io tells you what you *can* spend — today, specifically. It reduces the cognitive load of budgeting to a single number: your **Daily Amban Score**.

The core loop is:
1. You set up your finances once (income, balance, recurring costs).
2. Every day, amban tells you your safe-to-spend number.
3. Every evening, you log what you actually spent.
4. Over time, amban builds insight into your lifestyle and what it costs.

---

## 2. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | React (Vite) | Paired with Ionic React for UI primitives |
| Mobile Runtime | CapacitorJS | iOS + Android binary generation |
| UI Library | Ionic React + Material-inspired custom components | Use Ionic's native-feel components + custom CSS |
| Local DB | `@capacitor-community/sqlite` | Structured storage via SQLite |
| Notifications | `@capacitor/local-notifications` | Daily spend prompts |
| State Management | Zustand | Lightweight, no boilerplate |
| Date/Time | `date-fns` | No moment.js bloat |
| Charts | Recharts | For trend visualizations |
| Icons | Ionicons (bundled with Ionic) | |
| Styling | CSS Modules + CSS Custom Properties | No Tailwind; hand-crafted design tokens |

### Capacitor Plugins Required

```bash
npm install @capacitor/local-notifications
npm install @capacitor-community/sqlite
npm install @capacitor/preferences  # for lightweight key-value (settings, flags)
npm install @capacitor/haptics      # for tactile feedback on interactions
npm install @capacitor/status-bar   # status bar color control
npm install @capacitor/keyboard     # keyboard behavior control
```

---

## 3. Design System

### Philosophy

Clean, modern Material Design 3 aesthetic. Not stock Material — a custom take. Think Google's M3 with sharper edges, a financial data-first layout, and a personality. The UI should feel like a premium Indian fintech app (think Jupiter or Fi Money) but lighter and faster.

### Color Palette

```css
:root {
  /* Primary */
  --color-primary: #1A73E8;         /* Deep Google Blue */
  --color-primary-light: #E8F0FE;
  --color-primary-dark: #1557B0;

  /* Score Colors — dynamically applied */
  --color-score-excellent: #1E8C45; /* Green: score is healthy */
  --color-score-good: #F29900;      /* Amber: spending a bit high */
  --color-score-warning: #E94235;   /* Red: critical zone */

  /* Surfaces */
  --color-bg: #F8F9FA;
  --color-surface: #FFFFFF;
  --color-surface-variant: #F1F3F4;

  /* Text */
  --color-text-primary: #202124;
  --color-text-secondary: #5F6368;
  --color-text-disabled: #BDC1C6;

  /* Divider */
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

```css
/* Use Google Fonts */
/* Display: DM Sans (headings, score numbers) */
/* Body: Inter (readable, clean body text) */

--font-display: 'DM Sans', sans-serif;
--font-body: 'Inter', sans-serif;

--text-score: 3.5rem;    /* The big daily number */
--text-h1: 1.75rem;
--text-h2: 1.25rem;
--text-h3: 1rem;
--text-body: 0.875rem;
--text-caption: 0.75rem;
--text-micro: 0.625rem;
```

### Spacing Scale

```css
--space-xs: 4px;
--space-sm: 8px;
--space-md: 16px;
--space-lg: 24px;
--space-xl: 32px;
--space-2xl: 48px;
```

### Border Radius

```css
--radius-sm: 8px;
--radius-md: 12px;
--radius-lg: 16px;
--radius-xl: 24px;
--radius-pill: 999px;
```

### Elevation / Shadow

```css
--shadow-card: 0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.05);
--shadow-elevated: 0 4px 16px rgba(0,0,0,0.12);
```

### Score Color Rule

The Amban Score card dynamically changes colour based on the ratio of `todayScore / historicalAvgScore`:

| Ratio | Color Token | Label |
|---|---|---|
| ≥ 90% | `--color-score-excellent` | Healthy |
| 60–89% | `--color-score-good` | Watch it |
| < 60% | `--color-score-warning` | Critical |

---

## 4. App Architecture

```
src/
├── main.tsx
├── App.tsx                     # Root router
├── db/
│   ├── schema.sql              # SQLite schema
│   ├── db.ts                   # DB init & connection singleton
│   └── migrations/             # Version-based migration files
├── stores/
│   ├── userStore.ts            # User profile + onboarding state
│   ├── financeStore.ts         # Income, balance, recurring payments
│   ├── dailyStore.ts           # Daily logs, score history
│   └── settingsStore.ts        # Notification time, theme, etc.
├── hooks/
│   ├── useAmbanScore.ts        # Score calculation hook
│   ├── useInsights.ts          # Insights generation hook
│   └── useNotifications.ts     # Notification scheduling
├── screens/
│   ├── Onboarding/
│   │   ├── Welcome.tsx
│   │   ├── BasicDetails.tsx
│   │   ├── IncomeSources.tsx
│   │   ├── BankBalance.tsx
│   │   ├── RecurringPayments.tsx
│   │   └── OnboardingComplete.tsx
│   ├── Home/
│   │   ├── HomeScreen.tsx
│   │   └── components/
│   │       ├── ScoreCard.tsx
│   │       ├── DailyLogPrompt.tsx
│   │       ├── UpcomingPayments.tsx
│   │       └── InsightCarousel.tsx
│   ├── Log/
│   │   ├── DailyLogScreen.tsx
│   │   └── LogHistory.tsx
│   ├── Insights/
│   │   └── InsightsScreen.tsx
│   ├── Settings/
│   │   ├── SettingsScreen.tsx
│   │   ├── ManageIncome.tsx
│   │   ├── ManageRecurring.tsx
│   │   └── NotificationSettings.tsx
│   └── Profile/
│       └── ProfileScreen.tsx
├── components/
│   ├── ui/
│   │   ├── Card.tsx
│   │   ├── Badge.tsx
│   │   ├── BottomSheet.tsx
│   │   ├── CurrencyInput.tsx
│   │   ├── DatePicker.tsx
│   │   └── ProgressRing.tsx
│   └── layout/
│       ├── AppShell.tsx
│       └── BottomNav.tsx
├── utils/
│   ├── scoring.ts              # Score formula functions
│   ├── dateHelpers.ts          # Date math utilities
│   ├── formatters.ts           # INR formatting, etc.
│   └── insightGenerators.ts    # All insight computation
└── constants/
    ├── categories.ts           # Spend category definitions
    └── insightThresholds.ts    # Thresholds for triggering insights
```

---

## 5. Data Models

### SQLite Schema

```sql
-- Users table (single row app)
CREATE TABLE IF NOT EXISTS user (
  id INTEGER PRIMARY KEY DEFAULT 1,
  name TEXT NOT NULL,
  currency TEXT DEFAULT 'INR',
  created_at TEXT NOT NULL,
  onboarding_complete INTEGER DEFAULT 0
);

-- Income sources
CREATE TABLE IF NOT EXISTS income_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,               -- "Salary", "Freelance", "Rent Income"
  amount REAL NOT NULL,
  credit_day INTEGER NOT NULL,       -- Day of month: 1–31
  is_active INTEGER DEFAULT 1
);

-- Bank balance snapshots
CREATE TABLE IF NOT EXISTS balance_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amount REAL NOT NULL,
  recorded_at TEXT NOT NULL          -- ISO date string
);

-- Recurring payments
CREATE TABLE IF NOT EXISTS recurring_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,               -- "Room Rent", "LIC Premium", "Netflix"
  amount REAL NOT NULL,
  due_day INTEGER NOT NULL,          -- Day of month: 1–31
  category TEXT NOT NULL,            -- "housing", "insurance", "utilities", "subscriptions", "other"
  is_active INTEGER DEFAULT 1
);

-- Daily spend logs
CREATE TABLE IF NOT EXISTS daily_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_date TEXT NOT NULL UNIQUE,     -- ISO date: YYYY-MM-DD
  spent REAL NOT NULL DEFAULT 0,
  notes TEXT,
  score_at_log REAL,                 -- Amban Score at time of logging
  logged_at TEXT NOT NULL
);

-- Manual income credits (non-recurring / one-off)
CREATE TABLE IF NOT EXISTS manual_credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  amount REAL NOT NULL,
  credited_at TEXT NOT NULL          -- ISO date string
);

-- App settings (single row)
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  notification_time TEXT DEFAULT '21:00',   -- HH:MM 24hr
  notifications_enabled INTEGER DEFAULT 1,
  theme TEXT DEFAULT 'system',              -- 'light', 'dark', 'system'
  onboarding_version INTEGER DEFAULT 1
);
```

### Zustand Store Shapes (TypeScript)

```typescript
// userStore.ts
interface UserStore {
  name: string;
  currency: string;
  onboardingComplete: boolean;
  setUser: (data: Partial<UserStore>) => void;
}

// financeStore.ts
interface IncomeSource {
  id: number;
  label: string;
  amount: number;
  creditDay: number;
  isActive: boolean;
}

interface RecurringPayment {
  id: number;
  label: string;
  amount: number;
  dueDay: number;
  category: string;
  isActive: boolean;
}

interface FinanceStore {
  currentBalance: number;
  lastBalanceUpdate: string;
  incomeSources: IncomeSource[];
  recurringPayments: RecurringPayment[];
  setBalance: (amount: number) => void;
  addIncomeSource: (source: Omit<IncomeSource, 'id'>) => void;
  addRecurringPayment: (payment: Omit<RecurringPayment, 'id'>) => void;
  // ...update, delete, toggle active
}

// dailyStore.ts
interface DailyLog {
  id: number;
  logDate: string;
  spent: number;
  notes?: string;
  scoreAtLog: number;
  loggedAt: string;
}

interface DailyStore {
  logs: DailyLog[];
  todayLog: DailyLog | null;
  logSpend: (amount: number, notes?: string) => void;
  fetchLogs: (days: number) => void;
}
```

---

## 6. User Flows

### 6.1 Onboarding Flow (First Launch Only)

```
[App Launch]
     │
     ▼
[Welcome Screen]
  • App name + tagline
  • "Get Started" CTA
     │
     ▼
[Step 1: Who are you?]
  • Name (text input)
  • Optional: Profile emoji picker (fun, not serious)
  • No email/phone — fully anonymous
     │
     ▼
[Step 2: Your Income]
  • "What do you earn?" header
  • Add income source form:
    - Label (free text): e.g. "Salary at TCS"
    - Amount (number): e.g. ₹65,000
    - Credit Day (1–31): day of month money hits account
  • "+ Add another income" to add multiple sources
  • At least ONE income source required to proceed
     │
     ▼
[Step 3: Your Bank Balance]
  • "What's in your account right now?"
  • Single number input (current bank balance)
  • Helper text: "This is your starting point. You can update it anytime."
  • Important: Capture today's date as the balance snapshot date
     │
     ▼
[Step 4: Recurring Payments]
  • "What goes out every month?"
  • Add recurring payment form:
    - Label: e.g. "Room Rent"
    - Amount: e.g. ₹12,000
    - Due Day (1–31): e.g. 1st of every month
    - Category: Housing / Insurance / Utilities / Subscriptions / EMI / Other
  • "+ Add another" to add multiple
  • Can be skipped (0 recurring payments is valid)
     │
     ▼
[Step 5: Notification Setup]
  • "When should we check in with you?"
  • Default: 9:00 PM
  • Time picker (scrollable, native feel)
  • Toggle to enable/disable
  • Permission request happens here (native OS prompt)
     │
     ▼
[Onboarding Complete]
  • Animated reveal of their first Amban Score
  • "Your daily budget is ₹X,XXX" — big celebratory display
  • Brief 3-line explanation of what the score means
  • "Let's go →" → Home Screen
```

### 6.2 Daily Use Flow

```
[Morning: App Open]
  │
  ▼
[Home Screen]
  • Shows Today's Amban Score (big number)
  • Shows yesterday's spend (if logged)
  • Shows upcoming recurring payments this week
  • Shows 1–2 rotating insight cards
  │
  ▼
[Evening: Push Notification fires]
  • "Hey [Name] 👋 How much did you spend today?"
  • Tap → opens DailyLogScreen
  │
  ▼
[Daily Log Screen]
  • Large numeric input: "I spent ₹ _____ today"
  • Optional notes field: "What was it for?" (free text)
  • Optional: Categorise (quick-tap category chips)
  • "Save" → updates balance, recalculates score
  │
  ▼
[Post-Log: Updated Home Screen]
  • Score re-renders with updated projection
  • If spent > score: warning message shown
  • If spent < score: positive reinforcement shown
```

### 6.3 Balance Update Flow

The user's balance needs to be periodically corrected (after salary credit, ATM withdrawal, etc.):

```
Settings → Update Balance
  • Shows last recorded balance + date
  • New amount input
  • "Save" → inserts new balance_snapshot
  • Score recalculates immediately
```

### 6.4 Income Credit Flow (Automatic)

When today's date matches an income source's `creditDay`:
- Show a banner on Home: "🎉 Salary day! Did ₹65,000 hit your account?"
- CTA: "Yes, update balance" → opens balance update sheet prefilled with `currentBalance + incomeAmount`
- CTA: "Not yet" → dismisses for the day

### 6.5 Recurring Payment Warning Flow

When a recurring payment's `dueDay` is within 3 days:
- Show a chip/card on Home: "⚠️ Room Rent ₹12,000 due in 2 days"
- This is purely informational — does not auto-deduct from balance

### 6.6 Burst Income / Manual Credit Flow

Real life produces income outside the recurring sources — freelance payments, gifts, refunds, splitwise settlements, side gigs. These need to land in the score the same way burst spends do, just in the opposite direction.

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

The effective working balance is calculated as:

```
effectiveBalance = latestBalanceSnapshot
                  - SUM(recurringPaymentsDueBeforeNextIncome)
                  - SUM(dailySpendLogged since lastBalanceSnapshot)
```

> **Key Rule:** Recurring payments that are due *before the next income credit date* are pre-deducted from the effective balance used for scoring. This prevents the score from being falsely optimistic.

### 7.2 Days Left Calculation

```
nextIncomeDate = next occurrence of any income source's creditDay
                 (whichever comes first across all income sources)

daysLeft = differenceInCalendarDays(nextIncomeDate, today)
```

- If `daysLeft === 0` (income day itself), use 1 to avoid division by zero.
- If multiple income sources exist, use the *earliest* upcoming credit date.

### 7.3 Pre-Deducting Recurring Payments

```
upcomingRecurring = recurringPayments.filter(p =>
  p.dueDay >= today.date AND p.dueDay <= nextIncomeDate.date
  AND NOT already paid/logged this month
)

totalUpcomingRecurring = SUM(upcomingRecurring.map(p => p.amount))
```

**Edge case:** If a recurring payment's `dueDay` has already passed this month, it is NOT deducted again (assume already paid / reflected in balance).

### 7.4 Daily Spend Deduction

When the user logs a spend, the spend is stored in `daily_logs`. The total logged spend since the last balance snapshot is subtracted from the effective balance:

```
spendSinceLastSnapshot = SUM(daily_logs WHERE log_date >= lastBalanceSnapshotDate)
```

---

## 8. The Amban Score

### 8.1 Formula

```
ambantScore = (effectiveBalance - totalUpcomingRecurring) / daysLeft
```

Where:

```
effectiveBalance      = latestBalanceSnapshot.amount - spendSinceLastSnapshot
totalUpcomingRecurring = SUM of recurring payments due before next income
daysLeft              = calendar days until next income credit date (min 1)
```

This gives a **₹/day** value — the safe daily spending amount.

### 8.2 Score Display

The score is always displayed as:
```
₹ X,XXX
per day
```

Color of the score card:
- **Green** if score ≥ 90% of the user's 30-day average score
- **Amber** if score is 60–89% of average
- **Red** if score is below 60% of average

On first launch (no history), always show Green.

### 8.3 Score Recalculation Triggers

The score recalculates on:
1. App foreground resume (every time)
2. After a daily spend log is saved
3. After a balance update
4. After adding/editing/deleting an income source or recurring payment
5. At midnight (automatic silent recalc)

### 8.4 Score History

Every time the user logs their daily spend, `score_at_log` is stored. This builds a historical record for trend charts and insight generation.

---

## 9. Screens & UI Spec

### 9.1 Home Screen

**Top Section: Score Card**
```
┌─────────────────────────────────┐
│  Good evening, Arjun 👋          │
│                                 │
│       ┌─────────────┐           │
│       │  ₹ 2,340    │  ← BIG   │
│       │  per day    │           │
│       └─────────────┘           │
│                                 │
│  💰 Balance: ₹ 38,450            │
│  📅 Next income: 12 days away    │
│  📤 Upcoming bills: ₹ 14,000    │
└─────────────────────────────────┘
```

**Middle Section: Yesterday's Spend**
- If logged: "Yesterday you spent ₹1,800 — ₹540 under your score 🙌"
- If not logged: "You haven't logged yesterday yet. Log now →"

**Upcoming Payments Strip**
- Horizontal scrollable chips for payments due in next 7 days
- Each chip: Label + Amount + Days left badge

**Insight Carousel**
- 1–3 swipeable insight cards (see Insights section)
- Auto-rotates every 5 seconds

**Bottom Navigation**
```
[Home]  [Log]  [Insights]  [Settings]
```

---

### 9.2 Daily Log Screen

Triggered by notification or manual tap on "Log" tab.

```
┌─────────────────────────────────┐
│  ← Back        Today's Spend   │
│                                 │
│  How much did you spend today?  │
│                                 │
│  ┌───────────────────────────┐  │
│  │  ₹  [    2,000         ]  │  │
│  └───────────────────────────┘  │
│                                 │
│  Quick amounts:                 │
│  [₹500] [₹1000] [₹1500] [₹2000]│
│                                 │
│  Notes (optional)               │
│  ┌───────────────────────────┐  │
│  │ Groceries + auto fare...  │  │
│  └───────────────────────────┘  │
│                                 │
│  [        Save Spend         ]  │
└─────────────────────────────────┘
```

Post-save feedback:
- If spent < score: Green toast "Good job! ₹X saved vs your daily score"
- If spent = score: Blue toast "Right on target!"
- If spent > score: Amber toast "You went ₹X over today. Score adjusted."

---

### 9.3 Log History Screen

- List view, grouped by week
- Each row: Date + Amount Spent + Color dot (green/amber/red vs score)
- Tap a row → expand to see notes, score at that time
- 30-day mini bar chart at top

---

### 9.4 Insights Screen

Full-page scrollable insights. Sections:

1. **Spending Trend** — Line chart of daily spend (last 30 days) vs score
2. **Monthly Summary** — Pie chart of spend by category
3. **Projection Cards** — Dynamic insight cards (see section 11)
4. **Recurring Breakdown** — Bar showing recurring as % of monthly income

---

### 9.5 Settings Screen

- **Profile:** Name, emoji
- **Income Sources:** List with edit/delete + Add new
- **Recurring Payments:** List with edit/delete + Add new
- **Update Balance:** Quick access balance update
- **Notification Time:** Time picker + toggle
- **Theme:** Light / Dark / System
- **Reset App:** Nuclear option (clears all data, with confirmation)

---

## 10. Notifications

### 10.1 Daily Spend Notification

**Type:** Local Notification (no server required)  
**Default Time:** 9:00 PM (user-configurable)  
**Repeat:** Daily  

**Message Variations** (rotate randomly):
- "Hey [Name]! 👋 How much did you spend today?"
- "End of day check-in 📊 Log your spend to keep your score accurate."
- "Quick question — what did today cost you? 💸"
- "Don't lose track! Log today's spend before you sleep. 🌙"
- "Your amban score is waiting to be updated. What did you spend? 📱"

### 10.2 Upcoming Payment Notification

Fires 2 days before each recurring payment's `dueDay`:

**Format:**  
"📅 [Label] (₹[Amount]) is due in 2 days. Make sure your balance is ready."

### 10.3 Salary Day Notification

Fires on each income source's `creditDay`:

**Format:**  
"🎉 It's salary day! Did ₹[Amount] land in your account? Update your balance to get an accurate score."

### 10.4 Notification Scheduling Logic

```typescript
// On app launch and after settings change:
async function scheduleAllNotifications() {
  await LocalNotifications.cancel({ notifications: getAllScheduledIds() });

  // 1. Daily spend notification (recurring daily)
  await LocalNotifications.schedule({
    notifications: [{
      id: 1000,
      title: "amban.io",
      body: getRandomDailyMessage(userName),
      schedule: {
        every: 'day',
        on: { hour: notificationHour, minute: notificationMinute }
      },
      sound: 'default',
    }]
  });

  // 2. Upcoming payment notifications (one per payment, 2 days before)
  recurringPayments.forEach((payment, index) => {
    const notifyDate = getNotifyDate(payment.dueDay); // 2 days before
    if (notifyDate) {
      LocalNotifications.schedule({
        notifications: [{
          id: 2000 + index,
          title: "Upcoming Payment",
          body: `${payment.label} (₹${payment.amount}) is due in 2 days.`,
          schedule: { at: notifyDate },
        }]
      });
    }
  });

  // 3. Salary day notifications
  incomeSources.forEach((source, index) => {
    const salaryDate = getSalaryDate(source.creditDay);
    LocalNotifications.schedule({
      notifications: [{
        id: 3000 + index,
        title: "🎉 Salary Day!",
        body: `Did ₹${source.amount} from ${source.label} land yet? Update your balance!`,
        schedule: { at: salaryDate },
      }]
    });
  });
}
```

---

## 11. Insights Engine

Insights are generated dynamically based on user data. They are shown as cards in the carousel on Home and in full in the Insights screen. Each insight has: a **headline**, a **supporting number**, and an **emoji/icon**.

### 11.1 Lifestyle Cost Insight

> "If you spend ₹X/day, your ideal monthly income is ₹Y."

```
Formula:
dailyAvgSpend = average of last 30 daily logs
monthlySpendProjection = dailyAvgSpend * 30
idealIncome = monthlySpendProjection + totalMonthlyRecurring
             + (monthlySpendProjection * 0.20)   // 20% savings buffer

Display: "At ₹[dailyAvgSpend]/day, you'd ideally earn ₹[idealIncome]/month."
```

### 11.2 Savings Rate Insight

```
monthlyIncome = SUM(all active income sources)
monthlySpend = SUM(recurringPayments) + (avgDailySpend * 30)
savingsRate = ((monthlyIncome - monthlySpend) / monthlyIncome) * 100

Display: "You're saving ~[savingsRate]% of your income this month."

Color:
  > 30%: Green — "Great discipline! 💪"
  15–30%: Amber — "Decent, but you can do better."
  < 15%: Red — "Watch out — low savings cushion."
```

### 11.3 Streak Insight

```
spendingStreak = consecutive days where spent <= ambanScore

Display: "🔥 [N]-day streak of spending within your score!"
         "You've been on track for [N] days straight."
```

### 11.4 Biggest Cost Insight

```
topRecurring = recurringPayments sorted by amount DESC [0]
pctOfIncome = (topRecurring.amount / monthlyIncome) * 100

Display: "[topRecurring.label] takes up [pctOfIncome]% of your monthly income."
```

### 11.5 Projected Month-End Balance Insight

```
projectedBalance = currentBalance
                 - totalUpcomingRecurring (this month)
                 - (avgDailySpend * daysLeft)
                 + totalMonthlyIncome (if income hits before month end)

Display: "At this pace, you'll end the month with ₹[projectedBalance]."
```

### 11.6 Best & Worst Day Insight

```
bestDay = daily_logs.min(spent) from last 30 days
worstDay = daily_logs.max(spent) from last 30 days

Display: "Your cheapest day this month was ₹[bestDay.spent] on [date]."
         "Your most expensive day was ₹[worstDay.spent] on [date]."
```

### 11.7 Lifestyle Upgrade Insight

If avg daily spend is consistently above the score for 7+ days:

```
Display: "You've been spending ₹[X] above your score daily.
          To sustain this, you'd need ₹[Y] more per month in income."
```

### 11.8 "Coffee Math" Fun Insight

Daily spend → equivalent in common products:

```
Thresholds:
  If avgDailySpend >= 500:  "That's [N] cups of chai at Café Coffee Day."
  If avgDailySpend >= 1000: "That's [N] movie tickets per day."
  If avgDailySpend >= 2000: "That's [N] restaurant meals every day."

Formula: N = Math.round(avgDailySpend / productCost)
```

### 11.9 Income Day Countdown

```
Display: "💰 [N] days until your next income of ₹[amount]."
         Shown only when N <= 7.
```

### 11.10 Insight Priority / Display Rules

- Maximum 3 insight cards shown at once on Home carousel.
- Insights are sorted by relevance: warnings (low score, over-budget streak) > time-sensitive (upcoming income, payment) > informational.
- Each insight has a `dismissed` flag — user can swipe-dismiss an insight for 24h.

---

## 12. Local Storage Strategy

### Primary: SQLite via `@capacitor-community/sqlite`

Used for all structured data: users, income, balance snapshots, recurring payments, daily logs.

### Secondary: Capacitor Preferences (key-value)

Used for:
- `onboarding_complete`: boolean
- `last_notification_schedule_date`: ISO string (to avoid rescheduling on every launch)
- `dismissed_insights`: JSON array of dismissed insight IDs + timestamps
- `app_version`: for migration checks

### Data Backup / Export (Future)

Since no cloud sync exists, offer a "Export Data" option in Settings that generates a JSON file the user can save to their Files app. Import from JSON for device migration.

### No External Calls Policy

- Zero analytics (no Firebase, no Mixpanel, no Sentry)
- Zero network requests in the app (all data is local)
- No crash reporting (keep it dumb, keep it private)

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
-- The runner backfills this table from the existing Preferences value
-- on first launch of v0.2 so v0.1.x installs don't re-apply migrations.
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

A new top-level surface — a card on Home above the insight carousel and a dedicated row in the Log tab — shows pending suggestions:

```
┌─────────────────────────────────┐
│ 💡 3 suggestions from your SMS  │
│                                 │
│ ─₹ 420   Swiggy   Today 1:42 PM │
│ HDFC ••1234                     │
│ [ Add as spend ]  [ Dismiss ]   │
│                                 │
│ +₹ 2,000  UPI from Anita        │
│ Today 11:15 AM                  │
│ [ Add as income ]  [ Dismiss ]  │
│                                 │
│ See all →                       │
└─────────────────────────────────┘
```

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
- **Bank changes their SMS template.** Confidence drops; we silently fail to parse those messages. A monthly "unparsed senders" telemetry would help — but we have zero telemetry by policy. Instead, ship a dev-only screen behind the style guide that lists unparsed bank-allowlisted senders so future template patches can land from real-world samples a developer voluntarily shares.

---

## 16. Future Scope

These are NOT in v1.0 but are worth architectural consideration:

| Feature | Notes |
|---|---|
| Live SMS capture (BroadcastReceiver) | Push-on-receive instead of foreground-resume scan; lights up the Quick Settings tile experience. |
| Quick Settings tile / home-screen widget | Add spend or accept the latest SMS suggestion without opening the app. |
| iOS Notification Service Extension | Read banking notifications (the iOS-equivalent of SMS capture, modulo Apple's restrictions). |
| Spend Categories per Log | Allow tagging spend by category (Food, Travel, etc.) |
| Category-wise budget caps | "Don't spend more than ₹5,000/month on dining" |
| CSV/JSON Export | Local export for personal backup |
| Widget (iOS/Android) | Home screen widget showing today's Amban Score |
| iCloud / Google Drive Sync | Optional encrypted backup to personal cloud |
| UPI Deep Link | Tap to open any UPI app with amount pre-filled |
| Multiple Accounts | Track separate bank accounts |
| Goal Setting | "I want to save ₹1,00,000 by December" |
| Split Expense Log | Split today's spend across days (e.g., quarterly bill) |
| Annual Review Screen | Year-in-review scrollable summary |

---

## 17. Android Instrumented E2E Testing

> **The release gate that proves the app works as a user would use it — on a real (emulated) Android device, end-to-end, before any build ships.**

amban.io is local-only: there is no server to mock, no API to stub, and no cloud to replay. The only way to know it works is to drive the actual compiled app on an actual Android runtime. This section defines the instrumented test strategy that must be green before any release tag is cut.

### 17.1 Goals

1. **Every user-facing flow** defined in §6 is exercised end-to-end on an emulated Android device.
2. **Every edge case** in §13 has at least one instrumented test proving the specified behaviour.
3. **Every Capacitor plugin integration** (SQLite, Preferences, Local Notifications, Haptics, SMS Reader) is exercised through the real native binding — not web mocks.
4. **Every database migration** is verified on the native SQLite binding via the §14.8 upgrade matrix, promoted from a script to a proper instrumented test suite.
5. **Regression-proof.** No release ships without this suite green on CI. A red test blocks the tag.

### 17.2 Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Test framework | Android Instrumented Tests (AndroidJUnit4) | Runs on-device / on-emulator via `connectedAndroidTest` Gradle task |
| UI automation | Espresso + Espresso-Web | Espresso-Web drives the Capacitor WebView; Espresso handles native dialogs (permission prompts, system UI) |
| Emulator | Android Emulator (API 30 minimum, API 34 recommended) | Managed via AVD or GitHub Actions `reactivecircus/android-emulator-runner` |
| Assertions | JUnit 4 + Hamcrest | Standard Android test assertions |
| Screenshot diffing | *(Future — v0.3)* | Not in v0.2; visual regression is manual for now |
| CI runner | GitHub Actions (`ubuntu-latest` + hardware-accelerated emulator) | KVM-enabled runner for acceptable emulator speed |

### 17.3 Emulator Configuration

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

### 17.4 Test Suite Organisation

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

### 17.5 Key Test Scenarios

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

### 17.6 SMS Injection for Tests

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

### 17.7 CI Integration

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

### 17.8 Nightly Extended Matrix

Beyond the per-PR suite, a nightly GitHub Actions cron job runs the full suite against:

| API Level | Profile | Purpose |
|---|---|---|
| 23 (Android 6.0) | Nexus 5 | Minimum supported API |
| 28 (Android 9) | Pixel 3 | Pre-notification-channel baseline |
| 30 (Android 11) | Pixel 4 | Scoped storage boundary |
| 33 (Android 13) | Pixel 6 | `POST_NOTIFICATIONS` runtime permission boundary |
| 34 (Android 14) | Pixel 7 | Latest stable |

Failures on the nightly matrix create a GitHub issue tagged `e2e-nightly-failure` with the emulator profile, failing test, and logcat excerpt attached.

### 17.9 Local Development Workflow

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

### 17.10 Test Data Discipline

- **No hardcoded dates.** Every test that involves date arithmetic accepts `today` as a parameter or uses a clock abstraction.
- **Isolated state per test.** Each test class wipes the DB and Preferences in `@Before`. No test depends on another test's side effects.
- **Fixture files over inline data.** SMS fixtures, migration SQL snapshots, and seeded DB states live in `androidTest/assets/` — never inline in Java.
- **Deterministic amounts.** Use coprime amounts (₹1,111, ₹2,222, ₹3,333) so assertions can distinguish which entry produced which number without ambiguity.

---

## Appendix A: INR Formatting Utility

```typescript
// utils/formatters.ts

export function formatINR(amount: number, compact = false): string {
  if (compact) {
    if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
    if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}
```

## Appendix B: Score Calculation Function

```typescript
// utils/scoring.ts
import { differenceInCalendarDays, setDate, endOfMonth } from 'date-fns';

interface ScoreInput {
  currentBalance: number;
  spendSinceLastSnapshot: number;
  incomeSources: { creditDay: number; amount: number }[];
  recurringPayments: { dueDay: number; amount: number }[];
  today: Date;
}

export function calculateAmbanScore(input: ScoreInput): {
  score: number;
  daysLeft: number;
  effectiveBalance: number;
  upcomingRecurring: number;
  nextIncomeDate: Date;
} {
  const { currentBalance, spendSinceLastSnapshot, incomeSources, recurringPayments, today } = input;

  // 1. Find next income date
  const nextIncomeDate = getNextIncomeDate(incomeSources, today);

  // 2. Calculate days left
  const daysLeft = Math.max(1, differenceInCalendarDays(nextIncomeDate, today));

  // 3. Effective balance
  const effectiveBalance = currentBalance - spendSinceLastSnapshot;

  // 4. Pre-deduct upcoming recurring payments
  const upcomingRecurring = recurringPayments
    .filter(p => {
      const dueDate = getActualDueDate(p.dueDay, today);
      return (
        differenceInCalendarDays(dueDate, today) >= 0 &&
        differenceInCalendarDays(dueDate, nextIncomeDate) <= 0
      );
    })
    .reduce((sum, p) => sum + p.amount, 0);

  // 5. Score
  const score = Math.max(0, (effectiveBalance - upcomingRecurring) / daysLeft);

  return { score, daysLeft, effectiveBalance, upcomingRecurring, nextIncomeDate };
}

function getNextIncomeDate(sources: { creditDay: number }[], today: Date): Date {
  const candidates = sources.map(s => {
    const thisMonth = setDate(today, s.creditDay);
    if (differenceInCalendarDays(thisMonth, today) > 0) return thisMonth;
    // Already passed — get next month's
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, s.creditDay);
    return nextMonth;
  });
  return candidates.reduce((min, d) => (d < min ? d : min));
}

function getActualDueDate(dueDay: number, reference: Date): Date {
  const lastDay = endOfMonth(reference).getDate();
  return setDate(reference, Math.min(dueDay, lastDay));
}
```

---

## Appendix C: Spend Categories

Categories are used for recurring payments (mandatory) and optional tagging on daily logs. Keep the set small and opinionated in v1.

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

Rules:
- Recurring payments must select exactly one category.
- Daily log category is optional; if not provided, stored as `null`.
- Category keys are the stable enum — never change them (labels/colors can evolve).

---

## Appendix D: Insight Thresholds

Central constants used by the insights engine. All numbers live in `constants/insightThresholds.ts` so they can be tuned in one place.

| Constant | Value | Used By |
|---|---|---|
| `SAVINGS_RATE_GREEN` | 30 (%) | Savings Rate Insight (§11.2) |
| `SAVINGS_RATE_AMBER` | 15 (%) | Savings Rate Insight (§11.2) |
| `SCORE_HEALTHY_RATIO` | 0.90 | Score Color Rule (§3) |
| `SCORE_GOOD_RATIO` | 0.60 | Score Color Rule (§3) |
| `AVG_WINDOW_DAYS` | 30 | Daily average spend window |
| `STREAK_MIN_DAYS` | 3 | Min days before showing streak insight |
| `OVERSPEND_STREAK_DAYS` | 7 | Trigger for Lifestyle Upgrade insight |
| `SAVINGS_BUFFER_PCT` | 20 (%) | Lifestyle Cost Insight buffer |
| `UPCOMING_PAYMENT_WARN_DAYS` | 3 | Show warning chip on Home |
| `UPCOMING_PAYMENT_NOTIFY_DAYS` | 2 | Local notification lead time |
| `INCOME_COUNTDOWN_DAYS` | 7 | Show income countdown insight |
| `INSIGHT_DISMISS_TTL_HOURS` | 24 | Dismissed insight suppression window |
| `HOME_CAROUSEL_MAX` | 3 | Max insights on Home |
| `HOME_CAROUSEL_ROTATE_MS` | 5000 | Auto-rotate interval |

---

## Appendix E: Notification ID Scheme

Local notifications use a deterministic ID range so they can be cancelled/rescheduled without collisions.

| Range | Purpose | ID Formula |
|---|---|---|
| `1000` | Daily spend prompt | Fixed `1000` |
| `2000–2999` | Upcoming recurring payment | `2000 + recurringPayment.id` |
| `3000–3999` | Salary day nudge | `3000 + incomeSource.id` |
| `4000–4999` | Reserved (future, e.g. month-end summary) | — |

Rules:
- On every schedule pass, cancel the entire range before rescheduling.
- Never hand-pick IDs outside these ranges.
- If the user disables notifications, cancel all IDs across ranges.

---

## Appendix F: Haptics & Micro-interactions

Use `@capacitor/haptics` sparingly. Each interaction has a defined feedback level.

| Interaction | Haptic |
|---|---|
| Onboarding step completed | `Impact { style: Light }` |
| Daily spend saved (under score) | `Notification { type: Success }` |
| Daily spend saved (over score) | `Notification { type: Warning }` |
| Balance updated | `Impact { style: Medium }` |
| Swipe-dismiss insight | `Selection` |
| Reset app confirmed | `Notification { type: Error }` |
| Number pad quick-amount tap | `Selection` |

Motion: respect OS-level reduce-motion settings. Disable carousel auto-rotate and card entrance animations when reduced motion is on.

---

## Appendix G: Accessibility Guidelines

- **Contrast:** All text must meet WCAG AA on both themes. Score numbers must meet AAA.
- **Hit targets:** Minimum 44×44 px for all tappable elements.
- **Dynamic type:** Use `rem` units. Score card scales with OS font size up to 1.3×; beyond that it locks to avoid clipping.
- **Screen readers:** Every icon-only button must have an `aria-label`. The score card exposes a combined label: *"Today's Amban score, 2,340 rupees per day, healthy."*
- **Colour reliance:** Score status (healthy/watch/critical) is also conveyed via a text label under the number, not colour alone.
- **Focus order:** Onboarding fields tab in visual order; primary CTA is always the last focusable element on each step.
- **Localisation:** v1 is English + INR only. All user-facing strings live in a single `strings.ts` file to make future localisation mechanical.

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
| Status bar style | Matches theme (light content on dark, dark on light) |
| Splash background | `#1A73E8` (primary) |
| App icon | Rounded square, white "a" monogram on primary gradient |

Store listing copy is owned outside this repo; keep a `store/` folder with screenshots + description drafts when closer to release.

---

## Appendix I: Reset & Data Wipe Behaviour

"Reset App" in Settings is a destructive, irreversible action. Flow:

1. Show a full-screen confirmation with typed confirmation (user types `RESET` to enable the CTA).
2. On confirm:
   - Drop all SQLite tables and recreate from `schema.sql`.
   - Clear every key in Capacitor Preferences.
   - Cancel every scheduled local notification (all ID ranges).
   - Reset Zustand stores to initial state.
3. Navigate to Welcome screen (as if fresh install).

No data is retained. No undo.

---

## Appendix J: Migration Strategy

> **Superseded by [§14 — Database Resilience & Migration Discipline](#14-database-resilience--migration-discipline) as of v0.2.0.** Kept for historical context.

Even in v1, migrations must be first-class — users will be on the app for months between updates.

- **Schema version** is stored in the `settings.onboarding_version` column plus a dedicated `schema_version` key in Preferences.
- Migrations live in `src/db/migrations/` as numbered files (`001_init.sql`, `002_add_x.sql`, …).
- On app start: read current `schema_version`, apply all pending migrations in order inside a single transaction, then update the version.
- Never edit a shipped migration file — always add a new one.
- If a migration fails: roll back, log locally, and show a non-dismissable error screen with a "Reset App" escape hatch. (No remote recovery possible — this is a local-only app.)

---

## Appendix K: E2E Test Matrix

The canonical test matrix for the §17 instrumented suite. Every row must be green before a release tag.

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
| 31 | POST_NOTIFICATIONS runtime permission (API 33+) | §10, Phase 21 | `PermissionFlowTest` | Permission dialog appears, grant works |
| 32 | Theme toggle: light/dark/system | §9.5 | `ThemeToggleTest` | data-theme attribute correct |
| 33 | Export data produces valid JSON | §13, Phase 13 | `ExportDataTest` | JSON parses, contains expected keys |
| 34 | Zero network during complete flow | §12 | `PrivacyZeroNetworkTest` | No outbound connections in logcat |
| 35 | Reset App → full wipe → re-onboarding | Appendix I | `ResetAppFlowTest` | All tables empty, Welcome screen |
| 36 | All 9 insight generators produce output with valid seed data | §11 | `InsightsScreen` (manual / future) | Each insight type observable |

---

*Last updated: 2026. This document is the single source of truth for amban.io development. All implementation decisions should reference this spec. When in doubt, ship simpler.*
