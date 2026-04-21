/**
 * screens/Home/HomeScreen.tsx — the authenticated landing surface.
 *
 * Source of truth: CLAUDE.md §9.1 (Home Screen) and §8 (The Amban Score).
 *
 * Composition:
 *   1. Greeting header (name + time-of-day)
 *   2. Score card (hero)
 *   3. Warnings / income-day banner (when score warnings demand it)
 *   4. Daily log prompt (yesterday's spend or "log now")
 *   5. Upcoming payments strip (next 7 days)
 *   6. Insight carousel (Phase 11 lands real content; empty list = hidden)
 *
 * Design rules:
 *   - The screen is a thin composition layer. Every tile pulls its
 *     own slice from the stores / hooks — HomeScreen does not thread
 *     props through, because that creates three competing sources of
 *     "current state" (this file, the hook, the child).
 *   - No store writes here. The income-day banner opens a bottom sheet
 *     that talks to financeStore directly; every other action is a
 *     navigation push.
 *   - Respect reduce-motion: the score card count-up lives on the
 *     onboarding reveal; Home intentionally renders the number flat.
 */

import { useMemo, useState } from "react";
import { useHistory } from "react-router-dom";
import { IonContent, IonIcon, IonPage } from "@ionic/react";

import ScoreCard from "./components/ScoreCard";
import DailyLogPrompt from "./components/DailyLogPrompt";
import UpcomingPayments from "./components/UpcomingPayments";
import InsightCarousel from "./components/InsightCarousel";

import BottomSheet from "../../components/ui/BottomSheet";
import CurrencyInput from "../../components/ui/CurrencyInput";

import { useAmbanScore } from "../../hooks/useAmbanScore";
import { useUserStore } from "../../stores/userStore";
import { useFinanceStore } from "../../stores/financeStore";

import { Icons } from "../../theme/icons";
import { formatINR, greetingForHour } from "../../utils/formatters";
import { haptics } from "../../utils/haptics";
import { today as todayStartOfDay } from "../../utils/dateHelpers";

/**
 * Resolves today's matching income sources (by credit day) so the
 * "salary day" banner can prefill the balance sheet with a sensible
 * value (current balance + expected credit).
 */
function incomeSourcesCreditingToday(
  sources: { creditDay: number; amount: number; label: string; isActive: boolean }[],
): { amount: number; labels: string[] } {
  const day = todayStartOfDay().getDate();
  const matches = sources.filter((s) => s.isActive && s.creditDay === day);
  const amount = matches.reduce((sum, s) => sum + s.amount, 0);
  const labels = matches.map((s) => s.label);
  return { amount, labels };
}

/**
 * Top-of-page greeting + dev styleguide shortcut.
 * Kept separate so the header can grow (notification bell, etc.)
 * without bloating the main HomeScreen body.
 */
const GreetingHeader: React.FC = () => {
  const name = useUserStore((s) => s.name);
  const emoji = useUserStore((s) => s.emoji);
  const isDev = import.meta.env.DEV;
  const history = useHistory();

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    return greetingForHour(hour);
  }, []);

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-md)",
        padding: "var(--space-md) var(--space-xs) var(--space-sm)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span
          style={{
            fontSize: "var(--text-caption)",
            color: "var(--text-muted)",
            fontWeight: "var(--font-weight-medium)",
            letterSpacing: "0.02em",
          }}
        >
          {greeting}
        </span>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "var(--text-h1)",
            fontWeight: "var(--font-weight-bold)",
            color: "var(--text-strong)",
            margin: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name ? `${name}${emoji ? ` ${emoji}` : ""}` : "Welcome"}
        </h1>
      </div>

      {isDev ? (
        <button
          type="button"
          onClick={() => history.push("/styleguide")}
          aria-label="Open style guide (dev only)"
          style={{
            minWidth: 40,
            minHeight: 40,
            padding: "var(--space-xs) var(--space-sm)",
            borderRadius: "var(--radius-pill)",
            backgroundColor: "var(--color-primary-light)",
            color: "var(--color-primary-dark)",
            border: "none",
            fontSize: "var(--text-caption)",
            fontWeight: "var(--font-weight-semibold)",
          }}
        >
          dev
        </button>
      ) : null}
    </header>
  );
};

/**
 * Warning banners surfaced above the score card when the score hook
 * flags an edge case the user should act on. Only the highest-priority
 * banner is rendered — stacking them creates noise.
 */
