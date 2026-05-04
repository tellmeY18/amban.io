package io.amban.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.provider.Telephony;
import android.telephony.SmsMessage;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * SmsBroadcastReceiver — real-time SMS capture.
 *
 * Receives incoming SMS immediately when they arrive (even when app is in background).
 * Stages messages in SharedPreferences for the TypeScript layer to consume on next foreground.
 * If the app is currently active, a local broadcast notifies SmsReaderPlugin to trigger
 * an immediate scan.
 *
 * Privacy: zero network calls. Messages are parsed on-device by the TS parser.
 * The raw body is only held transiently in SharedPreferences until processed.
 */
public class SmsBroadcastReceiver extends BroadcastReceiver {

    private static final String PREFS_NAME = "amban_sms_staging";
    private static final String KEY_QUEUE = "pending_sms_queue";
    public static final String ACTION_SMS_STAGED = "io.amban.app.SMS_STAGED";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;

        Bundle bundle = intent.getExtras();
        if (bundle == null) return;

        SmsMessage[] messages = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (messages == null || messages.length == 0) return;

        // Reassemble multi-part SMS
        StringBuilder bodyBuilder = new StringBuilder();
        String sender = null;
        long timestamp = System.currentTimeMillis();

        for (SmsMessage sms : messages) {
            if (sms == null) continue;
            if (sender == null) {
                sender = sms.getDisplayOriginatingAddress();
                timestamp = sms.getTimestampMillis();
            }
            bodyBuilder.append(sms.getMessageBody());
        }

        if (sender == null || bodyBuilder.length() == 0) return;

        String body = bodyBuilder.toString();

        // Quick pre-filter: skip obvious non-transactional (too short, or clearly personal)
        if (body.length() < 20) return;

        // Stage the message in SharedPreferences
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String existing = prefs.getString(KEY_QUEUE, "[]");
            JSONArray queue = new JSONArray(existing);

            JSONObject msg = new JSONObject();
            msg.put("sender", sender);
            msg.put("body", body);
            msg.put("receivedAt", timestamp);
            msg.put("messageId", sender + "_" + timestamp + "_" + Math.abs(body.hashCode()));
            queue.put(msg);

            // Cap queue at 100 messages to prevent unbounded growth
            while (queue.length() > 100) {
                queue.remove(0);
            }

            prefs.edit().putString(KEY_QUEUE, queue.toString()).apply();
        } catch (Exception e) {
            // Silently fail — don't crash the SMS pipeline
        }

        // Notify the app (if running) via a local broadcast
        Intent localIntent = new Intent(ACTION_SMS_STAGED);
        localIntent.setPackage(context.getPackageName());
        context.sendBroadcast(localIntent);
    }
}
