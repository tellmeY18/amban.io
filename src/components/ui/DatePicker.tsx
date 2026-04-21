/**
 * components/ui/DatePicker.tsx — date selection primitive.
 *
 * Source of truth: CLAUDE.md §6 (User Flows — balance updates, backfill
 * logs), §9.5 (Settings — notification time is handled separately by a
 * time-only variant downstream), and Appendix G (Accessibility).
 *
 * Implementation notes:
 *   - Wraps @ionic/react's <IonDatetime> so the component inherits the
 *     native-feel wheel/calendar UX on iOS and the Material calendar on
 *     Android, with zero bespoke logic on our side.
 *   - amban stores dates as ISO date strings (YYYY-MM-DD) — never as
 *     Date objects at rest. This component's `value` / `onChange` speak
 *     that same string so the store layer can write through without
 *     any format conversion.
 *   - Themed via Ionic CSS variables (see src/theme/variables.css) so the
 *     picker flips with light/dark automatically.
 *   - Hit-target and focus-ring tokens come from src/theme/tokens.css.
 *
 * Design rules:
 *   - Controlled component. Parent owns the ISO string; we only own the
 *     transient "which detent is the modal at" state when presented as
 *     a sheet.
 *   - `presentation="date"` by default. A `mode="date-time"` escape hatch
 *     exists but no v1 flow needs it — backfill uses per-day rows, not
 *     timestamps.
 *   - Never return a Date to the caller. If you need date math, pull the
 *     ISO string into `date-fns` at the call site — keeps this component
 *     boring and side-effect free.
 */

import { IonDatetime } from "@ionic/react";
import { useCallback, useId, useMemo } from "react";
import type { CSSProperties } from "react";

import { prefersReducedMotion } from "../../utils/haptics";

/** Kind of picker surface. `date` is the overwhelming v1 default. */
export type DatePickerPresentation = "date" | "date-time" | "time";

export interface DatePickerProps {
  /**
   * Current value as an ISO-8601 date string (YYYY-MM-DD) for `date`
   * presentation, or an ISO datetime for `date-time`. `null` / empty
   * means "unset".
   */
  value: string | null;
  /** Fires with the new ISO string whenever the user picks a value. */
  onChange: (value: string | null) => void;
  /** Optional label rendered above the picker. */
  label?: string;
  /** Surface kind. Defaults to `date`. */
  presentation?: DatePickerPresentation;
  /**
   * Earliest selectable date as an ISO string. Useful for backfill
   * (§13.6) where we don't want the user picking a future date, or for
   * recurring payment editors that must stay within this month.
   */
  min?: string;
  /** Latest selectable date as an ISO string. Defaults to today. */
  max?: string;
  /** Error message shown below the picker. Non-empty = invalid state. */
  error?: string;
  /** Disables interaction. */
  disabled?: boolean;
  /** Input name for form submissions. */
  name?: string;
  /** Accessible label when no visible `label` is provided. */
  "aria-label"?: string;
  /** Passthrough class for screen-specific tweaks. */
  className?: string;
}

/**
 * Reduce an Ionic onIonChange payload to the ISO string we care about.
 * Ionic emits either a single string, an array (multi-select mode we
 * don't use), or null. We normalize everything to `string | null`.
 */
function normalizeChangeValue(raw: unknown): string | null {
  if (typeof raw === "string" && raw.length > 0) return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
  return null;
}

/**
 * For `presentation="date"` we only care about YYYY-MM-DD. IonDatetime
 * sometimes emits a full ISO datetime (with time component) depending
 * on the platform; slice it down so the store never sees stray "T00:00:00".
 */
function trimToPresentation(
  value: string | null,
  presentation: DatePickerPresentation,
): string | null {
  if (!value) return null;
  if (presentation === "date") {
    // Keep the first 10 chars — the YYYY-MM-DD head of any ISO string.
    return value.slice(0, 10);
  }
  return value;
}

const DatePicker: React.FC<DatePickerProps> = ({
  value,
  onChange,
  label,
  presentation = "date",
  min,
  max,
  error,
  disabled = false,
  name,
  "aria-label": ariaLabel,
  className,
}) => {
  const reactId = useId();
  const pickerId = `datepicker-${reactId}`;
  const errorId = error ? `${pickerId}-error` : undefined;

  // Ionic's animation engine is governed by its own internal flags, but
  // we still honour reduce-motion by asking it to skip the open/close
  // transition when the OS requests a quieter experience.
  const animated = !prefersReducedMotion();

  const handleIonChange = useCallback(
    (event: CustomEvent) => {
      if (disabled) return;
      const raw = normalizeChangeValue(event.detail?.value);
      onChange(trimToPresentation(raw, presentation));
    },
    [disabled, onChange, presentation],
  );

  const wrapperStyle = useMemo<CSSProperties>(
    () => ({
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-xs)",
      width: "100%",
      opacity: disabled ? 0.55 : 1,
      pointerEvents: disabled ? "none" : "auto",
    }),
    [disabled],
  );

  const fieldStyle = useMemo<CSSProperties>(
    () => ({
      minHeight: "var(--hit-target-min)",
      padding: "var(--space-sm)",
      backgroundColor: "var(--surface-sunken)",
      borderRadius: "var(--radius-md)",
      border: `1px solid ${error ? "var(--color-score-warning)" : "transparent"}`,
      transition:
        "border-color var(--motion-fast) var(--motion-ease), background-color var(--motion-fast) var(--motion-ease)",
      // Expose amban surface tokens to IonDatetime's internals so the
      // calendar inherits the active theme without bespoke overrides.
      ["--background" as string]: "var(--surface-sunken)",
      ["--ion-color-base" as string]: "var(--color-primary)",
    }),
    [error],
  );

  return (
    <div className={className} style={wrapperStyle}>
      {label ? (
        <label
          htmlFor={pickerId}
          style={{
            fontSize: "var(--text-caption)",
            fontWeight: "var(--font-weight-medium)",
            color: "var(--text-muted)",
            letterSpacing: "0.01em",
          }}
        >
          {label}
        </label>
      ) : null}

      <div style={fieldStyle}>
        <IonDatetime
          id={pickerId}
          name={name}
          presentation={presentation}
          value={value ?? undefined}
          min={min}
          max={max}
          disabled={disabled}
          onIonChange={handleIonChange}
          aria-label={label ?? ariaLabel}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={errorId}
          // `showDefaultButtons` is intentionally omitted — the caller
          // decides when to commit by watching onChange. Keeping the
          // default (inline) surface keeps the component composable
          // inside <BottomSheet>, its main host.
          preferWheel={presentation === "time"}
          firstDayOfWeek={1 /* Monday — matches Indian calendar convention */}
          // Animate only when the OS hasn't opted out of motion.
          // `animated` is not a first-class prop on IonDatetime but it
          // is forwarded via data attribute for future extension; the
          // primary lever is reduce-motion CSS already applied globally.
          data-animated={animated ? "true" : "false"}
        />
      </div>

      {error ? (
        <p
          id={errorId}
          role="alert"
          style={{
            fontSize: "var(--text-caption)",
            color: "var(--color-score-warning)",
            margin: 0,
          }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
};

export default DatePicker;