const TopWarningBanner: React.FC<{ warnings: ReturnType<typeof useAmbanScore>["warnings"] }> = ({
  warnings,
}) => {
  const history = useHistory();

  // Priority order (matches §13 ordering in useAmbanScore).
  const primary = warnings.find(
    (w) =>
      w === "no-income-source" ||
      w === "no-balance-snapshot" ||
      w === "projected-negative" ||
      w === "stale-logs",
  );
  if (!primary) return null;

  const banner = (() => {
    switch (primary) {
      case "no-income-source":
        return {
          icon: Icons.status.alert,
          tone: "var(--color-score-warning)",
          tint: "rgba(233, 66, 53, 0.10)",
          title: "Add an income source",
          body: "amban needs at least one income to compute your score.",
          cta: "Add now",
          onCta: () => history.push("/settings/income"),
        };
      case "no-balance-snapshot":
        return {
          icon: Icons.status.alert,
          tone: "var(--color-score-warning)",
          tint: "rgba(233, 66, 53, 0.10)",
          title: "Set your balance",
          body: "Your score needs a starting balance to be meaningful.",
          cta: "Update now",
          onCta: () => history.push("/settings"),
        };
      case "projected-negative":
        return {
          icon: Icons.status.warning,
          tone: "var(--color-score-warning)",
          tint: "rgba(233, 66, 53, 0.10)",
          title: "Bills outrun your balance",
          body: "Your projected balance may not cover upcoming recurring payments.",
          cta: "Review bills",
          onCta: () => history.push("/settings/recurring"),
        };
      case "stale-logs":
        return {
          icon: Icons.status.time,
          tone: "var(--color-score-good)",
          tint: "rgba(242, 153, 0, 0.12)",
          title: "Log your missed days",
          body: "You haven't logged in a while — your score may drift.",
          cta: "Catch up",
          onCta: () => history.push("/log"),
        };
      default:
        return null;
    }
  })();

  if (!banner) return null;

  return (
    <article
      role="status"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--space-md)",
        padding: "var(--space-md)",
        borderRadius: "var(--radius-md)",
        backgroundColor: banner.tint,
        border: `1px solid ${banner.tone}33`,
      }}
    >
      <IonIcon
        icon={banner.icon}
        aria-hidden="true"
        style={{ color: banner.tone, fontSize: "1.25rem", marginTop: 2, flexShrink: 0 }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
        <span
          style={{
            fontSize: "var(--text-body)",
            fontWeight: "var(--font-weight-semibold)",
            color: "var(--text-strong)",
          }}
        >
          {banner.title}
        </span>
        <span
          style={{
            fontSize: "var(--text-caption)",
            color: "var(--text-muted)",
            lineHeight: "var(--line-height-body)",
          }}
        >
          {banner.body}
        </span>
      </div>
      <button
        type="button"
        onClick={banner.onCta}
        style={{
          flexShrink: 0,
          minHeight: 36,
          padding: "var(--space-xs) var(--space-sm)",
          borderRadius: "var(--radius-md)",
          backgroundColor: banner.tone,
          color: "#ffffff",
          border: "none",
          fontSize: "var(--text-caption)",
          fontWeight: "var(--font-weight-semibold)",
          cursor: "pointer",
        }}
      >
        {banner.cta}
      </button>
    </article>
  );
};

/**
 * Income-day banner (§6.4). Shown only when today matches an income
 * source's credit day AND the user hasn't refreshed their balance
 * today. Opens a bottom sheet prefilled with current + expected.
 */
