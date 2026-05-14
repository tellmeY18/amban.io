package io.amban.app;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;

import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
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

        // Fix: ensure the WebView content does not draw behind the
        // system navigation bar (3-button or gesture). On Android 15+
        // edge-to-edge is enforced, so we apply proper inset handling
        // rather than trying to opt out.
        setupSystemBars();

        // Schedule periodic update check (every 12 hours, needs network)
        scheduleUpdateCheckWorker();
    }

    /**
     * Configure system bar appearance so the app's BottomNav never
     * sits behind the Android navigation bar (3-button layout).
     *
     * Strategy:
     *   - Let the status bar remain edge-to-edge (app draws behind it,
     *     padded by safe-area-inset-top in CSS).
     *   - For the BOTTOM navigation bar: apply a window inset listener
     *     that pads the WebView's root so content stops above the system
     *     nav bar. This makes env(safe-area-inset-bottom) in the CSS
     *     unnecessary for the system nav — the viewport itself is already
     *     above it.
     */
    private void setupSystemBars() {
        Window window = getWindow();
        View decorView = window.getDecorView();

        // Tell the system we want to handle insets ourselves
        WindowCompat.setDecorFitsSystemWindows(window, false);

        // Set navigation bar colour to match the app surface
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            window.setNavigationBarColor(0xFFF8F9FA); // --color-bg light
            new WindowInsetsControllerCompat(window, decorView)
                    .setAppearanceLightNavigationBars(true);
        }

        // Apply bottom inset as padding on the root view so the WebView
        // viewport ends above the system navigation bar.
        View rootContent = findViewById(android.R.id.content);
        if (rootContent != null) {
            ViewCompat.setOnApplyWindowInsetsListener(rootContent, (view, insets) -> {
                int bottomInset = insets.getInsets(
                        WindowInsetsCompat.Type.navigationBars()
                ).bottom;
                // Apply bottom padding to push the WebView up above the nav bar.
                // Keep existing left/top/right padding.
                view.setPadding(
                        view.getPaddingLeft(),
                        view.getPaddingTop(),
                        view.getPaddingRight(),
                        bottomInset
                );
                return WindowInsetsCompat.CONSUMED;
            });
        }
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
