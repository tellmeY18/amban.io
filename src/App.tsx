/**
 * App.tsx — router root.
 *
 * Phase 6 (Navigation & App Shell):
 *   - Onboarding vs authenticated split: when `onboardingComplete` is
 *     false the onboarding stack is mounted; otherwise the four-tab
 *     shell with Home / Log / Insights / Settings is rendered.
 *   - Deep links: `amban://log` and the plain `/log` path jump
 *     straight into the Daily Log. Other notification taps land on
 *     Home.
 *   - Lifecycle triggers: subscribes to Capacitor's `appStateChange`
 *     so scoring hooks re-evaluate on resume. A midnight tick nudges
 *     a harmless slice of the user store so every score consumer
 *     re-memoises against "today" at 00:00 local time.
 *   - The ErrorBoundary inside AppShell catches in-tree render
 *     failures; the migration-failure escape hatch lives one level up
 *     in `main.tsx`.
 */

import { useEffect } from "react";
import { Redirect, Route, Switch, useHistory } from "react-router-dom";
import { IonApp, IonRouterOutlet, setupIonicReact } from "@ionic/react";
import { IonReactRouter } from "@ionic/react-router";
import { App as CapacitorApp } from "@capacitor/app";

/* Core Ionic styles */
import "@ionic/react/css/core.css";
import "@ionic/react/css/normalize.css";
import "@ionic/react/css/structure.css";
import "@ionic/react/css/typography.css";

/* Utility classes */
import "@ionic/react/css/padding.css";
import "@ionic/react/css/float-elements.css";
import "@ionic/react/css/text-alignment.css";
import "@ionic/react/css/text-transformation.css";
import "@ionic/react/css/flex-utils.css";
import "@ionic/react/css/display.css";

import "@ionic/react/css/palettes/dark.system.css";
import "./theme/variables.css";

import AppShell from "./components/layout/AppShell";
import HomeScreen from "./screens/Home/HomeScreen";
import DailyLogScreen from "./screens/Log/DailyLogScreen";
import LogHistory from "./screens/Log/LogHistory";
import InsightsScreen from "./screens/Insights/InsightsScreen";
import SettingsScreen from "./screens/Settings/SettingsScreen";
import ManageIncome from "./screens/Settings/ManageIncome";
import ManageRecurring from "./screens/Settings/ManageRecurring";
import NotificationSettings from "./screens/Settings/NotificationSettings";
import PrivacyStatement from "./screens/Settings/PrivacyStatement";
import OnboardingStack from "./screens/Onboarding/OnboardingStack";
import StyleGuideScreen from "./screens/StyleGuide/StyleGuideScreen";

import { ThemeProvider } from "./theme/ThemeProvider";
import { useUserStore } from "./stores/userStore";
import { useDailyStore } from "./stores/dailyStore";
import { useFinanceStore } from "./stores/financeStore";

setupIonicReact({ mode: "md" });

const IS_DEV = import.meta.env.DEV;

/**
 * Computes the ms until the next local midnight. Used by the midnight
 * tick subscriber so "today"-dependent hooks re-evaluate at 00:00.
 */
function msUntilNextMidnight(): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 50); // tiny nudge past midnight
  return Math.max(1_000, next.getTime() - now.getTime());
}

/**
 * Wires app-lifecycle side effects: foreground-resume score refresh,
 * midnight recalc. Lives inside the router so `useHistory` is valid.
 */
