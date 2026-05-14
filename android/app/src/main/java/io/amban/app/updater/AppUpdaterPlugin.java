package io.amban.app.updater;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * AppUpdaterPlugin — Capacitor plugin for in-app APK updates.
 *
 * Checks GitHub Releases for new versions, downloads APKs to cache,
 * and triggers the system package installer.
 *
 * Methods:
 *   - checkForUpdate()    → { available, version, downloadUrl, releaseNotes, currentVersion }
 *   - downloadApk(opts)   → { filePath } (emits "downloadProgress" events)
 *   - installApk(opts)    → resolves after launching installer
 *   - canInstallApks()    → { granted }
 *   - openInstallSettings() → opens unknown-sources settings (API 26+)
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    private static final String TAG = "AppUpdaterPlugin";
    // NOTE: /releases/latest ONLY returns non-prerelease, non-draft releases.
    // All amban alpha/beta builds are published as prerelease, so we must use
    // /releases (returns all) and pick the newest one ourselves.
    private static final String GITHUB_API_URL =
            "https://api.github.com/repos/tellmeY18/amban.io/releases?per_page=1";
    private static final String USER_AGENT = "amban-app-updater/1.0";
    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 30_000;
    private static final String APK_SUBDIR = "apk_updates";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    /* -------------------------------------------------------------------
     * checkForUpdate() → { available, version, downloadUrl, releaseNotes, currentVersion }
     * ------------------------------------------------------------------- */

    @PluginMethod
    public void checkForUpdate(PluginCall call) {
        final String currentVersion = getCurrentVersion();

        executor.execute(() -> {
            try {
                HttpURLConnection conn = (HttpURLConnection) new URL(GITHUB_API_URL).openConnection();
                conn.setRequestMethod("GET");
                conn.setRequestProperty("User-Agent", USER_AGENT);
                conn.setRequestProperty("Accept", "application/vnd.github.v3+json");
                conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
                conn.setReadTimeout(READ_TIMEOUT_MS);

                int responseCode = conn.getResponseCode();
                if (responseCode != 200) {
                    resolveNoUpdate(call, currentVersion);
                    return;
                }

                String responseBody = readStream(conn.getInputStream());
                conn.disconnect();

                // Response is an array of releases (newest first).
                // Pick the first non-draft release (prerelease is fine).
                JSONArray releases = new JSONArray(responseBody);
                if (releases.length() == 0) {
                    resolveNoUpdate(call, currentVersion);
                    return;
                }

                JSONObject release = null;
                for (int i = 0; i < releases.length(); i++) {
                    JSONObject r = releases.getJSONObject(i);
                    if (!r.optBoolean("draft", false)) {
                        release = r;
                        break;
                    }
                }
                if (release == null) {
                    resolveNoUpdate(call, currentVersion);
                    return;
                }

                String tagName = release.optString("tag_name", "");
                String releaseNotes = release.optString("body", "");

                // Strip leading 'v' from tag
                String remoteVersion = tagName.startsWith("v") ? tagName.substring(1) : tagName;

                // Find the first .apk asset
                String downloadUrl = "";
                JSONArray assets = release.optJSONArray("assets");
                if (assets != null) {
                    for (int i = 0; i < assets.length(); i++) {
                        JSONObject asset = assets.getJSONObject(i);
                        String assetName = asset.optString("name", "");
                        if (assetName.endsWith(".apk")) {
                            downloadUrl = asset.optString("browser_download_url", "");
                            break;
                        }
                    }
                }

                boolean available = !remoteVersion.isEmpty()
                        && !downloadUrl.isEmpty()
                        && isNewerVersion(remoteVersion, currentVersion);

                JSObject result = new JSObject();
                result.put("available", available);
                result.put("version", remoteVersion);
                result.put("downloadUrl", downloadUrl);
                result.put("releaseNotes", releaseNotes);
                result.put("currentVersion", currentVersion);
                call.resolve(result);

            } catch (Exception e) {
                resolveNoUpdate(call, currentVersion);
            }
        });
    }

    /* -------------------------------------------------------------------
     * downloadApk({ url, version }) → { filePath }
     * Emits "downloadProgress" events: { progress, bytesDownloaded, totalBytes }
     * ------------------------------------------------------------------- */

    @PluginMethod
    public void downloadApk(PluginCall call) {
        String url = call.getString("url");
        String version = call.getString("version");

        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        if (version == null || version.isEmpty()) {
            call.reject("version is required");
            return;
        }

        final String downloadUrl = url;
        final String apkVersion = version;

        executor.execute(() -> {
            InputStream inputStream = null;
            FileOutputStream outputStream = null;
            HttpURLConnection conn = null;

            try {
                // Ensure the APK subdirectory exists in cache
                File apkDir = new File(getContext().getCacheDir(), APK_SUBDIR);
                if (!apkDir.exists()) {
                    apkDir.mkdirs();
                }

                // Clean up old APK files
                cleanOldApks(apkDir);

                // Target file
                String fileName = "amban-update-" + apkVersion + ".apk";
                File apkFile = new File(apkDir, fileName);

                // Download — follow redirects manually because HttpURLConnection
                // sometimes fails to follow HTTPS→HTTPS redirects on some OEMs,
                // and GitHub asset URLs go through multiple 302 hops.
                String currentUrl = downloadUrl;
                int maxRedirects = 5;
                int redirectCount = 0;

                while (redirectCount < maxRedirects) {
                    conn = (HttpURLConnection) new URL(currentUrl).openConnection();
                    conn.setRequestMethod("GET");
                    conn.setRequestProperty("User-Agent", USER_AGENT);
                    conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
                    conn.setReadTimeout(READ_TIMEOUT_MS);
                    conn.setInstanceFollowRedirects(false); // Handle manually

                    int responseCode = conn.getResponseCode();

                    if (responseCode == 301 || responseCode == 302 || responseCode == 307 || responseCode == 308) {
                        String location = conn.getHeaderField("Location");
                        conn.disconnect();
                        conn = null;
                        if (location == null || location.isEmpty()) {
                            call.reject("Redirect with no Location header");
                            return;
                        }
                        currentUrl = location;
                        redirectCount++;
                    } else if (responseCode == 200) {
                        break; // We have the actual content
                    } else {
                        call.reject("Download failed with HTTP " + responseCode);
                        return;
                    }
                }

                if (conn == null || conn.getResponseCode() != 200) {
                    call.reject("Too many redirects or connection lost");
                    return;
                }

                long totalBytes = conn.getContentLength();
                inputStream = conn.getInputStream();
                outputStream = new FileOutputStream(apkFile);

                byte[] buffer = new byte[8192];
                long bytesDownloaded = 0;
                int bytesRead;
                int lastReportedProgress = -1;

                while ((bytesRead = inputStream.read(buffer)) != -1) {
                    outputStream.write(buffer, 0, bytesRead);
                    bytesDownloaded += bytesRead;

                    // Emit progress (throttle to whole-percent changes)
                    if (totalBytes > 0) {
                        int progress = (int) ((bytesDownloaded * 100) / totalBytes);
                        if (progress != lastReportedProgress) {
                            lastReportedProgress = progress;
                            JSObject progressData = new JSObject();
                            progressData.put("progress", progress);
                            progressData.put("bytesDownloaded", bytesDownloaded);
                            progressData.put("totalBytes", totalBytes);
                            notifyListeners("downloadProgress", progressData);
                        }
                    }
                }

                outputStream.flush();

                JSObject result = new JSObject();
                result.put("filePath", apkFile.getAbsolutePath());
                call.resolve(result);

            } catch (Exception e) {
                call.reject("Download failed: " + e.getMessage());
            } finally {
                try { if (inputStream != null) inputStream.close(); } catch (Exception ignored) {}
                try { if (outputStream != null) outputStream.close(); } catch (Exception ignored) {}
                if (conn != null) conn.disconnect();
            }
        });
    }

    /* -------------------------------------------------------------------
     * installApk({ filePath }) → resolves after launching installer
     * ------------------------------------------------------------------- */

    @PluginMethod
    public void installApk(PluginCall call) {
        String filePath = call.getString("filePath");
        if (filePath == null || filePath.isEmpty()) {
            call.reject("filePath is required");
            return;
        }

        File apkFile = new File(filePath);
        if (!apkFile.exists()) {
            call.reject("APK file not found at: " + filePath);
            return;
        }

        try {
            Context context = getContext();
            Uri contentUri = FileProvider.getUriForFile(
                    context,
                    context.getPackageName() + ".fileprovider",
                    apkFile
            );

            Intent installIntent = new Intent(Intent.ACTION_VIEW);
            installIntent.setDataAndType(contentUri, "application/vnd.android.package-archive");
            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            getActivity().runOnUiThread(() -> {
                context.startActivity(installIntent);
                call.resolve();
            });

        } catch (Exception e) {
            call.reject("Failed to launch installer: " + e.getMessage());
        }
    }

    /* -------------------------------------------------------------------
     * canInstallApks() → { granted }
     * ------------------------------------------------------------------- */

    @PluginMethod
    public void canInstallApks(PluginCall call) {
        JSObject result = new JSObject();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            boolean canInstall = getContext().getPackageManager().canRequestPackageInstalls();
            result.put("granted", canInstall);
        } else {
            // Pre-Oreo: unknown sources is a global toggle; assume granted
            result.put("granted", true);
        }

        call.resolve(result);
    }

    /* -------------------------------------------------------------------
     * openInstallSettings() → opens unknown-app-sources settings (API 26+)
     * ------------------------------------------------------------------- */

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            getActivity().runOnUiThread(() -> {
                getContext().startActivity(intent);
                call.resolve();
            });
        } else {
            // Pre-Oreo: no-op
            call.resolve();
        }
    }

    /* -------------------------------------------------------------------
     * Helpers
     * ------------------------------------------------------------------- */

    /**
     * Get the app's current versionName from BuildConfig.
     */
    private String getCurrentVersion() {
        try {
            return getContext()
                    .getPackageManager()
                    .getPackageInfo(getContext().getPackageName(), 0)
                    .versionName;
        } catch (Exception e) {
            return "0.0.0";
        }
    }

    /**
     * Simple semver comparison: returns true if remote > current.
     * Splits on '.', compares each part numerically.
     */
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
            return false; // equal
        } catch (NumberFormatException e) {
            // If parsing fails, fall back to string comparison
            return remote.compareTo(current) > 0;
        }
    }

    /**
     * Read an InputStream into a String.
     */
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

    /**
     * Delete old amban-update-*.apk files from the given directory.
     */
    private void cleanOldApks(File dir) {
        File[] files = dir.listFiles();
        if (files == null) return;
        for (File file : files) {
            if (file.getName().startsWith("amban-update-") && file.getName().endsWith(".apk")) {
                file.delete();
            }
        }
    }

    /**
     * Resolve with a "no update available" response (used on errors too).
     */
    private void resolveNoUpdate(PluginCall call, String currentVersion) {
        JSObject result = new JSObject();
        result.put("available", false);
        result.put("version", "");
        result.put("downloadUrl", "");
        result.put("releaseNotes", "");
        result.put("currentVersion", currentVersion);
        call.resolve(result);
    }
}
