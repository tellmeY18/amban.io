/**
 * screens/Settings/SmsCapture.tsx — SMS Capture settings screen.
 *
 * Source of truth: CLAUDE.md §15.2 (Platform Scope), §15.3 (Permission UX),
 * §15.8 (Privacy Contract).
 *
 * Responsibilities:
 *   - Master toggle for SMS capture (off by default).
 *   - Permission status indicator and request flow.
 *   - Pre-permission rationale (what we read, what we do, what we never do).
 *   - Initial scan window selector (7/14/30 days).
 *   - "Clear all suggestions" destructive action.
 *   - Privacy reaffirmation copy.
 *   - Platform gating: full content behind `Capacitor.getPlatform() === 'android'`.
 *     On iOS, shows an informational message.
 *
 * Design rules:
 *   - Uses the same layout primitives as other Settings sub-screens
 *     (NotificationSettings, ManageIncome) — back button, SectionHeader, etc.
 *   - Haptics per Appendix F: selection on toggle, tapMedium on permission
 *     grant, error on clear-all confirmation.
 *   - All suggestion writes go through smsSuggestionsStore.
 */

import React, { useCallback, useEffect, useState } from "react";
import { useHistory } from "react-router-dom";
import { IonContent, IonIcon, IonPage } from "@ionic/react";
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

import { useSmsSuggestionsStore } from "../../stores/smsSuggestionsStore";
import { SmsReader, runSmsScan, runInitialScan } from "../../utils/smsScan";
import { Icons } from "../../theme/icons";
import { haptics } from "../../utils/haptics";

/* ------------------------------------------------------------------
 * Preference keys (string literals — another agent owns PreferenceKey)
 * ------------------------------------------------------------------ */

const PREF_SMS_CAPTURE_ENABLED = "amban.sms_capture_enabled";
const PREF_SMS_SCAN_WINDOW_DAYS = "amban.sms_scan_window_days";

/* ------------------------------------------------------------------
 * Sub-components
 * ------------------------------------------------------------------ */

const SectionHeader: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h2
    style={{
      fontSize: "var(--text-caption)",
      fontWeight: "var(--font-weight-semibold, 600)",
      color: "var(--text-muted)",
      textTransform: "uppercase",
      letterSpacing: "0.05em",
      margin: "var(--space-lg) 0 var(--space-xs) 0",
    }}
  >
    {children}
  </h2>
);

/* ------------------------------------------------------------------
 * iOS fallback
 * ------------------------------------------------------------------ */

const IosNotAvailable: React.FC = () => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "var(--space-md)",
      padding: "var(--space-2xl) var(--space-md)",
      textAlign: "center",
    }}
  >
    <span style={{ fontSize: "3rem" }}>📱</span>
    <h2
      style={{
        fontSize: "var(--text-h2)",
        fontWeight: "var(--font-weight-bold, 700)",
        color: "var(--text-strong)",
        margin: 0,
      }}
    >
      Not available on iOS
    </h2>
    <p
      style={{
        fontSize: "var(--text-body)",
        color: "var(--text-muted)",
        lineHeight: "var(--line-height-body, 1.5)",
        maxWidth: 320,
      }}
    >
      SMS capture is only available on Android. iOS does not allow third-party apps to read SMS
      messages.
    </p>
  </div>
);

/* ------------------------------------------------------------------
 * Android content
 * ------------------------------------------------------------------ */

const SCAN_WINDOW_OPTIONS = [7, 14, 30] as const;

