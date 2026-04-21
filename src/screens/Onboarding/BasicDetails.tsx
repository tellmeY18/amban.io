/**
 * screens/Onboarding/BasicDetails.tsx — Onboarding Step 2 — name + emoji (Phase 7).
 * Phase 1 scaffolding only. The real implementation lands in a later phase
 * per CLAUDE.md. This stub exists so imports resolve and the skeleton is
 * navigable end-to-end while downstream phases fill in the real screens.
 */

import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar } from "@ionic/react";

const BasicDetails: React.FC = () => (
  <IonPage>
    <IonHeader>
      <IonToolbar>
        <IonTitle>BasicDetails</IonTitle>
      </IonToolbar>
    </IonHeader>
    <IonContent fullscreen>
      <main className="amban-screen">
        <h2>BasicDetails</h2>
        <p style={{ color: "var(--text-muted)", marginTop: "var(--space-sm)" }}>
          Placeholder — real UI lands later.
        </p>
      </main>
    </IonContent>
  </IonPage>
);

export default BasicDetails;
