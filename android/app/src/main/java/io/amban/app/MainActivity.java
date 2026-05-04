package io.amban.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import io.amban.app.updater.AppUpdaterPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SmsReaderPlugin.class);
        registerPlugin(AppUpdaterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
