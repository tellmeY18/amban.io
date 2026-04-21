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
14. [Future Scope](#14-future-scope)
15. [Appendices](#appendices)
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

## 14. Future Scope

These are NOT in v1.0 but are worth architectural consideration:

| Feature | Notes |
|---|---|
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

Even in v1, migrations must be first-class — users will be on the app for months between updates.

- **Schema version** is stored in the `settings.onboarding_version` column plus a dedicated `schema_version` key in Preferences.
- Migrations live in `src/db/migrations/` as numbered files (`001_init.sql`, `002_add_x.sql`, …).
- On app start: read current `schema_version`, apply all pending migrations in order inside a single transaction, then update the version.
- Never edit a shipped migration file — always add a new one.
- If a migration fails: roll back, log locally, and show a non-dismissable error screen with a "Reset App" escape hatch. (No remote recovery possible — this is a local-only app.)

---

*Last updated: 2026. This document is the single source of truth for amban.io development. All implementation decisions should reference this spec. When in doubt, ship simpler.*
