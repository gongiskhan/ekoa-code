/**
 * "NAMES, NEVER VALUES" - the redaction proof for the compiled recipe and its captures (P2.0, T8).
 *
 * The whole discovery→capture→replay design rests on one property: what a run learns about
 * authentication is WHICH HEADER carries the session token, and never the token. This suite proves
 * it end to end against the REAL `SecretRegistry` (never a mock - a mocked redactor proves only that
 * the mock was called), through the paths that actually persist:
 *
 *   - a live exchange whose headers, URL and bodies are stuffed with credentials becomes an
 *     `InjectedCall` carrying header NAMES and zero values;
 *   - the same exchange, appended to the captures store, persists with the values gone in every
 *     encoding the registry knows (raw, URL-encoded, base64, JSON-escaped);
 *   - a recipe that carries a value ANYWHERE - a header "name", a URL template, a body template, a
 *     scripted step's typed value, a lesson - is REFUSED by the store rather than redacted, and
 *     nothing lands;
 *   - a stored recipe whose header names are not header names fails to parse back, so a capture-side
 *     regression cannot be replayed even if it somehow reached the database.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationDefinitions, integrationCapturedCalls } from '../../src/data/stores.js';
import { SecretRegistry, MIN_MASKABLE_LENGTH } from '../../src/security/redaction.js';
import {
  IntegrationDefinitionStore,
  type IntegrationDefinitionCreate,
} from '../../src/integrations/definition-store.js';
import {
  IntegrationRecipeStore,
  RecipeStoreError,
  assertCarriesNoValues,
  type RecipeDraft,
} from '../../src/integrations/recipe-store.js';
import {
  CapturedCallsStore,
  MAX_CAPTURED_BODY_CHARS,
  type CaptureKey,
} from '../../src/integrations/captured-calls-store.js';
import {
  headerNameOf,
  headerNamesOf,
  injectedCallFromExchange,
  isHeaderName,
  parseCompiledRecipe,
  RecipeShapeError,
} from '../../src/automation/recipe.js';

let mem: MongoMemoryServer;
let clock = 0;
const definitions = new IntegrationDefinitionStore(integrationDefinitions, () => new Date(1_700_000_000_000 + clock++));
const recipes = new IntegrationRecipeStore(integrationDefinitions, () => new Date(1_700_000_000_000 + clock++));
const captures = new CapturedCallsStore(integrationCapturedCalls, () => new Date(1_700_000_000_000 + clock++));

/**
 * The live credentials of the imaginary run: a session cookie, a bearer token, a CSRF value.
 * The JWT-shaped one is COMPOSED AT RUNTIME so no credential-shaped literal is ever committed -
 * the same discipline the builder contract suite uses for its planted key, and what keeps the
 * repository's own secret scanner from flagging a fixture.
 */
const SESSION_COOKIE = 'JSESSIONID=9aXbZq7Lm2Rt4Vw8Ny1Pd3Kc';
const BEARER = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJhZHZvZ2FkbyJ9', '7Lm2Rt4Vw8Ny1Pd3Kc9aXbZq'].join('.');
const CSRF = 'c8f3a1b7d9e2f4a6';

function liveRegistry(): SecretRegistry {
  const registry = new SecretRegistry();
  registry.registerAll([SESSION_COOKIE, BEARER, CSRF]);
  return registry;
}

const exchange = {
  method: 'GET' as const,
  urlTemplate: 'https://portal.example.pt/api/processos?page={{input.page}}',
  headers: {
    Cookie: SESSION_COOKIE,
    Authorization: `Bearer ${BEARER}`,
    'X-CSRF-Token': CSRF,
    Accept: 'application/json',
  },
};

const definitionDraft: IntegrationDefinitionCreate = {
  orgId: 'orgA',
  userId: 'userA1',
  key: 'citius',
  visibility: 'private',
  configSchema: [],
  actions: [{ actionName: 'list_processos', description: 'lista', mutates: false }],
  skillMd: '# citius\n',
};

