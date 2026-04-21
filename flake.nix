{
  description = "amban.io — dev shell for building Android (and iOS bridge) artifacts";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    android-nixpkgs = {
      url = "github:tadfisher/android-nixpkgs";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      android-nixpkgs,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config = {
            allowUnfree = true;
            android_sdk.accept_license = true;
          };
        };

        # Pin a single Android SDK composition that matches Capacitor 8 + AGP 8.13.
        # compileSdk = 36, minSdk = 24, build-tools 36.x, NDK optional (omitted).
        androidSdk = android-nixpkgs.sdk.${system} (
          sdkPkgs: with sdkPkgs; [
            cmdline-tools-latest
            platform-tools
            build-tools-34-0-0
            build-tools-35-0-0
            build-tools-36-0-0
            platforms-android-34
            platforms-android-35
            platforms-android-36
            emulator
          ]
        );

        jdk = pkgs.temurin-bin-21;
      in
      {
        devShells.default = pkgs.mkShell {
          name = "amban-android-shell";

          buildInputs = [
            jdk
            androidSdk
            pkgs.gradle
            pkgs.nodejs_22
            pkgs.python3
            pkgs.git
          ];

          shellHook = ''
            export JAVA_HOME="${jdk}"
            export ANDROID_HOME="${androidSdk}/share/android-sdk"
            export ANDROID_SDK_ROOT="$ANDROID_HOME"
            export GRADLE_OPTS="-Dorg.gradle.jvmargs=-Xmx4g -Dorg.gradle.daemon=false"
            export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

            echo ""
            echo "  amban.io build shell"
            echo "  ────────────────────"
            echo "  JAVA_HOME    = $JAVA_HOME"
            echo "  ANDROID_HOME = $ANDROID_HOME"
            echo "  java         = $(java -version 2>&1 | head -n1)"
            echo "  node         = $(node --version)"
            echo ""
            echo "  Build the debug APK with:"
            echo "    npm ci && npm run build && npx cap sync android"
            echo "    cd android && ./gradlew assembleDebug"
            echo ""
          '';
        };
      }
    );
}
