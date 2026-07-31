#!/usr/bin/env node
/**
 * OpenAPI generator for the Cortex PUBLIC CAPABILITY SURFACE (slice E6).
 *
 * ---------------------------------------------------------------------------
 * WHAT GOES IN THE DOCUMENT - the one filter rule
 * ---------------------------------------------------------------------------
 * An endpoint belongs in the public spec IFF its `shared/` descriptor carries
 * `auth: 'user-or-key'`. Nothing else. There is no allowlist, no per-domain
 * opt-in, no hand-maintained inventory - which is the point: the document is
 * DEFINITIONALLY equal to the key-accepting surface (Capability Contract rule 4),
 * so it cannot drift away from it. Flip a descriptor to `user-or-key` and it
 * appears here; flip it back and it disappears.
 *
 * The corollary matters just as much: anything that requires a platform session
 * (`user`, `org-admin`, `super-admin`, `token-query`, `hmac`, ...) is ABSENT by
 * construction, not by omission. The spec is what an outside client holding an
 * `ekoa_gk_` key can actually reach.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT READS
 * ---------------------------------------------------------------------------
 * The CONTRACT only: the built `@ekoa/shared` package (descriptor maps + zod
 * schemas). It never imports `api/src` - the implementation is not an input, so
 * this document cannot accidentally describe a mounted route the contract does
 * not declare, nor inherit a runtime detail the contract does not carry.
 *
 * ---------------------------------------------------------------------------
 * DIALECT - why OpenAPI 3.1.0 with zod-to-json-schema's `jsonSchema7` target
 * ---------------------------------------------------------------------------
 * OpenAPI 3.1's schema dialect IS JSON Schema 2020-12. zod-to-json-schema's
 * `openApi3` target emits the OpenAPI *3.0* dialect, which is not a subset of it:
 * it renders exclusive bounds as `minimum` + `exclusiveMinimum: true` (2020-12
 * requires a NUMBER there) and renders a null branch as
 * `{"enum":["null"],"nullable":true}` - which literally admits the STRING "null"
 * and uses a keyword 3.1 removed. Both occur on this surface (`.positive()` on the
 * paging limits; the `null` arm of `JsonValue` inside the error envelope), so
 * `openApi3` would have produced a silently-wrong 3.1 document.
 *
 * The `jsonSchema7` target, on this surface, emits only keywords that are valid
 * and identically-meaning in 2020-12 (`type`, `properties`, `required`, `items`,
 * `enum`, `const`, `anyOf`, `additionalProperties`, `pattern`, numeric
 * `exclusiveMinimum`, `format: "date-time"`, `$ref`). The draft-7-only constructs
 * that would break it (`definitions`, `dependencies`, tuple `items: []`,
 * `additionalItems`, `nullable`) do not occur today and are asserted absent by
 * `assertDialectIs2020_12Compatible` - if a future `shared/` schema introduces one,
 * the generator fails loudly instead of emitting an invalid document.
 *
 * ---------------------------------------------------------------------------
 * DETERMINISM
 * ---------------------------------------------------------------------------
 * Two runs must be byte-identical, because a drift test regenerates and diffs.
 * Therefore: no timestamps, no wall-clock, no absolute paths, no environment
 * reads, no randomness. Paths sorted, methods in a fixed canonical order,
 * component schemas sorted by name, parameters sorted by (in, name), object keys
 * written in a fixed order, two-space JSON + a trailing newline.
 *
 * Usage:  npm run openapi:generate      (regenerate the committed document)
 *         npm run gate:openapi          (regenerate + fail on any diff)
 * The gate that fails CI is api/tests/contract/openapi-drift.test.ts, which rides
 * the ordinary api vitest suite (`npm test`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as shared from '@ekoa/shared';
import { zodToJsonSchema, ignoreOverride } from 'zod-to-json-schema';

/** The single filter rule. */
export const PUBLIC_AUTH_CLASS = 'user-or-key';

