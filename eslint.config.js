import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

/**
 * amban.io — ESLint configuration.
 *
 * Goals:
 *   1. TypeScript correctness (no `any`, no floating promises later, etc.).
 *   2. React + hooks best practices.
 *   3. Privacy gate: nothing in the app should ever reach the network.
 *      We enforce this at the linter so the CI check is cheap and the
 *      signal shows up at PR time, not at bundle-audit time.
 *
 * See CLAUDE.md §12 ("No External Calls Policy") and the README's
 * "Privacy-as-Code" section for the rationale.
 */

/** Symbols that must never appear in production source code. */
const FORBIDDEN_NETWORK_GLOBALS = [
  {
    name: "fetch",
    message:
      "amban.io is a local-only app. Network calls are forbidden — see CLAUDE.md §12 and README 'Privacy-as-Code'.",
  },
  {
    name: "XMLHttpRequest",
    message: "amban.io is a local-only app. XHR is forbidden — see CLAUDE.md §12.",
  },
  {
    name: "WebSocket",
    message: "amban.io is a local-only app. WebSockets are forbidden — see CLAUDE.md §12.",
  },
  {
    name: "EventSource",
    message: "amban.io is a local-only app. Server-sent events are forbidden — see CLAUDE.md §12.",
  },
];

/** Named imports from libraries we explicitly refuse to pull in. */
const FORBIDDEN_IMPORTS = [
  {
    name: "axios",
    message: "No HTTP clients. amban.io never touches the network — see CLAUDE.md §12.",
  },
  {
    name: "ky",
    message: "No HTTP clients. amban.io never touches the network.",
  },
  {
    name: "got",
    message: "No HTTP clients. amban.io never touches the network.",
  },
  {
    name: "node-fetch",
    message: "No HTTP clients. amban.io never touches the network.",
  },
  {
    name: "@sentry/browser",
    message: "No crash reporters. amban.io keeps all data on-device — see CLAUDE.md §12.",
  },
  {
    name: "@sentry/react",
    message: "No crash reporters. amban.io keeps all data on-device — see CLAUDE.md §12.",
  },
  {
    name: "mixpanel-browser",
    message: "No analytics SDKs. amban.io is local-only — see CLAUDE.md §12.",
  },
  {
    name: "@amplitude/analytics-browser",
    message: "No analytics SDKs. amban.io is local-only — see CLAUDE.md §12.",
  },
  {
    name: "posthog-js",
    message: "No analytics SDKs. amban.io is local-only — see CLAUDE.md §12.",
  },
  {
    name: "firebase",
    message: "No Firebase. amban.io has no backend — see CLAUDE.md §12.",
  },
  {
    name: "firebase/app",
    message: "No Firebase. amban.io has no backend — see CLAUDE.md §12.",
  },
  {
    name: "moment",
    message: "Use date-fns instead — see CLAUDE.md §2 (Tech Stack).",
  },
];

export default tseslint.config(
  {
    ignores: [
      "dist",
      "build",
      "coverage",
      "ios",
      "android",
      ".capacitor",
      "node_modules",
      "vite.config.ts",
      "capacitor.config.ts",
      "eslint.config.js",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // ----------------------------------------------------------------
      // React + Hooks
      // ----------------------------------------------------------------
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],

      // ----------------------------------------------------------------
      // TypeScript hygiene
      // ----------------------------------------------------------------
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-non-null-assertion": "warn",

      // ----------------------------------------------------------------
      // Privacy gate — see CLAUDE.md §12 / README "Privacy-as-Code"
      // ----------------------------------------------------------------
      "no-restricted-globals": ["error", ...FORBIDDEN_NETWORK_GLOBALS],
      "no-restricted-imports": [
        "error",
        {
          paths: FORBIDDEN_IMPORTS,
          patterns: [
            {
              group: ["@sentry/*"],
              message: "No crash reporters. amban.io keeps all data on-device — see CLAUDE.md §12.",
            },
            {
              group: ["firebase/*"],
              message: "No Firebase. amban.io has no backend — see CLAUDE.md §12.",
            },
          ],
        },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "window",
          property: "fetch",
          message: "amban.io is local-only — see CLAUDE.md §12.",
        },
        {
          object: "globalThis",
          property: "fetch",
          message: "amban.io is local-only — see CLAUDE.md §12.",
        },
        {
          object: "navigator",
          property: "sendBeacon",
          message: "amban.io never phones home — see CLAUDE.md §12.",
        },
      ],

      // ----------------------------------------------------------------
      // General correctness
      // ----------------------------------------------------------------
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-debugger": "error",
      "no-alert": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      curly: ["error", "multi-line"],
    },
  },
  {
    // SQL-migration-adjacent helpers and anywhere we legitimately need
    // looser rules can extend these overrides later. For now, nothing
    // in src/ is exempt — that's the point.
  },
);
