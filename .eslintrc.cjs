/**
 * Repo lint enforcement (ch02 §2.9). Three rule families:
 *  1. Repo boundaries (FIXED-1): web/↛api/, api/↛web/, shared/↛either.
 *  2. Egress chokepoint (FIXED-3/8/13): only api/src/llm/** may import @anthropic-ai/*.
 *  3. Module direction (ch02 §2.7): nothing imports routes/ or server.ts; routes/↛data/.
 */
const path = require('path');

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
  ignorePatterns: ['**/dist/**', '**/node_modules/**', '**/*.js', '**/*.cjs', '**/*.mjs', 'web/.next/**'],
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
                  './api/src/events',
                  './api/src/agents',
                  './api/src/apps',
                  './api/src/automation',
                  './api/src/legal',
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
    {
      files: ['api/src/**/*.ts', 'api/src/**/*.tsx'],
      rules: {
        'no-restricted-imports': [
          'error',
          { patterns: ['@anthropic-ai/*'] },
        ],
      },
    },
    // …with a single override lifting the ban for api/src/llm/**.
    {
      files: ['api/src/llm/**/*.ts', 'api/src/llm/**/*.tsx'],
      rules: { 'no-restricted-imports': 'off' },
    },
  ],
};
