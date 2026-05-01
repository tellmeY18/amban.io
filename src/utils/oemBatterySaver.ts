/**
 * utils/oemBatterySaver.ts — OEM battery-saver detection.
 *
 * Source of truth: CLAUDE.md §10 (Notifications), docs/NOTIFICATIONS.md.
 *
 * Many Android OEMs ship aggressive battery-saver / task-killer logic
 * that prevents `AlarmManager` exact alarms from firing reliably. This
 * module detects those OEMs so the UI can surface a one-time,
 * dismissable card pointing the user to the relevant Settings page.
 *
 * Approach (v0.2.0):
 *   We cannot access `android.os.Build.MANUFACTURER` from a WebView
 *   without a dedicated native plugin. Rather than adding a native
 *   bridge for a single string, we parse `navigator.userAgent` — the
 *   Android WebView embeds the device model (which almost always
 *   contains the manufacturer name) per the UA Client Hints spec. The
 *   detection is best-effort and intentionally conservative: a false
 *   negative (unrecognised OEM) costs only a missing informational
 *   card; a false positive costs a slightly irrelevant — but harmless
 *   — card.
 *
 * On iOS and web the detection short-circuits to the "not aggressive"
 * result because Apple does not expose equivalent background-kill
 * behaviour that the user can override.
 *
 * Design rules:
 *   - Pure utility — no React, no side-effects, no plugin imports.
 *   - Never throws. Every code path returns a valid `OemInfo`.
 *   - The intent actions are best-effort strings for
 *     `startActivity(Intent)`. They may or may not resolve on every
 *     device variant; callers should catch ActivityNotFoundException.
 */

import { Capacitor } from "@capacitor/core";

/* ------------------------------------------------------------------
 * Public types
 * ------------------------------------------------------------------ */

export interface OemInfo {
  /** Lower-cased manufacturer name, or `'unknown'` when not detected. */
  manufacturer: string;
  /** True when the manufacturer is on the known aggressive-kill list. */
  isAggressiveOem: boolean;
  /** Human-readable name for the OEM's custom Android skin, if known. */
  skinName: string | null;
  /**
   * Android intent action string for opening the OEM's battery or
   * auto-start settings. Null when unknown or not applicable.
   */
  batterySettingsAction: string | null;
}

/* ------------------------------------------------------------------
 * Known aggressive OEMs
 *
 * Each entry maps a UA-detectable keyword (lower-cased) to metadata.
 * The list is sourced from https://dontkillmyapp.com rankings and
 * cross-referenced with field observations from Indian Android users
 * (the primary audience for amban.io).
 *
 * Order matters: the first match wins. Some OEMs share parent brands
 * (Realme → OPPO / BBK), so more-specific entries come first.
 * ------------------------------------------------------------------ */

interface OemEntry {
  /** Substring to look for in the lower-cased UA string. */
  uaHint: string;
  /** Canonical manufacturer name. */
  manufacturer: string;
  /** Custom skin name. */
  skinName: string;
  /** Intent action for battery / auto-start settings. */
  batterySettingsAction: string | null;
}

