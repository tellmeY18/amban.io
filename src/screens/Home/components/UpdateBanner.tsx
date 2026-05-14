/**
 * screens/Home/components/UpdateBanner.tsx — in-app update prompt.
 *
 * Auto-downloads the APK in the background when an update is detected.
 * The user only sees progress → then a single "Install now" button.
 *
 * States:
 *   - idle / checking / available → not rendered (download is automatic)
 *   - downloading → progress bar with percentage
 *   - ready → "✅ vX.Y.Z ready" + Install now button
 *   - error → "Download failed" + Retry button
 *   - installing → "Installing…" (transient)
 */

import type { CSSProperties } from "react";

import { useAppUpdater } from "../../../hooks/useAppUpdater";
import type { UpdateStatus } from "../../../hooks/useAppUpdater";

/* ------------------------------------------------------------------
 * Styles
 * ------------------------------------------------------------------ */

const bannerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-xs)",
  padding: "var(--space-sm) var(--space-md)",
  borderRadius: "var(--radius-md)",
  backgroundColor: "var(--color-primary)",
  color: "#FFFFFF",
  fontSize: "var(--text-body)",
  fontWeight: "var(--font-weight-medium)",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-sm)",
};

const buttonBaseStyle: CSSProperties = {
  padding: "var(--space-xs) var(--space-sm)",
  borderRadius: "var(--radius-sm)",
  fontSize: "var(--text-caption)",
  fontWeight: "var(--font-weight-semibold)",
  cursor: "pointer",
  border: "none",
  lineHeight: 1.4,
  whiteSpace: "nowrap",
};

const outlineButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  backgroundColor: "transparent",
  color: "#FFFFFF",
  border: "1.5px solid rgba(255, 255, 255, 0.8)",
};

const filledButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  backgroundColor: "#FFFFFF",
  color: "var(--color-primary)",
};

const progressTrackStyle: CSSProperties = {
  width: "100%",
  height: 4,
  borderRadius: 2,
  backgroundColor: "rgba(255, 255, 255, 0.3)",
  overflow: "hidden",
};

/* ------------------------------------------------------------------
 * Sub-components
 * ------------------------------------------------------------------ */

const ProgressBar: React.FC<{ progress: number }> = ({ progress }) => (
  <div
    style={progressTrackStyle}
    role="progressbar"
    aria-valuenow={progress}
    aria-valuemin={0}
    aria-valuemax={100}
  >
    <div
      style={{
        width: `${Math.min(100, Math.max(0, progress))}%`,
        height: "100%",
        backgroundColor: "#FFFFFF",
        borderRadius: 2,
        transition: "width 0.2s ease-out",
      }}
    />
  </div>
);

/* ------------------------------------------------------------------
 * Component
 * ------------------------------------------------------------------ */

/** Statuses that cause the banner to render. */
const VISIBLE_STATUSES: Set<UpdateStatus> = new Set([
  "downloading",
  "ready",
  "installing",
  "error",
]);

const UpdateBanner: React.FC = () => {
  const { status, version, progress, install, checkForUpdate } = useAppUpdater();

  // Don't render when idle, checking, or available (download starts automatically)
  if (!VISIBLE_STATUSES.has(status)) return null;

  const versionLabel = version ? `v${version}` : "";

  return (
    <div style={bannerStyle} role="alert" aria-live="polite">
      {status === "downloading" && (
        <>
          <div style={rowStyle}>
            <span>Downloading update {versionLabel}…</span>
            <span style={{ fontSize: "var(--text-caption)", opacity: 0.9 }}>{progress}%</span>
          </div>
          <ProgressBar progress={progress} />
        </>
      )}

      {status === "ready" && (
        <div style={rowStyle}>
          <span>✅ {versionLabel} ready</span>
          <button
            type="button"
            style={filledButtonStyle}
            onClick={() => void install()}
            aria-label={`Install update ${versionLabel}`}
          >
            Install now
          </button>
        </div>
      )}

      {status === "installing" && (
        <div style={rowStyle}>
          <span>Installing {versionLabel}…</span>
        </div>
      )}

      {status === "error" && (
        <div style={rowStyle}>
          <span>Download failed</span>
          <button
            type="button"
            style={outlineButtonStyle}
            onClick={() => void checkForUpdate()}
            aria-label="Retry update download"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
};

export default UpdateBanner;