const AndroidSmsCapture: React.FC = () => {
  const [enabled, setEnabled] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [scanWindowDays, setScanWindowDays] = useState(7);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const pendingCount = useSmsSuggestionsStore((s) => s.pending.length);
  const clearAll = useSmsSuggestionsStore((s) => s.clearAll);
  const refreshPending = useSmsSuggestionsStore((s) => s.refreshPending);

  // Load saved preferences
  useEffect(() => {
    (async () => {
      const { value: enabledVal } = await Preferences.get({ key: PREF_SMS_CAPTURE_ENABLED });
      setEnabled(enabledVal === "1");

      const { value: windowVal } = await Preferences.get({ key: PREF_SMS_SCAN_WINDOW_DAYS });
      if (windowVal) {
        const parsed = parseInt(windowVal, 10);
        if ([7, 14, 30].includes(parsed)) setScanWindowDays(parsed);
      }

      try {
        const { granted } = await SmsReader.checkPermission();
        setPermissionGranted(granted);
      } catch {
        setPermissionGranted(false);
      }
    })();
  }, []);

  // Toggle handler
  const handleToggle = useCallback(async () => {
    const next = !enabled;
    void haptics.selection();
    setError(null);
    setScanResult(null);

    if (next && !permissionGranted) {
      // Need to request permission first
      try {
        const { granted } = await SmsReader.requestPermission();
        setPermissionGranted(granted);
        if (!granted) {
          setError("SMS permission was denied. You can enable it in Android Settings.");
          return;
        }
        void haptics.tapMedium();
      } catch (_err) {
        setError("Could not request SMS permission.");
        return;
      }
    }

    setEnabled(next);
    await Preferences.set({
      key: PREF_SMS_CAPTURE_ENABLED,
      value: next ? "1" : "0",
    });

    // If just enabled, run an initial scan
    if (next) {
      setScanning(true);
      try {
        const result = await runInitialScan(scanWindowDays);
        await refreshPending();
        setScanResult(
          `Scanned ${result.scanned} messages, found ${result.newSuggestions} new suggestion${result.newSuggestions !== 1 ? "s" : ""}.`,
        );
      } catch (_err) {
        setError("Initial scan failed. Try again later.");
      } finally {
        setScanning(false);
      }
    }
  }, [enabled, permissionGranted, scanWindowDays, refreshPending]);

  // Scan window change
  const handleWindowChange = useCallback(async (days: number) => {
    void haptics.selection();
    setScanWindowDays(days);
    await Preferences.set({
      key: PREF_SMS_SCAN_WINDOW_DAYS,
      value: String(days),
    });
  }, []);

  // Manual re-scan
  const handleManualScan = useCallback(async () => {
    if (!enabled || !permissionGranted) return;
    setScanning(true);
    setError(null);
    setScanResult(null);
    try {
      const result = await runSmsScan();
      await refreshPending();
      setScanResult(
        `Scanned ${result.scanned} messages, found ${result.newSuggestions} new suggestion${result.newSuggestions !== 1 ? "s" : ""}.`,
      );
    } catch {
      setError("Scan failed.");
    } finally {
      setScanning(false);
    }
  }, [enabled, permissionGranted, refreshPending]);

  // Clear all suggestions
  const handleClearAll = useCallback(async () => {
    void haptics.error();
    try {
      await clearAll();
      setShowClearConfirm(false);
      setScanResult("All suggestions cleared.");
    } catch {
      setError("Could not clear suggestions.");
    }
  }, [clearAll]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-xs)",
      }}
    >
      {/* Rationale / Privacy notice */}
      <article
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-sm)",
          padding: "var(--space-md)",
          borderRadius: "var(--radius-md)",
          backgroundColor: "rgba(26, 115, 232, 0.08)",
          border: "1px solid rgba(26, 115, 232, 0.2)",
        }}
      >
        <span
          style={{
            fontSize: "var(--text-body)",
            fontWeight: "var(--font-weight-semibold, 600)",
            color: "var(--text-strong)",
          }}
        >
          🔒 How SMS capture works
        </span>
        <p
          style={{
            fontSize: "var(--text-caption)",
            color: "var(--text-muted)",
            lineHeight: "var(--line-height-body, 1.5)",
            margin: 0,
          }}
        >
          amban reads your bank &amp; UPI SMS <strong>only on this device</strong> to suggest spend
          and income entries. Here&apos;s what we promise:
        </p>
        <ul
          style={{
            fontSize: "var(--text-caption)",
            color: "var(--text-muted)",
            lineHeight: "var(--line-height-body, 1.5)",
            margin: 0,
            paddingLeft: "var(--space-lg)",
          }}
        >
          <li>
            We <strong>never send</strong> your SMS over the network — there is no network code.
          </li>
          <li>
            We <strong>never store</strong> the original message text — only parsed amounts &amp;
            names.
          </li>
          <li>
            You can <strong>revoke</strong> permission anytime from Android Settings.
          </li>
          <li>Reset App wipes every parsed suggestion alongside everything else.</li>
        </ul>
      </article>

      {/* Master toggle */}
      <SectionHeader>SMS Capture</SectionHeader>
      <button
        type="button"
        onClick={handleToggle}
        disabled={scanning}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-sm)",
          padding: "var(--space-md)",
          borderRadius: "var(--radius-md)",
          backgroundColor: "var(--surface-card)",
          boxShadow: "var(--shadow-card)",
          border: "none",
          textAlign: "left",
          minHeight: 56,
          cursor: scanning ? "wait" : "pointer",
          opacity: scanning ? 0.6 : 1,
          width: "100%",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <IonIcon
          icon={Icons.status.notifications}
          style={{
            fontSize: "1.25rem",
            color: enabled ? "var(--color-primary)" : "var(--text-muted)",
            flexShrink: 0,
          }}
          aria-hidden="true"
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontSize: "var(--text-body)",
              fontWeight: "var(--font-weight-semibold, 600)",
              color: "var(--text-strong)",
            }}
          >
            Read bank SMS
          </span>
          <span
            style={{
              fontSize: "var(--text-caption)",
              color: "var(--text-muted)",
            }}
          >
            {enabled ? "On — scanning on app open" : "Off"}
          </span>
        </div>
        {/* Toggle indicator */}
        <div
          aria-hidden="true"
          style={{
            width: 48,
            height: 28,
            borderRadius: 14,
            backgroundColor: enabled ? "var(--color-primary)" : "var(--surface-sunken)",
            position: "relative",
            transition: "background-color 0.2s ease",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 3,
              left: enabled ? 23 : 3,
              width: 22,
              height: 22,
              borderRadius: 11,
              backgroundColor: "#fff",
              boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
              transition: "left 0.2s ease",
            }}
          />
        </div>
      </button>

      {/* Permission status */}
      {enabled && !permissionGranted && (
        <article
          role="status"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-xs)",
            padding: "var(--space-md)",
            borderRadius: "var(--radius-md)",
            backgroundColor: "rgba(242, 153, 0, 0.12)",
            border: "1px solid rgba(242, 153, 0, 0.35)",
          }}
        >
          <span
            style={{
              fontSize: "var(--text-body)",
              fontWeight: "var(--font-weight-semibold, 600)",
              color: "var(--text-strong)",
            }}
          >
            Permission needed
          </span>
          <span
            style={{
              fontSize: "var(--text-caption)",
              color: "var(--text-muted)",
              lineHeight: "var(--line-height-body, 1.5)",
            }}
          >
            SMS capture requires the &quot;Read SMS&quot; permission. Tap the toggle above to
            request it.
          </span>
        </article>
      )}

      {/* Error / scan result messages */}
      {error && (
        <div
          role="alert"
          style={{
            padding: "var(--space-sm) var(--space-md)",
            borderRadius: "var(--radius-sm)",
            backgroundColor: "rgba(233, 66, 53, 0.1)",
            color: "var(--color-score-warning)",
            fontSize: "var(--text-caption)",
          }}
        >
          {error}
        </div>
      )}
      {scanResult && (
        <div
          role="status"
          style={{
            padding: "var(--space-sm) var(--space-md)",
            borderRadius: "var(--radius-sm)",
            backgroundColor: "rgba(30, 140, 69, 0.1)",
            color: "var(--color-score-excellent)",
            fontSize: "var(--text-caption)",
          }}
        >
          {scanResult}
        </div>
      )}

      {/* Scan window selector */}
      {enabled && permissionGranted && (
        <>
          <SectionHeader>Initial scan window</SectionHeader>
          <div
            style={{
              display: "flex",
              gap: "var(--space-sm)",
              padding: "var(--space-xs) 0",
            }}
          >
            {SCAN_WINDOW_OPTIONS.map((days) => {
              const selected = days === scanWindowDays;
              return (
                <button
                  key={days}
                  type="button"
                  onClick={() => handleWindowChange(days)}
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: 40,
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: selected ? "var(--color-primary)" : "var(--surface-sunken)",
                    color: selected ? "#fff" : "var(--text-muted)",
                    border: "none",
                    fontSize: "var(--text-caption)",
                    fontWeight: "var(--font-weight-semibold, 600)",
                    cursor: "pointer",
                  }}
                >
                  {days} days
                </button>
              );
            })}
          </div>
          <p
            style={{
              fontSize: "var(--text-micro, 0.625rem)",
              color: "var(--text-muted)",
              margin: 0,
              paddingLeft: "var(--space-xs)",
            }}
          >
            How far back to scan when first enabled. Subsequent scans are incremental (since last
            scan).
          </p>
        </>
      )}

      {/* Manual re-scan */}
      {enabled && permissionGranted && (
        <>
          <SectionHeader>Actions</SectionHeader>
          <button
            type="button"
            onClick={handleManualScan}
            disabled={scanning}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-sm)",
              padding: "var(--space-md)",
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--surface-card)",
              boxShadow: "var(--shadow-card)",
              border: "none",
              textAlign: "left",
              minHeight: 48,
              cursor: scanning ? "wait" : "pointer",
              opacity: scanning ? 0.6 : 1,
              width: "100%",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <IonIcon
              icon={Icons.action.refresh}
              style={{
                fontSize: "1.25rem",
                color: "var(--color-primary)",
                flexShrink: 0,
              }}
              aria-hidden="true"
            />
            <span
              style={{
                fontSize: "var(--text-body)",
                fontWeight: "var(--font-weight-semibold, 600)",
                color: "var(--text-strong)",
                flex: 1,
              }}
            >
              {scanning ? "Scanning…" : "Scan now"}
            </span>
            {pendingCount > 0 && (
              <span
                style={{
                  fontSize: "var(--text-caption)",
                  color: "var(--text-muted)",
                }}
              >
                {pendingCount} pending
              </span>
            )}
          </button>
        </>
      )}

      {/* Clear all suggestions */}
      {pendingCount > 0 && (
        <>
          <SectionHeader>Data</SectionHeader>
          {!showClearConfirm ? (
            <button
              type="button"
              onClick={() => setShowClearConfirm(true)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-sm)",
                padding: "var(--space-md)",
                borderRadius: "var(--radius-md)",
                backgroundColor: "var(--surface-card)",
                boxShadow: "var(--shadow-card)",
                border: "none",
                textAlign: "left",
                minHeight: 48,
                cursor: "pointer",
                width: "100%",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <IonIcon
                icon={Icons.action.delete}
                style={{
                  fontSize: "1.25rem",
                  color: "var(--color-score-warning)",
                  flexShrink: 0,
                }}
                aria-hidden="true"
              />
              <span
                style={{
                  fontSize: "var(--text-body)",
                  fontWeight: "var(--font-weight-semibold, 600)",
                  color: "var(--color-score-warning)",
                  flex: 1,
                }}
              >
                Clear all suggestions
              </span>
            </button>
          ) : (
            <article
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-sm)",
                padding: "var(--space-md)",
                borderRadius: "var(--radius-md)",
                backgroundColor: "rgba(233, 66, 53, 0.08)",
                border: "1px solid rgba(233, 66, 53, 0.2)",
              }}
            >
              <span
                style={{
                  fontSize: "var(--text-body)",
                  fontWeight: "var(--font-weight-semibold, 600)",
                  color: "var(--color-score-warning)",
                }}
              >
                Delete {pendingCount} suggestion{pendingCount !== 1 ? "s" : ""}?
              </span>
              <span
                style={{
                  fontSize: "var(--text-caption)",
                  color: "var(--text-muted)",
                }}
              >
                This removes all pending, accepted, and dismissed suggestions. SMS already added as
                spend or income are not affected.
              </span>
              <div style={{ display: "flex", gap: "var(--space-sm)" }}>
                <button
                  type="button"
                  onClick={handleClearAll}
                  style={{
                    flex: 1,
                    minHeight: 40,
                    padding: "var(--space-xs) var(--space-md)",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "var(--color-score-warning)",
                    color: "#fff",
                    border: "none",
                    fontSize: "var(--text-caption)",
                    fontWeight: "var(--font-weight-semibold, 600)",
                    cursor: "pointer",
                  }}
                >
                  Clear all
                </button>
                <button
                  type="button"
                  onClick={() => setShowClearConfirm(false)}
                  style={{
                    flex: 1,
                    minHeight: 40,
                    padding: "var(--space-xs) var(--space-md)",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "var(--surface-sunken)",
                    color: "var(--text-muted)",
                    border: "none",
                    fontSize: "var(--text-caption)",
                    fontWeight: "var(--font-weight-semibold, 600)",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            </article>
          )}
        </>
      )}

      {/* Privacy footer */}
      <p
        style={{
          fontSize: "var(--text-micro, 0.625rem)",
          color: "var(--text-muted)",
          lineHeight: "var(--line-height-body, 1.5)",
          textAlign: "center",
          padding: "var(--space-lg) var(--space-md)",
          margin: 0,
        }}
      >
        amban is 100% local. Your SMS data never leaves this device. No analytics, no cloud, no
        tracking — ever.
      </p>
    </div>
  );
};

