/**
 * screens/Home/components/InsightCarousel.tsx — rotating insight cards.
 *
 * Source of truth: CLAUDE.md §9.1 (Home Screen → Insight Carousel),
 * §11 (Insights Engine), §11.10 (Insight Priority / Display Rules),
 * and Appendix D (HOME_CAROUSEL_MAX, HOME_CAROUSEL_ROTATE_MS,
 * INSIGHT_DISMISS_TTL_HOURS).
 *
 * Responsibilities:
 *   - Consume `useInsights({ capped: true })` to get the already-
 *     sorted, already-capped list of Home-worthy insights.
 *   - Render up to HOME_CAROUSEL_MAX insight cards with a single
 *     card visible at a time.
 *   - Auto-rotate every HOME_CAROUSEL_ROTATE_MS. Pause on pointer
 *     interaction and when the OS has requested reduce-motion.
 *   - Expose a swipe-to-dismiss affordance that calls
 *     `useInsights().dismiss(id)` and immediately rotates to the next
 *     card.
 *
 * Design rules:
 *   - Pure presentational. No Capacitor Preferences reads here — all
 *     dismissal state lives in the hook.
 *   - No imperative animation libraries. A CSS opacity/translate
 *     transition is enough — this is ambient UI, not a hero moment.
 *   - When the list is empty (first-day, or every insight dismissed),
 *     render nothing. The parent screen decides the empty-state copy.
 *   - Render nothing while the hook is loading so we never flash an
 *     empty slot before the first insight resolves.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import { IonIcon } from "@ionic/react";

import { useInsights } from "../../../hooks/useInsights";
import type { Insight, InsightTone } from "../../../hooks/useInsights";
import { HOME_CAROUSEL_MAX, HOME_CAROUSEL_ROTATE_MS } from "../../../constants/insightThresholds";
import { Icons } from "../../../theme/icons";
import { haptics, prefersReducedMotion } from "../../../utils/haptics";

/**
 * Tone → CSS colour lookup. Kept local to this component — the rest
 * of the app reasons about insight tones in the abstract, only the
 * card renderer needs concrete colours.
 */
const TONE_ACCENT: Record<InsightTone, string> = {
  positive: "var(--color-score-excellent)",
  neutral: "var(--color-primary)",
  warning: "var(--color-score-good)",
  critical: "var(--color-score-warning)",
};

const TONE_TINT: Record<InsightTone, string> = {
  positive: "rgba(30, 140, 69, 0.10)",
  neutral: "var(--color-primary-light)",
  warning: "rgba(242, 153, 0, 0.12)",
  critical: "rgba(233, 66, 53, 0.10)",
};

/**
 * Minimum horizontal swipe distance (px) before we treat a pointer
 * gesture as a dismiss. Tuned to feel intentional — a scroll or an
 * accidental drag shouldn't ever wipe an insight.
 */
const SWIPE_DISMISS_PX = 80;

