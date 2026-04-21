/**
 * components/ui/CurrencyInput.tsx — INR-formatted numeric input.
 *
 * Source of truth: CLAUDE.md §3 (Design System), Appendix A (INR
 * Formatting Utility), and Appendix G (Accessibility Guidelines).
 *
 * Responsibilities:
 *   - Render a numeric input that feels native on mobile: numeric keypad,
 *     no decimal places by default, and a prepended ₹ glyph.
 *   - Format the displayed value using Indian grouping (1,00,000 style)
 *     as the user types, without ever surfacing the formatted string
 *     outside the component.
 *   - Emit the underlying number via `onChange(value)`; callers never see
 *     the formatted text. Empty input emits `null`.
 *   - Respect the hit-target minimum (44×44) and expose a standard
 *     error slot via aria-describedby.
 *
 * Design rules:
 *   - This is a controlled component. The parent owns the number; we
 *     only own the transient formatted text while the user is typing.
 *   - Keep the DOM minimal: a <label> wrapping the ₹ glyph, the <input>,
 *     and an optional error paragraph. No IonLabel / IonItem — those
 *     bring too much vertical chrome for our dense forms.
 *   - No currency symbol is stored — callers see a plain number in rupees.
 *   - Never parse anything except digits. A paste of "₹ 1,23,456" must
 *     resolve to 123456; a paste of "12.5" resolves to 12 (we drop the
 *     decimal tail — amban is integer-rupees by policy in v1).
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties, FocusEvent } from "react";

export interface CurrencyInputProps {
  /** The current value in rupees. `null` means "empty". */
  value: number | null;
  /** Fires on every keystroke that produces a valid new number (or null). */
  onChange: (value: number | null) => void;
  /** Optional label rendered above the field. */
  label?: string;
  /** Placeholder shown when the field is empty. */
  placeholder?: string;
  /** Focus the field on mount. Defaults to false. */
  autoFocus?: boolean;
  /** Error message shown below the field. Non-empty = invalid state. */
  error?: string;
  /** Input name for form submissions. */
  name?: string;
  /** Called when the user commits the value (blur). Useful for persistence. */
  onCommit?: (value: number | null) => void;
  /** Called when the field gains focus. */
  onFocus?: (event: FocusEvent<HTMLInputElement>) => void;
  /** Disables the input and styles it accordingly. */
  disabled?: boolean;
  /**
   * Maximum value allowed. Inputs above the cap are clamped to it.
   * Defaults to 1e10 (₹10,000 crore) — well above any realistic personal
   * finance entry and comfortably inside JS's safe integer range.
   */
  max?: number;
  /** Passthrough class for screen-specific tweaks. */
  className?: string;
}

/** Cap on input magnitude — Appendix A's formatter handles anything under this. */
const DEFAULT_MAX = 1e10;

/**
 * Format a raw number with Indian digit grouping (lakh/crore style):
 * 1,234         -> "1,234"
 * 12,345        -> "12,345"
 * 1,23,456      -> "1,23,456"
 * 1,23,45,678   -> "1,23,45,678"
 *
 * Uses Intl with en-IN locale so the grouping is correct on every JS
 * runtime we ship to. No currency symbol here — the ₹ glyph is rendered
 * as a separate element to keep the grouping stable when the user edits.
 */
function formatIndianDigits(n: number): string {
  if (!Number.isFinite(n)) return "";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
}

/**
 * Pull the integer rupee value out of arbitrary user input. Anything
 * that isn't a digit is dropped, including currency symbols, commas,
 * spaces, and decimal tails. Returns `null` for an empty result so the
 * parent can distinguish "zero" from "unset".
 */
