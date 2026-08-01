/**
 * automation/login-recipes.ts — the per-site login recipe registry (Cofre F-3).
 *
 * WHAT A RECIPE IS ALLOWED TO BE. Four optional CSS selectors, and nothing else. A recipe tells the
 * typist WHERE the username, password, next and submit controls are on a known site; it never tells
 * it what to DO. That distinction is the whole security property: the typist's behaviour is fixed
 * code, and a recipe can only point it at different elements of the same fixed sequence.
 *
 * WHERE RECIPES COME FROM. `api/assets/login-recipes/recipes.json`, committed and reviewed. NOT the
 * planner, NOT the user, NOT fetched at runtime. The plan is explicit that recipes are fixed data
 * "never model-authored", and the reason is I5: the typist is the one primitive that handles a
 * decrypted credential against a live page, so anything steering it is part of the credential's
 * trust boundary. A model-authored selector is a model choosing which field receives a password.
 *
 * WHY THE LOADER IS STRICT AND ALL-OR-NOTHING. Every value is validated as a plain selector, and a
 * single bad entry rejects the WHOLE file. A registry that silently drops the entries it dislikes
 * is one nobody can reason about: the typist would fall back to its generic selectors for that site
 * and nobody would know which sites are actually covered. Failing loudly at load is cheap; a
 * half-loaded registry is a permanent question mark.
 *
 * THE SECOND MAP: `loginUrls`. A selector decides which FIELD on a page receives the password; the
 * URL decides which HOST receives it, and that is the strictly more dangerous parameter — yet it
 * was the one left free-form at the caller while the far less dangerous selectors were fixed,
 * reviewed data. So a host may also declare its login URL here, and `session-establishment.ts`
 * prefers it over anything a caller passes. It is a SIBLING map rather than a field on a recipe
 * entry deliberately: "a recipe is selectors only" is a rule worth keeping literally true, and a
 * URL is not a selector. Validation is correspondingly different — an https URL, no userinfo, and
 * the URL's host must BE the key or a subdomain of it, so an entry cannot aim one portal's password
 * at another site.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TypistRecipe } from './typist.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** `api/assets/login-recipes/recipes.json`, resolved from src/ or dist/ alike. */
function recipesPath(): string {
  for (const rel of ['../../assets/login-recipes/recipes.json', '../../../assets/login-recipes/recipes.json']) {
    const p = join(HERE, rel);
    if (existsSync(p)) return p;
  }
  return join(HERE, '../../assets/login-recipes/recipes.json');
}

const SELECTOR_FIELDS = ['usernameSelector', 'passwordSelector', 'submitSelector', 'nextSelector'] as const;

/**
 * Characters that have no business in a CSS selector and every business in an injection attempt:
 * angle brackets (markup), braces (script blocks / template literals), backslash (escapes),
 * backtick and the `javascript:` scheme. A selector is a query, not a program.
 */
