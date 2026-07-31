import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { allEndpointsFlat, KnowledgeSegment, type EndpointDescriptor } from '@ekoa/shared';

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
 * IT MUST NOT PASS VACUOUSLY, AND IT MUST NOT BE FED A CONTAMINATED BUILD. A missing, empty or
 * hand-gutted document has to FAIL (the anti-vacuity test), and a `shared/dist` older than
 * `shared/src` has to FAIL before any comparison is trusted (the freshness test) - because the
 * generator and this test both read the GITIGNORED build output, not the source. That is how the
 * first committed document came to advertise a schema no committed source backed (review F1/F7).
 *
 * KNOWN LIMIT of the freshness test, stated rather than hidden: it catches a STALE dist (a source
 * newer than its build output). It cannot catch a dist built correctly from UNCOMMITTED source -
 * that is a legitimate mid-work state, so failing on it would block the normal edit-build-test
 * loop. The proof against THAT is procedural: regenerate and re-verify from a pristine checkout
 * of HEAD before the document is committed.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const GENERATOR_PATH = resolve(REPO_ROOT, 'api', 'scripts', 'generate-openapi.mjs');

/** The public surface, straight from the descriptors - the gate's independent expectation. */
const publicDescriptors = (): Array<EndpointDescriptor & { domain: string; name: string }> =>
  allEndpointsFlat()
    .filter((e) => e.auth === 'user-or-key')
    .sort((a, b) => `${a.domain}.${a.name}`.localeCompare(`${b.domain}.${b.name}`, 'en')) as Array<
    EndpointDescriptor & { domain: string; name: string }
  >;
const publicDescriptorKeys = () => publicDescriptors().map((e) => `${e.domain}.${e.name}`);

type OpenApiOperation = {
  operationId: string;
  parameters?: Array<{ name: string; in: string; required?: boolean; schema?: Record<string, unknown> }>;
  requestBody?: { content: Record<string, unknown> };
  responses: Record<string, { description: string; content?: Record<string, { schema?: { $ref?: string } }> }>;
  'x-ekoa-auth'?: string;
  'x-ekoa-kind'?: string;
  'x-ekoa-success-statuses'?: number[];
};
type OpenApiDocument = {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: {
    schemas: Record<string, Record<string, unknown>>;
    securitySchemes: Record<string, { type: string; scheme?: string; description?: string }>;
  };
  security: Array<Record<string, string[]>>;
  tags: Array<{ name: string }>;
};
type Generator = {
  buildOpenApiDocument: () => OpenApiDocument;
  serializeOpenApiDocument: (doc: OpenApiDocument) => string;
  convertSchema: (
    componentName: string,
    zodSchema: unknown,
    enqueue: (n: string) => string,
    nameByDef: Map<unknown, string>,
  ) => Record<string, unknown>;
  REFINEMENT_ENCODINGS: Record<string, Record<string, unknown>>;
  OPENAPI_DOC_ABSOLUTE_PATH: string;
  OPENAPI_DOC_RELATIVE_PATH: string;
  REGENERATE_COMMAND: string;
  PUBLIC_AUTH_CLASS: string;
};

/** Loaded via a computed specifier: the generator is plain `.mjs` with no type declaration. */
let generator: Generator;
let committedText: string;
let committed: OpenApiDocument;

/** Every documented operation, flattened. */
const operationsOf = (doc: OpenApiDocument) =>
  Object.entries(doc.paths).flatMap(([path, item]) => Object.entries(item).map(([method, op]) => ({ path, method, op })));
const operationById = (doc: OpenApiDocument, id: string) => operationsOf(doc).find((o) => o.op.operationId === id);

