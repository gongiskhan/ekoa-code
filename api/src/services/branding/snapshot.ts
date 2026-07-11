/**
 * Snapshot assembly + prompts for brand research (ch05 §5.6.4).
 *
 * The agent is TOOL-LESS: it never sees the site, only this server-built snapshot.
 * Two prompt modes:
 *  - GROUNDED: the site was reachable; the model picks from the snapshot's
 *    candidate lists and is forbidden from inventing anything ("usa APENAS a
 *    informação do snapshot").
 *  - KNOWLEDGE: the site was unreachable; the model degrades honestly to
 *    brand-knowledge proposals, flagged by `confidence` (the pre-port behavior).
 */

import { normalizeFontKey, type SiteBuilder } from './site-builder.js';
import { summarizeSiteContext, type SiteContext } from './site-context.js';
import { summarizeDesignSystem, filterDesignSystemChrome, type DesignSystem } from './design-system.js';
import { summarizeVisualVibe, type VisualVibe } from './visual-vibe.js';
import type { RenderedCandidates } from './rendered-candidates.js';

/**
 * Grounded system prompt (PT-PT). Strict single-JSON-object output; every field
 * must come from the snapshot; unknown fields are omitted, not invented.
 */
export const GROUNDED_SYSTEM = `És o investigador de marca da plataforma. Foi-te fornecido, mais abaixo, um SNAPSHOT do site da empresa, construído por código do servidor (o agente não navega). A tua tarefa é sintetizar a identidade de marca a partir DESSE snapshot.

Regras absolutas:
- Usa APENAS a informação presente no snapshot. NÃO inventes cores, tipos de letra, nomes ou traços que não estejam lá.
- Toda a cor que devolveres tem de aparecer LITERALMENTE numa das listas de candidatos do snapshot (hex minúsculo de 6 dígitos).
- Se o snapshot não contém um campo, OMITE-O (não devolvas null nem um valor inventado).
- "confidence" reflete a cobertura de evidência do snapshot: muitos sinais concordantes = "high"; sinais escassos = "low".

Responde com EXATAMENTE um objeto JSON (sem texto antes ou depois, sem cercas de código):
{
  "websiteUrl": "<o URL final do snapshot>",
  "primaryColor": "#rrggbb",
  "secondaryColor": "#rrggbb",
  "accentColor": "#rrggbb",
  "fonts": ["<família tipográfica do snapshot>"],
  "toneOfVoice": "<uma frase sobre o tom de comunicação, a partir do texto visível>",
  "instructions": "<3-6 frases acionáveis de identidade visual: forma dominante, ambiente/mood, densidade, textura, estilo do botão principal, citando os rótulos do snapshot>",
  "summary": "<2-3 frases sobre a empresa e o racional das escolhas>",
  "confidence": "low" | "medium" | "high"
}`;

/**
 * Knowledge system prompt (PT-PT) - the honest-degradation path when the site is
 * unreachable. Colors/fonts/tone are PROPOSALS from brand knowledge, flagged by
 * `confidence`; the agent never claims to have measured the page.
 */
export const KNOWLEDGE_SYSTEM = `És o investigador de marca da plataforma. NÃO foi possível aceder ao site (bloqueado, offline, ou a rejeitar pedidos automáticos). Propõe a identidade de marca a partir do teu conhecimento sobre a marca e das convenções do setor. NÃO tens ferramentas nem acesso à web: nunca afirmes ter medido cores ou lido a página; as tuas propostas são estimativas assinaladas por "confidence".

Responde com EXATAMENTE um objeto JSON (sem texto antes ou depois, sem cercas de código):
{
  "websiteUrl": "<o URL recebido>",
  "primaryColor": "#rrggbb",
  "accentColor": "#rrggbb",
  "secondaryColor": "#rrggbb",
  "fonts": ["<família tipográfica proposta>"],
  "toneOfVoice": "<uma frase sobre o tom de comunicação>",
  "summary": "<2-3 frases sobre a empresa e o racional das escolhas>",
  "confidence": "low" | "medium" | "high"
}

Regras: cores em hexadecimal de 6 dígitos; omite qualquer campo que não consigas propor com razoabilidade (nunca inventes um URL de logótipo); "confidence" reflete o teu conhecimento real da marca - uma marca conhecida = "high", uma empresa desconhecida = "low" com uma paleta profissional adequada ao setor.`;

