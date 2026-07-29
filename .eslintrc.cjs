/**
 * Repo lint enforcement (ch02 §2.9). Three rule families:
 *  1. Repo boundaries (FIXED-1): web/↛api/, api/↛web/, shared/↛either.
 *  2. Egress chokepoint (FIXED-3/8/13): only api/src/llm/** may import @anthropic-ai/*.
 *  3. Module direction (ch02 §2.7): nothing imports routes/ or server.ts; routes/↛data/.
 */
const path = require('path');

const ANTHROPIC_BAN = {
  group: ['@anthropic-ai/*'],
  message: 'Only api/src/llm/ may import an Anthropic SDK (FIXED-3/8/13 — the egress chokepoint).',
};

const COFRE_STORE_BAN = {
  group: ['**/cofre/store', '**/cofre/store.js'],
  message:
    'The Cofre item/grant stores are reachable only through api/src/cofre/ (B-1). Use the module entry — unwrap(), mintCofreItem(), issueGrant() — never the raw store handle.',
};

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint', 'import'],
  extends: ['eslint:recommended'],
  env: { node: true, es2022: true },
  settings: {
    'import/resolver': { typescript: { alwaysTryTypes: true } },
  },
  ignorePatterns: [
    '**/dist/**',
    '**/node_modules/**',
    '**/*.js',
    '**/*.cjs',
    '**/*.mjs',
    // web/ is a Next.js app with its own flat config (web/eslint.config.mjs: next + react-hooks
    // plugins this legacy-eslintrc config does not load). It self-lints via `npm run lint
    // --workspace web` (root `lint` script), which also enforces the web->api FIXED-1 boundary
    // there. The root config keeps api->web and shared->web (those files are still linted here).
    'web/**',
    'web/.next/**',
    // Data trees, not platform source: app scaffold templates and the versioned
    // featured-artifact scaffolds (user-app JSX built by the apps/ pipeline, ch07).
    'api/assets/**',
  ],
  overrides: [
    {
      files: ['**/*.ts', '**/*.tsx'],
      rules: {
        // TypeScript handles these; the core JS rules misfire on TS syntax
        // (the idiomatic zod `const X` + `type X = z.infer<typeof X>` merge, ambient types).
        'no-unused-vars': 'off',
        '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        // Disabled: the idiomatic zod `const X = z.object(...)` + `type X = z.infer<typeof X>`
        // pattern is a safe value+type merge TypeScript allows, but no-redeclare (core AND
        // typescript-eslint, whose declaration-merge exemption doesn't cover value+type)
        // both misfire on it. The load-bearing rules here are the import-boundary/chokepoint
        // zones, not redeclare.
        'no-redeclare': 'off',
        'no-undef': 'off',
      },
    },
    // Rule 1 + 3: repo boundary + module-direction zones.
    {
      files: ['**/*.ts', '**/*.tsx'],
      rules: {
        'import/no-restricted-paths': [
          'error',
          {
            zones: [
              // Rule 1 — repo boundaries (FIXED-1)
              { target: './web', from: './api', message: 'web/ must not import from api/ (FIXED-1).' },
              { target: './api', from: './web', message: 'api/ must not import from web/ (FIXED-1).' },
              { target: './shared', from: './api', message: 'shared/ must not import from api/ (FIXED-1).' },
              { target: './shared', from: './web', message: 'shared/ must not import from web/ (FIXED-1).' },
              // Rule 3 — module direction (ch02 §2.7): nothing imports routes/ or server.ts
              // (server.ts is the composition root — it imports everything, nothing imports it);
              // routes/ must not import data/ directly.
              //
              // `import/no-restricted-paths` resolves `except` relative to `from`, so it cannot
              // exempt "the target dir importing itself". Instead we target everything EXCEPT
              // routes/ and server.ts as the importer, so an intra-routes import and server.ts's
              // own imports are simply not in the target set and never flagged.
              {
                target: [
                  './api/src/data',
                  './api/src/auth',
                  './api/src/billing',
                  './api/src/content',
                  './api/src/llm',
                  './api/src/services',
                  './api/src/integrations',
                  './api/src/memory',
                  './api/src/knowledge',
                  './api/src/bridge',
                  './api/src/streaming',
                  './api/src/voice',
                  './api/src/events',
                  './api/src/agents',
                  './api/src/apps',
                  './api/src/automation',
                  './api/src/legal',
                  './api/src/security',
                  './api/src/cofre',
                ],
                from: ['./api/src/routes', './api/src/server.ts'],
                message: 'Nothing may import api/src/routes/ or server.ts (ch02 §2.7 — they are leaves-in-reverse).',
              },
              {
                target: './api/src/routes',
                from: './api/src/data',
                message: 'routes/ must not import data/ directly — go through a domain module (ch02 §2.7).',
              },
            ],
          },
        ],
      },
    },
    // Rule 2 — egress chokepoint (FIXED-3/8/13): ban @anthropic-ai/* everywhere in api/src
    // (.ts AND .tsx; the grep gate additionally covers .js/.mjs and split-string evasion)…
    //
    // Rule 4 — the Cofre store is reachable ONLY through api/src/cofre/ (Cofre B-1). The Cofre is
    // the third consumer of the scoped repository, and unlike the ~52 hand-written filter sites it
    // must be reachable only through it: `cofre/store.ts` wraps the raw handles in
    // `OwnerVisibilityScoped` and every product read goes through `unwrap()`. A second importer
    // reaching past that — even a well-meaning one re-deriving the scoping predicate — turns one
    // auditable chokepoint into two, which is the drift `apps/app-paths.ts` already demonstrates
    // elsewhere in this repo. B-1 specified this rule and it was never added (found by the A-8
    // sweep, logged as `cofre-raw-store-lint-rule-missing`).
    //
    // BOTH bans live in ONE override per file set, deliberately. `no-restricted-imports` can be
    // configured only once for a given file — a second override targeting the same files REPLACES
    // the first rather than merging, so expressing these as two independent overrides silently
    // disabled whichever lost. (That is exactly what the first attempt at Rule 4 did: it wiped the
    // @anthropic-ai ban for every non-llm api/src file while appearing to add a rule.) The two
    // exemptions below therefore RESTATE the ban they keep instead of switching the rule off.
    {
      files: ['api/src/**/*.ts', 'api/src/**/*.tsx'],
      rules: {
        'no-restricted-imports': ['error', { patterns: [ANTHROPIC_BAN, COFRE_STORE_BAN] }],
      },
    },
    // …lifting the ANTHROPIC ban for api/src/llm/** (the one module that may hold the client),
    // while keeping the Cofre-store ban: llm/ has no business reaching the credential store either.
    {
      files: ['api/src/llm/**/*.ts', 'api/src/llm/**/*.tsx'],
      rules: { 'no-restricted-imports': ['error', { patterns: [COFRE_STORE_BAN] }] },
    },
    // …and lifting the COFRE-STORE ban inside api/src/cofre/** (the module that owns it), while
    // keeping the anthropic ban.
    {
      files: ['api/src/cofre/**/*.ts', 'api/src/cofre/**/*.tsx'],
      rules: { 'no-restricted-imports': ['error', { patterns: [ANTHROPIC_BAN] }] },
    },
    // api/scripts/** is outside the api/src file sets above, so a migration — which rewrites every
    // tenant's rows and therefore cannot go through an owner-scoped repository — reaches the raw
    // handle legitimately. It is exported under a deliberately ugly name so that exception stays
    // greppable rather than looking ordinary.
  ],
};
