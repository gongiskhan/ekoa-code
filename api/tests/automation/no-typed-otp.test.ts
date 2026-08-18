import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as cofre from '../../src/cofre/index.js';
import * as relay from '../../src/cofre/relay.js';
import { typistLogin } from '../../src/automation/typist.js';
import { RelayCompleteRequest, RelayLoginPrompt } from '@ekoa/shared';
import { issueLoginRelayPrompt } from '../../src/cofre/relay.js';

/**
 * THE GUARD: there is no typed-OTP automation, and there is not going to be one (P3.2,
 * docs/decisions.md 2026-08-18).
 *
 * WHY A TEST AND NOT A COMMENT. The pieces to build it are all present and all innocent-looking:
 * `RelayCompleteRequest` has a `code` field, the typist can type into a page, and the login relay
 * now has a producer. Wiring the three together is one small, plausible-looking commit — "the user
 * already has the code, we're just saving them a paste" — and it converts a human ceremony into an
 * unattended credential path against exactly the portals that fight hardest. So the absence is
 * asserted rather than described.
 *
 * WHAT IS ASSERTED, in three layers:
 *   1. STRUCTURE — the relay module exposes a producer and no completion, and the Cofre's public
 *      surface does not re-export one.
 *   2. SIGNATURE — the typist's input has no field a code could be handed through.
 *   3. SOURCE — no module in the credential path mentions `RelayCompleteRequest`/`.code` alongside
 *      the typist. A grep is a blunt instrument; it is here because layers 1 and 2 both pass for an
 *      implementation that smuggles the code in through an existing field.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SRC = `${HERE}../../src`;

function read(rel: string): string {
  return readFileSync(`${SRC}/${rel}`, 'utf8');
}

describe('no typed-OTP primitive exists (P3.2)', () => {
  it('the relay module produces a login prompt and has NO completion entry point', () => {
    const exported = Object.keys(relay);
    expect(exported).toContain('issueLoginRelayPrompt');
    // Nothing that could accept a code and act on it.
    for (const name of exported) {
      expect(name.toLowerCase()).not.toMatch(/complete|submitcode|entercode|typecode/);
    }
  });

  it("the Cofre's public surface exposes no relay completion either", () => {
    for (const name of Object.keys(cofre)) {
      expect(name.toLowerCase()).not.toMatch(/completerelay|relaycomplete/);
    }
  });

  it('the typist has no OTP entry point: nothing in its input can carry a code', () => {
    // `TypistLoginInput` is a type, so the assertion is over the SOURCE of its declaration — the
    // only place a new field could be added.
    const src = read('automation/typist.ts');
    const decl = /export interface TypistLoginInput \{[\s\S]*?\n\}/.exec(src)?.[0] ?? '';
    expect(decl).not.toBe('');
    expect(decl.toLowerCase()).not.toMatch(/\botp\b|\bcode\b|\bmfa\b|totp|onetime|one_time/);
    // And the function itself takes exactly the two documented arguments (input, deps).
    expect(typistLogin.length).toBe(2);
  });

  it('no module in the credential path wires RelayCompleteRequest to anything', () => {
    const modules = [
      'automation/typist.ts',
      'automation/session-establishment.ts',
      'automation/credential-gate.ts',
      'cofre/relay.ts',
      'cofre/sessions.ts',
    ];
    for (const m of modules) {
      const src = read(m);
      // A COMMENT may name it (relay.ts explains at length why it is not wired); an IMPORT may not.
      const withoutComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(withoutComments, `${m} must not import RelayCompleteRequest`).not.toMatch(
        /RelayCompleteRequest/,
      );
    }
  });

  it('the login prompt it DOES produce is a valid login-variant prompt and carries no secret field', () => {
    const prompt = issueLoginRelayPrompt(
      { automationName: 'Sync case list', siteOrigin: 'citius.mj.pt', reason: 'no stored session' },
      { now: () => Date.parse('2026-08-18T10:00:00.000Z'), genId: () => 'rly_fixed' },
    );
    expect(RelayLoginPrompt.safeParse(prompt).success).toBe(true);
    expect(prompt).toEqual({
      operation: 'login',
      relayId: 'rly_fixed',
      automationName: 'Sync case list',
      siteOrigin: 'citius.mj.pt',
      reason: 'no stored session',
      expiresAt: '2026-08-18T10:10:00.000Z',
    });
    // The produced shape has no `code`; the schema that does is a different schema, unused here.
    expect(Object.keys(prompt)).not.toContain('code');
    expect(Object.keys(RelayCompleteRequest.shape)).toContain('code');
  });
});
