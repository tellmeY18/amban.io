/**
 * screens/Settings/PrivacyStatement.tsx — on-device privacy statement.
 *
 * Source of truth: CLAUDE.md §12 (Local Storage Strategy → No External
 * Calls Policy) and ROADMAP.md Phase 13 ("On-device privacy statement").
 *
 * Responsibilities:
 *   - Reiterate, in plain language, that nothing leaves the device.
 *   - Enumerate exactly what is stored locally and where.
 *   - Explain the notification permission (local-only, no push server).
 *   - Link to the Reset-App escape hatch for users who want to wipe.
 *
 * Design rules:
 *   - Zero network imagery, zero cloud imagery — the page must visually
 *     match the promise it makes.
 *   - Plain typography, wide line-height, friendly Indian English.
 *   - Respects the same container + safe-area pattern as the rest of
 *     Settings so it doesn't feel like a web page pasted inside.
 */

import { useHistory } from "react-router-dom";
import {
  IonBackButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
} from "@ionic/react";

import { BUILD_INFO, formatBuildLabel } from "../../constants/buildInfo";

/** A single labelled paragraph block — no decoration, just readable prose. */
const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section
    style={{
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-sm)",
      paddingTop: "var(--space-md)",
    }}
  >
    <h2
      style={{
        margin: 0,
        fontSize: "var(--text-h3)",
        fontWeight: "var(--font-weight-semibold)",
        color: "var(--text-strong)",
      }}
    >
      {title}
    </h2>
    <div
      style={{
        fontSize: "var(--text-body)",
        lineHeight: "var(--line-height-body)",
        color: "var(--text-secondary)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-sm)",
      }}
    >
      {children}
    </div>
  </section>
);

const PrivacyStatement = () => {
  const history = useHistory();

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/settings" text="Settings" />
          </IonButtons>
          <IonTitle>Privacy</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <main
          style={{
            padding: "var(--space-md) var(--space-md) var(--space-2xl)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-md)",
            maxWidth: 640,
            margin: "0 auto",
          }}
        >
          <header
            style={{
              padding: "var(--space-lg)",
              borderRadius: "var(--radius-lg)",
              backgroundColor: "var(--surface-raised)",
              boxShadow: "var(--shadow-card)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-sm)",
            }}
          >
            <h1
              style={{
                margin: 0,
                fontFamily: "var(--font-display)",
                fontSize: "var(--text-h1)",
                fontWeight: "var(--font-weight-bold)",
                color: "var(--text-strong)",
              }}
            >
              Nothing leaves this device.
            </h1>
            <p
              style={{
                margin: 0,
                fontSize: "var(--text-body)",
                lineHeight: "var(--line-height-body)",
                color: "var(--text-secondary)",
              }}
            >
              amban is a private, on-device finance tracker. We do not run servers for your data. We
              do not run servers for you at all.
            </p>
          </header>

          <Section title="What amban stores">
            <p style={{ margin: 0 }}>
              Every piece of information you enter — your name, income sources, bank balance
              snapshots, recurring payments, and daily spend logs — is written to a SQLite database
              that lives inside this app's sandbox on this device.
            </p>
            <p style={{ margin: 0 }}>
              A handful of small preferences (your chosen theme, your notification time, which
              insight cards you've dismissed) are stored alongside it using the platform's key-value
              store.
            </p>
          </Section>

          <Section title="What amban does not do">
            <ul
              style={{
                margin: 0,
                paddingLeft: "var(--space-lg)",
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-xs)",
              }}
            >
              <li>No accounts. No sign-in. No email or phone number.</li>
              <li>No network requests. No analytics. No crash reporting.</li>
              <li>No cloud sync. No backup server. No third-party SDKs.</li>
              <li>No ads, no tracking, no fingerprinting.</li>
            </ul>
            <p style={{ margin: 0 }}>
              If this device loses power permanently, the data goes with it. That is an intentional
              design decision, not an oversight.
            </p>
          </Section>

          <Section title="About notifications">
            <p style={{ margin: 0 }}>
              The daily spend prompt, upcoming-payment reminders, and salary-day nudges are{" "}
              <em>local</em> notifications. They are scheduled by the app and fired by your phone's
              operating system — no push server is involved, and no data is sent anywhere when they
              fire.
            </p>
            <p style={{ margin: 0 }}>
              You can change the notification time or turn them off entirely under Settings →
              Notifications.
            </p>
          </Section>

          <Section title="Deleting your data">
            <p style={{ margin: 0 }}>
              Because nothing lives on our side, there is nothing for us to delete on request. You
              are in complete control:
            </p>
            <ul
              style={{
                margin: 0,
                paddingLeft: "var(--space-lg)",
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-xs)",
              }}
            >
              <li>
                <strong>Reset app</strong> (Settings → Danger zone) wipes the database, clears
                preferences, and cancels every scheduled notification.
              </li>
              <li>Uninstalling the app removes everything from this device.</li>
            </ul>
            <button
              type="button"
              onClick={() => history.push("/settings")}
              style={{
                alignSelf: "flex-start",
                marginTop: "var(--space-sm)",
                padding: "var(--space-sm) var(--space-md)",
                borderRadius: "var(--radius-pill)",
                border: "1px solid var(--color-divider)",
                backgroundColor: "var(--surface-raised)",
                color: "var(--text-strong)",
                fontSize: "var(--text-caption)",
                fontWeight: "var(--font-weight-semibold)",
                cursor: "pointer",
              }}
            >
              Back to Settings
            </button>
          </Section>

          <Section title="Open source">
            <p style={{ margin: 0 }}>
              amban is licensed under GPL-3.0-or-later. The source code is the ultimate answer to
              "what does this app actually do?" — read it, audit it, fork it.
            </p>
          </Section>

          <footer
            style={{
              marginTop: "var(--space-lg)",
              paddingTop: "var(--space-md)",
              borderTop: "1px solid var(--color-divider)",
              fontSize: "var(--text-micro)",
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono, monospace)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-xs)",
            }}
          >
            <span>{formatBuildLabel()}</span>
            <span>Built {BUILD_INFO.buildDate.slice(0, 10)}</span>
          </footer>
        </main>
      </IonContent>
    </IonPage>
  );
};

export default PrivacyStatement;