/* ------------------------------------------------------------------
 * Main screen component
 * ------------------------------------------------------------------ */

const SmsCapture: React.FC = () => {
  const history = useHistory();
  const isAndroid = Capacitor.getPlatform() === "android";

  return (
    <IonPage>
      <IonContent fullscreen>
        <main
          className="amban-screen"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-xs)",
          }}
        >
          {/* Header with back button */}
          <header
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-sm)",
              padding: "var(--space-md) var(--space-xs) var(--space-md)",
            }}
          >
            <button
              type="button"
              onClick={() => history.goBack()}
              aria-label="Go back"
              style={{
                minWidth: 40,
                minHeight: 40,
                borderRadius: "var(--radius-pill)",
                backgroundColor: "var(--surface-sunken)",
                color: "var(--text-strong)",
                border: "none",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <IonIcon icon={Icons.action.chevronBack} aria-hidden="true" />
            </button>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "var(--text-h1)",
                fontWeight: "var(--font-weight-bold, 700)",
                color: "var(--text-strong)",
                margin: 0,
              }}
            >
              SMS Capture
            </h1>
          </header>

          {/* Platform-gated content */}
          {isAndroid ? <AndroidSmsCapture /> : <IosNotAvailable />}
        </main>
      </IonContent>
    </IonPage>
  );
};

export default SmsCapture;