/** Repo-relative output path (relative, so no machine path can leak into the document). */
export const OPENAPI_DOC_RELATIVE_PATH = 'docs/openapi/cortex.v1.json';

/** The command a developer runs to fix a drift failure. */
export const REGENERATE_COMMAND = 'npm run openapi:generate';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const OPENAPI_DOC_ABSOLUTE_PATH = join(REPO_ROOT, OPENAPI_DOC_RELATIVE_PATH);

const COMPONENT_POINTER_PREFIX = '#/components/schemas/';

/** Canonical method order inside a path item (OpenAPI convention, not alphabetical). */
const METHOD_ORDER = ['get', 'put', 'post', 'patch', 'delete', 'options', 'head', 'trace'];

/**
 * The failure responses every capability operation can answer, and why each is UNIVERSAL
 * rather than per-endpoint. These are platform-wide invariants, not endpoint facts, so
 * listing them uniformly keeps the document free of a second hand-maintained table (same
 * reasoning as the filter rule above - a per-endpoint list would drift).
 *
 *   401 - `requireUserOrApiKey` fails closed on every capability route (rule 4).
 *   402 - the activation/billing gate runs on every authenticated surface.
 *   403 - a deactivated account, or a role the service refuses (e.g. `automations.create`).
 *   404 - the uniform not-found that also covers a cross-tenant ownership mismatch (rule 5).
 *   429 - the per-key capability window applies to every key principal.
 *   500 - the terminal error handler, in the same envelope.
 *
 * 400 is the one CONDITIONAL entry: emitted only where the descriptor declares a `request`
 * or `query` schema, because that is exactly where contract validation can reject the call.
 */
const UNIVERSAL_ERROR_RESPONSES = [
  ['401', 'Unauthenticated - missing, unknown, revoked or inactive credential (one uniform message).'],
  ['402', 'Billing-locked account (`BILLING_LOCKED`) or a blocked allowance (`BILLING_BLOCKED`).'],
  ['403', 'Deactivated account (`ACCOUNT_DISABLED`), or a role that may not perform this call (`FORBIDDEN`).'],
  ['404', 'Not found. Also returned for a resource owned by another tenant - the mismatch is deliberately indistinguishable from absence.'],
  ['429', 'Rate limited by the per-key capability window (`RATE_LIMITED`).'],
  ['500', 'Internal error (`INTERNAL`).'],
];

const VALIDATION_ERROR_RESPONSE = [
  '400',
  'Request body or query string failed contract validation (`VALIDATION_FAILED`); `details` carries the zod issues.',
];

// ---------------------------------------------------------------------------
// Named-schema registry
// ---------------------------------------------------------------------------

/**
 * Map every zod schema EXPORTED from `@ekoa/shared` to its export name, so schemas become
 * reusable `#/components/schemas/*` components instead of being inlined at every use site
 * (which the E7 client generator needs: a component name is a type name).
 *
 * Keyed by the zod `_def` object because that is the identity zod-to-json-schema itself
 * keys on. Several names can alias ONE schema object - `OkResponse` is also exported as
 * `AgentFaceCancelResponse`, `CompanySpaceStopResponse` and
 * `PlatformIntegrationDisconnectResponse`; `NoteRecord` is also `WriteNoteResponse`. One
 * component per schema OBJECT, and the winning name is the SHORTEST, ties broken
 * alphabetically. Deterministic, and on today's aliases it picks the canonical name every
 * time (`OkResponse`, `NoteRecord`) rather than an incidental domain-specific one - which
 * matters because a component name becomes a type name in the generated client.
 */
function buildNameRegistry() {
  const nameByDef = new Map();
  const schemaByName = new Map();
  const candidates = Object.keys(shared)
    .sort((a, b) => (a.length === b.length ? a.localeCompare(b, 'en') : a.length - b.length));
  for (const exportName of candidates) {
    const value = shared[exportName];
    if (!value || typeof value !== 'object') continue;
    if (!('_def' in value) || typeof value.safeParse !== 'function') continue;
    if (nameByDef.has(value._def)) continue;
    nameByDef.set(value._def, exportName);
    schemaByName.set(exportName, value);
  }
  return { nameByDef, schemaByName };
}

