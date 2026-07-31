import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseRecipeRegistry,
  assertPlainSelector,
  recipeForHost,
  loadRecipeRegistry,
  RecipeRegistryError,
  __resetRecipeRegistryForTests,
} from '../../src/automation/login-recipes.js';
import { routeForHumanAction, isCredentialAdjacentFailure } from '../../src/automation/human-action-routing.js';

/**
 * SECURITY SUITE — login recipes as fixed data, and where an unknown pattern goes (Cofre F-3/F-4).
 *
 * THE ONE SENTENCE THAT MATTERS. The typist is the only primitive that handles a DECRYPTED
 * credential against a LIVE page, so anything that steers it sits inside the credential's trust
 * boundary. A recipe may say WHERE the fields are; it may never say what to do. And when no recipe
 * matches and the generic selectors find nothing, the answer is a human — never the rehearsal fixer,
 * because the fixer is an LLM whose output would decide which field receives the password.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = join(HERE, '../../assets/login-recipes/recipes.json');

describe('F-3: recipes are fixed data, and the loader refuses anything else', () => {
  it('the shipped registry loads and covers the plan\'s terminal-gate portal', () => {
    __resetRecipeRegistryForTests();
    const reg = loadRecipeRegistry();
    expect(reg.size).toBeGreaterThan(0);
    // webmail.oa.pt is the only surveyed rail where a typist login is possible at all.
    expect(reg.get('webmail.oa.pt')?.passwordSelector).toBeTruthy();
  });

  it('the shipped registry contains ONLY selector fields — no executable content', () => {
    const raw = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')) as { recipes: Record<string, Record<string, unknown>> };
    const allowed = new Set(['usernameSelector', 'passwordSelector', 'submitSelector', 'nextSelector']);
    for (const [host, entry] of Object.entries(raw.recipes)) {
      for (const key of Object.keys(entry)) {
        if (key.startsWith('$')) continue; // reviewer notes
        expect(allowed.has(key), `${host}.${key} is not a selector field`).toBe(true);
      }
    }
  });

  it('REFUSES a recipe carrying script-shaped content', () => {
    for (const bad of [
      '<script>alert(1)</script>',
      'input`x`',
      'input[onerror=alert(1)]',
      'javascript:alert(1)',
      'input{color:red}',
      'input\\;drop',
    ]) {
      expect(() => assertPlainSelector('h', 'passwordSelector', bad), bad).toThrow(RecipeRegistryError);
    }
  });

  it('REFUSES an unrecognised field rather than ignoring it', () => {
    // The dangerous direction: a recipe grows a `script`/`beforeFill` key, the loader drops it
    // silently, and a later version reads it. An unknown field is a hard error.
    expect(() => parseRecipeRegistry({ recipes: { 'x.pt': { passwordSelector: '#p', script: 'doThing()' } } })).toThrow(
      RecipeRegistryError,
    );
  });

  it('is ALL-OR-NOTHING: one bad entry rejects the whole file', () => {
    // A registry that silently drops entries it dislikes is one nobody can reason about — the
    // typist would fall back to generic selectors for that site and nobody would know.
    expect(() =>
      parseRecipeRegistry({
        recipes: { 'good.pt': { passwordSelector: '#p' }, 'bad.pt': { passwordSelector: '<script>' } },
      }),
    ).toThrow(RecipeRegistryError);
  });

  it('refuses an empty recipe and a non-string selector', () => {
    expect(() => parseRecipeRegistry({ recipes: { 'x.pt': {} } })).toThrow(RecipeRegistryError);
    expect(() => parseRecipeRegistry({ recipes: { 'x.pt': { passwordSelector: 42 } } })).toThrow(RecipeRegistryError);
  });

  it('subdomains inherit the parent recipe — one "same site" rule, not two that can disagree', () => {
    __resetRecipeRegistryForTests();
    expect(recipeForHost('webmail.oa.pt')).toBeTruthy();
    expect(recipeForHost('mail.webmail.oa.pt')).toBeTruthy();
    expect(recipeForHost('oa.pt.evil.example')).toBeUndefined(); // suffix trick does not match
    expect(recipeForHost('unknown-portal.example')).toBeUndefined();
  });
});

describe('F-4: login and signature are different ceremonies (I8)', () => {
  it('a signature is ATTENDED — presence, not a relayed code', () => {
    // Signing is an act of legal authorship bound to the card in the reader in front of the person
    // signing. No code supplied from elsewhere is equivalent evidence.
    expect(routeForHumanAction('signature')).toBe('attended');
  });

  it('a login is RELAY — forcing presence for a password pushes people toward sharing it', () => {
    expect(routeForHumanAction('login')).toBe('relay');
  });

  it('every other classified state relays', () => {
    for (const k of ['captcha', 'mfa', 'payment', 'identity', 'other'] as const) {
      expect(routeForHumanAction(k)).toBe('relay');
    }
  });

  it('an UNCLASSIFIED state claims the WEAKER route, not the stronger one', () => {
    // 'other' must not assert presence-at-a-machine, which is evidence we have not earned.
    expect(routeForHumanAction('other')).toBe('relay');
  });
});

describe('F-4: a credential-adjacent failure never reaches the fixer', () => {
  it('recognises the typist refusals by ERROR NAME', () => {
    for (const name of ['TypistUnknownPattern', 'TypistNotSuppressed', 'CredentialOriginError', 'CofreLockedError']) {
      expect(isCredentialAdjacentFailure({ name, message: 'x' }), name).toBe(true);
    }
  });

  it('survives the serialisation boundary — a persisted record keeps the MESSAGE, not the class', () => {
    // StepRecord persists `error.message`; the class is gone by then. The property must hold anyway.
    expect(isCredentialAdjacentFailure({ message: 'refusing to fill: a viewer is attached' })).toBe(true);
    expect(isCredentialAdjacentFailure({ message: 'login requires an opaque cofre: reference' })).toBe(true);
    expect(isCredentialAdjacentFailure({ message: 'TypistUnknownPattern: no password field' })).toBe(true);
  });

  it('does NOT swallow ordinary failures — the fixer still gets those', () => {
    // Over-matching would quietly disable the fixer for the whole engine, which is its own defect.
    expect(isCredentialAdjacentFailure({ name: 'TimeoutError', message: 'locator timed out' })).toBe(false);
    expect(isCredentialAdjacentFailure({ message: 'net::ERR_CONNECTION_REFUSED' })).toBe(false);
    expect(isCredentialAdjacentFailure(null)).toBe(false);
    expect(isCredentialAdjacentFailure(undefined)).toBe(false);
  });
});
