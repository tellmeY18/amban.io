package io.amban.app.updater;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

import io.amban.app.MainActivity;
import io.amban.app.R;

/**
 * UpdateCheckWorker — background periodic check for new app versions.
 *
 * Runs every 12 hours via WorkManager (scheduled from MainActivity).
 * If a newer version is found on GitHub Releases, fires a local
 * notification so the user knows to open the app and update.
 *
 * This ensures beta testers are notified even if they don't open
 * the app for days. The notification tap opens the app, where the
 * UpdateBanner handles the download + install flow.
 */
public class UpdateCheckWorker extends Worker {

    private static final String GITHUB_API_URL =
            "https://api.github.com/repos/tellmeY18/amban.io/releases?per_page=1";
    private static final String USER_AGENT = "amban-app-updater/1.0";
    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 30_000;

    private static final String CHANNEL_ID = "amban_updates";
    private static final int NOTIFICATION_ID = 9000;

    private static final String PREFS_NAME = "amban_updater";
    private static final String KEY_LAST_NOTIFIED_VERSION = "last_notified_version";

    public UpdateCheckWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();

        try {
            String currentVersion = getCurrentVersion(context);
            String remoteVersion = fetchLatestVersion();

            if (remoteVersion == null || remoteVersion.isEmpty()) {
                return Result.success(); // No release found or network issue
            }

            if (!isNewerVersion(remoteVersion, currentVersion)) {
                return Result.success(); // Already up to date
            }

            // Check if we already notified for this version
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String lastNotified = prefs.getString(KEY_LAST_NOTIFIED_VERSION, "");
            if (remoteVersion.equals(lastNotified)) {
                return Result.success(); // Already notified for this version
            }

            // Fire notification
            showUpdateNotification(context, remoteVersion);

            // Record that we notified for this version
            prefs.edit().putString(KEY_LAST_NOTIFIED_VERSION, remoteVersion).apply();

        } catch (Exception e) {
            // Network failures etc — don't retry aggressively, just wait for next schedule
            return Result.success();
        }

        return Result.success();
    }

    /**
     * Fetch the latest version tag from GitHub Releases.
     */
    private String fetchLatestVersion() {
        try {
            HttpURLConnection conn = (HttpURLConnection) new URL(GITHUB_API_URL).openConnection();
            conn.setRequestMethod("GET");
            conn.setRequestProperty("User-Agent", USER_AGENT);
            conn.setRequestProperty("Accept", "application/vnd.github.v3+json");
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);

            int responseCode = conn.getResponseCode();
            if (responseCode != 200) {
                conn.disconnect();
                return null;
            }

            String responseBody = readStream(conn.getInputStream());
            conn.disconnect();

            JSONArray releases = new JSONArray(responseBody);
            if (releases.length() == 0) return null;

            // Find first non-draft release
            for (int i = 0; i < releases.length(); i++) {
                JSONObject release = releases.getJSONObject(i);
                if (!release.optBoolean("draft", false)) {
                    String tagName = release.optString("tag_name", "");
                    // Also verify it has an APK asset
                    JSONArray assets = release.optJSONArray("assets");
                    if (assets != null) {
                        for (int j = 0; j < assets.length(); j++) {
                            if (assets.getJSONObject(j).optString("name", "").endsWith(".apk")) {
                                return tagName.startsWith("v") ? tagName.substring(1) : tagName;
                            }
                        }
                    }
                }
            }
            return null;
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Show a notification telling the user an update is available.
     */
    private void showUpdateNotification(Context context, String version) {
        ensureNotificationChannel(context);

        // Check notification permission (Android 13+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                return; // Can't post — user hasn't granted notification permission
            }
        }

        // Tap the notification → opens the app (where UpdateBanner handles the rest)
        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                context, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("amban update available")
                .setContentText("v" + version + " is ready. Tap to update.")
                .setStyle(new NotificationCompat.BigTextStyle()
                        .bigText("A new version of amban (v" + version + ") is available. "
                                + "Open the app and tap Download to update in one tap."))
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent);

        NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, builder.build());
    }

    /**
     * Create the notification channel (required on Android 8+).
     */
    private void ensureNotificationChannel(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "App Updates",
                    NotificationManager.IMPORTANCE_DEFAULT
            );
            channel.setDescription("Notifications when a new version of amban is available.");
            NotificationManager nm = context.getSystemService(NotificationManager.class);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
    }

    private String getCurrentVersion(Context context) {
        try {
            return context.getPackageManager()
                    .getPackageInfo(context.getPackageName(), 0)
                    .versionName;
        } catch (Exception e) {
            return "0.0.0";
        }
    }

    private boolean isNewerVersion(String remote, String current) {
        try {
            String[] remoteParts = remote.split("\\.");
            String[] currentParts = current.split("\\.");
            int maxLen = Math.max(remoteParts.length, currentParts.length);
            for (int i = 0; i < maxLen; i++) {
                int r = i < remoteParts.length ? Integer.parseInt(remoteParts[i]) : 0;
                int c = i < currentParts.length ? Integer.parseInt(currentParts[i]) : 0;
                if (r > c) return true;
                if (r < c) return false;
            }
            return false;
        } catch (NumberFormatException e) {
            return remote.compareTo(current) > 0;
        }
    }

    private String readStream(InputStream stream) throws Exception {
        BufferedReader reader = new BufferedReader(new InputStreamReader(stream));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) {
            sb.append(line);
        }
        reader.close();
        return sb.toString();
    }
}
