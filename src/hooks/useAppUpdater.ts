/**
 * hooks/useAppUpdater.ts — in-app update lifecycle for alpha distribution.
 *
 * Source of truth: CLAUDE.md §16 (In-App Updater).
 *
 * This hook drives the UpdateBanner component on the Home screen. It:
 *   1. Checks for updates on mount (max once per hour via Preferences).
 *   2. Re-checks on Capacitor appStateChange (foreground resume),
 *      respecting the same 1-hour debounce.
 *   3. Exposes state + actions for the banner to render.
 *
 * Android-only. On web/iOS the hook returns a permanent 'idle' status
 * and all actions are no-ops.
 *
 * Design rules:
 *   - Never throws. All plugin/network errors are caught and surfaced
 *     as state transitions, not exceptions.
 *   - The Preferences key `amban_last_update_check` stores an ISO
 *     timestamp of the last successful check. This is NOT in the
 *     PreferenceKey catalog because the updater is a standalone
 *     alpha-distribution concern — it's raw Capacitor Preferences
 *     scoped to this module.
 *   - The hook only initializes when the platform is Android.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { App as CapacitorApp } from "@capacitor/app";
import { Preferences } from "@capacitor/preferences";

import {
  checkForUpdate as pluginCheckForUpdate,
  downloadApk,
  installApk,
  canInstallApks,
  openInstallSettings,
  isUpdaterAvailable,
} from "../utils/appUpdater";
import type { UpdateInfo } from "../utils/appUpdater";

/* ------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------ */

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "error";

export interface UseAppUpdaterResult {
  /** Current lifecycle status. */
  status: UpdateStatus;
  /** Version string of the available update (e.g. "0.2.0"). */
  version: string | null;
  /** Release notes from GitHub (may be empty). */
  releaseNotes: string | null;
  /** Download progress percentage, 0–100. Only meaningful in 'downloading' state. */
  progress: number;
  /** Path to the downloaded APK on device. Only set in 'ready' state. */
  filePath: string | null;
  /** Manually trigger a check (e.g. pull-to-refresh). Ignores debounce. */
  checkForUpdate: () => Promise<void>;
  /** Start downloading the available update. */
  startDownload: () => Promise<void>;
  /** Install the downloaded APK. Handles permission flow internally. */
  install: () => Promise<void>;
}

/* ------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------ */

/** Preferences key for the last update check timestamp. */
const PREF_LAST_CHECK = "amban_last_update_check";

/** Minimum interval between automatic checks: 1 hour in milliseconds. */
const CHECK_DEBOUNCE_MS = 60 * 60 * 1000;

/* ------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------ */

async function getLastCheckTime(): Promise<number> {
  try {
    const { value } = await Preferences.get({ key: PREF_LAST_CHECK });
    if (!value) return 0;
    const ts = new Date(value).getTime();
    return Number.isFinite(ts) ? ts : 0;
  } catch {
    return 0;
  }
}

async function setLastCheckTime(): Promise<void> {
  try {
    await Preferences.set({ key: PREF_LAST_CHECK, value: new Date().toISOString() });
  } catch {
    // Best-effort — non-critical.
  }
}

function shouldCheck(lastCheckMs: number): boolean {
  return Date.now() - lastCheckMs > CHECK_DEBOUNCE_MS;
}

/* ------------------------------------------------------------------
 * Hook
 * ------------------------------------------------------------------ */

export function useAppUpdater(): UseAppUpdaterResult {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [version, setVersion] = useState<string | null>(null);
  const [releaseNotes, setReleaseNotes] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [filePath, setFilePath] = useState<string | null>(null);

  // Keep a ref to the update info so download/install actions can
  // access it without re-checking.
  const updateInfoRef = useRef<UpdateInfo | null>(null);

  // Prevent concurrent checks.
  const checkingRef = useRef(false);

  /**
   * Core check logic — queries the plugin, updates state.
   * `respectDebounce`: when true, skips the check if <1 hour since last.
   */
  const doCheck = useCallback(async (respectDebounce: boolean) => {
    if (!isUpdaterAvailable()) return;
    if (checkingRef.current) return;

    if (respectDebounce) {
      const lastCheck = await getLastCheckTime();
      if (!shouldCheck(lastCheck)) return;
    }

    checkingRef.current = true;
    setStatus("checking");

    try {
      const info = await pluginCheckForUpdate();
      await setLastCheckTime();

      if (info) {
        updateInfoRef.current = info;
        setVersion(info.version);
        setReleaseNotes(info.releaseNotes || null);
        setStatus("available");
      } else {
        setStatus("idle");
      }
    } catch {
      // Treat check failures as "no update" — silent per §16.13.
      setStatus("idle");
    } finally {
      checkingRef.current = false;
    }
  }, []);

  /**
   * Public: manual check (ignores debounce). Useful for a pull-to-refresh
   * or a "Check now" button in settings.
   */
  const checkForUpdate = useCallback(async () => {
    await doCheck(false);
  }, [doCheck]);

  /**
   * Start downloading the APK. Transitions through 'downloading' → 'ready'
   * or 'downloading' → 'error'.
   */
  const startDownload = useCallback(async () => {
    const info = updateInfoRef.current;
    if (!info) return;

    setStatus("downloading");
    setProgress(0);

    const path = await downloadApk(info.downloadUrl, info.version, (pct) => {
      setProgress(pct);
    });

    if (path) {
      setFilePath(path);
      setStatus("ready");
    } else {
      setStatus("error");
    }
  }, []);

  /**
   * Install the downloaded APK. Handles the REQUEST_INSTALL_PACKAGES
   * permission flow:
   *   - If not granted → opens system settings, returns. User must
   *     re-tap "Install" after granting.
   *   - If granted → fires the install intent.
   */
  const install = useCallback(async () => {
    if (!filePath) return;

    const hasPermission = await canInstallApks();
    if (!hasPermission) {
      // Open system settings — the user needs to grant "Install unknown apps".
      // When they return and tap Install again, this branch won't fire.
      await openInstallSettings();
      return;
    }

    setStatus("installing");
    const success = await installApk(filePath);

    if (!success) {
      // Install intent failed — revert to 'ready' so the user can retry.
      setStatus("ready");
    }
    // If success, the system installer UI is now showing. The app may
    // be backgrounded. We stay in 'installing' state — on next launch
    // the version will differ and the banner won't show.
  }, [filePath]);

  /* ----------------------------------------------------------------
   * Effects
   * ---------------------------------------------------------------- */

  // On mount: check with debounce.
  useEffect(() => {
    if (!isUpdaterAvailable()) return;
    void doCheck(true);
  }, [doCheck]);

  // On foreground resume: re-check with debounce.
  useEffect(() => {
    if (!isUpdaterAvailable()) return;

    let cancelled = false;
    let removeHandle: { remove: () => Promise<void> } | null = null;

    CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive && !cancelled) {
        void doCheck(true);
      }
    })
      .then((h) => {
        if (cancelled) void h.remove();
        else removeHandle = h;
      })
      .catch(() => {
        // Web/dev — plugin unavailable, silently skip.
      });

    return () => {
      cancelled = true;
      if (removeHandle) void removeHandle.remove();
    };
  }, [doCheck]);

  return {
    status,
    version,
    releaseNotes,
    progress,
    filePath,
    checkForUpdate,
    startDownload,
    install,
  };
}