const refTo = (name) => ({ $ref: `${COMPONENT_POINTER_PREFIX}${name}` });

/**
 * Convert one zod schema into a JSON Schema destined for `#/components/schemas/<name>`.
 *
 * `basePath` is set to the component's own location so that INTERNAL self-recursion (a
 * schema referring to itself without going through a named export) emits a pointer that
 * actually resolves inside this document, rather than the library default `#` - which would
 * point at the whole OpenAPI document and be silently wrong.
 *
 * The `override` hook performs the hoisting: any sub-schema that has an export name is
 * replaced by a `$ref` and queued for its own conversion. The root of THIS conversion is
 * exempted, otherwise a named schema would immediately collapse into a `$ref` to itself.
 *
 * The library appends a draft-07 `$schema` to the top level of every result; it is stripped
 * here, because a 3.1 document's schemas are 2020-12 and must not claim otherwise.
 */
function convertSchema(componentName, zodSchema, enqueue, nameByDef) {
  const rootDef = zodSchema._def;
  const converted = zodToJsonSchema(zodSchema, {
    target: 'jsonSchema7',
    $refStrategy: 'root',
    basePath: ['#', 'components', 'schemas', componentName],
    errorMessages: false,
    markdownDescription: false,
    override: (def) => {
      if (def === rootDef) return ignoreOverride;
      const hoisted = nameByDef.get(def);
      if (!hoisted) return ignoreOverride;
      enqueue(hoisted);
      return refTo(hoisted);
    },
  });
  delete converted.$schema;
  return converted;
}

// ---------------------------------------------------------------------------
// Descriptor -> operation
// ---------------------------------------------------------------------------

/** `/api/v1/automations/:id/runs` -> `/api/v1/automations/{id}/runs`. */
const toOpenApiPath = (expressPath) => expressPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

/** Path parameter names, in path order, derived from the path template itself. */
const pathParamNames = (expressPath) => [...expressPath.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);

/** PascalCase a run of parts: ('memvault','writeNote','Request') -> 'MemvaultWriteNoteRequest'. */
const pascal = (...parts) => parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');

/**
 * The zod object behind a descriptor `query` schema, unwrapped through the wrappers a query
 * schema may legitimately wear. Returns null when there is no object underneath - the caller
 * then fails loudly rather than silently dropping the parameters.
 */
function queryShapeOf(zodSchema) {
  let cursor = zodSchema;
  for (let hops = 0; hops < 8 && cursor; hops += 1) {
    const typeName = cursor._def?.typeName;
    if (typeName === 'ZodObject') return cursor.shape;
    if (typeName === 'ZodEffects') cursor = cursor._def.schema;
    else if (typeName === 'ZodOptional' || typeName === 'ZodDefault' || typeName === 'ZodReadonly') cursor = cursor._def.innerType;
    else if (typeName === 'ZodPipeline') cursor = cursor._def.out;
    else return null;
  }
  return null;
}

/** True when the schema accepts `undefined`, i.e. the query parameter is not required. */
const isOptionalSchema = (zodSchema) => zodSchema.safeParse(undefined).success;

/**
 * Strip `ZodOptional` wrappers off a query parameter schema. In OpenAPI, optionality of a
 * parameter is `required: false`, not part of its schema; leaving the wrapper on makes
 * zod-to-json-schema emit `anyOf: [{ not: {} }, <schema>]` (its encoding of "or undefined"),
 * which is a noisy no-op union that client generators turn into a bogus type. `ZodDefault`
 * is deliberately NOT stripped - it renders as the inner schema plus a `default`, which is
 * exactly right.
 */
function unwrapOptional(zodSchema) {
  let cursor = zodSchema;
  while (cursor?._def?.typeName === 'ZodOptional') cursor = cursor._def.innerType;
  return cursor;
}

