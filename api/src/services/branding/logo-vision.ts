/**
 * Vision confirmation for the logo pick (ch05 §5.6.4). The heuristic ranking in
 * brand-assets.ts can only score candidates by SOURCE and format - it cannot see them. This
 * module restores what the old browser-driving research agent did by eye, tool-lessly: ONE
 * FAST vision call comparing the downloaded candidates against the rendered header strip,
 * asking "which of these is the logo actually shown on the site?".
 *
 * The model call goes through the llm/ chokepoint (`runOneShot` with `images`, FIXED-3).
 * Non-fatal: any failure returns null and the caller keeps the heuristic pick.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runOneShot, decideForTier, type LlmAttribution } from '../../llm/index.js';
import { getBrandAssetsDir, type LogoCandidate } from './brand-assets.js';

/** Media types the vision endpoint accepts - .ico/.svg candidates are skipped. */
const VISION_MEDIA: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

const MAX_VISION_CANDIDATES = 4;

const LOGO_PICK_SYSTEM = `Vais receber uma captura do TOPO de um site (a primeira imagem) seguida de imagens candidatas numeradas. Identifica qual das candidatas é o LOGÓTIPO da marca visível no cabeçalho do site.

Regras:
- O logótipo é a marca gráfica no canto/cabeçalho do site - NÃO é uma fotografia, um banner, um ícone social, nem um banner de cookies.
- Responde APENAS com o número da candidata (1, 2, ...) ou 0 se nenhuma corresponder ao logótipo visível.
- Sem explicações, sem texto adicional.`;

function mediaTypeOf(c: LogoCandidate): string | null {
  const ext = c.filename.split('.').pop()?.toLowerCase() ?? '';
  return VISION_MEDIA[ext] ?? null;
}

/**
 * Ask the FAST vision tier which downloaded candidate matches the logo shown in the header
 * strip. Returns the matched candidate or null (unparseable answer / "none" / any failure).
 */
export async function pickLogoByVision(
  input: { headerShot: Buffer; candidates: LogoCandidate[]; attribution: LlmAttribution },
): Promise<LogoCandidate | null> {
  // Vision-eligible candidates only, in heuristic order, capped.
  const eligible = input.candidates
    .map((c) => ({ c, media: mediaTypeOf(c) }))
    .filter((e): e is { c: LogoCandidate; media: string } => e.media !== null)
    .slice(0, MAX_VISION_CANDIDATES);
  if (eligible.length < 2) return null; // nothing to disambiguate

  const dir = getBrandAssetsDir();
  const images: Array<{ mediaType: string; data: string }> = [
    { mediaType: 'image/jpeg', data: input.headerShot.toString('base64') },
  ];
  const loaded: LogoCandidate[] = [];
  for (const { c, media } of eligible) {
    try {
      images.push({ mediaType: media, data: readFileSync(join(dir, c.filename)).toString('base64') });
      loaded.push(c);
    } catch {
      /* unreadable candidate: skip it */
    }
  }
  if (loaded.length < 2) return null;

  try {
    const res = await runOneShot(
      {
        prompt: `Primeira imagem: topo do site. Seguem-se ${loaded.length} candidatas numeradas de 1 a ${loaded.length}, pela mesma ordem. Qual é o logótipo?`,
        systemPrompt: LOGO_PICK_SYSTEM,
        images,
        decision: decideForTier('FAST'),
      },
      input.attribution,
    );
    const m = /\b(\d+)\b/.exec(res.text.trim());
    if (!m) return null;
    const n = parseInt(m[1] as string, 10);
    if (!Number.isInteger(n) || n < 1 || n > loaded.length) return null;
    return loaded[n - 1] ?? null;
  } catch (err) {
    console.warn(`[logo-vision] pick failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}
