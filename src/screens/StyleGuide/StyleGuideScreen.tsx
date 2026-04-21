/**
 * screens/StyleGuide/StyleGuideScreen.tsx — dev-only component showcase.
 *
 * Source of truth: CLAUDE.md §3 (Design System Foundation). The roadmap's
 * Phase 2 exit criteria explicitly requires a StyleGuide route that
 * "showcases every primitive in light and dark, with haptics wired and
 * reduce-motion respected".
 *
 * Rules:
 *   - This route is DEV-ONLY. It must be removed (or hidden behind a
 *     compile-time flag) before the first production build. The guard
 *     currently lives in App.tsx, which only mounts this route when
 *     `import.meta.env.DEV` is true.
 *   - No store reads. Every section renders against hardcoded demo data
 *     so the guide works even before SQLite is wired (Phase 3).
 *   - No router navigation away from this page. The BottomNav sample
 *     below uses an onTabSelect callback to demo the haptic tick without
 *     actually leaving the guide.
 *   - Every primitive rendered here is imported via its canonical path,
 *     exactly as screens would consume it. If a primitive requires a
 *     weird prop to "look right" in the guide, that's a signal the
 *     primitive is under-designed — fix the primitive, not the guide.
 */

import { IonContent, IonIcon, IonPage } from "@ionic/react";
import { useState } from "react";
import type { CSSProperties } from "react";

import Badge from "../../components/ui/Badge";
import BottomSheet from "../../components/ui/BottomSheet";
import Card from "../../components/ui/Card";
import CurrencyInput from "../../components/ui/CurrencyInput";
import DatePicker from "../../components/ui/DatePicker";
import ProgressRing from "../../components/ui/ProgressRing";
import BottomNav from "../../components/layout/BottomNav";
import type { NavTabId } from "../../components/layout/BottomNav";

import { CATEGORIES } from "../../constants/categories";
import { CATEGORY_ICONS, Icons } from "../../theme/icons";
import { useTheme } from "../../theme/ThemeProvider";
import type { ThemePreference } from "../../theme/ThemeProvider";
import { haptics, prefersReducedMotion } from "../../utils/haptics";

/* ------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------ */

/** Section wrapper for consistent spacing + heading treatment. */
const Section: React.FC<{ title: string; caption?: string; children: React.ReactNode }> = ({
  title,
  caption,
  children,
}) => (
  <section
    style={{
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-md)",
      paddingTop: "var(--space-lg)",
      paddingBottom: "var(--space-lg)",
      borderBottom: "1px solid var(--divider)",
    }}
  >
    <header style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
      <h2
        style={{
          fontSize: "var(--text-h2)",
          fontWeight: "var(--font-weight-semibold)",
          margin: 0,
          color: "var(--text-strong)",
        }}
      >
        {title}
      </h2>
      {caption ? (
        <p
          style={{
            fontSize: "var(--text-caption)",
            color: "var(--text-muted)",
            margin: 0,
          }}
        >
          {caption}
        </p>
      ) : null}
    </header>
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
      {children}
    </div>
  </section>
);

/** Button token used repeatedly in this screen — local to the guide. */
const demoButtonStyle = (variant: "primary" | "ghost" = "primary"): CSSProperties => ({
  minHeight: "var(--hit-target-min)",
  padding: "var(--space-sm) var(--space-md)",
  borderRadius: "var(--radius-md)",
  fontFamily: "var(--font-body)",
  fontSize: "var(--text-body)",
  fontWeight: "var(--font-weight-medium)",
  border: variant === "ghost" ? "1px solid var(--divider)" : "none",
  background: variant === "ghost" ? "transparent" : "var(--color-primary)",
  color: variant === "ghost" ? "var(--text-strong)" : "#ffffff",
  cursor: "pointer",
});

/** Tiny swatch block used by the colour section. */
const Swatch: React.FC<{ name: string; value: string }> = ({ name, value }) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-xs)",
      minWidth: 96,
    }}
  >
    <div
      style={{
        width: "100%",
        height: 56,
        borderRadius: "var(--radius-md)",
        backgroundColor: value,
        border: "1px solid var(--divider)",
      }}
    />
    <code
      style={{
        fontFamily: "var(--font-body)",
        fontSize: "var(--text-micro)",
        color: "var(--text-muted)",
      }}
    >
      {name}
    </code>
  </div>
);

/* ------------------------------------------------------------------
 * Screen
 * ------------------------------------------------------------------ */