export interface ScrubbedInputs {
  site: SiteContext;
  designSystem: DesignSystem | null;
}

/**
 * On a detected builder host, the linked theme CSS carries the builder's ENTIRE
 * default palette + font catalog. The raw-CSS scan can't tell those from the
 * owner's real colors, but the rendered pass can (it only sees what PAINTS). So
 * trust the CSS scan only where it corroborates the rendered signal, and scrub
 * dembrandt against the discovered chrome (it runs in a subprocess we cannot
 * DOM-strip). Only intersects when the render actually succeeded. Returns new
 * objects; does not mutate the inputs.
 */
export function scrubBuilderChrome(
  site: SiteContext,
  rendered: RenderedCandidates,
  designSystem: DesignSystem | null,
  builder: SiteBuilder | null,
): ScrubbedInputs {
  // Site-builder chrome scrubbing (painted-colour intersection) is a builder-specific
  // heuristic and only runs when a builder is detected. The DESIGN-SYSTEM filter, however,
  // must ALWAYS run: it also strips cookie-consent vendor chrome (Cookiebot/OneTrust/etc.),
  // which appears on custom sites with no builder (observed live 2026-07-11: plmj.com's
  // dembrandt palette was all `cybotcookiebotdialog...` sources). filterDesignSystemChrome
  // no-ops safely when there is no chrome and no builder.
  let scrubbedSite = site;
  if (builder && rendered.ok) {
    const painted = new Set(rendered.paintedHexes);
    const renderedFontKeys = new Set(rendered.topFonts.map(normalizeFontKey));
    const colorCandidates = site.colorCandidates.filter((c) => painted.has(c.hex));
    const fontCandidates =
      renderedFontKeys.size > 0
        ? site.fontCandidates.filter((f) => renderedFontKeys.has(normalizeFontKey(f)))
        : site.fontCandidates;
    scrubbedSite = { ...site, colorCandidates, fontCandidates };
  }

  const scrubbedDesign = designSystem
    ? filterDesignSystemChrome(designSystem, {
        chromeColors: rendered.chromeColors,
        chromeFonts: rendered.chromeFonts,
        builder,
      })
    : designSystem;

  return { site: scrubbedSite, designSystem: scrubbedDesign };
}

export interface BuildSnapshotInput {
  site: SiteContext;
  rendered: RenderedCandidates;
  designSystem: DesignSystem | null;
  visualVibe: VisualVibe | null;
  builder: SiteBuilder | null;
}

/**
 * Build the grounded user turn: the assembled snapshot sections + strict
 * color-selection rules that adapt to which signals are present.
 */
