import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "io.amban.app",
  appName: "amban",
  webDir: "dist",
  backgroundColor: "#1A73E8",
  ios: {
    contentInset: "always",
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1000,
      launchAutoHide: true,
      backgroundColor: "#1A73E8",
      showSpinner: false,
      androidSpinnerStyle: "small",
      iosSpinnerStyle: "small",
      splashFullScreen: true,
      splashImmersive: true,
    },
    LocalNotifications: {
      smallIcon: "ic_stat_icon_config_sample",
      iconColor: "#1A73E8",
    },
    CapacitorSQLite: {
      iosDatabaseLocation: "Library/CapacitorDatabase",
      iosIsEncryption: false,
      iosBiometric: {
        biometricAuth: false,
      },
      androidIsEncryption: false,
      androidBiometric: {
        biometricAuth: false,
      },
      electronIsEncryption: false,
    },
  },
};

export default config;