const StyleGuideScreen: React.FC = () => {
  const { preference, effective, setTheme, cycleTheme } = useTheme();

  const [amount, setAmount] = useState<number | null>(12500);
  const [date, setDate] = useState<string | null>(() => new Date().toISOString().slice(0, 10));
  const [progress, setProgress] = useState(0.42);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [lastTab, setLastTab] = useState<NavTabId | null>(null);

  const reduceMotion = prefersReducedMotion();

  const handleTabSelect = (id: NavTabId) => {
    setLastTab(id);
  };

  return (
    <IonPage>
      <IonContent fullscreen>
        <main className="amban-screen" style={{ paddingTop: "var(--space-lg)" }}>
          {/* -------------------------------------------------- */}
          {/* Header                                             */}
          {/* -------------------------------------------------- */}
          <header style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            <Badge tone="info">DEV ONLY</Badge>
            <h1
              style={{
                fontSize: "var(--text-h1)",
                fontWeight: "var(--font-weight-bold)",
                margin: 0,
              }}
            >
              amban.io — Style Guide
            </h1>
            <p
              style={{
                fontSize: "var(--text-body)",
                color: "var(--text-muted)",
                margin: 0,
              }}
            >
              Phase 2 primitives, token surfaces, and theme behaviour. This route is removed before
              release. Reduce motion is currently <strong>{reduceMotion ? "on" : "off"}</strong>.
            </p>
          </header>

          {/* -------------------------------------------------- */}
          {/* Theme controls                                     */}
          {/* -------------------------------------------------- */}
          <Section
            title="Theme"
            caption={`Preference: ${preference} · Effective: ${effective}. Writes <html data-theme> and syncs the status bar.`}
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)" }}>
              {(["light", "dark", "system"] as ThemePreference[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    void haptics.tapLight();
                    setTheme(p);
                  }}
                  style={{
                    ...demoButtonStyle(preference === p ? "primary" : "ghost"),
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--space-xs)",
                  }}
                >
                  <IonIcon
                    icon={
                      p === "light"
                        ? Icons.theme.light
                        : p === "dark"
                          ? Icons.theme.dark
                          : Icons.theme.system
                    }
                    aria-hidden="true"
                    style={{ fontSize: "1.1rem" }}
                  />
                  {p}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  void haptics.selection();
                  cycleTheme();
                }}
                style={demoButtonStyle("ghost")}
              >
                Cycle
              </button>
            </div>
          </Section>

          {/* -------------------------------------------------- */}
          {/* Tokens — colours                                   */}
          {/* -------------------------------------------------- */}
          <Section title="Colour tokens" caption="Driven by src/theme/tokens.css.">
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)" }}>
              <Swatch name="--color-primary" value="var(--color-primary)" />
              <Swatch name="--color-primary-light" value="var(--color-primary-light)" />
              <Swatch name="--color-primary-dark" value="var(--color-primary-dark)" />
              <Swatch name="--color-score-excellent" value="var(--color-score-excellent)" />
              <Swatch name="--color-score-good" value="var(--color-score-good)" />
              <Swatch name="--color-score-warning" value="var(--color-score-warning)" />
              <Swatch name="--surface-base" value="var(--surface-base)" />
              <Swatch name="--surface-raised" value="var(--surface-raised)" />
              <Swatch name="--surface-sunken" value="var(--surface-sunken)" />
            </div>
          </Section>

          {/* -------------------------------------------------- */}
          {/* Typography                                         */}
          {/* -------------------------------------------------- */}
          <Section title="Typography" caption="Display: DM Sans · Body: Inter (self-hosted).">
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "var(--text-score)",
                  fontWeight: "var(--font-weight-bold)",
                  lineHeight: "var(--line-height-tight)",
                }}
              >
                ₹ 2,340
              </span>
              <h1 style={{ fontSize: "var(--text-h1)" }}>H1 · Know your number.</h1>
              <h2 style={{ fontSize: "var(--text-h2)" }}>H2 · Own your day.</h2>
              <h3 style={{ fontSize: "var(--text-h3)" }}>H3 · Section heading</h3>
              <p style={{ fontSize: "var(--text-body)" }}>
                Body · The safe-to-spend amount for today, tuned to your upcoming bills.
              </p>
              <small>Caption · Last updated just now.</small>
              <span style={{ fontSize: "var(--text-micro)", color: "var(--text-faint)" }}>
                Micro · LEGAL/DISCLOSURE
              </span>
            </div>
          </Section>

          {/* -------------------------------------------------- */}
          {/* Cards                                              */}
          {/* -------------------------------------------------- */}
          <Section
            title="Card"
            caption="Base surface primitive. `flat` vs `elevated`, tappable or static."
          >
            <div
              style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-md)" }}
            >
              <Card variant="flat">
                <strong>Flat card</strong>
                <p style={{ color: "var(--text-muted)", fontSize: "var(--text-caption)" }}>
                  Default surface for most content.
                </p>
              </Card>
              <Card variant="elevated">
                <strong>Elevated card</strong>
                <p style={{ color: "var(--text-muted)", fontSize: "var(--text-caption)" }}>
                  For sheets, modals, primary CTAs.
                </p>
              </Card>
              <Card
                variant="flat"
                onClick={() => {
                  void haptics.tapLight();
                }}
                aria-label="Tappable card"
              >
                <strong>Tappable</strong>
                <p style={{ color: "var(--text-muted)", fontSize: "var(--text-caption)" }}>
                  Fires a light haptic on tap.
                </p>
              </Card>
              <Card variant="flat" padding="lg">
                <strong>Padding: lg</strong>
                <p style={{ color: "var(--text-muted)", fontSize: "var(--text-caption)" }}>
                  Padding resolves from spacing tokens.
                </p>
              </Card>
            </div>
          </Section>

          {/* -------------------------------------------------- */}
          {/* Badges                                             */}
          {/* -------------------------------------------------- */}
          <Section title="Badge" caption="Pill labels across all tones.">
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)" }}>
              <Badge tone="neutral">Neutral</Badge>
              <Badge tone="info">In 3 days</Badge>
              <Badge tone="success">Healthy</Badge>
              <Badge tone="warning">Watch it</Badge>
              <Badge tone="danger">Critical</Badge>
            </div>
          </Section>

          {/* -------------------------------------------------- */}
          {/* ProgressRing                                       */}
          {/* -------------------------------------------------- */}
          <Section
            title="ProgressRing"
            caption="SVG ring; snaps instead of tweening when reduce-motion is on."
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-lg)",
                flexWrap: "wrap",
              }}
            >
              <ProgressRing
                progress={progress}
                aria-label="Demo progress"
                size={96}
                strokeWidth={8}
              >
                <span
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "var(--text-h2)",
                    fontWeight: "var(--font-weight-bold)",
                    color: "var(--text-strong)",
                  }}
                >
                  {Math.round(progress * 100)}%
                </span>
              </ProgressRing>
              <ProgressRing
                progress={0.88}
                color="var(--color-score-excellent)"
                size={72}
                strokeWidth={6}
                aria-label="Healthy"
              />
              <ProgressRing
                progress={0.55}
                color="var(--color-score-good)"
                size={72}
                strokeWidth={6}
                aria-label="Watch it"
              />
              <ProgressRing
                progress={0.2}
                color="var(--color-score-warning)"
                size={72}
                strokeWidth={6}
                aria-label="Critical"
              />
            </div>
            <div style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap" }}>
              <button
                type="button"
                style={demoButtonStyle("ghost")}
                onClick={() => setProgress((p) => Math.max(0, p - 0.1))}
              >
                -10%
              </button>
              <button
                type="button"
                style={demoButtonStyle()}
                onClick={() => setProgress((p) => Math.min(1, p + 0.1))}
              >
                +10%
              </button>
            </div>
          </Section>

          {/* -------------------------------------------------- */}
          {/* CurrencyInput                                      */}
          {/* -------------------------------------------------- */}
          <Section
            title="CurrencyInput"
            caption="Indian digit grouping; emits plain numbers; numeric keypad on mobile."
          >
            <CurrencyInput
              label="Today's spend"
              value={amount}
              onChange={setAmount}
              placeholder="0"
            />
            <CurrencyInput
              label="With an error"
              value={null}
              onChange={() => undefined}
              error="Amount must be greater than zero."
            />
            <CurrencyInput label="Disabled" value={65000} onChange={() => undefined} disabled />
            <small>
              Parsed value: <code>{amount ?? "null"}</code>
            </small>
          </Section>

          {/* -------------------------------------------------- */}
          {/* DatePicker                                         */}
          {/* -------------------------------------------------- */}
          <Section title="DatePicker" caption="Wraps IonDatetime; emits YYYY-MM-DD strings.">
            <DatePicker label="Snapshot date" value={date} onChange={setDate} />
            <small>
              ISO value: <code>{date ?? "null"}</code>
            </small>
          </Section>

          {/* -------------------------------------------------- */}
          {/* BottomSheet                                        */}
          {/* -------------------------------------------------- */}
          <Section title="BottomSheet" caption="Wraps IonModal with drag-handle breakpoints.">
            <button
              type="button"
              style={demoButtonStyle()}
              onClick={() => {
                void haptics.tapMedium();
                setSheetOpen(true);
              }}
            >
              Open sheet
            </button>
            <BottomSheet
              open={sheetOpen}
              onDismiss={() => setSheetOpen(false)}
              title="Update balance"
            >
              <CurrencyInput label="New balance" value={amount} onChange={setAmount} autoFocus />
              <div style={{ display: "flex", gap: "var(--space-sm)", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  style={demoButtonStyle("ghost")}
                  onClick={() => setSheetOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  style={demoButtonStyle()}
                  onClick={() => {
                    void haptics.success();
                    setSheetOpen(false);
                  }}
                >
                  Save
                </button>
              </div>
            </BottomSheet>
          </Section>

          {/* -------------------------------------------------- */}
          {/* Haptics                                            */}
          {/* -------------------------------------------------- */}
          <Section
            title="Haptics"
            caption="All fire via utils/haptics.ts. No-op under reduce-motion or on web."
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)" }}>
              {(
                [
                  ["tapLight", haptics.tapLight],
                  ["tapMedium", haptics.tapMedium],
                  ["tapHeavy", haptics.tapHeavy],
                  ["success", haptics.success],
                  ["warning", haptics.warning],
                  ["error", haptics.error],
                  ["selection", haptics.selection],
                ] as const
              ).map(([label, fn]) => (
                <button
                  key={label}
                  type="button"
                  style={demoButtonStyle("ghost")}
                  onClick={() => void fn()}
                >
                  {label}
                </button>
              ))}
            </div>
          </Section>

          {/* -------------------------------------------------- */}
          {/* Category icons                                     */}
          {/* -------------------------------------------------- */}
          <Section
            title="Categories (Appendix C)"
            caption="Stable keys → Ionicons via CATEGORY_ICONS; colours via --color-cat-* tokens."
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                gap: "var(--space-sm)",
              }}
            >
              {CATEGORIES.map((cat) => (
                <div
                  key={cat.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-sm)",
                    padding: "var(--space-sm) var(--space-md)",
                    borderRadius: "var(--radius-md)",
                    backgroundColor: "var(--surface-sunken)",
                  }}
                >
                  <IonIcon
                    icon={CATEGORY_ICONS[cat.key]}
                    aria-hidden="true"
                    style={{
                      fontSize: "1.25rem",
                      color: `var(${cat.colorToken})`,
                    }}
                  />
                  <span style={{ fontSize: "var(--text-caption)" }}>{cat.label}</span>
                </div>
              ))}
            </div>
          </Section>

          {/* -------------------------------------------------- */}
          {/* BottomNav preview                                  */}
          {/* -------------------------------------------------- */}
          <Section
            title="BottomNav"
            caption="The real tab bar. Tapping emits a selection haptic and reports the id (no navigation)."
          >
            <p style={{ fontSize: "var(--text-caption)", color: "var(--text-muted)", margin: 0 }}>
              Last tapped: <code>{lastTab ?? "—"}</code>
            </p>
            <div
              style={{
                position: "relative",
                height: "calc(var(--bottom-nav-height) + 16px)",
                borderRadius: "var(--radius-md)",
                overflow: "hidden",
                border: "1px solid var(--divider)",
              }}
            >
              {/*
                The real BottomNav is position:fixed. Rendering it inline
                here would detach it from the section; instead we render
                a preview that reuses NAV_TABS via BottomNav's own logic.
                The activeOverride keeps Home highlighted regardless of
                the actual router location.
              */}
              <div style={{ position: "absolute", inset: 0 }}>
                <BottomNav activeOverride="home" onTabSelect={handleTabSelect} />
              </div>
            </div>
          </Section>

          <footer style={{ paddingTop: "var(--space-lg)", paddingBottom: "var(--space-2xl)" }}>
            <small>
              When every section above looks right in both themes, Phase 2 is done. Remove this
              route before the release build.
            </small>
          </footer>
        </main>
      </IonContent>
    </IonPage>
  );
};

export default StyleGuideScreen;
