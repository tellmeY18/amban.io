package io.amban.app;

import android.Manifest;
import android.content.ContentResolver;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.provider.Telephony;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;

/**
 * SmsWorker — periodic background SMS scanner.
 *
 * Scheduled via WorkManager to run every 4 hours. Scans the Telephony
 * content provider for messages received since the last worker run.
 * Stages new messages in SharedPreferences for the TS layer to process.
 *
 * This catches messages that the BroadcastReceiver might have missed
 * (e.g., receiver was killed by the OS, or SMS arrived during a restart).
 */
public class SmsWorker extends Worker {

    private static final String PREFS_NAME = "amban_sms_staging";
    private static final String KEY_QUEUE = "pending_sms_queue";
    private static final String KEY_LAST_WORKER_SCAN = "last_worker_scan_ms";
    private static final long SCAN_WINDOW_MS = 5 * 60 * 60 * 1000; // 5 hours (overlap buffer)

    public SmsWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();

        // Check permission
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS)
                != PackageManager.PERMISSION_GRANTED) {
            return Result.success(); // No permission — nothing to do
        }

        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        long lastScan = prefs.getLong(KEY_LAST_WORKER_SCAN, System.currentTimeMillis() - SCAN_WINDOW_MS);
        long sinceMs = Math.max(lastScan - (60 * 60 * 1000), System.currentTimeMillis() - SCAN_WINDOW_MS);

        // Get existing queue message IDs to avoid duplicates
        Set<String> existingIds = new HashSet<>();
        try {
            String existing = prefs.getString(KEY_QUEUE, "[]");
            JSONArray existingQueue = new JSONArray(existing);
            for (int i = 0; i < existingQueue.length(); i++) {
                JSONObject obj = existingQueue.getJSONObject(i);
                existingIds.add(obj.optString("messageId", ""));
            }
        } catch (Exception ignored) {}

        try {
            ContentResolver resolver = context.getContentResolver();
            Uri uri = Telephony.Sms.Inbox.CONTENT_URI;
            String selection = Telephony.Sms.DATE + " > ?";
            String[] selectionArgs = new String[]{ String.valueOf(sinceMs) };
            String sortOrder = Telephony.Sms.DATE + " DESC LIMIT 200";

            Cursor cursor = resolver.query(uri, null, selection, selectionArgs, sortOrder);
            if (cursor == null) return Result.success();

            String queueStr = prefs.getString(KEY_QUEUE, "[]");
            JSONArray queue = new JSONArray(queueStr);
            int added = 0;

            try {
                if (cursor.moveToFirst()) {
                    int bodyIdx = cursor.getColumnIndex(Telephony.Sms.BODY);
                    int addressIdx = cursor.getColumnIndex(Telephony.Sms.ADDRESS);
                    int dateIdx = cursor.getColumnIndex(Telephony.Sms.DATE);
                    int idIdx = cursor.getColumnIndex(Telephony.Sms._ID);

                    SimpleDateFormat isoFormat = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
                    isoFormat.setTimeZone(TimeZone.getTimeZone("UTC"));

                    do {
                        String body = bodyIdx >= 0 ? cursor.getString(bodyIdx) : "";
                        String sender = addressIdx >= 0 ? cursor.getString(addressIdx) : "";
                        long dateMs = dateIdx >= 0 ? cursor.getLong(dateIdx) : 0;
                        String rowId = idIdx >= 0 ? cursor.getString(idIdx) : "";

                        if (body == null || body.length() < 20) continue;
                        if (sender == null) continue;

                        String messageId = rowId + "_" + Math.abs(body.hashCode());
                        if (existingIds.contains(messageId)) continue;

                        JSONObject msg = new JSONObject();
                        msg.put("sender", sender);
                        msg.put("body", body);
                        msg.put("receivedAt", isoFormat.format(new Date(dateMs)));
                        msg.put("messageId", messageId);
                        queue.put(msg);
                        existingIds.add(messageId);
                        added++;

                        if (added >= 50) break; // Cap per worker run
                    } while (cursor.moveToNext());
                }
            } finally {
                cursor.close();
            }

            // Cap total queue
            while (queue.length() > 100) {
                queue.remove(0);
            }

            prefs.edit()
                .putString(KEY_QUEUE, queue.toString())
                .putLong(KEY_LAST_WORKER_SCAN, System.currentTimeMillis())
                .apply();

        } catch (Exception e) {
            // Don't crash — just report failure for retry
            return Result.retry();
        }

        return Result.success();
    }
}