export function buildGroundedPrompt(input: BuildSnapshotInput): string {
  const { site, rendered, designSystem, visualVibe, builder } = input;

  const snapshotSection = summarizeSiteContext(site, rendered.candidates);
  const designSection = designSystem ? '\n\n' + summarizeDesignSystem(designSystem) : '';
  const vibeSection = visualVibe ? '\n\n' + summarizeVisualVibe(visualVibe) : '';

  // On a builder site the raw-CSS scan surfaces the builder's whole theme font
  // catalog (fonts the owner never uses, zero rendered area) - prefer the fonts
  // that actually paint. Not applied to normal sites, where a brand font can
  // legitimately live only in an SVG logo/tagline with near-zero DOM area.
  const renderedFontsSection =
    builder && rendered.topFonts.length > 0
      ? `\n\n## Tipos de letra renderizados (PREFERIR, ordenados por área)\nEste site está num construtor cujo tema declara muitos tipos de letra que o dono nunca usa. Estes são os que REALMENTE pintam a página, do mais usado para o menos. Usa o PRIMEIRO como fonte principal, salvo se o sistema de design nomear uma fonte de marca mais específica.\n${rendered.topFonts.map((f, i) => `  ${i + 1}. ${f}`).join('\n')}`
      : '';

  const hasDesignSystem = designSystem != null;
  const hasRendered = rendered.candidates.length > 0;

  const colorRules = hasDesignSystem
    ? `## Regras de seleção de cor (ESTRITAS, com sinais do sistema de design)
Prioridade das fontes:
1. Variáveis CSS com nome de marca (--primary, --brand, --accent, --main-color) na secção "Sistema de design" - o sinal de intenção mais forte.
2. O fundo ("fundo") do "Estilo do botão principal" - a cor real do CTA.
3. Entradas de paleta de alta confiança cujas "sources" mencionem button/bg-primary/header_bg.
4. A lista "Rendered brand-color candidates" (pré-ordenada por brandFit x sqrt(área)).
5. A lista "CSS-frequency candidates" (por bucket) como último recurso.
- primaryColor: prefere uma variável CSS de marca não-neutra; senão o fundo do botão; senão a entrada de paleta de maior confiança; senão o topo dos rendered.
- secondaryColor / accentColor: famílias de cor distintas de primaryColor, pela mesma prioridade. Omite se nada qualificar.`
    : hasRendered
      ? `## Regras de seleção de cor (ESTRITAS)
A lista "Rendered brand-color candidates" foi amostrada da página renderizada, pré-ordenada por brandFit x sqrt(área): a PRIMEIRA entrada é a cor de marca mais forte que realmente pinta a página.
- primaryColor: a PRIMEIRA entrada dos rendered.
- secondaryColor: o próximo candidato rendered de bucket de matiz diferente; senão o melhor candidato CSS de outro bucket; senão omite.
- accentColor: outro bucket distinto; senão omite.
- Não inventes cores: cada hex tem de aparecer literalmente numa das listas.`
      : `## Regras de seleção de cor (ESTRITAS)
Os candidatos estão agrupados por bucket de matiz, já ordenados por qualidade de marca. NÃO escolhas por frequência bruta - usa a ordem dada.
- primaryColor: a PRIMEIRA entrada do bucket #1.
- secondaryColor: a PRIMEIRA entrada de um bucket DIFERENTE (evita buckets só de quase-preto/quase-branco); senão omite.
- accentColor: qualquer bucket restante, distinto de primary e secondary; senão omite.
- Não inventes cores: cada hex tem de aparecer literalmente na lista de candidatos.`;

  return `Foi obtido um snapshot do site abaixo. Usa APENAS a informação do snapshot - não especules sobre cores, tipos de letra ou traços que não estejam presentes. Se não conseguires determinar um campo, omite-o.

## Snapshot do site

${snapshotSection}${renderedFontsSection}${designSection}${vibeSection}

## Tarefa

Devolve um único objeto JSON com a estrutura do teu prompt de sistema. Escolhe as cores das fontes acima, seguindo as regras de prioridade.

${colorRules}

## Orientação de identidade visual (para o campo "instructions")
Escreve 3-6 frases que um gerador de UI possa USAR para reproduzir a sensação da marca:
- Nomeia a linguagem de forma dominante (angular/arredondada/pill) - se apareceu uma linha "Linguagem de forma", cita-a.
- Nomeia o ambiente (mood), densidade e textura - se apareceu uma secção "Vibe visual", cita os seus rótulos.
- Menciona o estilo do botão principal se foi extraído (raio + espaçamento + fundo).
- Não escrevas prosa de marketing. Escreve instruções de estilo concretas e acionáveis.`;
}