const LifecycleSubscribers: React.FC = () => {
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Bump the loadedDays of dailyStore to force a fresh read from
    // SQLite whenever the app resumes or a new day begins. The read
    // is cheap and keeps scoring honest.
    const refreshOnTick = async () => {
      if (cancelled) return;
      try {
        const daily = useDailyStore.getState();
        await daily.fetchLogs(daily.loadedDays);
        const finance = useFinanceStore.getState();
        await finance.hydrate();
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn("[amban.lifecycle] refresh failed:", err);
        }
      }
    };

    const scheduleMidnight = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        await refreshOnTick();
        scheduleMidnight();
      }, msUntilNextMidnight());
    };
    scheduleMidnight();

    // Foreground resume handler. Capacitor's listener API is async in
    // v8; we treat the returned handle best-effort.
    let removeHandle: { remove: () => Promise<void> } | null = null;
    CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) void refreshOnTick();
    })
      .then((h) => {
        if (cancelled) void h.remove();
        else removeHandle = h;
      })
      .catch(() => {
        /* web dev — plugin unavailable, silently skip */
      });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (removeHandle) void removeHandle.remove();
    };
  }, []);

  return null;
};

/**
 * Deep-link handler — listens for Capacitor `appUrlOpen` events and
 * routes `amban://log` to /log. Any other scheme falls through to
 * Home (the default landing).
 */
const DeepLinkHandler: React.FC = () => {
  const history = useHistory();

  useEffect(() => {
    let removeHandle: { remove: () => Promise<void> } | null = null;
    let cancelled = false;

    CapacitorApp.addListener("appUrlOpen", (event) => {
      try {
        const url = new URL(event.url);
        // `amban://log` parses with host = "log" on most platforms.
        const target = url.host || url.pathname.replace(/^\/+/, "");
        if (target === "log") {
          history.push("/log");
        } else {
          history.push("/home");
        }
      } catch {
        // Malformed URL — ignore.
      }
    })
      .then((h) => {
        if (cancelled) void h.remove();
        else removeHandle = h;
      })
      .catch(() => {
        /* web — not available */
      });

    return () => {
      cancelled = true;
      if (removeHandle) void removeHandle.remove();
    };
  }, [history]);

  return null;
};

/**
 * Onboarding-vs-authenticated router split. Reads `onboardingComplete`
 * from the user store; the store is already hydrated by `bootstrapApp`
 * before this component mounts (see main.tsx / BootGate).
 */
const AuthenticatedRoutes: React.FC = () => (
  <AppShell>
    <IonRouterOutlet>
      <Switch>
        <Route exact path="/home" component={HomeScreen} />
        <Route exact path="/log" component={DailyLogScreen} />
        <Route exact path="/log/history" component={LogHistory} />
        <Route exact path="/insights" component={InsightsScreen} />
        <Route exact path="/settings" component={SettingsScreen} />
        <Route exact path="/settings/income" component={ManageIncome} />
        <Route exact path="/settings/recurring" component={ManageRecurring} />
        <Route exact path="/settings/notifications" component={NotificationSettings} />
        <Route exact path="/settings/privacy" component={PrivacyStatement} />
        {IS_DEV ? <Route exact path="/styleguide" component={StyleGuideScreen} /> : null}
        <Route exact path="/">
          <Redirect to="/home" />
        </Route>
        <Route>
          <Redirect to="/home" />
        </Route>
      </Switch>
    </IonRouterOutlet>
  </AppShell>
);

const App: React.FC = () => {
  const onboardingComplete = useUserStore((s) => s.onboardingComplete);
  const hydrated = useUserStore((s) => s.hydrated);

  // Until the user store has hydrated we can't safely pick a branch —
  // the boot gate in main.tsx already awaits hydration, so this
  // should effectively always be `true` by the time we render. The
  // guard is defensive against a future change to that contract.
  if (!hydrated) return null;

  return (
    <IonApp>
      <ThemeProvider initialPreference="system">
        <IonReactRouter>
          <LifecycleSubscribers />
          <DeepLinkHandler />
          {onboardingComplete ? (
            <AuthenticatedRoutes />
          ) : (
            <IonRouterOutlet>
              <Switch>
                {IS_DEV ? <Route exact path="/styleguide" component={StyleGuideScreen} /> : null}
                <Route path="/onboarding" component={OnboardingStack} />
                <Route>
                  <Redirect to="/onboarding" />
                </Route>
              </Switch>
            </IonRouterOutlet>
          )}
        </IonReactRouter>
      </ThemeProvider>
    </IonApp>
  );
};

export default App;
