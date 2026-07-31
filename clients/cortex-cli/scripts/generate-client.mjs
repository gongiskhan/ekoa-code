#!/usr/bin/env node
/**
 * Generate the typed client from the committed public contract.
 *
 * INPUT  docs/openapi/cortex.v1.json  (itself GENERATED from the shared/ descriptor maps by
 *        api/scripts/generate-openapi.mjs and pinned by api/tests/contract/openapi-drift.test.ts)
 * OUTPUT src/generated/cortex-v1.d.ts  - the TYPES, via `openapi-typescript` (OpenAPI 3.1 aware).
 *        src/generated/operations.ts   - the RUNTIME table the wrapper needs and a .d.ts cannot
 *                                        carry: method, path template, declared success statuses
 *                                        IN ORDER, response kind/media type, per-operation timeout.
 *
 * Both files are committed and never hand-edited: `npm run check:drift --workspace @ekoa/cortex-cli`
 * regenerates them into a scratch dir and diffs, so a `shared/` change that reached the spec but not
 * the client fails the build.
 *
 * The per-operation facts come from the spec's `x-ekoa-*` extensions - the generator holds no
 * per-endpoint knowledge, exactly as the OpenAPI generator upstream of it holds none.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const repoRoot = resolve(pkgRoot, '..', '..');
export const SPEC_PATH = join(repoRoot, 'docs', 'openapi', 'cortex.v1.json');

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/** The wrapper's fallback when the descriptor declares no `x-ekoa-timeout-ms`. */
const DEFAULT_TIMEOUT_MS = 30_000;

const BANNER = [
  '/**',
  ' * GENERATED FILE - DO NOT EDIT.',
  ' *',
  ' * Source: docs/openapi/cortex.v1.json (the public Cortex Capability API contract).',
  ' * Regenerate: npm run generate --workspace @ekoa/cortex-cli',
  ' * Verify:     npm run gate:client-drift (root)',
  ' */',
  '',
].join('\n');

/** Read the spec, tolerating nothing: a malformed or non-3.1 document must fail loudly. */
export function readSpec() {
  const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8'));
  if (!String(spec.openapi ?? '').startsWith('3.1')) {
    throw new Error(`${SPEC_PATH} is not an OpenAPI 3.1 document (openapi: ${spec.openapi})`);
  }
  return spec;
}

/** The operation table, derived ONLY from spec fields + x-ekoa-* extensions. */
export function operationTable(spec) {
  const rows = [];
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op) continue;
      const id = op.operationId;
      if (!id) throw new Error(`${method.toUpperCase()} ${path} has no operationId`);

      const declared = op['x-ekoa-success-statuses'];
      const successStatuses = Array.isArray(declared)
        ? declared.map(Number)
        : Object.keys(op.responses ?? {}).map(Number).filter((s) => s >= 200 && s < 300);
      if (successStatuses.length === 0) throw new Error(`${id} declares no success status`);

      const primary = op.responses?.[String(successStatuses[0])];
      const mediaTypes = Object.keys(primary?.content ?? {});
      if (mediaTypes.length !== 1) {
        throw new Error(`${id}: expected exactly one response media type, got ${JSON.stringify(mediaTypes)}`);
      }
      const kind = op['x-ekoa-kind'] === 'binary' ? 'binary' : 'json';
      const mediaType = mediaTypes[0];
      if (kind === 'json' && mediaType !== 'application/json') {
        throw new Error(`${id}: a non-binary operation answering ${mediaType} is not something this client models`);
      }

      rows.push({
        id,
        method: method.toUpperCase(),
        path,
        domain: op['x-ekoa-domain'] ?? id.split('.')[0],
        successStatuses,
        kind,
        mediaType,
        timeoutMs: Number(op['x-ekoa-timeout-ms'] ?? DEFAULT_TIMEOUT_MS),
      });
    }
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));
  return rows;
}

/** Render the runtime table as a TypeScript module (deterministic - a diff means real drift). */
export function renderOperationsModule(rows) {
  const entries = rows
    .map(
      (r) =>
        `  '${r.id}': { method: '${r.method}', path: '${r.path}', domain: '${r.domain}',` +
        ` successStatuses: [${r.successStatuses.join(', ')}], kind: '${r.kind}',` +
        ` mediaType: '${r.mediaType}', timeoutMs: ${r.timeoutMs} },`,
    )
    .join('\n');

  return `${BANNER}
/** Facts about one operation that the generated TYPES cannot carry (they are values, not types). */
export interface OperationSpec {
  /** HTTP method, upper case. */
  readonly method: string;
  /** Path template with \`{param}\` placeholders, exactly as the spec declares it. */
  readonly path: string;
  /** \`x-ekoa-domain\`. */
  readonly domain: string;
  /**
   * Declared success statuses IN DECLARED ORDER (\`x-ekoa-success-statuses\`). The FIRST entry is the
   * primary outcome; a later one is a distinct, documented outcome carrying the SAME body schema -
   * \`automations.createRun\` answers 202 for a fresh run and 200 for an idempotent replay, and the
   * status is the only signal telling them apart.
   */
  readonly successStatuses: readonly number[];
  /** \`x-ekoa-kind\`: a \`binary\` response is delivered as bytes, never parsed as JSON. */
  readonly kind: 'json' | 'binary';
  /** Response media type of the primary success status. */
  readonly mediaType: string;
  /** \`x-ekoa-timeout-ms\` where declared, else the client default (${DEFAULT_TIMEOUT_MS} ms). */
  readonly timeoutMs: number;
}

export const OPERATIONS = {
${entries}
} as const satisfies Record<string, OperationSpec>;

/** Every operationId in the contract: \`<domain>.<endpoint>\`. */
export type OperationId = keyof typeof OPERATIONS;

export const OPERATION_IDS = Object.keys(OPERATIONS) as OperationId[];
`;
}

/** Types via openapi-typescript. Returns the file contents (banner + generated source). */
export async function renderTypes(spec) {
  const ast = await openapiTS(spec, { alphabetize: true });
  return `${BANNER}${astToString(ast)}`;
}

/** Generate both artefacts into `outDir` (defaults to the committed src/generated). */
export async function generate(outDir = join(pkgRoot, 'src', 'generated')) {
  const spec = readSpec();
  mkdirSync(outDir, { recursive: true });
  const types = await renderTypes(spec);
  const operations = renderOperationsModule(operationTable(spec));
  writeFileSync(join(outDir, 'cortex-v1.d.ts'), types, 'utf8');
  writeFileSync(join(outDir, 'operations.ts'), operations, 'utf8');
  return { types, operations };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { operations } = await generate();
  const count = (operations.match(/^ {2}'/gm) ?? []).length;
  console.log(`cortex-cli client generated from docs/openapi/cortex.v1.json: ${count} operations`);
}
