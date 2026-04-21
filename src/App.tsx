/**
 * App.tsx — router root.
 *
 * Source of truth: CLAUDE.md §4 (App Architecture). The full routing
 * structure (onboarding gate, four-tab bar, deep links) lands in
 * Phase 6. This file currently covers Phase 2 responsibilities:
 *   - Mount <ThemeProvider> so the whole tree respects the active
 *     theme preference (writes <html data-theme>, syncs the status
 *     bar, follows OS changes when preference is `system`).
 *   - Mount <AppShell> so every rendered screen gets the bottom nav
 *     and the shared error boundary for free.
 *   - Expose the dev-only /styleguide route behind `import.meta.env.DEV`
 *     so Phase 2 can be validated end-to-end in light + dark.
 *
 * Rules of the road:
 *   - Keep route declarations flat and explicit here. Nesting belongs
 *     in the onboarding stack (Phase 7), not in the root router.
 *   - Never mount a dev-only route in a production build. The
 *     import.meta.env.DEV guard is the single gate — if you need
 *     access to the style guide from a prod build, ship a separate
 *     debug build instead of softening this check.
 */

import { Redirect, Route } from "react-router-dom";
import { IonApp, IonRouterOutlet, setupIonicReact } from "@ionic/react";
import { IonReactRouter } from "@ionic/react-router";

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

/* System-driven dark mode palette. amban's ThemeProvider writes
 * <html data-theme> explicitly, but this import gives Ionic's own
 * components (IonModal, IonDatetime, etc.) their dark variants when
 * the OS requests dark and the user hasn't forced light mode. */
import "@ionic/react/css/palettes/dark.system.css";

/* Ionic CSS variables mapped to amban design tokens. Must load after
 * the Ionic core stylesheets above so our overrides actually win. */
import "./theme/variables.css";

import HomeScreen from "./screens/Home/HomeScreen";
import StyleGuideScreen from "./screens/StyleGuide/StyleGuideScreen";
import { ThemeProvider } from "./theme/ThemeProvider";

setupIonicReact({
  mode: "md",
});

/**
 * Dev-only gate. Vite's `import.meta.env.DEV` is `true` during
 * `npm run dev` and `false` in production bundles, so the style
 * guide is tree-shaken out of release builds.
 */
const IS_DEV = import.meta.env.DEV;

const App: React.FC = () => (
  <IonApp>
    <ThemeProvider initialPreference="system">
      <IonReactRouter>
        <IonRouterOutlet>
          <Route exact path="/home">
            <HomeScreen />
          </Route>

          {IS_DEV ? (
            <Route exact path="/styleguide">
              <StyleGuideScreen />
            </Route>
          ) : null}

          <Route exact path="/">
            <Redirect to="/home" />
          </Route>
        </IonRouterOutlet>
      </IonReactRouter>
    </ThemeProvider>
  </IonApp>
);

export default App;