/**
 * Is the built `shared/` package current with `shared/src`? The generator and this test both
 * import the BUILT package, so a stale build makes the whole gate compare the committed spec
 * against a contract nobody is looking at (review F7).
 *
 * The authority is TypeScript's OWN incremental answer (`tsc -b --dry`), not a hand-rolled mtime
 * comparison, and it distinguishes three states where mtimes see only two:
 *
 *   "Project ... is up to date"                      -> fresh.
 *   "would update timestamps for output of project"  -> a source was TOUCHED but its content is
 *                                                       unchanged, so the emitted JS is correct.
 *   "would build project ..."                        -> content changed and dist is genuinely
 *                                                       stale. THIS is the failure.
 *
 * That middle state is why the mtime version was wrong: a branch switch, a `cp`, or a
 * save-with-no-edit bumps mtimes, and `tsc -b` then refuses to re-emit because the content hashes
 * in `tsconfig.tsbuildinfo` still match - so a raw mtime check would cry stale AND hand the
 * developer a rebuild command that cannot clear it. Verified empirically both ways.
 */
function sharedBuildStaleness(): { stale: boolean; detail: string } {
  const tsc = join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!existsSync(tsc)) return { stale: true, detail: `cannot check: ${tsc} not found` };
  const run = spawnSync(process.execPath, [tsc, '-b', join(REPO_ROOT, 'shared', 'tsconfig.json'), '--dry'], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
  });
  const detail = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim();
  if (run.status !== 0) return { stale: true, detail: `tsc -b --dry exited ${run.status}:\n${detail}` };
  const benign = /is up to date/i.test(detail) || /would update timestamps/i.test(detail);
  // Fail CLOSED on an unrecognised message rather than reading silence as freshness.
  return { stale: !benign, detail };
}

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
    `  FIX:  npm run build --workspace shared && ${generator.REGENERATE_COMMAND}   (then commit the regenerated file)`,
    '',
    'The document is generated, never hand-edited. Regenerating makes this test green, but green is',
    'not the same as correct - check WHAT changed before committing it. A new endpoint or a new',
    'optional field is additive and lands silently (rule 7). A removed or renamed endpoint, a removed',
    'or renamed component, a narrowed type or a new required field is BREAKING: it needs a major',
    'version bump (a new /api/vN prefix and its own docs/openapi/cortex.vN.json) plus an explicit',
    'migration of every consumer, and regenerating alone would publish the break silently.',
  ].join('\n');