const InsightCarousel: React.FC = () => {
  // The hook owns sorting, dismissal TTL, and the HOME_CAROUSEL_MAX
  // cap. We just render what it hands back.
  const { insights, loading, dismiss } = useInsights({ capped: true });

  const [activeIndex, setActiveIndex] = useState(0);
  const [dragDx, setDragDx] = useState(0);
  const [paused, setPaused] = useState(false);
  const pointerStartX = useRef<number | null>(null);
  const reduceMotion = prefersReducedMotion();

  // Keep activeIndex in range when the list shrinks (dismiss, hydrate
  // order, etc.). Clamp rather than reset so a dismiss advances
  // forward naturally.
  useEffect(() => {
    if (insights.length === 0) {
      setActiveIndex(0);
      return;
    }
    if (activeIndex >= insights.length) {
      setActiveIndex(insights.length - 1);
    }
  }, [insights.length, activeIndex]);

  // Auto-rotate. Skip entirely when there's nothing to rotate, when
  // the user has paused via touch, or when reduce-motion is on.
  useEffect(() => {
    if (insights.length <= 1) return;
    if (paused || reduceMotion) return;
    const t = setInterval(() => {
      setActiveIndex((i) => (i + 1) % insights.length);
    }, HOME_CAROUSEL_ROTATE_MS);
    return () => clearInterval(t);
  }, [insights.length, paused, reduceMotion]);

  const current = insights[activeIndex];

  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    pointerStartX.current = event.clientX;
    setPaused(true);
  }, []);

  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (pointerStartX.current == null) return;
    setDragDx(event.clientX - pointerStartX.current);
  }, []);

  const handlePointerEnd = useCallback(
    async (event: PointerEvent<HTMLDivElement>) => {
      if (pointerStartX.current == null) {
        setPaused(false);
        return;
      }
      const dx = event.clientX - pointerStartX.current;
      pointerStartX.current = null;
      setDragDx(0);

      if (!current) {
        setPaused(false);
        return;
      }

      if (Math.abs(dx) >= SWIPE_DISMISS_PX) {
        // Swipe registered — dismiss the current card and advance.
        void haptics.selection();
        try {
          await dismiss(current.id);
        } catch {
          // Dismissal failures are non-fatal; leave the card up and
          // the hook will retry on the next render.
        }
      }
      // Resume auto-rotate after a short cool-down so a rapid second
      // tap doesn't feel like it "fought" the carousel.
      setTimeout(() => setPaused(false), 600);
    },
    [current, dismiss],
  );

  // Nothing to render — the parent screen decides whether to show an
  // empty-state. This component never injects its own copy.
  if (loading) return null;
  if (insights.length === 0 || !current) return null;

  return (
    <section
      aria-label="Insights"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-xs)",
      }}
    >
      <div
        role="group"
        aria-roledescription="carousel"
        aria-label={`Insight ${activeIndex + 1} of ${insights.length}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        style={{
          position: "relative",
          userSelect: "none",
          touchAction: "pan-y",
        }}
      >
        <InsightCard insight={current} dragDx={dragDx} reduceMotion={reduceMotion} />
      </div>

      {insights.length > 1 ? (
        <div
          role="tablist"
          aria-label="Insight indicators"
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "var(--space-xs)",
            paddingTop: "var(--space-xs)",
          }}
        >
          {insights.map((insight, index) => {
            const isActive = index === activeIndex;
            return (
              <button
                key={insight.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={`Show insight ${index + 1}`}
                onClick={() => {
                  void haptics.selection();
                  setActiveIndex(index);
                  // Pause rotation briefly after a manual pick so the
                  // auto-advance doesn't immediately fight the tap.
                  setPaused(true);
                  setTimeout(() => setPaused(false), 1_500);
                }}
                style={{
                  width: isActive ? 18 : 6,
                  height: 6,
                  minWidth: 0,
                  minHeight: 0,
                  padding: 0,
                  borderRadius: "var(--radius-pill)",
                  backgroundColor: isActive ? "var(--color-primary)" : "var(--divider)",
                  border: "none",
                  cursor: "pointer",
                  transition:
                    "width var(--motion-fast) var(--motion-ease), background-color var(--motion-fast) var(--motion-ease)",
                }}
              />
            );
          })}
        </div>
      ) : null}

      {/* Hard cap reminder for assistive tech — the UI is already
       *  visually constrained, but the label helps screen readers
       *  understand why only a subset is on screen. */}
      <span className="sr-only">
        Showing up to {HOME_CAROUSEL_MAX} insights on Home. View all in the Insights tab.
      </span>
    </section>
  );
};

/**
 * A single insight card. Kept as a local subcomponent so the carousel
 * wrapper stays focused on gesture + rotation state.
 */
const InsightCard: React.FC<{
  insight: Insight;
  dragDx: number;
  reduceMotion: boolean;
}> = ({ insight, dragDx, reduceMotion }) => {
  const accent = TONE_ACCENT[insight.tone];
  const tint = TONE_TINT[insight.tone];

  // Drag affordance: translate horizontally and fade slightly as the
  // user pulls. Capped so the card never slides off the edge entirely
  // before the gesture resolves.
  const translate = useMemo(() => {
    const capped = Math.max(-120, Math.min(120, dragDx));
    return capped;
  }, [dragDx]);

  const opacity = useMemo(() => {
    if (dragDx === 0) return 1;
    const mag = Math.min(Math.abs(dragDx), 120);
    return 1 - (mag / 120) * 0.35;
  }, [dragDx]);

  const cardStyle: CSSProperties = {
    display: "flex",
    alignItems: "flex-start",
    gap: "var(--space-md)",
    padding: "var(--space-md)",
    borderRadius: "var(--radius-md)",
    backgroundColor: "var(--surface-raised)",
    boxShadow: "var(--shadow-card)",
    borderLeft: `3px solid ${accent}`,
    transform: `translateX(${translate}px)`,
    opacity,
    transition: reduceMotion
      ? "none"
      : dragDx === 0
        ? "transform var(--motion-base) var(--motion-ease-out), opacity var(--motion-base) var(--motion-ease-out)"
        : "none",
  };

  return (
    <article style={cardStyle} aria-label={insight.headline}>
      <span
        aria-hidden="true"
        style={{
          width: 36,
          height: 36,
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "var(--radius-pill)",
          backgroundColor: tint,
          color: accent,
        }}
      >
        <IonIcon icon={insight.icon || Icons.status.info} />
      </span>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          minWidth: 0,
          flex: 1,
        }}
      >
        <span
          style={{
            fontSize: "var(--text-body)",
            fontWeight: "var(--font-weight-semibold)",
            color: "var(--text-strong)",
            lineHeight: "var(--line-height-body)",
          }}
        >
          {insight.headline}
        </span>
        {insight.supporting ? (
          <span
            style={{
              fontSize: "var(--text-caption)",
              color: "var(--text-muted)",
              lineHeight: "var(--line-height-body)",
            }}
          >
            {insight.supporting}
          </span>
        ) : null}
        <span
          style={{
            marginTop: "var(--space-xs)",
            fontSize: "var(--text-micro)",
            color: "var(--text-muted)",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          Swipe to dismiss
        </span>
      </div>
    </article>
  );
};

export default InsightCarousel;
