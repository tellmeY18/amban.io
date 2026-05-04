/**
 * utils/appUpdater.ts — bridge to the native AppUpdater Capacitor plugin.
 *
 * Source of truth: CLAUDE.md §16 (In-App Updater).
 *
 * Android-only. On web/iOS, all methods return safe no-op responses.
 * This is the single authorized network call in amban.io — contacts
 * only api.github.com and github.com for APK downloads. Zero user data
 * transmitted.
 *
 * Design rules:
 *   - Never throws past the caller boundary. Every method catches
 *     internally and returns a typed "did not succeed" value.
 *   - Platform gate: `Capacitor.getPlatform() === 'android'` is
 *     checked in every public function. On web/iOS, callers get a
 *     null/false that short-circuits the UI into a hidden state.
 *   - Progress events are delivered via the plugin's `addListener`
 *     mechanism and cleaned up via the returned handle.
 */

import { Capacitor, registerPlugin } from "@capacitor/core";

/* ------------------------------------------------------------------
 * Type definitions
 * ------------------------------------------------------------------ */

/** Metadata returned from the native check-for-update call. */
export interface UpdateInfo {
  available: boolean;
  version: string;
  downloadUrl: string;
  releaseNotes: string;
  currentVersion: string;
}

/** Result of a successful APK download. */
export interface DownloadResult {
  filePath: string;
}

/** Fired on the 'downloadProgress' event during APK download. */
export interface DownloadProgressEvent {
  /** Percentage complete, 0–100. */
  progress: number;
  /** Bytes downloaded so far. */
  bytesDownloaded: number;
  /** Total file size in bytes (may be 0 if server doesn't report it). */
  totalBytes: number;
}

/** Whether the app has REQUEST_INSTALL_PACKAGES permission. */
export interface InstallPermission {
  granted: boolean;
}

/** Plugin interface — matches the native implementation contract. */
interface AppUpdaterPlugin {
  checkForUpdate(): Promise<UpdateInfo>;
  downloadApk(options: { url: string; version: string }): Promise<DownloadResult>;
  installApk(options: { filePath: string }): Promise<void>;
  canInstallApks(): Promise<InstallPermission>;
  openInstallSettings(): Promise<void>;
  addListener(
    event: "downloadProgress",
    handler: (data: DownloadProgressEvent) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

/* ------------------------------------------------------------------
 * Plugin registration
 * ------------------------------------------------------------------ */

/**
 * Register the plugin — Capacitor will route calls to the native
 * Android implementation when running on-device.
 */
const AppUpdater = registerPlugin<AppUpdaterPlugin>("AppUpdater");

/* ------------------------------------------------------------------
 * Public helpers
 * ------------------------------------------------------------------ */

/** Returns true if the updater is available on this platform. */
export function isUpdaterAvailable(): boolean {
  return Capacitor.getPlatform() === "android";
}

/**
 * Check GitHub Releases for a newer version.
 * Returns the update info if a newer version is available, or null on
 * web/iOS, network failure, or when already up-to-date.
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isUpdaterAvailable()) return null;
  try {
    const result = await AppUpdater.checkForUpdate();
    return result.available ? result : null;
  } catch {
    // Network unavailable, API error, etc. — per §16.13, fail silently.
    return null;
  }
}

/**
 * Download the APK to the device's cache directory.
 * Calls `onProgress` with 0–100 during download.
 * Returns the file path on success, or null on failure.
 */
export async function downloadApk(
  url: string,
  version: string,
  onProgress?: (progress: number) => void,
): Promise<string | null> {
  if (!isUpdaterAvailable()) return null;

  let listener: { remove: () => Promise<void> } | null = null;

  try {
    if (onProgress) {
      listener = await AppUpdater.addListener("downloadProgress", (data) => {
        onProgress(data.progress);
      });
    }

    const result = await AppUpdater.downloadApk({ url, version });
    return result.filePath;
  } catch {
    // Download interrupted or failed — per §16.13, surface as error state.
    return null;
  } finally {
    if (listener) {
      await listener.remove();
    }
  }
}

/**
 * Trigger the system package installer for a downloaded APK.
 * Returns true if the intent was fired successfully (does NOT mean
 * the user actually installed — that's outside our control).
 */
export async function installApk(filePath: string): Promise<boolean> {
  if (!isUpdaterAvailable()) return false;
  try {
    await AppUpdater.installApk({ filePath });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if the app has permission to install APKs from unknown sources.
 * On Android 8+ (API 26+), REQUEST_INSTALL_PACKAGES must be granted.
 */
export async function canInstallApks(): Promise<boolean> {
  if (!isUpdaterAvailable()) return false;
  try {
    const result = await AppUpdater.canInstallApks();
    return result.granted;
  } catch {
    return false;
  }
}

/**
 * Open system settings for "Install unknown apps" permission for this
 * app. Used when the user taps "Install" but the permission isn't
 * granted yet.
 */
export async function openInstallSettings(): Promise<void> {
  if (!isUpdaterAvailable()) return;
  try {
    await AppUpdater.openInstallSettings();
  } catch {
    // no-op — system settings navigation failed silently.
  }
}