// ---------------------------------------------------------------------------
// Integrity assertions - a silently-wrong schema is worse than an omitted one
// ---------------------------------------------------------------------------

/** Yield every object node of a plain-JSON tree. */
function* walkJson(node) {
  if (Array.isArray(node)) {
    for (const item of node) yield* walkJson(item);
  } else if (node && typeof node === 'object') {
    yield node;
    for (const value of Object.values(node)) yield* walkJson(value);
  }
}

/**
 * Draft-7 constructs that do NOT mean the same thing in JSON Schema 2020-12 (the OpenAPI
 * 3.1 dialect). None occur on today's surface; if a future `shared/` schema introduces one,
 * fail here instead of emitting an invalid document.
 */
function assertDialectIs2020_12Compatible(doc) {
  const offenders = [];
  for (const node of walkJson(doc)) {
    if ('definitions' in node) offenders.push('`definitions` (2020-12 uses `$defs`)');
    if ('dependencies' in node) offenders.push('`dependencies` (2020-12 splits it into `dependentSchemas`/`dependentRequired`)');
    if ('additionalItems' in node) offenders.push('`additionalItems` (2020-12 uses `items` after `prefixItems`)');
    if ('nullable' in node) offenders.push('`nullable` (an OpenAPI 3.0 keyword; 3.1 uses `type: "null"`)');
    if ('$schema' in node) offenders.push('`$schema` (a nested dialect declaration; the document dialect is 2020-12)');
    if (Array.isArray(node.items)) offenders.push('tuple `items: []` (2020-12 uses `prefixItems`)');
    if (typeof node.exclusiveMinimum === 'boolean') offenders.push('boolean `exclusiveMinimum` (2020-12 requires a number)');
    if (typeof node.exclusiveMaximum === 'boolean') offenders.push('boolean `exclusiveMaximum` (2020-12 requires a number)');
  }
  if (offenders.length > 0) {
    throw new Error(
      `generate-openapi: the emitted JSON Schema is not OpenAPI 3.1 (2020-12) compatible: ${[...new Set(offenders)].join(', ')}. ` +
        'A shared/ schema introduced a draft-7-only construct; teach the generator to render it before shipping the document.',
    );
  }
}

/**
 * Every `$ref` must resolve to a component that exists. This kills the whole class of
 * silently-wrong pointers: a recursive schema that emitted bare `#`, a hoisted name that was
 * never converted, a deep pointer into a component that moved.
 */
function assertEveryRefResolves(doc) {
  const dangling = [];
  for (const node of walkJson(doc)) {
    const ref = node.$ref;
    if (typeof ref !== 'string') continue;
    const match = /^#\/components\/schemas\/([^/]+)(\/.*)?$/.exec(ref);
    if (!match) {
      dangling.push(`${ref} (not a #/components/schemas pointer)`);
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(doc.components.schemas, match[1])) {
      dangling.push(`${ref} (no such component)`);
    }
  }
  if (dangling.length > 0) {
    throw new Error(`generate-openapi: unresolvable $ref(s): ${[...new Set(dangling)].join(', ')}`);
  }
}

/**
 * The contract MAJOR version, DERIVED from the paths rather than hand-maintained: every
 * public path must share one `/api/vN` prefix, and N is the version. A hand-maintained
 * constant could let the document claim v1 while describing v2 paths.
 */
