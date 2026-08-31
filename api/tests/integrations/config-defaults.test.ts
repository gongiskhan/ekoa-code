import { describe, it, expect } from 'vitest';
import { publicConfigWithDefaults } from '../../src/integrations/definitions.js';

/**
 * `configSchema` defaults for the non-secret projection an action runs with.
 *
 * WHY THIS EXISTS. A package could state a default only in prose - the shipped citius package's
 * `portal_url` says "por omissao https://portal.tribunais.org.pt" in its `helpText` - and no code
 * could read it, so the address stayed hardcoded in the automation template and the config field
 * was decoration. `defaultValue` makes the default one declared string, and this is the single
 * place it is applied.
 */
const schema = [
  { key: 'portal_url', label: 'Portal', type: 'url' as const, required: false, secret: false, defaultValue: 'https://portal.tribunais.org.pt' },
  { key: 'cedula', label: 'Cedula', type: 'string' as const, required: true, secret: false },
  { key: 'token', label: 'Token', type: 'password' as const, required: false, secret: true, defaultValue: 'NEVER' },
];

describe('publicConfigWithDefaults', () => {
  it('fills a field the tenant never answered', () => {
    expect(publicConfigWithDefaults(schema, { cedula: '12345' })).toEqual({
      cedula: '12345',
      portal_url: 'https://portal.tribunais.org.pt',
    });
  });

  it('never overrides a value the tenant DID give', () => {
    const out = publicConfigWithDefaults(schema, { cedula: '12345', portal_url: 'http://127.0.0.1:45190' });
    expect(out?.portal_url).toBe('http://127.0.0.1:45190');
  });

  it('treats a stored EMPTY STRING as unanswered', () => {
    // Optional text inputs post `""` rather than omitting the key, so "present" cannot mean
    // "answered" - an untouched optional field would otherwise defeat its own default.
    const out = publicConfigWithDefaults(schema, { cedula: '12345', portal_url: '' });
    expect(out?.portal_url).toBe('https://portal.tribunais.org.pt');
  });

  it('NEVER defaults a secret field - a defaulted credential is a shared credential', () => {
    const out = publicConfigWithDefaults(schema, { cedula: '12345' });
    expect(out).not.toHaveProperty('token');
  });

  it('applies defaults even when the config row has no projection at all', () => {
    expect(publicConfigWithDefaults(schema, undefined)).toEqual({ portal_url: 'https://portal.tribunais.org.pt' });
  });

  it('passes the projection through untouched when no field declares a default', () => {
    const values = { a: '1' };
    const noDefaults = [{ key: 'a', label: 'A', type: 'string' as const, required: false, secret: false }];
    expect(publicConfigWithDefaults(noDefaults, values)).toBe(values);
    expect(publicConfigWithDefaults(noDefaults, undefined)).toBeUndefined();
  });
});
