import { describe, it, expect } from 'vitest';
import { classifyArtifactType, baseForType, typeForBase } from '../../src/apps/artifact-type.js';
import { BASE_IDS } from '../../src/apps/base-loader.js';
import { ArtifactType } from '@ekoa/shared';

/**
 * operator-run C1, INVERTED MODEL-FIRST post-incident (WS6, 2026-08-08): a request for "um site
 * que fale da aplicação de cobranças do ekoa" (a WEBSITE) built a slide deck. Root cause: the
 * deterministic regex table ran BEFORE the model and (a) had no site/website/página web signal,
 * (b) fired `presentation` on bare "apresentação" - which is also ordinary Portuguese for
 * "showcase/introduce". Fixed: the model runs FIRST on every non-empty request now; the regex
 * table survives ONLY as the offline/failure fallback. `classifyArtifactType` returns
 * `{type, reason}` (the reason is what makes a future misroute self-diagnosing) - `classify()`
 * below unwraps `.type` to keep most assertions terse.
 */
async function classify(
  description: string,
  userId: string,
  deps: Parameters<typeof classifyArtifactType>[2] = {},
  opts: Parameters<typeof classifyArtifactType>[3] = {},
): Promise<ArtifactType> {
  return (await classifyArtifactType(description, userId, deps, opts)).type;
}

describe('classifyArtifactType - model-first primary path (WS6)', () => {
  it('an empty or blank description is the platform default app, no model call (codex C1)', async () => {
    const boom = async () => { throw new Error('must not be called'); };
    expect(await classify('', 'u1', { oneShot: boom })).toBe('app');
    expect(await classify('   \n', 'u1', { oneShot: boom })).toBe('app');
  });

  it('every non-empty request consults the model FIRST - even one a fallback regex could match', async () => {
    // Pre-incident this never reached the model: the deterministic table matched `landing`
    // (page de marketing) before any model call. Now the model is asked regardless.
    let consulted = 0;
    const oneShot = async () => {
      consulted += 1;
      return JSON.stringify({ type: 'landing', reason: 'página de marketing explícita' });
    };
    expect(await classify('Landing page para o escritório', 'u1', { oneShot })).toBe('landing');
    expect(consulted).toBe(1);
  });

  it('THE INCIDENT: a website request classifies as landing via the model, never presentation', async () => {
    const oneShot = async (prompt: string) => {
      expect(prompt).toContain('site que fale da aplicação de cobranças');
      return JSON.stringify({ type: 'landing', reason: 'pede um site institucional (regra 1: site nunca é slides)' });
    };
    expect(await classify('um site que fale da aplicação de cobranças do ekoa', 'u1', { oneShot })).toBe('landing');
  });

  it("parses the model's {type, reason} JSON, tolerating a ``` fence", async () => {
    const oneShot = async () => '```json\n{"type": "presentation", "reason": "pitch deck explícito"}\n```';
    expect(await classify('faz-me um pitch deck para a ronda seed', 'u1', { oneShot })).toBe('presentation');
  });

  it('feeds attachment filenames to the model prompt (DO #4)', async () => {
    let seenPrompt = '';
    const oneShot = async (prompt: string) => {
      seenPrompt = prompt;
      return JSON.stringify({ type: 'document', reason: 'anexo Word para rever' });
    };
    await classify('revê isto com registo de alterações', 'u1', { oneShot }, { attachments: ['contrato-final.docx'] });
    expect(seenPrompt).toContain('contrato-final.docx');
  });

  it('unparseable model output falls back to the deterministic signal table', async () => {
    const oneShot = async () => 'não sei, talvez uma app?'; // not JSON
    expect(await classify('Gestor de processos com prazos', 'u1', { oneShot })).toBe('app');
  });

  it('a syntactically valid but out-of-enum type falls back to the deterministic signal table', async () => {
    const oneShot = async () => JSON.stringify({ type: 'spreadsheet', reason: 'not a real type' });
    expect(await classify('Relatório mensal de honorários', 'u1', { oneShot })).toBe('report');
  });

  it('a thrown one-shot (offline/credential failure) falls back to the deterministic signal table', async () => {
    const oneShot = async () => { throw new Error('no credential'); };
    expect(await classify('Um contrato de prestação de serviços', 'u1', { oneShot })).toBe('document');
  });
});