const IncomeDayBanner: React.FC<{ visible: boolean }> = ({ visible }) => {
  const incomeSources = useFinanceStore((s) => s.incomeSources);
  const latestBalance = useFinanceStore((s) => s.latestBalance);
  const setBalance = useFinanceStore((s) => s.setBalance);

  const [open, setOpen] = useState(false);
  const { amount: expectedCredit, labels } = useMemo(
    () => incomeSourcesCreditingToday(incomeSources),
    [incomeSources],
  );

  const prefill = (latestBalance?.amount ?? 0) + expectedCredit;
  const [draft, setDraft] = useState<number | null>(prefill);
  const [busy, setBusy] = useState(false);

  // Keep the draft synced to the prefill when the sheet opens. Without
  // this, reopening after a balance change would show stale numbers.
  const handleOpen = () => {
    setDraft(prefill);
    setOpen(true);
    void haptics.selection();
  };

  const handleSave = async () => {
    if (draft == null || busy) return;
    setBusy(true);
    try {
      await setBalance(draft);
      void haptics.tapMedium();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  if (!visible || expectedCredit <= 0) return null;

  return (
    <>
      <article
        role="status"
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "var(--space-md)",
          padding: "var(--space-md)",
          borderRadius: "var(--radius-md)",
          backgroundColor: "rgba(30, 140, 69, 0.10)",
          border: "1px solid rgba(30, 140, 69, 0.35)",
        }}
      >
        <span aria-hidden="true" style={{ fontSize: "1.25rem" }}>
          🎉
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
          <span
            style={{
              fontSize: "var(--text-body)",
              fontWeight: "var(--font-weight-semibold)",
              color: "var(--text-strong)",
            }}
          >
            Salary day!
          </span>
          <span
            style={{
              fontSize: "var(--text-caption)",
              color: "var(--text-muted)",
              lineHeight: "var(--line-height-body)",
            }}
          >
            Did {formatINR(expectedCredit)}
            {labels.length > 0 ? ` from ${labels.join(" + ")}` : ""} land in your account?
          </span>
        </div>
        <button
          type="button"
          onClick={handleOpen}
          style={{
            flexShrink: 0,
            minHeight: 36,
            padding: "var(--space-xs) var(--space-sm)",
            borderRadius: "var(--radius-md)",
            backgroundColor: "var(--color-score-excellent)",
            color: "#ffffff",
            border: "none",
            fontSize: "var(--text-caption)",
            fontWeight: "var(--font-weight-semibold)",
            cursor: "pointer",
          }}
        >
          Update
        </button>
      </article>

      <BottomSheet
        open={open}
        onDismiss={() => setOpen(false)}
        title="Update balance"
        initialBreakpoint={0.5}
      >
        <p
          style={{
            fontSize: "var(--text-body)",
            color: "var(--text-muted)",
            margin: 0,
            lineHeight: "var(--line-height-body)",
          }}
        >
          We've prefilled your previous balance plus today's expected credit. Adjust it to match
          what's actually in your account.
        </p>
        <CurrencyInput
          label="New balance"
          value={draft}
          onChange={setDraft}
          autoFocus
          placeholder={String(prefill)}
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={draft == null || busy}
          style={{
            minHeight: "var(--hit-target-min)",
            padding: "var(--space-sm) var(--space-lg)",
            borderRadius: "var(--radius-md)",
            backgroundColor:
              draft == null || busy ? "var(--surface-sunken)" : "var(--color-primary)",
            color: draft == null || busy ? "var(--text-muted)" : "#ffffff",
            border: "none",
            fontFamily: "var(--font-body)",
            fontSize: "var(--text-body)",
            fontWeight: "var(--font-weight-semibold)",
            cursor: draft == null || busy ? "not-allowed" : "pointer",
          }}
        >
          {busy ? "Saving…" : "Save balance"}
        </button>
      </BottomSheet>
    </>
  );
};

/**
 * First-launch empty-state for insights. Shown only when the score
 * hook flags `no-history` AND the carousel has nothing to render.
 * Keeps the Home layout from collapsing into a short stub on day 1.
 */
const FirstDayHint: React.FC = () => (
  <article
    style={{
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-xs)",
      padding: "var(--space-md)",
      borderRadius: "var(--radius-md)",
      backgroundColor: "var(--surface-sunken)",
      color: "var(--text-muted)",
      textAlign: "center",
    }}
  >
    <span aria-hidden="true" style={{ fontSize: "1.5rem" }}>
      📘
    </span>
    <span
      style={{
        fontSize: "var(--text-body)",
        color: "var(--text-strong)",
        fontWeight: "var(--font-weight-semibold)",
      }}
    >
      Your first day on amban
    </span>
    <span style={{ fontSize: "var(--text-caption)", lineHeight: "var(--line-height-body)" }}>
      Log a spend tonight to unlock insights, streaks, and trends.
    </span>
  </article>
);

const HomeScreen: React.FC = () => {
  const score = useAmbanScore();
  const hasNoHistoryWarning = score.warnings.includes("no-history");
  const incomeDayPending = score.warnings.includes("income-day-pending");

  return (
    <IonPage>
      <IonContent fullscreen>
        <main
          className="amban-screen"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-md)",
          }}
        >
          <GreetingHeader />

          <TopWarningBanner warnings={score.warnings} />
          <IncomeDayBanner visible={incomeDayPending} />

          <ScoreCard score={score} />

          <DailyLogPrompt />

          <UpcomingPayments />

          <InsightCarousel />

          {hasNoHistoryWarning ? <FirstDayHint /> : null}
        </main>
      </IonContent>
    </IonPage>
  );
};

export default HomeScreen;