const captureKey: CaptureKey = {
  orgId: 'orgA',
  integrationKey: 'citius',
  actionName: 'list_processos',
  captureId: 'cap1',
};

const baseDraft = (): RecipeDraft => ({
  goal: 'listar os processos do escritório',
  injectedCalls: [injectedCallFromExchange(exchange)],
  scriptedSteps: [{ locator: { strategy: 'label', value: 'Utilizador' }, action: 'fill', value: '{{input.username}}' }],
  lessons: ['the session rides the cookie header', 'pagination is ?page=N'],
});

beforeAll(async () => {
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_security_recipe_no_values');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  clock = 0;
  await integrationDefinitions.deleteMany({});
  await integrationCapturedCalls.deleteMany({});
  await definitions.create(definitionDraft, { actor: { userId: 'userA1', orgId: 'orgA', role: 'user' } });
});

describe('an injected call keeps header names and drops header values', () => {
  it('turns a credential-bearing exchange into names only', () => {
    const call = injectedCallFromExchange(exchange);
    expect(call.headerNames).toEqual(['accept', 'authorization', 'cookie', 'x-csrf-token']);
    // The learning survives: WHICH header carries the session is exactly what a replay needs…
    expect(call.headerNames).toContain('cookie');
    // …and nothing else does, in any encoding.
    const serialised = JSON.stringify(call);
    for (const secret of [SESSION_COOKIE, BEARER, CSRF]) {
      expect(serialised).not.toContain(secret);
      expect(serialised).not.toContain(encodeURIComponent(secret));
      expect(serialised).not.toContain(Buffer.from(secret, 'utf8').toString('base64'));
    }
    expect(liveRegistry().redact(serialised)).toBe(serialised);
    expect(call.idempotent).toBe(true); // GET replays freely (T4)
  });

  it('refuses to mint a header NAME from a header VALUE', () => {
    expect(isHeaderName('authorization')).toBe(true);
    expect(isHeaderName('x-csrf-token')).toBe(true);
    // A value with a space, or one merely too long to be a name, is not a name.
    expect(isHeaderName(`Bearer ${BEARER}`)).toBe(false);
    expect(isHeaderName(SESSION_COOKIE)).toBe(false); // '=' is not a token character
    expect(isHeaderName(BEARER)).toBe(false); // token-shaped, but 71 chars - the bound catches it
    expect(() => headerNameOf(`Bearer ${BEARER}`)).toThrow(RecipeShapeError);
    // The refusal never echoes the offending text: an error message is a log line.
    try {
      headerNameOf(SESSION_COOKIE, 'injectedCalls[0].headerNames[0]');
      throw new Error('expected a refusal');
    } catch (e) {
      expect((e as Error).message).toContain('injectedCalls[0].headerNames[0]');
      expect((e as Error).message).not.toContain(SESSION_COOKIE);
    }
    // A header map with a value-shaped KEY contributes nothing rather than smuggling it through.
    expect(headerNamesOf({ [`Bearer ${BEARER}`]: 'x', cookie: SESSION_COOKIE })).toEqual(['cookie']);
  });
});

