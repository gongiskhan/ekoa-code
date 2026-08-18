import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Claims-ceiling gate (§17.9, §18.6 publish gate): NO user-facing surface may make a forbidden claim,
 * and no automation-tier confidentiality claim may appear anywhere (blocked entirely this run). We
 * grep the claims-bearing surfaces — the centralised PT-PT strings and the claims-bearing docs — for
 * the forbidden phrasings (EN literals from §17.9 + their PT paraphrases) and assert none appear.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

/**
 * The claims-bearing user-facing surfaces this package OWNS: the centralised PT-PT strings the
 * daemon prints, and the installer copy an operator reads while installing it.
 *
 * When the daemon lived in its own repository this list also named `docs/custody-map.md` and
 * `docs/product-overview.md`. Those documents did not move here (this package's docs are ekoa-code
 * docs now, authored fresh rather than dropped in), so gating a path that no longer exists would
 * make this suite fail for a missing file rather than for a forbidden claim. The installers were
 * never in the list and are added in their place: they ship real PT-PT product copy to a user, and
 * are exactly the kind of surface a confidentiality claim tends to appear on.
 */
const SURFACES = [
  'src/i18n/pt.ts',
  'packaging/README.md',
  'packaging/install.sh',
  'packaging/install.ps1',
];

/** Forbidden claims — §17.9 EN list + PT paraphrases that mean the same. Case-insensitive substrings. */
const FORBIDDEN = [
  // "Sensitive data never reaches the AI/LLM" (unqualified)
  'never reaches the ai',
  'never reaches the llm',
  'nenhum dado sensível chega ao modelo', // unqualified PT form (the claimable form is qualified)
  // "Your data never leaves your machine"
  'your data never leaves your machine',
  'os seus dados nunca saem da sua máquina',
  'nunca saem da máquina',
  // "Masked before leaving your machine"
  'masked before leaving your machine',
  'mascarado antes de sair da sua máquina',
  'mascarados antes de sair da máquina',
  // "Ekoa never sees your data"
  'ekoa never sees your data',
  'a ekoa nunca vê os seus dados',
  // arts. 75/76 EOA applied to hosted data
  'artigos 75',
  'art. 75',
  '75.º/76.º',
  // "Ekoa is immune to production orders"
  'immune to production orders',
  'imune a ordens',
  // on-premises / local placement
  'on-premises',
  'on-premise',
];

/** Automation-tier confidentiality claims are blocked entirely this run — no "bash/browser is safe/
 *  private/contained" copy may ship. We check the user-facing surfaces don't advertise the tier. */
const FORBIDDEN_AUTOMATION_CLAIMS = [
  'automation is private',
  'automação é privada',
  'automação é segura',
  'bash is contained',
  'browser is contained',
];

function readSurface(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8').toLowerCase();
}

describe('claims ceiling (§17.9 / §18.6 publish gate)', () => {
  for (const rel of SURFACES) {
    it(`${rel} contains no forbidden confidentiality claim`, () => {
      const text = readSurface(rel);
      for (const phrase of FORBIDDEN) {
        expect(text.includes(phrase.toLowerCase()), `forbidden claim in ${rel}: "${phrase}"`).toBe(false);
      }
    });

    it(`${rel} makes no automation-tier confidentiality claim (blocked this run)`, () => {
      const text = readSurface(rel);
      for (const phrase of FORBIDDEN_AUTOMATION_CLAIMS) {
        expect(text.includes(phrase.toLowerCase()), `automation claim in ${rel}: "${phrase}"`).toBe(false);
      }
    });
  }

  it('the PT-PT strings module uses the formal register markers (spot check)', () => {
    const pt = readFileSync(resolve(ROOT, 'src/i18n/pt.ts'), 'utf8');
    // Formal register + PT-PT spelling conventions appear (o seu / a sua / do seu).
    expect(pt).toMatch(/o seu|a sua|do seu/i);
  });
});