const FORBIDDEN_IN_SELECTOR = /[<>{}\\`]|javascript:|expression\s*\(|\bon[a-z]+\s*=/i;
const MAX_SELECTOR_LENGTH = 200;

export class RecipeRegistryError extends Error {
  constructor(message: string) {
    super(`login-recipes: ${message}`);
    this.name = 'RecipeRegistryError';
  }
}

/** Validate one selector string. Exported so the schema test can drive it directly. */
export function assertPlainSelector(host: string, field: string, value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RecipeRegistryError(`${host}.${field} must be a non-empty string`);
  }
  if (value.length > MAX_SELECTOR_LENGTH) {
    throw new RecipeRegistryError(`${host}.${field} exceeds ${MAX_SELECTOR_LENGTH} characters`);
  }
  if (FORBIDDEN_IN_SELECTOR.test(value)) {
    throw new RecipeRegistryError(`${host}.${field} contains characters that cannot appear in a plain CSS selector`);
  }
}

/** Parse + validate a raw registry object. Throws on the FIRST problem; never partially accepts. */
export function parseRecipeRegistry(raw: unknown): Map<string, TypistRecipe> {
  const root = raw as { recipes?: Record<string, unknown> } | null;
  if (!root || typeof root !== 'object' || !root.recipes || typeof root.recipes !== 'object') {
    throw new RecipeRegistryError('expected an object with a `recipes` map');
  }
  const out = new Map<string, TypistRecipe>();
  for (const [host, entry] of Object.entries(root.recipes)) {
    if (!entry || typeof entry !== 'object') throw new RecipeRegistryError(`${host} is not an object`);
    const recipe: TypistRecipe = {};
    for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
      // `$note`/`$comment` are documentation for the reviewer, ignored by the loader.
      if (key.startsWith('$')) continue;
      if (!(SELECTOR_FIELDS as readonly string[]).includes(key)) {
        // An UNKNOWN field is a hard error, not something to skip. If a recipe grows a `script`
        // or `beforeFill` key, the registry must refuse rather than quietly ignore it — silently
        // dropping it is how a field nobody validates ends up being read by a later version.
        throw new RecipeRegistryError(`${host}.${key} is not a recognised recipe field`);
      }
      assertPlainSelector(host, key, value);
      recipe[key as (typeof SELECTOR_FIELDS)[number]] = value;
    }
    if (Object.keys(recipe).length === 0) throw new RecipeRegistryError(`${host} declares no selectors`);
    out.set(host.toLowerCase(), recipe);
  }
  return out;
}

/**
 * Parse + validate the `loginUrls` map. Absent is fine (most hosts declare only selectors); present
 * and malformed is a hard error, for the same all-or-nothing reason the recipes are.
 *
 * The host-containment check is the load-bearing one: `loginUrls["citius…mj.pt"]` MUST point at
 * `citius…mj.pt` or a subdomain of it. Without it this map would be a place to write "when you are
 * establishing citius, go type the password over there", which is the exact confused-deputy shape
 * the whole module exists to prevent — and it would be reviewed as a URL, not as a redirection.
 */
export function parseLoginUrls(raw: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const root = raw as { loginUrls?: unknown } | null;
  if (!root || typeof root !== 'object' || root.loginUrls === undefined) return out;
  const map = root.loginUrls;
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    throw new RecipeRegistryError('`loginUrls` must be a map of host -> https login URL');
  }
  for (const [host, value] of Object.entries(map as Record<string, unknown>)) {
    if (host.startsWith('$')) continue; // documentation for the reviewer, as in `recipes`
    if (typeof value !== 'string' || value.trim() === '') {
      throw new RecipeRegistryError(`loginUrls.${host} must be a non-empty string`);
    }
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new RecipeRegistryError(`loginUrls.${host} is not a URL`);
    }
    if (url.protocol !== 'https:') {
      throw new RecipeRegistryError(`loginUrls.${host} must be https — a credential is replayed against it`);
    }
    if (url.username || url.password) {
      throw new RecipeRegistryError(`loginUrls.${host} must not carry userinfo`);
    }
    const key = host.toLowerCase();
    const target = url.hostname.toLowerCase();
    if (!(target === key || target.endsWith(`.${key}`))) {
      throw new RecipeRegistryError(`loginUrls.${host} points at ${target}, which is not on ${key}`);
    }
    out.set(key, url.toString());
  }
  return out;
}

let cached: Map<string, TypistRecipe> | null = null;
let cachedLoginUrls: Map<string, string> | null = null;
let cachedRaw: unknown;
let cachedRawLoaded = false;

/** The asset's parsed JSON, read once. Both maps live in the same reviewed file. */
function rawRegistryFile(): unknown {
  if (cachedRawLoaded) return cachedRaw;
  const path = recipesPath();
  cachedRaw = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  cachedRawLoaded = true;
  return cachedRaw;
}

/** The registry, loaded once. A malformed file throws — the typist then runs on its generic
 *  selectors, which is the honest degradation, but the operator sees why. */
export function loadRecipeRegistry(): Map<string, TypistRecipe> {
  if (cached) return cached;
  const raw = rawRegistryFile();
  cached = raw === null ? new Map() : parseRecipeRegistry(raw);
  return cached;
}

/** The login-URL map, loaded once from the same asset. */
export function loadLoginUrlRegistry(): Map<string, string> {
  if (cachedLoginUrls) return cachedLoginUrls;
  const raw = rawRegistryFile();
  cachedLoginUrls = raw === null ? new Map() : parseLoginUrls(raw);
  return cachedLoginUrls;
}

/**
 * The recipe for a host, or undefined. Subdomains inherit their parent's recipe using the same
 * eTLD+1-ish rule origin binding uses, so `mail.webmail.oa.pt` matches `webmail.oa.pt` — one rule
 * for "is this the same site", not two that can disagree.
 */
export function recipeForHost(host: string): TypistRecipe | undefined {
  return lookupByHost(loadRecipeRegistry(), host);
}

/**
 * The REVIEWED login URL for a host, or undefined. Subdomains inherit by the same rule recipes do.
 *
 * `session-establishment.ts` prefers this over a caller-supplied URL, and refuses when a caller
 * supplies one that disagrees with it — the URL is the parameter that decides which host receives a
 * password, so it belongs in reviewed data rather than in a request field.
 */
export function loginUrlForHost(host: string): string | undefined {
  return lookupByHost(loadLoginUrlRegistry(), host);
}

/** Exact host, else the nearest declared parent domain. One rule for "is this the same site". */
function lookupByHost<T>(registry: Map<string, T>, host: string): T | undefined {
  const h = host.toLowerCase().replace(/^https?:\/\//, '').split('/')[0]!.split(':')[0]!;
  const exact = registry.get(h);
  if (exact !== undefined) return exact;
  for (const [key, value] of registry) {
    if (h.endsWith(`.${key}`)) return value;
  }
  return undefined;
}

/** Test helper: drop the cache so a test can load a crafted registry. */
export function __resetRecipeRegistryForTests(): void {
  cached = null;
  cachedLoginUrls = null;
  cachedRaw = undefined;
  cachedRawLoaded = false;
}
