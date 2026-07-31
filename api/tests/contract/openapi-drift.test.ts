import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { allEndpointsFlat } from '@ekoa/shared';

/**
 * OpenAPI drift gate (Capability Contract rule 7, slice E6).
 *
 * `docs/openapi/cortex.v1.json` is GENERATED from the `shared/` descriptor maps by
 * `api/scripts/generate-openapi.mjs`. This gate regenerates it IN-PROCESS and diffs against the
 * committed bytes, so the published spec cannot silently fall behind the contract: change a zod
 * schema, add a `user-or-key` endpoint, or flip an auth class, and this test goes red until the
 * document is regenerated and committed.
 *
 * WHAT IT DOES NOT PROVE. Like schema-coverage, this is a CONTRACT-vs-CONTRACT gate: it proves
 * the document equals the descriptor maps, not that a route's real response body matches its
 * schema. The per-domain contract suites (`memvault.test.ts`, `automations.test.ts`,
 * `knowledge.test.ts`) are what verify bodies; `mount-coverage.test.ts` is what verifies mounting.
 *
 * IT MUST NOT PASS VACUOUSLY. A missing, empty, truncated or hand-gutted document has to FAIL,
 * not quietly succeed - hence the anti-vacuity test below, which asserts the committed file is a
 * real 3.1 document with a real operation set before any comparison is trusted.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const GENERATOR_PATH = resolve(REPO_ROOT, 'api', 'scripts', 'generate-openapi.mjs');

/** The public surface, straight from the descriptors - the gate's independent expectation. */
const publicDescriptorKeys = () =>
  allEndpointsFlat()
    .filter((e) => e.auth === 'user-or-key')
    .map((e) => `${e.domain}.${e.name}`)
    .sort();

type OpenApiOperation = {
  operationId: string;
  responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>;
  'x-ekoa-auth'?: string;
};
type OpenApiDocument = {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: { schemas: Record<string, unknown>; securitySchemes: Record<string, { type: string; scheme?: string; description?: string }> };
  security: Array<Record<string, string[]>>;
  tags: Array<{ name: string }>;
};
type Generator = {
  buildOpenApiDocument: () => OpenApiDocument;
  serializeOpenApiDocument: (doc: OpenApiDocument) => string;
  OPENAPI_DOC_ABSOLUTE_PATH: string;
  OPENAPI_DOC_RELATIVE_PATH: string;
  REGENERATE_COMMAND: string;
  PUBLIC_AUTH_CLASS: string;
};

/** Loaded via a computed specifier: the generator is plain `.mjs` with no type declaration. */
let generator: Generator;
let committedText: string;
let committed: OpenApiDocument;

beforeAll(async () => {
  const url = pathToFileURL(GENERATOR_PATH).href;
  generator = (await import(/* @vite-ignore */ url)) as Generator;
  committedText = existsSync(generator.OPENAPI_DOC_ABSOLUTE_PATH)
    ? readFileSync(generator.OPENAPI_DOC_ABSOLUTE_PATH, 'utf8')
    : '';
  committed = committedText.trim() === '' ? ({} as OpenApiDocument) : (JSON.parse(committedText) as OpenApiDocument);
});

const driftMessage = () =>
  [
    `${generator.OPENAPI_DOC_RELATIVE_PATH} is out of date with the shared/ descriptor maps.`,
    '',
    `  FIX:  ${generator.REGENERATE_COMMAND}    (then commit the regenerated file)`,
    '',
    'The document is generated, never hand-edited: it contains exactly the endpoints whose descriptor',
    "carries auth: 'user-or-key'. If this went red because you ADDED or CHANGED such an endpoint,",
    'regenerating IS the whole fix. If it went red because you made a BREAKING change, regenerating is',
    'NOT enough - Capability Contract rule 7 requires a major version bump (a new /api/vN prefix and a',
    'new docs/openapi/cortex.vN.json) plus an explicit migration of every consumer.',
  ].join('\n');

