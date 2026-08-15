/**
 * The org's brand, as a prompt section for the FIRST build (ch05 §5.6.2 first-build branch).
 *
 * Brand reaches a built app on two routes, and only one of them existed. At SERVE time
 * `/api/design-tokens.css` overlays the org's palette, fonts and logo onto the platform defaults
 * — but tokens can only recolour what the agent decided to paint. At BUILD time the agent saw
 * nothing at all: it invented a layout, a header with no brand mark, and a light canvas for orgs
 * whose whole identity is dark. This is that second route: a compact statement of the brand the
 * app is FOR, appended to the base's prompt sections.
 *
 * Deliberately short. It states the brand and the two rules the agent cannot infer (use the real
 * logo through the token contract, never invent one; a dark brand means a dark app) and then
 * points at the token contract for everything else, so the agent reads live values instead of
 * hardcoding this snapshot of them.
 */
import { resolveBrandCanvas } from '../services/design-tokens.js';

/** Free-text brand fields are user-authored and unbounded; the section stays compact. */
const MAX_INSTRUCTIONS = 600;
const MAX_FREE_TEXT = 160;

function trimTo(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}...` : clean;
}

/** The brand's font names, from either spelling research produced (`fontFamily`, `fonts[]`). */
function fontLine(branding: Record<string, unknown>): string | null {
  const fonts = Array.isArray(branding.fonts)
    ? branding.fonts.filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
    : [];
  const named = [trimTo(branding.fontFamily, 60), ...fonts.map((f) => trimTo(f, 60))].filter(
    (f): f is string => f !== null,
  );
  const unique = [...new Set(named)];
  return unique.length > 0 ? unique.join(', ') : null;
}

/** The vision read of the site's feel (`visualVibe`: mood + keyword bullets). */
function vibeLine(branding: Record<string, unknown>): string | null {
  const vibe = branding.visualVibe as { mood?: unknown; bullets?: unknown } | undefined;
  if (!vibe) return null;
  const mood = trimTo(vibe.mood, MAX_FREE_TEXT);
  const bullets = Array.isArray(vibe.bullets)
    ? vibe.bullets.map((b) => trimTo(b, 60)).filter((b): b is string => b !== null).slice(0, 5)
    : [];
  if (!mood && bullets.length === 0) return null;
  return [mood, bullets.join('; ')].filter(Boolean).join(' - ');
}

/**
 * Render the section, or null when the org has no brand worth stating (no colours, no fonts, no
 * logo, no guidance) — a section of empty labels would only spend prompt budget and invite the
 * agent to fill the blanks itself.
 */
export function brandPromptSection(branding: Record<string, unknown> | null | undefined): string | null {
  if (!branding || Object.keys(branding).length === 0) return null;

  const lines: string[] = [];
  const primary = trimTo(branding.primaryColor, 40);
  const secondary = trimTo(branding.secondaryColor, 40);
  const accent = trimTo(branding.accentColor, 40);
  if (primary) lines.push(`- Cor primária: ${primary}`);
  if (secondary) lines.push(`- Cor secundária: ${secondary}`);
  if (accent) lines.push(`- Cor de destaque: ${accent}`);

  const fonts = fontLine(branding);
  if (fonts) lines.push(`- Tipografia da marca: ${fonts}`);

  const tone = trimTo(branding.toneOfVoice, MAX_FREE_TEXT);
  if (tone) lines.push(`- Tom de voz: ${tone}`);

  const vibe = vibeLine(branding);
  if (vibe) lines.push(`- Ambiente visual: ${vibe}`);

  const instructions = trimTo(branding.instructions, MAX_INSTRUCTIONS);
  if (instructions) lines.push(`- Notas de identidade visual: ${instructions}`);

  const hasLogo = typeof branding.logo === 'string' && branding.logo.trim().length > 0;
  if (hasLogo) {
    lines.push(
      '- Logótipo: a organização TEM logótipo próprio, publicado pelo contrato de design em'
        + ' var(--logo-url) e var(--logo-icon-url). Usa a marca real no cabeçalho da aplicação'
        + ' (e no rodapé, quando existir). NUNCA inventes, desenhes ou geres um logótipo.',
    );
  }

  const canvas = resolveBrandCanvas(branding);
  if (canvas?.isDark) {
    lines.push(
      `- Fundo da marca: ${canvas.background} (escuro). Constrói a aplicação ESCURA de raiz - superfícies,`
        + ' texto e contrastes pensados para fundo escuro, não um tema claro com detalhes escuros.',
    );
  }

  if (lines.length === 0) return null;

  return [
    'MARCA DA ORGANIZAÇÃO',
    'Esta aplicação é para uma organização com identidade própria. A marca não é decoração final:',
    'decide o aspeto do produto desde o primeiro ecrã.',
    '',
    ...lines,
    '',
    'Quando a marca define um fundo escuro, a aplicação é construída escura: o estilo claro por',
    'omissão da plataforma cede sempre perante a marca da organização.',
    'Lê os valores em tempo de execução a partir de /api/design-tokens.css (--color-primary,',
    '--color-primary-hover, --color-on-primary, --color-bg, --color-surface, --color-text,',
    '--font-sans, --font-display, --logo-url, --logo-icon-url): essa folha é servida a cada',
    'carregamento e acompanha alterações da marca. Usa literais apenas quando não existir token.',
  ].join('\n');
}