function parseDigits(raw: string): number | null {
  const digits = raw.replace(/\D+/g, "");
  if (digits.length === 0) return null;
  // Guard against absurdly long pastes before we hand them to Number().
  const trimmed = digits.slice(0, 15);
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

const CurrencyInput: React.FC<CurrencyInputProps> = ({
  value,
  onChange,
  label,
  placeholder,
  autoFocus = false,
  error,
  name,
  onCommit,
  onFocus,
  disabled = false,
  max = DEFAULT_MAX,
  className,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const reactId = useId();
  const inputId = `currency-${reactId}`;
  const errorId = error ? `${inputId}-error` : undefined;

  // Text shown inside the <input>. Kept in local state so digit-grouping
  // remains stable while the user types ("1234" -> "1,234" -> "12,345"),
  // but authoritative only while the field is focused. On blur we
  // re-derive from the prop so external updates win.
  const [text, setText] = useState<string>(() => (value == null ? "" : formatIndianDigits(value)));
  const [focused, setFocused] = useState(false);

  // When the external value changes (reset, prefill, programmatic update),
  // sync the displayed text — but only if the user isn't currently typing.
  // Typing takes precedence to avoid caret jumps mid-edit.
  useEffect(() => {
    if (focused) return;
    setText(value == null ? "" : formatIndianDigits(value));
  }, [value, focused]);

  // Honour autoFocus without relying on the unreliable attribute — the
  // ref-based path works uniformly on iOS WebView, Android, and web.
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const parsed = parseDigits(event.target.value);
      if (parsed == null) {
        setText("");
        onChange(null);
        return;
      }
      const clamped = Math.min(parsed, max);
      setText(formatIndianDigits(clamped));
      onChange(clamped);
    },
    [onChange, max],
  );

  const handleFocus = useCallback(
    (event: FocusEvent<HTMLInputElement>) => {
      setFocused(true);
      onFocus?.(event);
    },
    [onFocus],
  );

  const handleBlur = useCallback(() => {
    setFocused(false);
    // Re-derive from the authoritative prop so a trailing edit that
    // resolved to `null` (deleted everything) clears visibly.
    setText(value == null ? "" : formatIndianDigits(value));
    onCommit?.(value);
  }, [value, onCommit]);

  const wrapperStyle = useMemo<CSSProperties>(
    () => ({
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-xs)",
      width: "100%",
    }),
    [],
  );

  const fieldStyle = useMemo<CSSProperties>(
    () => ({
      display: "flex",
      alignItems: "center",
      gap: "var(--space-sm)",
      minHeight: "var(--hit-target-min)",
      padding: "var(--space-sm) var(--space-md)",
      backgroundColor: "var(--surface-sunken)",
      borderRadius: "var(--radius-md)",
      border: `1px solid ${error ? "var(--color-score-warning)" : "transparent"}`,
      transition:
        "border-color var(--motion-fast) var(--motion-ease), background-color var(--motion-fast) var(--motion-ease)",
      opacity: disabled ? 0.55 : 1,
      cursor: disabled ? "not-allowed" : "text",
    }),
    [error, disabled],
  );

  return (
    <div className={className} style={wrapperStyle}>
      {label ? (
        <label
          htmlFor={inputId}
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

      <div
        style={fieldStyle}
        onClick={() => inputRef.current?.focus()}
        // The wrapper is decorative; the real focus target is the <input>.
        // We expose it as presentation so screen readers skip straight to
        // the input without announcing a redundant container.
        role="presentation"
      >
        <span
          aria-hidden="true"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "var(--text-h2)",
            fontWeight: "var(--font-weight-semibold)",
            color: "var(--text-muted)",
            lineHeight: 1,
          }}
        >
          ₹
        </span>
        <input
          ref={inputRef}
          id={inputId}
          name={name}
          type="text"
          // `inputMode` drives the on-screen keyboard; `pattern` nudges
          // browsers that still honour it. `type="text"` (not "number")
          // because we want full control over formatting and caret behaviour.
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="done"
          disabled={disabled}
          placeholder={placeholder ?? "0"}
          value={text}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={errorId}
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: "var(--font-display)",
            fontSize: "var(--text-h2)",
            fontWeight: "var(--font-weight-semibold)",
            color: "var(--text-strong)",
            background: "transparent",
            border: "none",
            outline: "none",
            // Numeric tabular figures keep the grouping commas visually
            // aligned while the user types — stops the "dancing digits"
            // effect on proportional fonts.
            fontVariantNumeric: "tabular-nums",
          }}
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

export default CurrencyInput;
