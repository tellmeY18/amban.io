/**
 * screens/Onboarding/RecurringPayments.tsx — Onboarding Step 5 — recurring payments (Phase 7).
 * Phase 1 scaffolding only. The real implementation lands in a later phase
 * per CLAUDE.md. This stub exists so imports resolve and the skeleton is
 * navigable end-to-end while downstream phases fill in the real screens.
 */

import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar } from "@ionic/react";

const OnboardingRecurringPayments: React.FC = () => (
  <IonPage>
    <IonHeader>
      <IonToolbar>
        <IonTitle>OnboardingRecurringPayments</IonTitle>
      </IonToolbar>
    </IonHeader>
    <IonContent fullscreen>
      <main className="amban-screen">
        <h2>OnboardingRecurringPayments</h2>
        <p style={{ color: "var(--text-muted)", marginTop: "var(--space-sm)" }}>
          Placeholder — real UI lands later.
        </p>
      </main>
    </IonContent>
  </IonPage>
);

export default OnboardingRecurringPayments;
