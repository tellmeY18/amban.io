import legacy from "@vitejs/plugin-legacy";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

/**
 * Resolve build metadata once per Vite invocation.
 *
 * - `version` is the single source of truth from `package.json`.
 * - `commit` comes from the CI-provided `GIT_COMMIT` env (set by the
 *   release workflow) and falls back to a local `git rev-parse` so dev
 *   builds show something meaningful. If git is unavailable, we degrade
 *   to `"local"` rather than throwing — the build must never fail on
 *   metadata.
 * - `buildDate` is the ISO timestamp at config-evaluation time.
 */
function resolveBuildInfo(): { version: string; commit: string; buildDate: string } {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf-8")) as {
    version?: string;
  };
  const version = pkg.version ?? "0.0.0-dev";

  let commit = process.env.GIT_COMMIT ?? "";
  if (!commit) {
    try {
      commit = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim();
    } catch {
      commit = "local";
    }
  }

  return {
    version,
    commit: commit || "local",
    buildDate: new Date().toISOString(),
  };
}

const buildInfo = resolveBuildInfo();

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), legacy()],
  define: {
    __APP_VERSION__: JSON.stringify(buildInfo.version),
    __APP_COMMIT__: JSON.stringify(buildInfo.commit),
    __APP_BUILD_DATE__: JSON.stringify(buildInfo.buildDate),
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "es2020",
  },
});
