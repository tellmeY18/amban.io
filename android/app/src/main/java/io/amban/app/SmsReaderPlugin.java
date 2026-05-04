package io.amban.app;

import android.Manifest;
import android.content.ContentResolver;
import android.content.SharedPreferences;
import android.content.Context;
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

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * SmsReaderPlugin — custom Capacitor plugin for reading device SMS.
 *
 * Source of truth: CLAUDE.md §15 (SMS Capture & Auto-Suggestions).
 *
 * Exposes methods to the JS layer:
 *   - checkPermission()      → { granted: boolean }
 *   - requestPermission()    → { granted: boolean }
 *   - readSince(options)     → { messages: SmsMessage[] }
 *   - getStagedMessages()    → { messages: SmsMessage[] }  (from BroadcastReceiver/Worker queue)
 *   - clearStagedMessages()  → void
 *   - checkReceiveSmsPermission() → { granted: boolean }
 *   - requestReceiveSmsPermission() → { granted: boolean }
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
        ),
        @Permission(
            alias = "receiveSms",
            strings = { Manifest.permission.RECEIVE_SMS }
        )
    }
)
public class SmsReaderPlugin extends Plugin {

    private static final String PERMISSION_ALIAS = "sms";
    private static final String RECEIVE_PERMISSION_ALIAS = "receiveSms";
    private static final String STAGING_PREFS = "amban_sms_staging";
    private static final String KEY_QUEUE = "pending_sms_queue";

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
     * checkReceiveSmsPermission() → { granted: boolean }
     * --------------------------------------------------------------- */

    @PluginMethod
    public void checkReceiveSmsPermission(PluginCall call) {
        boolean granted = getPermissionState(RECEIVE_PERMISSION_ALIAS) == com.getcapacitor.PermissionState.GRANTED;
        JSObject result = new JSObject();
        result.put("granted", granted);
        call.resolve(result);
    }

    /* ---------------------------------------------------------------
     * requestReceiveSmsPermission() → { granted: boolean }
     * --------------------------------------------------------------- */

    @PluginMethod
    public void requestReceiveSmsPermission(PluginCall call) {
        if (getPermissionState(RECEIVE_PERMISSION_ALIAS) == com.getcapacitor.PermissionState.GRANTED) {
            JSObject result = new JSObject();
            result.put("granted", true);
            call.resolve(result);
            return;
        }
        requestPermissionForAlias(RECEIVE_PERMISSION_ALIAS, call, "onReceiveSmsPermissionResult");
    }

    @PermissionCallback
    private void onReceiveSmsPermissionResult(PluginCall call) {
        boolean granted = getPermissionState(RECEIVE_PERMISSION_ALIAS) == com.getcapacitor.PermissionState.GRANTED;
        JSObject result = new JSObject();
        result.put("granted", granted);
        call.resolve(result);
    }

    /* ---------------------------------------------------------------
     * getStagedMessages() → { messages: SmsMessage[] }
     *
     * Reads messages staged by SmsBroadcastReceiver and SmsWorker
     * from SharedPreferences. Returns them and clears the queue.
     * --------------------------------------------------------------- */

    @PluginMethod
    public void getStagedMessages(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(STAGING_PREFS, Context.MODE_PRIVATE);
        String queueStr = prefs.getString(KEY_QUEUE, "[]");

        JSArray messages = new JSArray();
        try {
            JSONArray queue = new JSONArray(queueStr);
            SimpleDateFormat isoFormat = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
            isoFormat.setTimeZone(TimeZone.getTimeZone("UTC"));

            for (int i = 0; i < queue.length(); i++) {
                JSONObject obj = queue.getJSONObject(i);
                JSObject msg = new JSObject();
                msg.put("messageId", obj.optString("messageId", ""));
                msg.put("sender", obj.optString("sender", ""));
                msg.put("body", obj.optString("body", ""));

                // Handle receivedAt — could be epoch ms (from BroadcastReceiver) or ISO (from Worker)
                String receivedAt = obj.optString("receivedAt", "");
                if (receivedAt.isEmpty()) {
                    long ms = obj.optLong("receivedAt", System.currentTimeMillis());
                    receivedAt = isoFormat.format(new Date(ms));
                } else {
                    try {
                        // If it's a numeric string (epoch ms from BroadcastReceiver)
                        long ms = Long.parseLong(receivedAt);
                        receivedAt = isoFormat.format(new Date(ms));
                    } catch (NumberFormatException e) {
                        // Already ISO format — keep as-is
                    }
                }
                msg.put("receivedAt", receivedAt);
                messages.put(msg);
            }
        } catch (Exception e) {
            // Return empty on parse failure
        }

        // Clear the queue after reading
        prefs.edit().putString(KEY_QUEUE, "[]").apply();

        JSObject result = new JSObject();
        result.put("messages", messages);
        call.resolve(result);
    }

    /* ---------------------------------------------------------------
     * clearStagedMessages() → void
     * --------------------------------------------------------------- */

    @PluginMethod
    public void clearStagedMessages(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(STAGING_PREFS, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_QUEUE, "[]").apply();
        call.resolve();
    }

    /* ---------------------------------------------------------------
     * readSince({ sinceIso: string, limit?: number }) → { messages }
     * --------------------------------------------------------------- */

    @PluginMethod
    public void readSince(PluginCall call) {
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

                    String rowId = idIdx >= 0 ? cursor.getString(idIdx) : "";
                    String body = bodyIdx >= 0 ? cursor.getString(bodyIdx) : "";
                    String sender = addressIdx >= 0 ? cursor.getString(addressIdx) : "";
                    long dateMs = dateIdx >= 0 ? cursor.getLong(dateIdx) : 0;

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

    private long parseIso8601(String iso) throws Exception {
        String cleaned = iso.replace("Z", "+00:00");
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

        SimpleDateFormat[] formats = {
            new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZ", Locale.US),
            new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssZ", Locale.US),
        };

        for (SimpleDateFormat fmt : formats) {
            fmt.setTimeZone(TimeZone.getTimeZone("UTC"));
            try {
                return fmt.parse(cleaned).getTime();
            } catch (Exception ignored) {}
        }

        throw new Exception("Could not parse: " + iso);
    }
}
