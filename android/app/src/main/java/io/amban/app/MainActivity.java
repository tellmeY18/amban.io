package io.amban.app;

import android.os.Bundle;

import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import com.getcapacitor.BridgeActivity;
import io.amban.app.ml.TFLitePlugin;
import io.amban.app.updater.AppUpdaterPlugin;
import io.amban.app.updater.UpdateCheckWorker;

import java.util.concurrent.TimeUnit;

public class MainActivity extends BridgeActivity {

    private static final String UPDATE_WORKER_TAG = "amban_update_check";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppUpdaterPlugin.class);
        registerPlugin(TFLitePlugin.class);
        super.onCreate(savedInstanceState);

        // Schedule periodic update check (every 12 hours, needs network)
        scheduleUpdateCheckWorker();
    }

    private void scheduleUpdateCheckWorker() {
        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();

        PeriodicWorkRequest workRequest = new PeriodicWorkRequest.Builder(
                UpdateCheckWorker.class, 12, TimeUnit.HOURS)
                .setConstraints(constraints)
                .build();

        WorkManager.getInstance(this)
                .enqueueUniquePeriodicWork(
                        UPDATE_WORKER_TAG,
                        ExistingPeriodicWorkPolicy.KEEP,
                        workRequest);
    }
}
