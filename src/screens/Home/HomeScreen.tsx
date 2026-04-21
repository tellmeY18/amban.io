import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar } from "@ionic/react";
import { Link } from "react-router-dom";

/**
 * HomeScreen — placeholder.
 *
 * This is still Phase 1/2 scaffolding. The real Home screen is built in
 * Phase 8 per CLAUDE.md §9.1 (ScoreCard, yesterday's spend, upcoming
 * payments, insight carousel). Until then, this exists so the router has
 * something to render and the boot sequence can be verified end-to-end.
 *
 * A dev-only link to the /styleguide route is surfaced here so the
 * Phase 2 primitives showcase is one tap away during development. The
 * link is tree-shaken out of production builds by the `import.meta.env.DEV`
 * guard.
 */
const HomeScreen: React.FC = () => {
  const isDev = import.meta.env.DEV;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>amban</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <main className="amban-screen">
          <h1>Know your number.</h1>
          <p style={{ color: "var(--text-muted)", marginTop: "var(--space-sm)" }}>Own your day.</p>
          <p
            style={{
              marginTop: "var(--space-lg)",
              color: "var(--text-muted)",
              fontSize: "var(--text-caption)",
            }}
          >
            Phase 1/2 scaffolding — the real Home screen lands in Phase 8.
          </p>

          {isDev ? (
            <p
              style={{
                marginTop: "var(--space-xl)",
                fontSize: "var(--text-caption)",
              }}
            >
              <Link
                to="/styleguide"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--space-xs)",
                  padding: "var(--space-sm) var(--space-md)",
                  borderRadius: "var(--radius-md)",
                  backgroundColor: "var(--color-primary-light)",
                  color: "var(--color-primary-dark)",
                  fontWeight: "var(--font-weight-medium)",
                  textDecoration: "none",
                }}
              >
                → Open Style Guide (dev only)
              </Link>
            </p>
          ) : null}
        </main>
      </IonContent>
    </IonPage>
  );
};

export default HomeScreen;
