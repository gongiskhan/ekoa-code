#!/usr/bin/env node
/**
 * Post-build: copy the generated `.d.ts` into dist/.
 *
 * tsc treats a `.d.ts` input as a declaration it does not need to re-emit, so `src/generated/
 * cortex-v1.d.ts` never reaches `dist/generated/`, and the emitted `dist/client.d.ts` would import
 * a file that is not there. Copying it keeps dist/ self-consistent for anything that reads the
 * published types.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(pkgRoot, 'dist', 'generated'), { recursive: true });
copyFileSync(join(pkgRoot, 'src', 'generated', 'cortex-v1.d.ts'), join(pkgRoot, 'dist', 'generated', 'cortex-v1.d.ts'));
