import { describe, it, expect } from 'vitest';
import { scrubCredentials } from '../../src/automation/engine.js';
import { interpolate } from '../../src/automation/template-vars.js';
import {
  redactSecretValuesIn,
  redactSecretsDeep,
  redactUrl,
  redactHeaders,
  redactBody,
  maskValue,
} from '../../src/integrations/http-template.js';

/**
 * SECURITY SUITE — the credential boundaries the plan leans on (Cofre R-7).
 *
 * The discovery gate's completeness pass found these had ZERO test files each, while other findings
 * were argued down on the basis that "this boundary already handles it". By this repo's own verdict
 * rule an untested seam is not a control, so each is pinned here before anything cites it as
 * prevention.
 */

describe('scrubCredentials — credentials never reach the persisted run row', () => {
  it('drops the credentials key', () => {
    const out = scrubCredentials({ nif: '500000000', credentials: { user: 'u', pass: 'SECRET' } });
    expect(out).toEqual({ nif: '500000000' });
    expect(JSON.stringify(out)).not.toContain('SECRET');
  });

  it('returns the same object identity when there is nothing to scrub (no needless copy)', () => {
    const inputs = { nif: '1' };
    expect(scrubCredentials(inputs)).toBe(inputs);
  });

  it('does not mutate the caller: the in-memory inputs keep credentials for the browser session', () => {
    const inputs = { credentials: { pass: 'SECRET' }, a: 1 };
    scrubCredentials(inputs);
    expect(inputs.credentials).toEqual({ pass: 'SECRET' });
  });

  it('drops credentials even when it is a falsy or oddly-typed value', () => {
    expect(scrubCredentials({ credentials: '' })).toEqual({});
    expect(scrubCredentials({ credentials: null })).toEqual({});
    expect(scrubCredentials({ credentials: 'raw-string-secret' })).toEqual({});
  });
});

describe('template-vars — {{input.credentials}} can never be interpolated', () => {
  const inputs = { credentials: { pass: 'SUPERSECRET', user: 'u' }, nif: '500000000' };

  it.each([
    'flat',
    'dotted',
    'bracketed',
    'spaced',
    'nested dotted',
  ])('refuses the %s form', (form) => {
    const template = {
      flat: '{{input.credentials}}',
      dotted: '{{input.credentials.pass}}',
      bracketed: '{{input.credentials["pass"]}}',
      spaced: '{{  input.credentials.pass  }}',
      'nested dotted': '{{input.credentials.deep.nested.pass}}',
    }[form]!;
    const out = interpolate(template, inputs);
    expect(out).not.toContain('SUPERSECRET');
    expect(out).toBe('');
  });

  it('still interpolates ordinary inputs', () => {
    expect(interpolate('nif={{input.nif}}', inputs)).toBe('nif=500000000');
  });

  it('refuses credentials embedded mid-template without eating the rest', () => {
    const out = interpolate('a={{input.nif}}&b={{input.credentials.pass}}&c=x', inputs);
    expect(out).not.toContain('SUPERSECRET');
    expect(out).toContain('a=500000000');
    expect(out).toContain('c=x');
  });
});

describe('http-template redaction wrappers (now thin callers of security/redaction)', () => {
  const SECRET = 'sk-live-BOUNDARY-TEST-0001';

  it('redactSecretValuesIn masks the value with no plaintext fragment', () => {
    const out = redactSecretValuesIn(`token=${SECRET}`, [SECRET]);
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain('0001'); // the retired maskValue leaked the last four chars
    expect(out).toContain('[REDACTED:');
  });

  it('redactSecretValuesIn catches the URL-encoded form too', () => {
    const withSpecials = 'p@ss/word+x';
    const out = redactSecretValuesIn(`q=${encodeURIComponent(withSpecials)}`, [withSpecials]);
    expect(out).not.toContain(encodeURIComponent(withSpecials));
  });

  it('redactSecretsDeep masks values anywhere in a returned tree', () => {
    const out = redactSecretsDeep({ a: { b: [{ c: SECRET }] }, ok: 'fine' }, [SECRET]);
    expect(JSON.stringify(out)).not.toContain(SECRET);
    expect(JSON.stringify(out)).toContain('fine');
  });

  it('redactSecretsDeep is a no-op with no known secrets', () => {
    const tree = { a: 1 };
    expect(redactSecretsDeep(tree, [])).toBe(tree);
  });

  it('redactUrl masks both the known VALUE and a conventionally-named parameter', () => {
    const out = redactUrl(`https://x.test/a?token=${SECRET}&api_key=unknown-one&page=2`, [SECRET]);
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain('unknown-one');
    expect(out).toContain('page=2');
  });

  it('redactHeaders masks credential-shaped header names but keeps the scheme', () => {
    const out = redactHeaders({ authorization: `Bearer ${SECRET}`, accept: 'application/json' });
    expect(out.authorization).toBe('Bearer [REDACTED]');
    expect(out.authorization).not.toContain(SECRET);
    expect(out.accept).toBe('application/json');
  });

  it('redactBody masks credential-shaped JSON fields', () => {
    const out = redactBody(JSON.stringify({ client_secret: SECRET, page: 2 }));
    expect(out).not.toContain(SECRET);
    expect(out).toContain('2');
  });

  it('maskValue (the compat alias) no longer leaks a suffix', () => {
    expect(maskValue(`Bearer ${SECRET}`)).toBe('Bearer [REDACTED]');
    expect(maskValue(SECRET)).toBe('[REDACTED]');
    expect(maskValue(SECRET)).not.toContain('0001');
  });
});

describe('planner violations report a CATEGORY, never the offending content (H-6)', () => {
  /**
   * A cross-validation violation travels THREE ways: the process log, the RETRY PROMPT sent back
   * to the model, and the `plan_failed` wire plan rendered to the user. The thing being reported
   * is, by definition, a literal credential the model just wrote — so echoing a prefix of it
   * copied the secret into all three.
   */
  it('an auth-shaped header violation names the header, not its value', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../../src/automation/planner.ts', import.meta.url), 'utf8'),
    );
    // The retired form built a 50-char preview of the header VALUE and interpolated it.
    expect(src).not.toContain('valuePreview');
    expect(src).not.toMatch(/sets an auth-shaped header "\$\{k\}"="/);
    expect(src).toMatch(/sets an auth-shaped header "\$\{k\}" to a literal value/);
  });

  it('an argv violation names the POSITION, not the element', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../../src/automation/planner.ts', import.meta.url), 'utf8'),
    );
    expect(src).not.toMatch(/argv\[\$\{j\}\]="\$\{argv\[j\]\}"/);
    expect(src).toMatch(/argv\[\$\{j\}\] contains shell metacharacters/);
  });
});