const AGGRESSIVE_OEMS: ReadonlyArray<OemEntry> = [
  {
    uaHint: "xiaomi",
    manufacturer: "xiaomi",
    skinName: "MIUI / HyperOS",
    batterySettingsAction: "miui.intent.action.HIDDEN_APPS_CONFIG_ACTIVITY",
  },
  {
    uaHint: "redmi",
    manufacturer: "xiaomi",
    skinName: "MIUI / HyperOS",
    batterySettingsAction: "miui.intent.action.HIDDEN_APPS_CONFIG_ACTIVITY",
  },
  {
    uaHint: "poco",
    manufacturer: "xiaomi",
    skinName: "MIUI / HyperOS",
    batterySettingsAction: "miui.intent.action.HIDDEN_APPS_CONFIG_ACTIVITY",
  },
  {
    uaHint: "realme",
    manufacturer: "realme",
    skinName: "Realme UI",
    batterySettingsAction: "com.coloros.safecenter",
  },
  {
    uaHint: "oppo",
    manufacturer: "oppo",
    skinName: "ColorOS",
    batterySettingsAction: "com.coloros.safecenter",
  },
  {
    uaHint: "oneplus",
    manufacturer: "oneplus",
    skinName: "OxygenOS",
    batterySettingsAction: "com.android.settings.action.BATTERY_SAVER_SETTINGS",
  },
  {
    uaHint: "vivo",
    manufacturer: "vivo",
    skinName: "Funtouch OS",
    batterySettingsAction: "com.vivo.permissionmanager",
  },
  {
    uaHint: "iqoo",
    manufacturer: "vivo",
    skinName: "Funtouch OS",
    batterySettingsAction: "com.vivo.permissionmanager",
  },
  {
    uaHint: "samsung",
    manufacturer: "samsung",
    skinName: "One UI",
    batterySettingsAction: "com.samsung.android.lool",
  },
  {
    uaHint: "huawei",
    manufacturer: "huawei",
    skinName: "EMUI / HarmonyOS",
    batterySettingsAction: "huawei.intent.action.HSM_PROTECTED_APPS",
  },
  {
    uaHint: "honor",
    manufacturer: "honor",
    skinName: "MagicOS",
    batterySettingsAction: "huawei.intent.action.HSM_PROTECTED_APPS",
  },
];

/* ------------------------------------------------------------------
 * Default result for non-Android / unrecognised platforms.
 * ------------------------------------------------------------------ */

const SAFE_DEFAULT: OemInfo = Object.freeze({
  manufacturer: "unknown",
  isAggressiveOem: false,
  skinName: null,
  batterySettingsAction: null,
});

/* ------------------------------------------------------------------
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Detect the device OEM from the User-Agent string. Returns rich
 * metadata when the OEM is on the aggressive-kill list.
 *
 * Pure function — safe to call on every render or in an effect.
 * Memoisation is the caller's responsibility if the result is used
 * in a render-hot path (it isn't expensive, but it isn't free).
 */
export function detectOem(): OemInfo {
  try {
    const platform = Capacitor.getPlatform();
    if (platform !== "android") return SAFE_DEFAULT;

    const ua =
      typeof navigator !== "undefined" && navigator.userAgent
        ? navigator.userAgent.toLowerCase()
        : "";

    if (ua.length === 0) return SAFE_DEFAULT;

    for (const entry of AGGRESSIVE_OEMS) {
      if (ua.includes(entry.uaHint)) {
        return {
          manufacturer: entry.manufacturer,
          isAggressiveOem: true,
          skinName: entry.skinName,
          batterySettingsAction: entry.batterySettingsAction,
        };
      }
    }

    // Android device not on the aggressive list.
    return {
      manufacturer: extractManufacturer(ua),
      isAggressiveOem: false,
      skinName: null,
      batterySettingsAction: null,
    };
  } catch {
    // Capacitor.getPlatform() can throw in unusual environments
    // (e.g. SSR, test runners without a DOM). Safe default.
    return SAFE_DEFAULT;
  }
}

/**
 * Best-effort manufacturer name extraction from the UA. Android
 * WebView UAs typically contain `Build/XXXX` preceded by the model
 * name, whose first token is often the manufacturer.
 *
 * Example UA fragment: `... SM-A515F Build/SP1A.210812.016 ...`
 *   → first token before Build/ is "SM-A515F" → starts with "SM"
 *     which is Samsung. But we've already caught Samsung above,
 *     so this is a fallback for lesser-known brands.
 */
function extractManufacturer(ua: string): string {
  // Look for the model string before "Build/".
  const buildIdx = ua.indexOf("build/");
  if (buildIdx === -1) return "unknown";

  // Walk backwards from "build/" to find the model token.
  const beforeBuild = ua.substring(0, buildIdx).trim();
  const lastSemicolon = beforeBuild.lastIndexOf(";");
  const modelChunk = lastSemicolon >= 0 ? beforeBuild.substring(lastSemicolon + 1).trim() : "";
  if (modelChunk.length === 0) return "unknown";

  // The first word of the model chunk is usually the brand.
  const firstWord = modelChunk.split(/\s+/)[0];
  return firstWord ?? "unknown";
}
