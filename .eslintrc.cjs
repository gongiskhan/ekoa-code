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
    // …EXCEPT the consumer packages' shipped .mjs: clients/*/bin holds the executable shim and
    // clients/*/scripts the client generator + drift gate. They are ordinary source, and the
    // consumer boundary zone below must be able to fire on them - an ignored file makes a zone
    // that names it dead configuration, which is worse than no zone at all.
    '!clients/*/bin/*.mjs',
    '!clients/*/scripts/*.mjs',
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
    // Rule 1 + 3: repo boundary + module-direction zones. Applied to the consumer packages'
    // .mjs (bin/ shim, scripts/ generator) as well as TypeScript, so the clients/ zones below
    // cover every shipped file rather than only the ones that happen to end in .ts.
    {
      files: ['**/*.ts', '**/*.tsx', 'clients/*/bin/*.mjs', 'clients/*/scripts/*.mjs'],
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
              // Rule 1 (extension) — generated API CONSUMERS (clients/*). A consumer is an
              // ordinary API client: it may reach shared/ (the contract) and its own generated
              // client, and NOTHING else in this repo. Reaching into api/ would make the CLI a
              // second implementation of a capability instead of a caller of one (Capability
              // Contract rule 1), and would silently couple a shipped binary to server internals.
              // Targeted at everything SHIPPED - src/ (TypeScript), bin/ (the executable shim) and
              // scripts/ (the client generator + drift gate), the last two being .mjs and
              // un-ignored above precisely so these zones can fire on them. clients/*/tests is the
              // one carve-out: a dev-only harness that boots the provider in-process, the same
              // shape that lets api/tests import server.ts under the module-direction zone below.
              { target: ['./clients/*/src/**', './clients/*/bin/**', './clients/*/scripts/**'], from: './api', message: 'clients/ must not import from api/ — a consumer is an API client, not a second implementation (Capability Contract rule 1).' },
              { target: ['./clients/*/src/**', './clients/*/bin/**', './clients/*/scripts/**'], from: './web', message: 'clients/ must not import from web/ — a consumer talks to the public API, not to the dashboard.' },
              // …and nothing in the platform may depend on a consumer.
              { target: './api', from: './clients', message: 'api/ must not import from clients/ — the dependency runs one way, provider to contract to consumer.' },
              // NOTE: web/** is in ignorePatterns (web self-lints), so a zone targeting it here
              // can never fire. The real enforcement of web -> clients lives in
              // web/eslint.config.mjs; this entry is kept only so the four-edge intent is
              // readable in one place, and is deliberately NOT counted as a working gate.
              { target: './web', from: './clients', message: 'web/ must not import from clients/ — the dashboard is not a consumer of the CLI. (Enforced by web/eslint.config.mjs; this zone cannot fire.)' },
              { target: './shared', from: './clients', message: 'shared/ must not import from clients/ — the contract depends on nothing.' },
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
              // Rule 3 (extension, slice D2) — the ONE tier-5 sibling edge runs one way.
              // automation/planner.ts imports the shared authoring core
              // (agents/integration-agent.ts); agents/ importing automation/ back would close a
              // cycle inside tier 5, which the tier table (docs/architecture.md) declares acyclic
              // by construction. Direction is the whole safety argument, so it is lint-enforced
              // rather than left as a convention a future slice can quietly reverse.
              {
                target: './api/src/agents',
                from: './api/src/automation',
                message: 'agents/ must not import automation/ — the tier-5 authoring edge runs ONE way (automation/ -> agents/integration-agent.ts).',
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