function deriveMajorVersion(endpoints) {
  const prefixes = new Set(endpoints.map((e) => /^\/api\/(v\d+)\//.exec(e.path)?.[1] ?? null));
  if (prefixes.size !== 1 || prefixes.has(null)) {
    throw new Error(
      `generate-openapi: the public surface must sit under exactly one /api/vN prefix; found ${JSON.stringify([...prefixes])}. ` +
        'A second major version needs its own document (docs/openapi/cortex.vN.json), not a mixed one.',
    );
  }
  return Number([...prefixes][0].slice(1));
}

function sortObjectKeys(obj, comparator) {
  const out = {};
  for (const key of Object.keys(obj).sort(comparator)) out[key] = obj[key];
  return out;
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export function buildOpenApiDocument() {
  const endpoints = shared
    .allEndpointsFlat()
    .filter((e) => e.auth === PUBLIC_AUTH_CLASS)
    .sort((a, b) => `${a.domain}.${a.name}`.localeCompare(`${b.domain}.${b.name}`, 'en'));

  if (endpoints.length === 0) {
    throw new Error(`generate-openapi: no descriptor carries auth '${PUBLIC_AUTH_CLASS}' - refusing to emit an empty spec.`);
  }

  const major = deriveMajorVersion(endpoints);
  const { nameByDef, schemaByName } = buildNameRegistry();

  // Component conversion is queue-driven: an operation's schema pulls in its named
  // sub-schemas, which pull in theirs, until the reachable closure is converted. Nothing
  // unreachable from the public surface ends up in the document.
  const components = {};
  const queue = [];
  const queued = new Set();
  const enqueue = (name) => {
    if (queued.has(name)) return name;
    queued.add(name);
    queue.push(name);
    return name;
  };

  /** Inline (unexported) schemas registered under a synthesized, collision-checked name. */
  const anonymous = new Map();
  const registerAnonymous = (name, zodSchema) => {
    if (schemaByName.has(name)) {
      throw new Error(`generate-openapi: synthesized component name '${name}' collides with a shared/ export.`);
    }
    const existing = anonymous.get(name);
    if (existing && existing !== zodSchema) {
      throw new Error(`generate-openapi: synthesized component name '${name}' is claimed by two different schemas.`);
    }
    anonymous.set(name, zodSchema);
    return enqueue(name);
  };

  /** The component name for a descriptor schema: its export name, else a synthesized one. */
  const componentNameFor = (zodSchema, ...fallbackParts) => {
    const exported = nameByDef.get(zodSchema._def);
    return exported ? enqueue(exported) : registerAnonymous(pascal(...fallbackParts), zodSchema);
  };

  // The error envelope is a first-class component: every documented failure response
  // references it, which makes "every non-2xx is the CONV-2 envelope" a fact IN the spec
  // instead of a convention the reader has to already know. Resolved through the registry
  // so an alphabetically-earlier alias of the same schema cannot orphan the lookup.
  const errorEnvelopeComponent = nameByDef.get(shared.ErrorEnvelope._def);
  if (!errorEnvelopeComponent) {
    throw new Error('generate-openapi: shared/ no longer exports the error envelope schema.');
  }
  enqueue(errorEnvelopeComponent);
  const errorResponse = (description) => ({
    description,
    content: { 'application/json': { schema: refTo(errorEnvelopeComponent) } },
  });

  const paths = {};
  const tags = new Set();

  for (const endpoint of endpoints) {
    const { domain, name, method, path: expressPath, request, response, query, kind, timeoutMs } = endpoint;
    const operationKey = `${domain}.${name}`;
    tags.add(domain);

    // --- parameters: path params from the path template, query params from the schema.
    const parameters = [];
    for (const paramName of pathParamNames(expressPath)) {
      parameters.push({
        name: paramName,
        in: 'path',
        required: true,
        // The descriptor carries no `params` field, so a path parameter is typed by the ONE
        // thing the contract actually states about it: it is a single non-empty path
        // segment. Narrowing further would encode a fact the contract does not hold.
        schema: { type: 'string', minLength: 1 },
      });
    }
    if (query) {
      const shape = queryShapeOf(query);
      if (!shape) {
        throw new Error(
          `generate-openapi: ${operationKey} declares a non-object query schema; the generator cannot render it as parameters.`,
        );
      }
      const inlineBase = `${COMPONENT_POINTER_PREFIX}${pascal(domain, name)}Query`;
      for (const paramName of Object.keys(shape).sort()) {
        const declared = shape[paramName];
        const propertySchema = unwrapOptional(declared);
        const exported = nameByDef.get(propertySchema._def);
        let paramSchema;
        if (exported) {
          paramSchema = refTo(enqueue(exported));
        } else {
          // Inline: a query parameter schema has no component of its own. Named
          // sub-schemas still hoist; a SELF-recursive one has nowhere to point, so it is
          // rejected explicitly rather than emitted as a dangling pointer.
          paramSchema = convertSchema(`${pascal(domain, name)}Query`, propertySchema, enqueue, nameByDef);
          for (const node of walkJson(paramSchema)) {
            if (typeof node.$ref === 'string' && node.$ref.startsWith(inlineBase)) {
              throw new Error(
                `generate-openapi: ${operationKey} query parameter '${paramName}' is self-recursive; ` +
                  'export it from shared/ as a named schema so it can be hoisted into a component.',
              );
            }
          }
        }
        parameters.push({ name: paramName, in: 'query', required: !isOptionalSchema(declared), schema: paramSchema });
      }
    }
    parameters.sort((a, b) => (a.in === b.in ? a.name.localeCompare(b.name, 'en') : a.in.localeCompare(b.in, 'en')));

    // --- success response.
    let successContent;
    if (kind === 'binary') {
      // `kind: 'binary'` means "opaque bytes", and the descriptor carries NO media type
      // (`response` is `z.unknown()`). The spec must not invent one: narrowing this to a
      // concrete type would copy a fact out of api/src that could then drift silently.
      successContent = { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } };
    } else if (response) {
      successContent = { 'application/json': { schema: refTo(componentNameFor(response, domain, name, 'Response')) } };
    }

    // Response keys are integer-like strings, so JS (and therefore JSON.stringify) always
    // orders them numerically ascending regardless of insertion order - deterministic.
    const responses = {
      200: {
        description:
          kind === 'binary'
            ? 'Opaque bytes. The contract declares `kind: "binary"` and carries no media type; read the response `Content-Type` header for the concrete type.'
            : 'Success.',
        ...(successContent ? { content: successContent } : {}),
      },
    };
    if (request || query) responses[VALIDATION_ERROR_RESPONSE[0]] = errorResponse(VALIDATION_ERROR_RESPONSE[1]);
    for (const [status, description] of UNIVERSAL_ERROR_RESPONSES) responses[status] = errorResponse(description);

    const operation = {
      operationId: operationKey,
      summary: `${method} ${toOpenApiPath(expressPath)}`,
      tags: [domain],
      // Machine-readable provenance, so a client generator (slice E7) never has to parse the
      // operationId back apart and can see descriptor facts the spec itself cannot express.
      'x-ekoa-domain': domain,
      'x-ekoa-endpoint': name,
      'x-ekoa-auth': PUBLIC_AUTH_CLASS,
      ...(kind ? { 'x-ekoa-kind': kind } : {}),
      ...(timeoutMs ? { 'x-ekoa-timeout-ms': timeoutMs } : {}),
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(request
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: refTo(componentNameFor(request, domain, name, 'Request')) } },
            },
          }
        : {}),
      responses,
    };

    const openApiPath = toOpenApiPath(expressPath);
    const pathItem = (paths[openApiPath] ??= {});
    const httpMethod = method.toLowerCase();
    if (pathItem[httpMethod]) {
      throw new Error(`generate-openapi: two descriptors claim ${method} ${openApiPath}.`);
    }
    pathItem[httpMethod] = operation;
  }

  // Drain the component queue (a conversion can enqueue further components).
  while (queue.length > 0) {
    const componentName = queue.shift();
    const zodSchema = anonymous.get(componentName) ?? schemaByName.get(componentName);
    if (!zodSchema) {
      throw new Error(`generate-openapi: component '${componentName}' was referenced but has no schema.`);
    }
    components[componentName] = convertSchema(componentName, zodSchema, enqueue, nameByDef);
  }

  const doc = {
    openapi: '3.1.0',
    info: {
      title: 'Cortex Capability API',
      // The MAJOR mirrors the /api/vN path prefix and is the ONLY meaningful field.
      // Capability Contract rule 7: additive change lands SILENTLY, so a new endpoint or a
      // new optional field must not move the version. A breaking change bumps the major,
      // which means a new path prefix, a new document, and an explicit consumer migration.
      version: `${major}.0.0`,
      description: [
        'The capability surface Cortex exposes to outside clients.',
        '',
        'GENERATED from the `shared/` endpoint descriptor maps by `api/scripts/generate-openapi.mjs`.',
        "It contains exactly those endpoints whose descriptor carries `auth: 'user-or-key'` - the",
        'surface a user-scoped gateway key can reach. Endpoints requiring a platform session are',
        'absent by construction. Do not edit this file by hand: a drift test regenerates and diffs it.',
        '',
        `Versioning: the major mirrors the \`/api/v${major}\` path prefix. Additive change (a new`,
        'endpoint, a new optional field) lands silently and does NOT move it. A breaking change needs',
        'a major bump plus an explicit migration of every consumer.',
      ].join('\n'),
    },
    // A single variable server. The default is the LOCAL dev origin, deliberately: this repo
    // documents no canonical production hostname, and inventing one would put a fact in the
    // spec that nothing here can keep true. A consumer substitutes its own deployment origin.
    servers: [
      {
        url: '{origin}',
        description: 'The Cortex deployment origin. Substitute your own; the default is the local dev stack.',
        variables: { origin: { default: 'http://localhost:4111' } },
      },
    ],
    tags: [...tags].sort().map((tag) => ({ name: tag })),
    security: [{ gatewayKey: [] }],
    paths: sortObjectKeys(paths, (a, b) => a.localeCompare(b, 'en')),
    components: {
      securitySchemes: {
        gatewayKey: {
          type: 'http',
          scheme: 'bearer',
          description: [
            'A user-scoped Cortex gateway key: `Authorization: Bearer ekoa_gk_...`. Mint one at',
            '`POST /api/v1/gateway-keys` - key minting deliberately requires a platform session and is',
            'therefore NOT part of this key-reachable surface. The key identifies a single user; tenancy',
            'and authorization are enforced server-side against that identity.',
            '',
            'A platform JWT is also accepted on every endpoint in this document: `requireUserOrApiKey`',
            'delegates a `Bearer <JWT>` to the ordinary session path untouched. Outside clients should',
            'use a gateway key - a JWT is a browser-session credential and is not issued to API consumers.',
          ].join('\n'),
        },
      },
      schemas: sortObjectKeys(components, (a, b) => a.localeCompare(b, 'en')),
    },
  };

  // Canonical method order inside each path item (re-assigning an existing key does not
  // move it, so the sorted `paths` order is preserved).
  for (const [openApiPath, pathItem] of Object.entries(doc.paths)) {
    doc.paths[openApiPath] = sortObjectKeys(pathItem, (a, b) => METHOD_ORDER.indexOf(a) - METHOD_ORDER.indexOf(b));
  }

  assertDialectIs2020_12Compatible(doc);
  assertEveryRefResolves(doc);
  return doc;
}

/** The exact bytes written to disk: two-space JSON + a trailing newline (POSIX text file). */
export function serializeOpenApiDocument(doc) {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export function generateOpenApiFile() {
  const text = serializeOpenApiDocument(buildOpenApiDocument());
  mkdirSync(dirname(OPENAPI_DOC_ABSOLUTE_PATH), { recursive: true });
  writeFileSync(OPENAPI_DOC_ABSOLUTE_PATH, text, 'utf8');
  return text;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const text = generateOpenApiFile();
  const doc = JSON.parse(text);
  const operations = Object.values(doc.paths).reduce((n, item) => n + Object.keys(item).length, 0);
  process.stdout.write(
    `wrote ${OPENAPI_DOC_RELATIVE_PATH}: ${operations} operations across ${Object.keys(doc.paths).length} paths, ` +
      `${Object.keys(doc.components.schemas).length} schema components, tags: ${doc.tags.map((t) => t.name).join(', ')}\n`,
  );
}