describe('OpenAPI drift gate (docs/openapi/cortex.v1.json vs shared/)', () => {
  it('the committed document exists and is a real OpenAPI 3.1 document (no vacuous pass)', () => {
    expect(
      existsSync(generator.OPENAPI_DOC_ABSOLUTE_PATH),
      `${generator.OPENAPI_DOC_RELATIVE_PATH} is missing. ${generator.REGENERATE_COMMAND}`,
    ).toBe(true);
    expect(committedText.length, 'the committed document is empty or truncated').toBeGreaterThan(2_000);
    expect(committed.openapi).toBe('3.1.0');
    expect(committed.info?.title).toBe('Cortex Capability API');
    expect(committed.info?.version, 'the major mirrors the /api/v1 path prefix').toBe('1.0.0');
    // Floors, not pins: an additive change must land silently (rule 7), so these numbers are
    // deliberately not exact - the byte-equality test below is what catches every real change.
    const operations = Object.values(committed.paths ?? {}).flatMap((item) => Object.keys(item));
    expect(operations.length, 'the committed document has no operations').toBeGreaterThan(20);
    expect(Object.keys(committed.components?.schemas ?? {}).length).toBeGreaterThan(20);
    expect(committed.components?.schemas?.ErrorEnvelope, 'the error envelope component is missing').toBeTruthy();
  });

  it('regenerating in-process reproduces the committed document byte for byte', () => {
    const fresh = generator.serializeOpenApiDocument(generator.buildOpenApiDocument());
    if (fresh === committedText) {
      expect(fresh).toBe(committedText);
      return;
    }
    // Structural diff first: vitest renders it far more usefully than a 4000-line string diff.
    expect(committed, driftMessage()).toEqual(JSON.parse(fresh));
    // Structurally equal but byte-different => key order / indentation / trailing-newline drift.
    expect.fail(`${driftMessage()}\n\n(The document is structurally equal but not byte-identical: serialization drift.)`);
  });

  it('the generator is deterministic (two builds are byte-identical)', () => {
    const first = generator.serializeOpenApiDocument(generator.buildOpenApiDocument());
    const second = generator.serializeOpenApiDocument(generator.buildOpenApiDocument());
    expect(second, 'the generator is not deterministic - the drift gate would be flaky').toBe(first);
  });

  it('documents EXACTLY the user-or-key surface - nothing needing a platform session leaks in', () => {
    const documented = Object.values(committed.paths)
      .flatMap((item) => Object.values(item))
      .map((op) => op.operationId)
      .sort();
    const expected = publicDescriptorKeys();
    expect(expected.length, 'shared/ declares no user-or-key endpoints - the filter rule has nothing to select').toBeGreaterThan(20);
    // Set equality in BOTH directions: a missing capability endpoint is as much a defect as a
    // platform-session endpoint that leaked into the public spec.
    expect(documented, driftMessage()).toEqual(expected);

    const publicKeys = new Set(expected);
    const sessionOnly = allEndpointsFlat()
      .filter((e) => e.auth !== 'user-or-key')
      .map((e) => `${e.domain}.${e.name}`);
    expect(
      sessionOnly.filter((k) => publicKeys.has(k)),
      'an endpoint appears under two auth classes',
    ).toEqual([]);
    expect(
      documented.filter((k) => !publicKeys.has(k)),
      'the spec documents an endpoint that is NOT auth: user-or-key - the filter rule broke',
    ).toEqual([]);
    // The three capability domains this surface is made of must all be represented.
    expect(committed.tags.map((t) => t.name)).toEqual(expect.arrayContaining(['automations', 'knowledge', 'memvault']));
  });

  it('every documented failure response points at the shared error envelope', () => {
    const offenders: string[] = [];
    for (const [path, item] of Object.entries(committed.paths)) {
      for (const [method, op] of Object.entries(item)) {
        expect(op['x-ekoa-auth'], `${op.operationId} must be tagged as the public auth class`).toBe(generator.PUBLIC_AUTH_CLASS);
        const failures = Object.keys(op.responses).filter((status) => Number(status) >= 400);
        if (failures.length < 6) offenders.push(`${method.toUpperCase()} ${path}: only ${failures.length} failure responses`);
        for (const status of failures) {
          const ref = op.responses[status]?.content?.['application/json']?.schema?.$ref;
          if (ref !== '#/components/schemas/ErrorEnvelope') {
            offenders.push(`${method.toUpperCase()} ${path} ${status}: ${ref ?? '(no JSON schema)'}`);
          }
        }
      }
    }
    expect(offenders, 'every non-2xx body is the CONV-2 envelope; the spec must say so').toEqual([]);
  });

  it('the bearer security scheme is declared, applied globally, and names the gateway key', () => {
    const scheme = committed.components.securitySchemes.gatewayKey;
    expect(scheme?.type).toBe('http');
    expect(scheme?.scheme).toBe('bearer');
    expect(scheme?.description).toContain('ekoa_gk_');
    // Rule 4's other half: a platform JWT is accepted too, and the spec must not hide it.
    expect(scheme?.description).toContain('JWT');
    expect(committed.security).toEqual([{ gatewayKey: [] }]);
  });

  it('every $ref in the committed document resolves to a declared component', () => {
    const dangling: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== 'object') return;
      const ref = (node as { $ref?: unknown }).$ref;
      if (typeof ref === 'string') {
        const name = /^#\/components\/schemas\/([^/]+)(\/.*)?$/.exec(ref)?.[1];
        if (!name || !(name in committed.components.schemas)) dangling.push(ref);
      }
      Object.values(node).forEach(walk);
    };
    walk(committed);
    expect([...new Set(dangling)], 'a $ref points at a component that does not exist').toEqual([]);
  });
});
