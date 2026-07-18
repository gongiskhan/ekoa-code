import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // FIXED-1 boundary (belt-and-braces; the root .eslintrc.cjs owns api/shared): web/ imports
    // shared + its own tree only, never api/. A relative reach into ../api is the only path and is
    // banned here since web self-lints (the root config ignores web/**).
    rules: {
      "no-restricted-imports": [
        "error",
        {
          // The sibling api/ is reachable only by a relative escape into its source or dist (web's
          // OWN client is `@/lib/api`, which has no src/dist subdir, so it is never matched). Catches
          // deep escapes (../../../api/src/x) at any depth without false-positiving on `@/lib/api`.
          patterns: [
            { group: ["**/api/src", "**/api/src/**", "**/api/dist", "**/api/dist/**", "@ekoa/api", "@ekoa/api/**"], message: "web/ must not import from api/ (FIXED-1)." },
          ],
        },
      ],
      // FIXED-9 (migrate, do not rewrite): the frontend is ported source-level unchanged. The old
      // app carried these as pervasive, non-gating findings (134 in the original tree); downgrade
      // them to WARN so the gate passes without editing migrated behavior, while they stay visible
      // for incremental cleanup.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "@next/next/no-img-element": "warn",
      // The eslint-plugin-react-hooks v6 (React Compiler) diagnostics - inherited across the ported
      // tree; WARN per FIXED-9 (the original app carried them non-gating).
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/static-components": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-gate/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored Monaco AMD tree (scripts/copy-monaco.mjs) - third-party minified assets.
    "public/monaco/**",
    // Vendored voice VAD assets (scripts/copy-voice-assets.mjs) - third-party minified/wasm.
    "public/voice/vendor/**",
  ]),
]);

export default eslintConfig;
