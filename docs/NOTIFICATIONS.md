# Notifications — amban.io v0.2.0

> How local notifications work, why they sometimes don't, and how to fix it.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [ID Ranges (Appendix E)](#id-ranges)
3. [Scheduling Flow](#scheduling-flow)
4. [Android 13+ POST_NOTIFICATIONS Permission](#android-13-post_notifications-permission)
5. [Exact Alarms (SCHEDULE_EXACT_ALARM)](#exact-alarms)
6. [Boot-Completed Re-registration](#boot-completed-re-registration)
7. [Deep-Link Routing](#deep-link-routing)
8. [OEM Kill-List](#oem-kill-list)
9. [Test-Fire Procedure (QA)](#test-fire-procedure)
10. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

amban.io uses **100% local notifications** — no server, no push, no Firebase
Cloud Messaging. The `@capacitor/local-notifications` plugin wraps the native
`AlarmManager` (Android) and `UNUserNotificationCenter` (iOS) APIs.

All scheduling logic lives in a single React hook:

```
src/hooks/useNotifications.ts
```

The hook:

- Reads from three Zustand stores (`settingsStore`, `financeStore`,
  `userStore`) to build the notification payload.
- Uses a fingerprint-based dedupe so calling `rescheduleAll()` multiple
  times a day is a no-op when nothing changed.
- Auto-reschedules on any store slice change (toggle, time, income,
  recurring payments, user name).
- Exposes diagnostic data (`lastScheduleVerified`, `scheduledCount`,
  `lastError`) consumed by the Settings > Notifications screen.

---

## ID Ranges

Per CLAUDE.md Appendix E, every notification ID is deterministic:

| Range        | Purpose                          | Formula                          |
| ------------ | -------------------------------- | -------------------------------- |
| `1000`       | Daily spend prompt (recurring)   | Fixed `1000`                     |
| `2000–2999`  | Upcoming recurring payment       | `2000 + recurringPayment.id`     |
| `3000–3999`  | Salary day nudge                 | `3000 + incomeSource.id`         |
| `4000–4999`  | Reserved (future)                | —                                |
| `9999`       | Test-fire (dev diagnostics)      | Fixed `9999`                     |

Before every schedule pass, the hook cancels **every** pending
notification whose ID falls in these ranges. This ensures stale
entries from a previous app version or a deleted income source are
never left dangling.

---

## Scheduling Flow

```
rescheduleAll()
    │
    ├── If master toggle is OFF → cancel all → return
    │
    ├── Compute fingerprint = date + inputs hash
    ├── If fingerprint matches stored fingerprint → skip (dedupe)
    │
    ├── Check/refresh OS permission
    │   └── If denied → cancel all → return (toggle stays on)
    │
    ├── Cancel all existing amban notifications
    ├── Build notification set:
    │   ├── Daily prompt (recurring, user's chosen time)
    │   ├── Recurring payment reminders (N days before due)
    │   └── Salary day nudges (at 10am on credit day)
    │
    ├── Schedule via LocalNotifications.schedule()
    │
    └── Verify schedule (check daily prompt is pending)
        ├── Store verified = true/false
        └── Log warning if daily prompt is missing
```

### Fingerprint Dedupe

The fingerprint is `YYYY-MM-DD|key=value|key=value...` — a date prefix
ensures the daily template rotation (which picks by day-of-year) gets a
fresh message every day. Input changes (new income source, time change)
also invalidate the fingerprint.

### Force Reschedule

The dev diagnostics screen exposes a "Force reschedule" button that
clears the fingerprint before calling `rescheduleAll()`, bypassing the
dedupe.

---

## Android 13+ POST_NOTIFICATIONS Permission

Starting with **API 33 (Android 13)**, apps must request the runtime
permission `android.permission.POST_NOTIFICATIONS` before local
notifications will display. Without it, `LocalNotifications.schedule()`
succeeds silently but nothing shows up.

### How amban handles this

1. **New installs:** The onboarding flow's notification step (Step 5)
   calls `requestPermission()`, which triggers the OS dialog.

2. **Upgrading users (pre-v0.2.0 → v0.2.0+):** On first launch after
   upgrade, the hook detects that `onboardingComplete` is true but the
   `amban.notifications_runtime_asked` Preferences key is not set. It
   automatically triggers `requestPermission()` once. The key is set
   regardless of the outcome to avoid nagging.

3. **Denied state:** The Settings > Notifications screen shows a
   prominent "Grant permission" button alongside "Open system settings".
   The hook's `effectivelyEnabled` returns `false` when permission is
   denied, so the schedule pass short-circuits cleanly.

### Manifest declaration

```xml
<!-- android/app/src/main/AndroidManifest.xml -->
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

This is already handled by the Capacitor local-notifications plugin.

---

## Exact Alarms

### SCHEDULE_EXACT_ALARM (Android 12+)

Android 12 (API 31) introduced restrictions on exact alarms. The
Capacitor plugin uses `AlarmManager.setExactAndAllowWhileIdle()` when
`allowWhileIdle: true` is set (which we do on every notification).

Starting with Android 14 (API 34), the `SCHEDULE_EXACT_ALARM` permission
is no longer automatically granted. Capacitor's plugin requests
`USE_EXACT_ALARM` instead, which is auto-granted for alarm/timer/calendar
apps. For non-clock apps the plugin falls back to inexact alarms if exact
alarm permission is not available.

### What this means for amban

- On Android 12–13: Exact alarms work out of the box.
- On Android 14+: The plugin handles the fallback. Notifications may
  arrive within a ~10 minute window rather than exactly on time. This is
  acceptable for daily prompts and payment reminders.
- To check exact alarm status: `AlarmManager.canScheduleExactAlarms()`.
  This is not currently exposed to JS; if we need it, we'll add a native
  bridge method.

---

## Boot-Completed Re-registration

When a device reboots, all pending `AlarmManager` alarms are wiped by
the OS. The Capacitor local-notifications plugin declares
`RECEIVE_BOOT_COMPLETED` in the manifest and registers a
`BootReceiver` that re-schedules pending alarms on boot.

### Current status (v0.2.0)

We rely on the plugin's built-in behaviour. The schedule-verification
diagnostic (`verifySchedule()`) confirms the daily prompt is registered
after each schedule pass. If we discover the plugin does NOT properly
re-register on boot (visible as `lastScheduleVerified = false` after a
device reboot), we'll need to add a custom `BroadcastReceiver` at:

```
android/app/src/main/java/io/amban/app/BootReceiver.java
```

That receiver would need to:
1. Receive `android.intent.action.BOOT_COMPLETED`
2. Start the Capacitor WebView (or a headless JS executor)
3. Call `rescheduleAll()` from the hook

This is deferred to v0.3.0 unless QA finds boot-completed issues.

---

## Deep-Link Routing

Tapping a notification routes the user into the app via deep links:

| Notification Type       | `extra.target` | Deep Link Route  |
| ----------------------- | -------------- | ---------------- |
| Daily spend prompt      | `"log"`        | `amban://log`    |
| Recurring payment       | `"home"`       | `amban://home`   |
| Salary day nudge        | `"home"`       | `amban://home`   |
| Test-fire (dev)         | `"log"`        | `amban://log`    |

The `DeepLinkHandler` component in `App.tsx` listens for
`appUrlOpen` events and maps `extra.target` to the corresponding
route. When the app is cold-launched from a notification, the same
handler fires after the boot sequence completes.

---

## OEM Kill-List

Many Android OEMs ship aggressive battery-saver / task-killer UIs that
kill background alarms. The severity varies by manufacturer. amban
detects these OEMs via `navigator.userAgent` parsing (see
`src/utils/oemBatterySaver.ts`) and shows a one-time, dismissable card
in Settings > Notifications.

### Known aggressive OEMs

| Manufacturer | Skin Name           | Severity | What They Do |
| ------------ | ------------------- | -------- | ------------ |
| **Xiaomi**   | MIUI / HyperOS      | 🔴 High  | Auto-start restriction kills background alarms. Apps must be added to the "Autostart" whitelist AND battery saver must be set to "No restrictions" per-app. |
| **OPPO**     | ColorOS             | 🔴 High  | "Smart Power Saver" kills alarms aggressively. Must add app to "Allow Auto Launch" and disable battery optimization. |
| **Vivo**     | Funtouch OS         | 🔴 High  | Similar to OPPO — must whitelist in "High background power consumption" settings. |
| **Realme**   | Realme UI           | 🔴 High  | Fork of ColorOS, same restrictions. |
| **Samsung**  | One UI              | 🟡 Medium | "Sleeping apps" and "Deep sleeping apps" lists can suppress alarms. Default behaviour is less aggressive than Chinese OEMs. |
| **Huawei**   | EMUI / HarmonyOS    | 🔴 High  | "Protected Apps" list — apps not on the list get killed after screen-off. Launch Manager controls autostart. |
| **Honor**    | MagicOS             | 🔴 High  | Similar to Huawei EMUI. |
| **OnePlus**  | OxygenOS            | 🟡 Medium | Merged with ColorOS in recent versions. Battery optimization settings apply. |

### User guidance (displayed in the OEM card)

The card tells the user:

> "Your device ([skin name]) may prevent notifications from arriving on
> time. To ensure amban can notify you, tap below to adjust your battery
> settings."

The "Open battery settings" button attempts to open the OS settings via
`requestPermissions()` (best-effort — we can't deep-link into OEM-
specific settings pages reliably from a WebView without a native plugin).

### Detection mechanism

`detectOem()` in `src/utils/oemBatterySaver.ts` checks
`navigator.userAgent` for manufacturer keywords. This is a best-effort
heuristic — the Android WebView UA typically includes the device model
(e.g., `Redmi Note 12 Pro`), which contains the brand name.

Limitations:
- Some devices may not include the brand in the UA string.
- Custom ROMs (LineageOS, Pixel Experience) won't match any OEM pattern.
- The intent actions returned are not guaranteed to resolve on every
  device variant.

---

## Test-Fire Procedure

### For QA / manual testing

1. Open **Settings → Notifications**.
2. In dev builds, scroll to the **Diagnostics (dev only)** section.
3. Tap **"Send test notification"**.
4. Wait ~10 seconds.
5. A notification should appear: *"This is a test notification. If you
   see this, notifications work! 🎉"*
6. Tapping the notification should route to the Log screen.

### What the test covers

- OS permission is granted and active.
- `AlarmManager` / `UNUserNotificationCenter` is accepting schedules.
- The notification channel is not muted by the OS.
- OEM battery optimization is not silently suppressing alarms.

### What the test does NOT cover

- Whether recurring (daily) alarms survive a device reboot.
- Whether exact alarm timing is preserved on Android 14+.
- Whether the app resumes correctly from a cold-launch notification tap.

### Diagnostics panel fields

| Field         | Description |
| ------------- | ----------- |
| Permission    | Current OS-level permission state (`granted`, `denied`, `prompt`, `unknown`) |
| Scheduled     | Count of amban notifications currently pending in the OS |
| Verified      | Whether the daily prompt (ID 1000) is present in the pending list |
| OEM           | Detected manufacturer and skin name, or "not on aggressive list" |
| Last error    | Most recent scheduler error message, if any |

### Force reschedule

The "Force reschedule" button clears the fingerprint cache and runs a
full cancel + re-schedule pass. Use this after:

- Changing the system clock manually.
- Granting notification permission via OS Settings (outside the app).
- Suspecting that the OEM dropped alarms.

---

## Troubleshooting

### Notifications don't arrive at all

1. **Check permission:** Settings → Notifications → diagnostics panel
   should show `Permission: granted`. If `denied`, tap "Grant permission"
   or enable in OS Settings.

2. **Check toggle:** The master "Evening reminder" toggle must be ON.

3. **Check scheduled count:** Should be ≥ 1 (at least the daily prompt).
   If 0, tap "Force reschedule".

4. **Check verified:** Should be `yes`. If `NO`, the OS or OEM killed
   the alarm after scheduling. See OEM-specific guidance below.

### Notifications arrive late (10+ minutes off)

- **Android 14+:** Exact alarms may not be available. The OS batches
  inexact alarms to save battery. This is expected and acceptable for
  amban's use case (±10 minutes on a daily prompt is fine).

- **Doze mode:** Android's Doze mode delays alarms when the device is
  stationary with screen off for extended periods. The
  `allowWhileIdle: true` flag mitigates this but doesn't fully prevent
  batching on some devices.

### Notifications stop after a device reboot

- The plugin's `BootReceiver` should re-register alarms. If it doesn't:
  1. Open the app — the auto-reschedule effect will fire.
  2. Tap "Force reschedule" in diagnostics.
  3. File a bug: this means we need a custom `BootReceiver`.

### Notifications stop after a few days (OEM kill)

This is the most common issue on Indian Android devices. The OEM's
battery optimizer killed amban's background alarm.

**Xiaomi / MIUI / HyperOS:**
1. Settings → Apps → Manage apps → amban → Autostart → Enable
2. Settings → Battery & performance → Battery saver → amban →
   No restrictions

**OPPO / ColorOS / Realme UI:**
1. Settings → Battery → More settings → Optimize battery use →
   amban → Don't optimize
2. Settings → App management → amban → Battery → Allow background
   activity

**Vivo / Funtouch OS:**
1. Settings → Battery → High background power consumption →
   Add amban
2. Settings → More settings → Permission manager → Autostart →
   amban → Enable

**Samsung / One UI:**
1. Settings → Battery and device care → Battery → Background usage
   limits → Never sleeping apps → Add amban
2. Remove amban from "Sleeping apps" and "Deep sleeping apps" if present

**Huawei / EMUI / Honor / MagicOS:**
1. Settings → Battery → App launch → amban → Manage manually →
   Enable all three toggles (Auto-launch, Secondary launch, Run in
   background)

**OnePlus / OxygenOS:**
1. Settings → Battery → Battery optimization → amban → Don't optimize
2. On newer OxygenOS (merged with ColorOS): follow OPPO instructions

### Notifications work in dev but not in release builds

- Ensure `@capacitor/local-notifications` is in `dependencies` (not
  `devDependencies`).
- Ensure the notification permission is declared in `AndroidManifest.xml`.
- Ensure Capacitor's `npx cap sync` has been run after adding the plugin.
- Check Proguard/R8 rules are not stripping the plugin's receivers.

### The test notification works but daily prompts don't

- The test notification fires in ~10 seconds (one-shot). Daily prompts
  use `{ every: 'day', on: { hour, minute } }` (recurring). These use
  different `AlarmManager` code paths.
- Check that the notification time is set to a time in the future today.
  If the time has already passed today, the first fire will be tomorrow.
- On some devices, recurring alarms need the exact alarm permission even
  though one-shot alarms work without it.

---

*Last updated: v0.2.0. See CLAUDE.md §10, §13, Appendix D & E for the
authoritative spec.*