describe('the recipe store refuses any recipe that carries a value', () => {
  const write = (mutate: (d: RecipeDraft) => RecipeDraft) =>
    recipes.putRecipe('orgA', 'citius', 'list_processos', mutate(baseDraft()), { secrets: liveRegistry() });

  it('accepts the value-free recipe, and the persisted form survives redaction unchanged', async () => {
    const result = await recipes.putRecipe('orgA', 'citius', 'list_processos', baseDraft(), { secrets: liveRegistry() });
    expect(result.verdict).toBe('ok');
    const stored = await recipes.getRecipe('orgA', 'citius', 'list_processos');
    expect(stored?.injectedCalls[0]?.headerNames).toEqual(['accept', 'authorization', 'cookie', 'x-csrf-token']);
    const serialised = JSON.stringify(stored);
    expect(liveRegistry().redact(serialised)).toBe(serialised);
    for (const secret of [SESSION_COOKIE, BEARER, CSRF]) expect(serialised).not.toContain(secret);
  });

  it.each([
    ['a live value parked in headerNames', (d: RecipeDraft) => {
      const call = d.injectedCalls[0]!;
      return { ...d, injectedCalls: [{ ...call, headerNames: [...call.headerNames, SESSION_COOKIE] }] };
    }],
    ['a live token baked into the url template', (d: RecipeDraft) => {
      const call = d.injectedCalls[0]!;
      return { ...d, injectedCalls: [{ ...call, urlTemplate: `${call.urlTemplate}&token=${BEARER}` }] };
    }],
    ['a live token in the body template', (d: RecipeDraft) => {
      const call = d.injectedCalls[0]!;
      return { ...d, injectedCalls: [{ ...call, bodyTemplate: JSON.stringify({ csrf: CSRF }) }] };
    }],
    ['a typed credential on a scripted step', (d: RecipeDraft) => ({
      ...d,
      scriptedSteps: [{ locator: { strategy: 'label', value: 'Password' }, action: 'fill', value: SESSION_COOKIE }],
    })],
    ['a credential quoted in a lesson', (d: RecipeDraft) => ({
      ...d,
      lessons: [...d.lessons, `send Authorization: Bearer ${BEARER}`],
    })],
    ['a credential used as an object key of expectShape', (d: RecipeDraft) => {
      const call = d.injectedCalls[0]!;
      return { ...d, injectedCalls: [{ ...call, expectShape: { [CSRF]: 'string' } }] };
    }],
  ])('refuses %s, and persists nothing', async (_name, mutate) => {
    await expect(write(mutate)).rejects.toThrow(RecipeStoreError);
    expect(await recipes.getRecipe('orgA', 'citius', 'list_processos')).toBeNull();
  });

  /**
   * THE HEADER-NAME GRAMMAR LEG, WITH A KILLER OF ITS OWN.
   *
   * The first row above plants a REGISTERED value in `headerNames`, so the registry leg catches it
   * first and the grammar leg could be deleted whole with every case above still green - measured,
   * not assumed: with that `forEach` removed, the whole security + integrations + automation +
   * contract lane passed. A leg no case can separate is a leg nobody is checking.
   *
   * It is the leg that has to hold when there is NO registry to compare against and no shape to
   * recognise - a "name" that came off a live capture through a cast, which is the only way one
   * gets here at all (`HeaderName` is branded, so a raw string does not compile).
   *
   * Both strings below are therefore grammatically not header names, are values no registry holds,
   * and are far under `looksLikeLiteralSecret`'s floor (a >=24-character run over three character
   * classes). Nothing but the grammar can refuse them.
   */
  it('refuses a header NAME that is not one, with no registry and no secret shape to lean on', async () => {
    const draft = baseDraft();
    const call = draft.injectedCalls[0]!;
    const notNames = [
      // An HTTP/2 pseudo-header. The capture path DROPS these deliberately (`normaliseNames`, "a
      // live capture legitimately carries HTTP/2 pseudo-headers"), so one arriving here means that
      // filter stopped filtering - and `:` is not a token character.
      ':authority',
      // Token characters throughout, and 72 of them. The `{1,64}` BOUND is the half of the grammar
      // a JWT-shaped "name" fails; single-cased text has no shape for any other leg to see.
      `x-${'a'.repeat(70)}`,
    ];
    for (const name of notNames) {
      const poisoned = { ...draft, injectedCalls: [{ ...call, headerNames: [...call.headerNames, name] }] };
      // NO REGISTRY AT ALL - the leg under test is the only one that can see this.
      expect(() => assertCarriesNoValues(poisoned)).toThrow(RecipeStoreError);
      // …and the same refusal through the real store, WITH the registry present, so the case is not
      // quietly relying on the absence of one.
      await expect(
        recipes.putRecipe('orgA', 'citius', 'list_processos', poisoned, { secrets: liveRegistry() }),
      ).rejects.toThrow(RecipeStoreError);
    }
    expect(await recipes.getRecipe('orgA', 'citius', 'list_processos')).toBeNull();
  });

  /**
   * THE SUPERSEDE'S OWN FIELD GOES THROUGH THE SAME PROOF - it did not.
   *
   * `supersedeRecipe` destructured `reason` OUT of the payload before `assertCarriesNoValues`, so
   * the one string in a supersede that this repo did NOT compile was the one string exempt from all
   * three legs at once: the run's SecretRegistry, `looksLikeLiteralSecret` and `LIMITS.stringChars`.
   *
   * It is the LEAST trusted string in the payload, not the most: it is `classifyReplayDrift`'s
   * signal reason - daemon-supplied or fetch-error text, i.e. bytes from the site - and it is
   * written as `supersedes.reason` onto the DEFINITION document, so it rides every read and every
   * compare-and-swap of that row (Trap T2, the whole bounded-recipe argument), and `recipeSummary`
   * puts it on the wire to the owner.
   */
  it('refuses a supersede whose REASON carries a live value, or is a dump', async () => {
    expect((await recipes.putRecipe('orgA', 'citius', 'list_processos', baseDraft(), { secrets: liveRegistry() })).verdict).toBe('ok');
    const supersede = (reason: string, over: Partial<RecipeDraft> = {}) =>
      recipes.supersedeRecipe(
        'orgA', 'citius', 'list_processos',
        { ...baseDraft(), ...over, reason },
        { secrets: liveRegistry() },
      );

    // THE CONTROL, in the identical call shape: the SAME token one field over, in `goal`, is
    // refused. Without it a green assertion below could mean the registry never held this value.
    await expect(supersede('the endpoint moved', { goal: `replay ${BEARER}` })).rejects.toThrow(RecipeStoreError);

    // …and now in `reason` itself, which is exactly the shape a drift reason takes: the replay's
    // own failure text, quoting what came back off the wire.
    await expect(supersede(`replayed call 1 could not be made: 401 for Bearer ${BEARER}`)).rejects.toThrow(RecipeStoreError);
    // The literal-secret leg too, with a value the registry never held (one the SITE minted).
    await expect(supersede(`replayed call 1 answered 401: ${CSRF}${CSRF}Aa`)).rejects.toThrow(RecipeStoreError);
    // …and the BOUND, which is the third thing the exemption gave away.
    await expect(supersede('x'.repeat(50_000))).rejects.toThrow(RecipeStoreError);

    // NOTHING LANDED. The refusals are refusals, not partial writes: still version 1, no lineage.
    const held = await recipes.getRecipe('orgA', 'citius', 'list_processos');
    expect(held!.version).toBe(1);
    expect(held!.supersedes).toBeUndefined();

    // …AND AN ORDINARY REASON STILL SUPERSEDES, so this is a boundary and not a wall - every real
    // drift reason this repo produces is a sentence of this shape.
    expect((await supersede('replayed call 1 answered 404')).verdict).toBe('ok');
    const healed = await recipes.getRecipe('orgA', 'citius', 'list_processos');
    expect(healed!.supersedes).toEqual({ version: 1, reason: 'replayed call 1 answered 404' });
  });

  it('refuses a secret-SHAPED literal even with no registry to compare against', () => {
    const draft = baseDraft();
    const call = draft.injectedCalls[0]!;
    // No registry: the run held no credentials, or this string is a value the run never resolved.
    // The shape predicate is the second leg, and it fires on the vendor-key shape alone.
    // Composed at runtime, like BEARER above, so the fixture is not itself a committed literal.
    const vendorKey = ['sk', 'live', ['9aXbZq7Lm2', 'Rt4Vw8Ny1Pd3Kc'].join('')].join('_');
    expect(() => assertCarriesNoValues({
      ...draft,
      lessons: [...draft.lessons, `use ${vendorKey}`],
    })).toThrow(RecipeStoreError);
    // …while an ordinary, value-free recipe passes with no registry at all.
    expect(() => assertCarriesNoValues({ ...draft, injectedCalls: [call] })).not.toThrow();
  });

  it('the known bound is honest: a value too short to substitute is surfaced, not silently missed', () => {
    const registry = new SecretRegistry();
    registry.register('ab'); // shorter than MIN_MASKABLE_LENGTH
    expect(MIN_MASKABLE_LENGTH).toBe(3);
    // The registry cannot mask it (masking two characters would shred every stream), and says so -
    // which is what makes this bound assertable rather than a silent hole in the proof above.
    expect(registry.unmaskable).toEqual(['ab']);
  });
});