describe('regex fallback - offline/model-failure path only (SIGNALS table)', () => {
  const boom = async () => { throw new Error('the model must not be reached - these assertions exist to prove the FALLBACK table, not the model'); };

  it('THE INCIDENT, offline: a website request still resolves to landing via the fallback table', async () => {
    expect(await classify('um site que fale da aplicação de cobranças do ekoa', 'u1', { oneShot: boom })).toBe('landing');
  });

  it('site/website/página web is landing, never presentation (incident fix)', async () => {
    const cases: Array<[string, ArtifactType]> = [
      ['Preciso de um site para o escritório', 'landing'],
      ['Quero um website para a clínica', 'landing'],
      ['Uma página web simples para a loja', 'landing'],
      ['site de apresentação da empresa', 'landing'], // "apresentação" here = showcase, not slides
      ['A static page', 'landing'],
      ['Uma página estática de apresentação do escritório', 'landing'],
    ];
    for (const [desc, want] of cases) {
      expect(await classify(desc, 'u1', { oneShot: boom }), desc).toBe(want);
    }
  });

  it('presentation requires a real deck anchor, not bare "apresentação"', async () => {
    expect(await classify('Faz-me um pitch deck para a ronda seed', 'u1', { oneShot: boom })).toBe('presentation');
    expect(await classify('Preciso de slides para a reunião de amanhã', 'u1', { oneShot: boom })).toBe('presentation');
    expect(await classify('Diapositivos para a formação de amanhã', 'u1', { oneShot: boom })).toBe('presentation');
    // DELIBERATE behaviour change (see the SIGNALS doc comment in artifact-type.ts): bare
    // "apresentação" with no deck anchor no longer matches in the FALLBACK table - it is
    // genuinely ambiguous with "apresentação" meaning "showcase" (the incident's own root
    // cause). The model (primary path, tested above) still gets this phrase right via the
    // worked example in CLASSIFY_SYSTEM; only the rare offline/model-failure path now answers
    // the safer "in doubt → app" default instead of guessing slides.
    expect(await classify('Uma apresentação sobre o novo regime fiscal', 'u1', { oneShot: boom })).toBe('app');
  });

  it('other strong PT/EN signals still classify deterministically', async () => {
    const cases: Array<[string, ArtifactType]> = [
      ['Relatório mensal de honorários', 'report'],
      ['Um contrato de prestação de serviços', 'document'],
      ['Minuta de procuração forense', 'document'],
      ['Gestor de processos com prazos', 'app'],
      ['A budget tracker with charts', 'app'],
    ];
    for (const [desc, want] of cases) {
      expect(await classify(desc, 'u1', { oneShot: boom }), desc).toBe(want);
    }
  });

  it('the earliest signal wins: head nouns beat later co-occurring words (codex C1)', async () => {
    expect(await classify('Uma app para gerar contratos de arrendamento', 'u1', { oneShot: boom })).toBe('app');
    expect(await classify('Gestor de contratos com prazos', 'u1', { oneShot: boom })).toBe('app');
    expect(await classify('Contrato de arrendamento para o gestor', 'u1', { oneShot: boom })).toBe('document');
  });

  // 2C-S6: reviewing an EXISTING Word file is a document build (the base's source-linked
  // mode edits the real .docx with native tracked changes). Every phrase is ANCHORED to a
  // document/Word noun in the same clause - see the misroute guard below, which is the
  // whole reason the regex is shaped the way it is.
  it("Word's review vocabulary routes to document when it names the document", async () => {
    const cases = [
      'Revê o ficheiro em anexo com registo de alterações',
      'reve o anexo com registo de alteracoes', // unaccented PT is just as common
      'Aceita as alterações registadas no ficheiro que enviei',
      'Preciso de controlar alterações neste ficheiro',
      'Marcas de revisão no anexo, por favor',
      'Preciso de um redline do ficheiro em anexo',
      'Aplica track changes no ficheiro que enviei',
      'apply tracked changes to the contract',
    ];
    for (const desc of cases) {
      expect(await classify(desc, 'u1', { oneShot: boom }), desc).toBe('document');
    }
  });

  it('MISROUTE GUARD: an unanchored review phrase is ordinary app vocabulary, never a document', async () => {
    // NONE of these phrases is Word-only. "registo de alterações" is plain Portuguese for a
    // CHANGE LOG, and "track changes" is version-control jargon - so unbound from a document
    // noun they must NOT hit the document signal. None of them carries any other signal
    // either, so the honest fallback outcome is "no deterministic hit" → the platform default.
    const ambiguous = [
      'Portal para registar alterações de morada dos clientes',
      'Preciso de controlo de alterações nos tickets de suporte',
      'track changes no codigo',
      'Preciso de track changes no código',
      'add track changes in the repo',
    ];
    for (const desc of ambiguous) {
      expect(await classify(desc, 'u1', { oneShot: boom }), desc).toBe('app');
    }
    // App head nouns keep winning deterministically (earliest match), never the review phrase.
    const apps = [
      'App para gerir o registo de alterações dos processos',
      'Preciso de registo de alterações no meu CRM',
      'Quero registo de alterações por utilizador no kanban',
      'Ferramenta para registar alterações no inventário e avisar o gestor',
    ];
    for (const desc of apps) {
      expect(await classify(desc, 'u1', { oneShot: boom }), desc).toBe('app');
    }
  });

  it('no deterministic signal matched defaults to app ("in doubt → app")', async () => {
    expect(await classify('Algo indefinido para o escritório', 'u1', { oneShot: boom })).toBe('app');
  });
});

describe('type<->base mappings (unchanged)', () => {
  it('type<->base mappings are total and land on real bases', () => {
    for (const t of ArtifactType.options) {
      expect(BASE_IDS).toContain(baseForType(t));
    }
    for (const b of BASE_IDS) {
      expect(ArtifactType.options).toContain(typeForBase(b));
    }
    expect(baseForType('report')).toBe('document'); // reports share the print shell
  });
});
