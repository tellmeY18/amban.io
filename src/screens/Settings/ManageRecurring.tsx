/**
 * screens/Settings/ManageRecurring.tsx — Recurring payments CRUD (Phase 10).
 * Phase 1 scaffolding only. The real implementation lands in a later phase
 * per CLAUDE.md. This stub exists so imports resolve and the skeleton is
 * navigable end-to-end while downstream phases fill in the real screens.
 */

import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar } from "@ionic/react";

const ManageRecurring: React.FC = () => (
  <IonPage>
    <IonHeader>
      <IonToolbar>
        <IonTitle>ManageRecurring</IonTitle>
      </IonToolbar>
    </IonHeader>
    <IonContent fullscreen>
      <main className="amban-screen">
        <h2>ManageRecurring</h2>
        <p style={{ color: "var(--text-muted)", marginTop: "var(--space-sm)" }}>
          Placeholder — real UI lands later.
        </p>
      </main>
    </IonContent>
  </IonPage>
);

export default ManageRecurring;
