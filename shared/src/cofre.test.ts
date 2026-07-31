import { describe, it, expect } from 'vitest';
import {
  CredentialRef,
  CofreItem,
  Grant,
  GrantDuration,
  RelayPrompt,
  CofreRegistoMetadata,
  StepDeclaration,
  assertGrantAllowedForItemType,
  CREDENTIAL_REF_PATTERN,
} from './cofre.js';

/**
 * CONTRACT — the Cofre vocabulary, and specifically the two invariants encoded as SCHEMA rather
 * than prose (Cofre WS-A). A rule that lives only in a docstring is a rule a future change drops
 * silently; these cases are what make I7 and I8 structural.
 */

describe('CredentialRef — the model only ever sees references', () => {
  it('accepts an opaque cofre reference', () => {
    expect(CredentialRef.safeParse('cofre:itm_abc-123').success).toBe(true);
  });

  it.each([
    ['a raw provider key', 'sk-live-abcdef123456'],
    ['a value wearing the prefix', 'cofre:sk-live-abcdef!'],
    ['a bare value', 'hunter2'],
    ['an empty string', ''],
    ['a whitespace-padded ref', ' cofre:abc '],
    ['a ref with a slash (path-shaped)', 'cofre:a/b'],
    ['an over-long ref', `cofre:${'a'.repeat(65)}`],
  ])('REJECTS %s', (_label, value) => {
    expect(CredentialRef.safeParse(value).success).toBe(false);
  });

  it('the pattern is anchored at both ends', () => {
    expect(CREDENTIAL_REF_PATTERN.test('xcofre:abc')).toBe(false);
    expect(CREDENTIAL_REF_PATTERN.test('cofre:abc\nmore')).toBe(false);
  });
});

describe('CofreItem — the view can never carry a value', () => {
  const valid = {
    id: 'itm_1',
    ref: 'cofre:itm_1',
    type: 'password' as const,
    label: 'Citius',
    state: 'locked' as const,
    boundOrigins: ['citius.tribunaisnet.mj.pt'],
    createdAt: '2026-07-27T00:00:00.000Z',
  };

  it('parses a well-formed item', () => {
    expect(CofreItem.safeParse(valid).success).toBe(true);
  });

  it('has no field that accepts a secret — an extra "value" is stripped, never surfaced', () => {
    const parsed = CofreItem.parse({ ...valid, value: 'SUPERSECRET' } as Record<string, unknown>);
    expect(JSON.stringify(parsed)).not.toContain('SUPERSECRET');
    expect('value' in parsed).toBe(false);
  });

  it('rejects an item whose ref is value-shaped', () => {
    expect(CofreItem.safeParse({ ...valid, ref: 'sk-live-abc' }).success).toBe(false);
  });
});

describe('I7 — signature authority never enters the grant/TTL model', () => {
  it('allows a this_run grant on a certificate identity', () => {
    const g = Grant.safeParse({
      scope: 'this_run',
      credentialId: 'itm_cc',
      issuedByUserId: 'u1',
      issuedAt: '2026-07-27T00:00:00.000Z',
      runId: 'run-1',
    });
    expect(g.success).toBe(true);
  });

  it('REJECTS a TTL grant on a certificate identity', () => {
    const g = Grant.safeParse({
      scope: 'ttl',
      credentialId: 'itm_cc',
      issuedByUserId: 'u1',
      issuedAt: '2026-07-27T00:00:00.000Z',
      duration: '1_day',
      expiresAt: '2026-07-28T00:00:00.000Z',
      itemType: 'certificate_identity',
    });
    expect(g.success).toBe(false);
  });

  it('REJECTS an until-locked grant on a certificate identity', () => {
    const g = Grant.safeParse({
      scope: 'until_locked',
      credentialId: 'itm_cc',
      issuedByUserId: 'u1',
      issuedAt: '2026-07-27T00:00:00.000Z',
      itemType: 'certificate_identity',
    });
    expect(g.success).toBe(false);
  });

  it('still allows a TTL grant on an ordinary password item', () => {
    const g = Grant.safeParse({
      scope: 'ttl',
      credentialId: 'itm_pw',
      issuedByUserId: 'u1',
      issuedAt: '2026-07-27T00:00:00.000Z',
      duration: '40_minutes',
      expiresAt: '2026-07-27T00:40:00.000Z',
      itemType: 'password',
    });
    expect(g.success).toBe(true);
  });

  it('the runtime guard throws for every non-this_run duration on a signature identity', () => {
    for (const d of GrantDuration.options) {
      if (d === 'this_run') {
        expect(() => assertGrantAllowedForItemType('certificate_identity', d)).not.toThrow();
      } else {
        expect(() => assertGrantAllowedForItemType('certificate_identity', d)).toThrow(/I7/);
      }
    }
  });

  it('the runtime guard leaves ordinary item types alone', () => {
    for (const d of GrantDuration.options) {
      expect(() => assertGrantAllowedForItemType('password', d)).not.toThrow();
      expect(() => assertGrantAllowedForItemType('session', d)).not.toThrow();
    }
  });
});

