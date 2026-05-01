package io.amban.app;

import android.Manifest;
import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.Telephony;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * SmsReaderPlugin — custom Capacitor plugin for reading device SMS.
 *
 * Source of truth: CLAUDE.md §15 (SMS Capture & Auto-Suggestions).
 *
 * Exposes three methods to the JS layer:
 *   - checkPermission()   → { granted: boolean }
 *   - requestPermission() → { granted: boolean }
 *   - readSince(options)  → { messages: SmsMessage[] }
 *
 * Privacy:
 *   - Reads from the on-device Telephony content provider only.
 *   - Zero network calls. The raw SMS body is returned to JS for
 *     on-device parsing; it is never stored by the native layer.
 */
@CapacitorPlugin(
    name = "SmsReader",
    permissions = {
        @Permission(
            alias = "sms",
            strings = { Manifest.permission.READ_SMS }
        )
    }
)
public class SmsReaderPlugin extends Plugin {

    private static final String PERMISSION_ALIAS = "sms";

    /* ---------------------------------------------------------------
     * checkPermission() → { granted: boolean }
     * --------------------------------------------------------------- */

    @PluginMethod
    public void checkPermission(PluginCall call) {
        boolean granted = getPermissionState(PERMISSION_ALIAS) == com.getcapacitor.PermissionState.GRANTED;
        JSObject result = new JSObject();
        result.put("granted", granted);
        call.resolve(result);
    }

    /* ---------------------------------------------------------------
     * requestPermission() → { granted: boolean }
     *
     * Triggers the Android runtime permission dialog for READ_SMS.
     * The result arrives asynchronously in the @PermissionCallback.
     * --------------------------------------------------------------- */

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (getPermissionState(PERMISSION_ALIAS) == com.getcapacitor.PermissionState.GRANTED) {
            JSObject result = new JSObject();
            result.put("granted", true);
            call.resolve(result);
            return;
        }
        requestPermissionForAlias(PERMISSION_ALIAS, call, "onSmsPermissionResult");
    }

    @PermissionCallback
    private void onSmsPermissionResult(PluginCall call) {
        boolean granted = getPermissionState(PERMISSION_ALIAS) == com.getcapacitor.PermissionState.GRANTED;
        JSObject result = new JSObject();
        result.put("granted", granted);
        call.resolve(result);
    }

    /* ---------------------------------------------------------------
     * readSince({ sinceIso: string, limit?: number }) → { messages }
     *
     * Reads SMS messages received after the given ISO-8601 timestamp.
     * Returns at most `limit` messages (default 500).
     * --------------------------------------------------------------- */

    @PluginMethod
    public void readSince(PluginCall call) {
        // Guard: permission must be granted before reading.
        if (getPermissionState(PERMISSION_ALIAS) != com.getcapacitor.PermissionState.GRANTED) {
            call.reject("READ_SMS permission not granted");
            return;
        }

        String sinceIso = call.getString("sinceIso");
        if (sinceIso == null || sinceIso.isEmpty()) {
            call.reject("sinceIso is required");
            return;
        }

        int limit = call.getInt("limit", 500);

        long sinceMillis;
        try {
            sinceMillis = parseIso8601(sinceIso);
        } catch (Exception e) {
            call.reject("Invalid sinceIso timestamp: " + e.getMessage());
            return;
        }

        JSArray messages = new JSArray();

        ContentResolver resolver = getContext().getContentResolver();
        Uri uri = Telephony.Sms.Inbox.CONTENT_URI;

        String selection = Telephony.Sms.DATE + " > ?";
        String[] selectionArgs = new String[]{ String.valueOf(sinceMillis) };
        String sortOrder = Telephony.Sms.DATE + " DESC LIMIT " + limit;

        Cursor cursor = null;
        try {
            cursor = resolver.query(uri, null, selection, selectionArgs, sortOrder);

            if (cursor != null && cursor.moveToFirst()) {
                int idIdx = cursor.getColumnIndex(Telephony.Sms._ID);
                int bodyIdx = cursor.getColumnIndex(Telephony.Sms.BODY);
                int addressIdx = cursor.getColumnIndex(Telephony.Sms.ADDRESS);
                int dateIdx = cursor.getColumnIndex(Telephony.Sms.DATE);

                SimpleDateFormat isoFormat = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
                isoFormat.setTimeZone(TimeZone.getTimeZone("UTC"));

                do {
                    JSObject msg = new JSObject();

                    // messageId: stable composite of provider _id + body hash
                    String rowId = idIdx >= 0 ? cursor.getString(idIdx) : "";
                    String body = bodyIdx >= 0 ? cursor.getString(bodyIdx) : "";
                    String sender = addressIdx >= 0 ? cursor.getString(addressIdx) : "";
                    long dateMs = dateIdx >= 0 ? cursor.getLong(dateIdx) : 0;

                    // Stable message ID: provider row ID + body hash avoids
                    // collisions if the provider recycles _id values.
                    String messageId = rowId + "_" + Math.abs(body.hashCode());

                    msg.put("messageId", messageId);
                    msg.put("sender", sender != null ? sender : "");
                    msg.put("body", body != null ? body : "");
                    msg.put("receivedAt", isoFormat.format(new Date(dateMs)));

                    messages.put(msg);
                } while (cursor.moveToNext());
            }
        } catch (Exception e) {
            call.reject("Failed to query SMS inbox: " + e.getMessage());
            return;
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }

        JSObject result = new JSObject();
        result.put("messages", messages);
        call.resolve(result);
    }

    /* ---------------------------------------------------------------
     * Helpers
     * --------------------------------------------------------------- */

    /**
     * Parse an ISO-8601 timestamp into epoch milliseconds.
     * Handles both "2025-01-15T10:30:00.000Z" and "2025-01-15T10:30:00Z".
     */
    private long parseIso8601(String iso) throws Exception {
        // Normalise: strip trailing Z and fractional seconds for SimpleDateFormat
        String cleaned = iso.replace("Z", "+00:00");
        // Handle the colon in timezone offset for older Android
        if (cleaned.lastIndexOf('+') > 10) {
            int tzIdx = cleaned.lastIndexOf('+');
            String tz = cleaned.substring(tzIdx);
            if (tz.length() == 6 && tz.charAt(3) == ':') {
                cleaned = cleaned.substring(0, tzIdx) + tz.replace(":", "");
            }
        }
        if (cleaned.lastIndexOf('-') > 10) {
            int tzIdx = cleaned.lastIndexOf('-');
            String tz = cleaned.substring(tzIdx);
            if (tz.length() == 6 && tz.charAt(3) == ':') {
                cleaned = cleaned.substring(0, tzIdx) + tz.replace(":", "");
            }
        }

        // Try with fractional seconds first, then without
        SimpleDateFormat[] formats = {
            new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZ", Locale.US),
            new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssZ", Locale.US),
        };

        for (SimpleDateFormat fmt : formats) {
            fmt.setTimeZone(TimeZone.getTimeZone("UTC"));
            try {
                return fmt.parse(cleaned).getTime();
            } catch (Exception ignored) {
                // try next format
            }
        }

        throw new Exception("Could not parse: " + iso);
    }
}