describe('captured calls persist names and redacted bodies, never values', () => {
  it('drops every live value from the url, the bodies and the header names', async () => {
    const secrets = liveRegistry();
    const result = await captures.appendCapturedCall(
      captureKey,
      0,
      {
        method: 'GET',
        url: `https://portal.example.pt/api/processos?page=1&token=${encodeURIComponent(BEARER)}`,
        requestHeaderNames: headerNamesOf(exchange.headers),
        responseHeaderNames: ['content-type', 'set-cookie'],
        status: 200,
        requestBody: JSON.stringify({ csrf: CSRF }),
        responseBody: `{"session":"${SESSION_COOKIE}","items":[]}`,
      },
      { secrets },
    );
    expect(result.verdict).toBe('ok');

    const stored = await captures.getCapturedCall(captureKey, 0);
    expect(stored?.call.requestHeaderNames).toEqual(['accept', 'authorization', 'cookie', 'x-csrf-token']);
    expect(stored?.call.responseHeaderNames).toEqual(['content-type', 'set-cookie']);
    const serialised = JSON.stringify(stored);
    for (const secret of [SESSION_COOKIE, BEARER, CSRF]) {
      expect(serialised).not.toContain(secret);
      expect(serialised).not.toContain(encodeURIComponent(secret));
    }
    // The proof, made with the real thing: a second registry over the same values finds nothing.
    expect(liveRegistry().redact(serialised)).toBe(serialised);
    // …and the evidence is still useful: the endpoint and the shape survived.
    expect(stored?.call.url).toContain('/api/processos');
    expect(stored?.call.responseBody).toContain('items');
  });

  it('refuses a header VALUE offered as a header name', async () => {
    await expect(
      captures.appendCapturedCall(captureKey, 1, {
        method: 'GET',
        url: 'https://portal.example.pt/api/processos',
        requestHeaderNames: [`Bearer ${BEARER}`],
      }),
    ).rejects.toThrow(/header NAMES, never values/);
    expect(await captures.listCapture(captureKey)).toEqual([]);
  });

  it('bounds a body rather than storing an archive', async () => {
    const huge = 'a'.repeat(200_000);
    await captures.appendCapturedCall(captureKey, 2, {
      method: 'GET',
      url: 'https://portal.example.pt/api/processos',
      requestHeaderNames: ['accept'],
      responseBody: huge,
    });
    const stored = await captures.getCapturedCall(captureKey, 2);
    expect(stored?.call.truncated).toBe(true);
    expect(stored?.call.responseBody?.length).toBe(MAX_CAPTURED_BODY_CHARS);
  });
});

describe('a stored recipe whose names are not names cannot be replayed', () => {
  it('fails to parse back rather than being repaired', () => {
    const good = parseCompiledRecipe({ ...baseDraft(), version: 1, compiledAt: '2026-08-18T00:00:00.000Z' });
    expect(good?.injectedCalls[0]?.headerNames).toContain('cookie');

    const poisoned = {
      ...baseDraft(),
      version: 1,
      compiledAt: '2026-08-18T00:00:00.000Z',
      injectedCalls: [{ ...baseDraft().injectedCalls[0]!, headerNames: [SESSION_COOKIE] }],
    };
    expect(parseCompiledRecipe(poisoned)).toBeNull();
  });
});