describe('I8 — a signature relay cannot exist without showing the document', () => {
  const common = {
    relayId: 'r1',
    automationName: 'Citius notificações',
    siteOrigin: 'https://citius.tribunaisnet.mj.pt',
    expiresAt: '2026-07-27T00:10:00.000Z',
  };

  it('parses a login prompt with no document fields', () => {
    expect(RelayPrompt.safeParse({ ...common, operation: 'login', reason: 'sessão expirou' }).success).toBe(true);
  });

  it('REJECTS a signature prompt with no document name', () => {
    expect(
      RelayPrompt.safeParse({ ...common, operation: 'signature', documentHash: 'abc' }).success,
    ).toBe(false);
  });

  it('REJECTS a signature prompt with no document hash', () => {
    expect(
      RelayPrompt.safeParse({ ...common, operation: 'signature', documentName: 'contrato.pdf' }).success,
    ).toBe(false);
  });

  it('REJECTS a signature prompt with an EMPTY document name (present but useless)', () => {
    expect(
      RelayPrompt.safeParse({ ...common, operation: 'signature', documentName: '', documentHash: 'abc' }).success,
    ).toBe(false);
  });

  it('accepts a fully-formed signature prompt', () => {
    expect(
      RelayPrompt.safeParse({
        ...common,
        operation: 'signature',
        documentName: 'contrato.pdf',
        documentHash: 'sha256:abc',
      }).success,
    ).toBe(true);
  });

  it('a login prompt does NOT satisfy the signature variant — the union is the enforcement', () => {
    const login = RelayPrompt.parse({ ...common, operation: 'login', reason: 'r' });
    expect(login.operation).toBe('login');
    // Structurally: a login prompt has no document fields to render, so a UI typed on the union
    // cannot render a signature ceremony from it.
    expect('documentName' in login).toBe(false);
  });
});

describe('Cofre Registo metadata is strict — a row can never carry a value', () => {
  it('accepts ids, origins and counts', () => {
    expect(
      CofreRegistoMetadata.safeParse({
        itemId: 'itm_1',
        runId: 'run-1',
        targetOrigin: 'citius.tribunaisnet.mj.pt',
        scope: 'this_run',
      }).success,
    ).toBe(true);
  });

  it('REJECTS an unknown key — this is what .passthrough() on RegistoEntry allowed through', () => {
    expect(CofreRegistoMetadata.safeParse({ itemId: 'itm_1', password: 'SUPERSECRET' }).success).toBe(false);
    expect(CofreRegistoMetadata.safeParse({ value: 'sk-live-abc' }).success).toBe(false);
  });
});

describe('StepDeclaration defaults', () => {
  it('defaults offlinePolicy to fail — the safe option is the one you get by not choosing', () => {
    const d = StepDeclaration.parse({});
    expect(d.offlinePolicy).toBe('fail');
    expect(d.target).toEqual({ kind: 'cloud' });
    expect(d.attended).toBe(false);
    expect(d.credentialRefs).toEqual([]);
  });

  it('rejects a credentialRef that is actually a value', () => {
    expect(StepDeclaration.safeParse({ credentialRefs: ['sk-live-abcdef'] }).success).toBe(false);
  });
});
