package io.amban.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;

import androidx.core.content.ContextCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import com.getcapacitor.BridgeActivity;
import io.amban.app.ml.TFLitePlugin;
import io.amban.app.updater.AppUpdaterPlugin;

import java.util.concurrent.TimeUnit;

public class MainActivity extends BridgeActivity {

    private static final String SMS_WORKER_TAG = "amban_sms_periodic_scan";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SmsReaderPlugin.class);
        registerPlugin(AppUpdaterPlugin.class);
        registerPlugin(TFLitePlugin.class);
        super.onCreate(savedInstanceState);

        // Schedule periodic SMS scan worker (only if permission granted)
        scheduleSmsWorkerIfPermitted();
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Re-check on resume in case permission was just granted
        scheduleSmsWorkerIfPermitted();
    }

    private void scheduleSmsWorkerIfPermitted() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_SMS)
                != PackageManager.PERMISSION_GRANTED) {
            // Cancel any existing worker if permission was revoked
            WorkManager.getInstance(this).cancelUniqueWork(SMS_WORKER_TAG);
            return;
        }

        Constraints constraints = new Constraints.Builder()
                .setRequiresBatteryNotLow(true)
                .build();

        PeriodicWorkRequest workRequest = new PeriodicWorkRequest.Builder(
                SmsWorker.class, 4, TimeUnit.HOURS)
                .setConstraints(constraints)
                .build();

        WorkManager.getInstance(this)
                .enqueueUniquePeriodicWork(
                        SMS_WORKER_TAG,
                        ExistingPeriodicWorkPolicy.KEEP,
                        workRequest);
    }
}
