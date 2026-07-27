import { describe, it, expect } from 'vitest';
import {
  assertOriginAllowed,
  hostMatchesOrigin,
  originFromBaseUrl,
  CredentialOriginError,
} from '../../src/security/origin-binding.js';

/**
 * SECURITY SUITE — credential-to-origin binding (Cofre R-2; invariant I6).
 *
 * The gate's exfiltration scenario: a model-authored `url` plus a model-supplied
 * `authIntegrationKey` sent a live tenant secret to any public host in one hop, because the only
 * gate was an SSRF guard that permits every public host by design.
 */
describe('assertOriginAllowed', () => {
  const stripe = { allowedOrigins: ['api.stripe.com'], credentialLabel: 'stripe' };

  it('allows the bound host', () => {
    expect(() => assertOriginAllowed('https://api.stripe.com/v1/charges', stripe)).not.toThrow();
  });

  it('allows a subdomain of the bound host', () => {
    expect(() => assertOriginAllowed('https://files.api.stripe.com/x', stripe)).not.toThrow();
  });

  it('REFUSES the gate exfiltration scenario', () => {
    expect(() =>
      assertOriginAllowed('https://attacker.example/?k=sk_live_secret', stripe),
    ).toThrow(CredentialOriginError);
  });

  it('REFUSES a lookalike that merely ends with the bound host', () => {
    // A naive endsWith() check would pass this. It must not.
    expect(() => assertOriginAllowed('https://evil-api.stripe.com.attacker.test/x', stripe)).toThrow(
      CredentialOriginError,
    );
    expect(() => assertOriginAllowed('https://notapi.stripe.com.evil.test/', stripe)).toThrow();
  });

  it('REFUSES a parent of the bound host (binding is not symmetric)', () => {
    expect(() => assertOriginAllowed('https://stripe.com/', stripe)).toThrow(CredentialOriginError);
  });

  it('REFUSES an empty binding rather than defaulting open', () => {
    // "We could not determine the binding" must never share a code path with "any host is fine".
    expect(() => assertOriginAllowed('https://api.stripe.com/', { allowedOrigins: [] })).toThrow(
      /must declare the hosts it may reach/,
    );
    expect(() =>
      assertOriginAllowed('https://api.stripe.com/', { allowedOrigins: ['', '   '] }),
    ).toThrow(/must declare the hosts/);
  });

  it('REFUSES an unparseable destination', () => {
    expect(() => assertOriginAllowed('not a url', stripe)).toThrow(/unparseable destination/);
  });

  it('names the credential in the refusal so an operator can see what was withheld', () => {
    expect(() => assertOriginAllowed('https://attacker.example/', stripe)).toThrow(/for stripe/);
  });

  it('is case-insensitive on the host', () => {
    expect(() => assertOriginAllowed('https://API.STRIPE.COM/v1', stripe)).not.toThrow();
    expect(() => assertOriginAllowed('https://api.stripe.com/v1', { allowedOrigins: ['API.Stripe.Com'] })).not.toThrow();
  });

  it('accepts an allowlist entry written as a full origin', () => {
    expect(() =>
      assertOriginAllowed('https://api.stripe.com/v1', { allowedOrigins: ['https://api.stripe.com'] }),
    ).not.toThrow();
  });

  it('ignores a port on the allowlist entry when matching the host', () => {
    expect(() =>
      assertOriginAllowed('https://api.stripe.com/v1', { allowedOrigins: ['api.stripe.com:443'] }),
    ).not.toThrow();
  });

  it('supports multiple bound origins', () => {
    const multi = { allowedOrigins: ['api.stripe.com', 'files.stripe.com'] };
    expect(() => assertOriginAllowed('https://files.stripe.com/a', multi)).not.toThrow();
    expect(() => assertOriginAllowed('https://other.test/a', multi)).toThrow();
  });
});

describe('hostMatchesOrigin', () => {
  it.each([
    ['api.stripe.com', 'api.stripe.com', true],
    ['sub.api.stripe.com', 'api.stripe.com', true],
    ['stripe.com', 'api.stripe.com', false],
    ['evil-stripe.com', 'stripe.com', false],
    ['xstripe.com', 'stripe.com', false],
    ['api.stripe.com.evil.test', 'api.stripe.com', false],
  ])('%s vs %s -> %s', (host, allowed, expected) => {
    expect(hostMatchesOrigin(host, allowed)).toBe(expected);
  });
});

describe('originFromBaseUrl', () => {
  it('derives the host from an integration base URL', () => {
    expect(originFromBaseUrl('https://api.stripe.com/v1')).toBe('api.stripe.com');
    expect(originFromBaseUrl('https://graph.microsoft.com')).toBe('graph.microsoft.com');
  });

  it('returns null for an unusable base URL so the caller refuses rather than binds to nothing', () => {
    expect(originFromBaseUrl('')).toBeNull();
    expect(originFromBaseUrl('{{host}}/v1')).toBeNull();
  });
});
