/**
 * screens/Home/components/UpdateBanner.tsx — in-app update prompt.
 *
 * Source of truth: CLAUDE.md §16.7 (UI States) and §16.8 (Placement).
 *
 * Compact banner fixed at the top of the Home screen, above all other
 * content. Non-dismissable — stays visible until the user installs the
 * update or the app is relaunched at the newer version.
 *
 * States:
 *   - idle / checking → not rendered (null)
 *   - available → "Update available vX.Y.Z" + Download button
 *   - downloading → progress bar with percentage
 *   - ready → "Ready to install vX.Y.Z" + Install button
 *   - error → "Download failed" + Retry button
 *   - installing → "Installing…" (transient)
 *
 * Design rules:
 *   - Uses CSS custom properties from the design system.
 *   - No external props — calls useAppUpdater() internally.
 *   - Inline styles following the same pattern as ScoreCard.tsx.
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

const releaseNotesStyle: CSSProperties = {
  fontSize: "var(--text-caption)",
  color: "rgba(255, 255, 255, 0.85)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  maxWidth: "100%",
};

/* ------------------------------------------------------------------
 * Sub-components
 * ------------------------------------------------------------------ */

const ProgressBar: React.FC<{ progress: number }> = ({ progress }) => (
  <div style={progressTrackStyle} role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
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
  "available",
  "downloading",
  "ready",
  "installing",
  "error",
]);

const UpdateBanner: React.FC = () => {
  const { status, version, releaseNotes, progress, startDownload, install, checkForUpdate } =
    useAppUpdater();

  // Don't render when idle or checking.
  if (!VISIBLE_STATUSES.has(status)) return null;

  const versionLabel = version ? `v${version}` : "";

  return (
    <div style={bannerStyle} role="alert" aria-live="polite">
      {status === "available" && (
        <>
          <div style={rowStyle}>
            <span>Update available: {versionLabel}</span>
            <button
              type="button"
              style={outlineButtonStyle}
              onClick={() => void startDownload()}
              aria-label={`Download update ${versionLabel}`}
            >
              Download
            </button>
          </div>
          {releaseNotes ? (
            <span style={releaseNotesStyle} title={releaseNotes}>
              {releaseNotes}
            </span>
          ) : null}
        </>
      )}

      {status === "downloading" && (
        <>
          <div style={rowStyle}>
            <span>Downloading {versionLabel}…</span>
            <span style={{ fontSize: "var(--text-caption)", opacity: 0.9 }}>{progress}%</span>
          </div>
          <ProgressBar progress={progress} />
        </>
      )}

      {status === "ready" && (
        <div style={rowStyle}>
          <span>Ready to install {versionLabel}</span>
          <button
            type="button"
            style={filledButtonStyle}
            onClick={() => void install()}
            aria-label={`Install update ${versionLabel}`}
          >
            Install
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