describe('OpenAPI drift gate (docs/openapi/cortex.v1.json vs shared/)', () => {
  it('the built shared/ package is not stale (this gate reads dist, not src)', () => {
    const { stale, detail } = sharedBuildStaleness();
    expect(
      stale,
      [
        'shared/dist is out of date with shared/src, so every check below would compare the committed',
        'OpenAPI document against a contract that no longer exists.',
        '',
        '  FIX:  npm run build --workspace shared',
        '',
        `tsc -b --dry said: ${detail}`,
      ].join('\n'),
    ).toBe(false);
    // Also assert the built entry point is actually there: "up to date" for a project with no
    // emit configured would otherwise read as freshness.
    expect(existsSync(join(REPO_ROOT, 'shared', 'dist', 'index.js')), 'shared/dist/index.js is missing').toBe(true);
  });

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
    expect(operationsOf(committed).length, 'the committed document has no operations').toBeGreaterThan(20);
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
    const documented = operationsOf(committed).map((o) => o.op.operationId).sort();
    const expected = publicDescriptorKeys();
    expect(expected.length, 'shared/ declares no user-or-key endpoints - the filter rule has nothing to select').toBeGreaterThan(20);
    // Set equality in BOTH directions: a missing capability endpoint is as much a defect as a
    // platform-session endpoint that leaked into the public spec.
    expect(documented, driftMessage()).toEqual(expected);

    const publicKeys = new Set(expected);
    expect(
      allEndpointsFlat()
        .filter((e) => e.auth !== 'user-or-key')
        .map((e) => `${e.domain}.${e.name}`)
        .filter((k) => publicKeys.has(k)),
      'an endpoint appears under two auth classes',
    ).toEqual([]);
    expect(
      documented.filter((k) => !publicKeys.has(k)),
      'the spec documents an endpoint that is NOT auth: user-or-key - the filter rule broke',
    ).toEqual([]);
    expect(committed.tags.map((t) => t.name)).toEqual(expect.arrayContaining(['automations', 'knowledge', 'memvault']));
  });

  /**
   * Review F5. A component NAME is public API - it is the type name in every generated client -
   * but the name is chosen by a tie-break over `shared/` export aliases, so merely ADDING an
   * export can rename an existing component. The byte-drift test above goes red for that, but its
   * remedy is "regenerate", which is exactly the wrong instruction for a break. This test
   * separates the two: a DISAPPEARING component name is breaking; a new one is additive.
   */
  it('no public component NAME disappeared - a rename or removal is BREAKING, not additive', () => {
    const freshNames = Object.keys(generator.buildOpenApiDocument().components.schemas);
    const committedNames = Object.keys(committed.components.schemas);
    const removed = committedNames.filter((n) => !freshNames.includes(n)).sort();
    const added = freshNames.filter((n) => !committedNames.includes(n)).sort();
    expect(
      removed,
      [
        'A published component name is GONE from the regenerated document:',
        `  removed: ${removed.join(', ') || '(none)'}`,
        `  added:   ${added.join(', ') || '(none)'}`,
        '',
        'Under Capability Contract rule 7 that is a BREAKING change, not additive growth, and',
        'regenerating the document is NOT the fix - every generated client loses or renames a type.',
        'The usual cause is not an intentional rename: adding a `shared/` export that ALIASES an',
        'existing schema can win the shortest-name tie-break and silently rename its component',
        '(see buildNameRegistry in api/scripts/generate-openapi.mjs). Either drop the alias, or take',
        'the break deliberately with a major version bump and a migration of every consumer.',
      ].join('\n'),
    ).toEqual([]);
  });

  /**
   * Review F2. `automations.createRun` answers 202 for a started run and 200 for an idempotent
   * replay of the same runId, and the STATUS is the only signal separating them. A spec that
   * documented only 200 made replay detection ungenerateable, and typed a real 202 into neither
   * `data` nor `error`.
   */
  it('every declared successStatus is documented (F2: 201 on create, 202-or-200 on run create)', () => {
    const offenders: string[] = [];
    for (const d of publicDescriptors()) {
      const key = `${d.domain}.${d.name}`;
      const found = operationById(committed, key);
      if (!found) {
        offenders.push(`${key}: not documented at all`);
        continue;
      }
      const declared = (d.successStatus === undefined ? [200] : [d.successStatus].flat()).map(String);
      const documentedSuccess = Object.keys(found.op.responses).filter((s) => Number(s) < 300).sort();
      if (documentedSuccess.join(',') !== [...declared].sort().join(',')) {
        offenders.push(`${key}: descriptor declares [${declared}], spec documents [${documentedSuccess}]`);
      }
      if (declared.length > 1 && String(found.op['x-ekoa-success-statuses']) !== String(d.successStatus)) {
        offenders.push(`${key}: x-ekoa-success-statuses does not preserve the declared order`);
      }
    }
    expect(offenders, 'a success status the contract declares is missing from the spec').toEqual([]);

    // The concrete cases the finding was about, pinned by name so a silent revert cannot pass.
    const create = operationById(committed, 'automations.create')!.op;
    expect(Object.keys(create.responses)).toContain('201');
    expect(Object.keys(create.responses)).not.toContain('200');
    const createRun = operationById(committed, 'automations.createRun')!.op;
    expect(Object.keys(createRun.responses), 'the replay signal needs BOTH statuses').toEqual(
      expect.arrayContaining(['200', '202']),
    );
    expect(createRun['x-ekoa-success-statuses']).toEqual([202, 200]);
    // Identical body schema on both, or the status is not a clean discriminator.
    expect(createRun.responses['202']?.content?.['application/json']?.schema).toEqual(
      createRun.responses['200']?.content?.['application/json']?.schema,
    );
    expect(createRun.responses['200']?.description).toMatch(/status code is the discriminator/i);
  });

  /**
   * Review F3. 400 must follow "the descriptor declares a validated input" - body, query OR path
   * params, since `knowledge.readKnowledgeDoc` safeParses its segments and 400s on a bad one - and
   * 413 must follow "the descriptor accepts a body", because one global
   * `express.json({limit:'1mb'})` covers every route in this document.
   */
  it('400 wherever an input is validated and 413 wherever a body is accepted (F3)', () => {
    const offenders: string[] = [];
    for (const d of publicDescriptors()) {
      const key = `${d.domain}.${d.name}`;
      const responses = operationById(committed, key)!.op.responses;
      const expects400 = Boolean(d.request || d.query || d.params);
      if ('400' in responses !== expects400) {
        offenders.push(
          `${key}: 400 ${'400' in responses ? 'documented' : 'missing'}, but request/query/params ${expects400 ? 'exist' : 'do not'}`,
        );
      }
      const expects413 = Boolean(d.request);
      if ('413' in responses !== expects413) {
        offenders.push(
          `${key}: 413 ${'413' in responses ? 'documented' : 'missing'}, but a request body ${expects413 ? 'is' : 'is not'} accepted`,
        );
      }
    }
    expect(offenders, 'the documented failure set does not follow the descriptor').toEqual([]);

    // The two concrete cases: a path-param-only 400, and a 413 reachable FROM the spec.
    expect(Object.keys(operationById(committed, 'knowledge.readKnowledgeDoc')!.op.responses)).toContain('400');
    const writeNote = operationById(committed, 'memvault.writeNote')!.op;
    expect(Object.keys(writeNote.responses)).toContain('413');
    // The character-vs-byte trap is WHY 413 is reachable from a spec-valid body; the description
    // has to say so, or a client author will not believe the status can occur.
    expect(writeNote.responses['413']?.description).toMatch(/BYTE limit[\s\S]*CHARACTERS/);
    expect(
      Object.keys(operationById(committed, 'memvault.exportVault')!.op.responses),
      'a GET with no body cannot 413',
    ).not.toContain('413');
  });

  /**
   * Review F4. `.refine()` is invisible to the JSON Schema conversion, so a refined constraint
   * silently WIDENS the published contract. `KnowledgeSegment` refuses '.' and '..' after its
   * regex - and the regex itself admits both.
   */
  it('a dropped zod refinement cannot silently widen the spec (F4)', () => {
    const segment = committed.components.schemas.KnowledgeSegment;
    expect(segment, 'KnowledgeSegment must be a published component').toBeTruthy();
    expect(segment?.pattern).toBe('^[a-zA-Z0-9._-]{1,100}$');
    expect(segment?.not, "the '.' / '..' refusal must survive into the spec").toEqual({ enum: ['.', '..'] });
    expect(generator.REFINEMENT_ENCODINGS.KnowledgeSegment).toEqual({ not: { enum: ['.', '..'] } });
    // The published pattern alone is not enough - prove the encoding is what excludes them.
    expect(new RegExp(segment?.pattern as string).test('..'), 'the regex alone admits ".."').toBe(true);

    // FAIL-CLOSED: the same refined schema under a name the table does not know must THROW rather
    // than convert quietly. This is what stops a future .refine() from widening the contract.
    expect(() =>
      generator.convertSchema('AnUnregisteredRefinedSchema', KnowledgeSegment, (n: string) => n, new Map()),
    ).toThrow(/refine|effect/i);
  });

  /**
   * Review F6. "Opaque bytes" is not a media type. The first document guessed
   * `application/octet-stream` while the route sends `application/x-tar`.
   */
  it('a binary response declares the media type the contract states (F6)', () => {
    const binaries = publicDescriptors().filter((e) => e.kind === 'binary');
    expect(binaries.length, 'no binary endpoint left to check - this test would be vacuous').toBeGreaterThan(0);
    for (const d of binaries) {
      const key = `${d.domain}.${d.name}`;
      expect(d.mediaType, `${key}: kind:'binary' must declare a mediaType`).toBeTruthy();
      const success = operationById(committed, key)!.op.responses['200']!;
      expect(Object.keys(success.content ?? {}), `${key}: the documented media type must be the declared one`).toEqual([
        d.mediaType,
      ]);
    }
    const exportOp = operationById(committed, 'memvault.exportVault')!.op;
    expect(Object.keys(exportOp.responses['200']!.content ?? {})).toEqual(['application/x-tar']);
  });

  it('every documented failure response points at the shared error envelope', () => {
    const offenders: string[] = [];
    for (const { path, method, op } of operationsOf(committed)) {
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
