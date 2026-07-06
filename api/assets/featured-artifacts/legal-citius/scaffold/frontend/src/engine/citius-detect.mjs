/**
 * Detector CONSERVADOR de notificações Citius (Portugal) — decide se um email é,
 * ou não, uma notificação do Citius que vale a pena processar. Determinístico,
 * zero retrieval. Princípio: só devolve TRUE quando há prova forte, para que
 * email de clientes / newsletters / marketing NUNCA entre no motor de prazos.
 *
 * Duas vias de prova (qualquer uma basta):
 *   1) REMETENTE autoritativo — o email vem de um endereço @citius.mj.pt (ou de
 *      um subdomínio desse domínio). É a via inequívoca.
 *   2) MARCADORES fortes em conjunto — o texto (assunto + corpo) menciona
 *      "Citius" E contém um número de processo no formato CPC E fala em
 *      "notificação". Os três juntos afastam falsos positivos.
 *
 * Reutiliza o `stripHtml` defensivo do parser (remove blocos escondidos) para
 * não ser enganado por conteúdo oculto — a mesma limpeza que o parser aplica.
 */
import { stripHtml } from './citius-parser.mjs';

/** Domínio oficial do Citius. */
const CITIUS_DOMAIN = 'citius.mj.pt';

/** Número de processo CPC: NNNN/NN.NTNLLL (ex.: 1234/26.0T8LSB). Igual ao parser. */
const RE_PROCESSO = /\b\d{1,6}\/\d{2}\.\d[A-Z]\d?[A-Z]{2,4}\b/;

/**
 * Texto simples (assunto + corpo) de um email, com HTML removido de forma
 * defensiva. Aceita a forma neutra do EmailInput ({ subject, body, bodyContentType }).
 */
export function extractPlainText(input) {
  const i = input && typeof input === 'object' ? input : {};
  const subject = String(i.subject == null ? '' : i.subject);
  const body = String(i.body == null ? '' : i.body);
  // stripHtml é inócuo em texto simples (colapsa espaços) e defensivo em HTML.
  return `${subject}\n${stripHtml(body)}`.trim();
}

/** Extrai o domínio (minúsculas) de um endereço de email; '' se não houver. */
function emailDomain(address) {
  const a = String(address == null ? '' : address).trim().toLowerCase();
  const at = a.lastIndexOf('@');
  return at >= 0 ? a.slice(at + 1) : a;
}

/**
 * @typedef {'sender' | 'text' | null} CitiusProvenance
 *   Como a deteção foi feita: 'sender' = remetente autoritativo @citius.mj.pt
 *   (prova forte, origem autenticada); 'text' = SÓ os marcadores de conteúdo
 *   dispararam (Citius + processo + notificação) — plausível, mas o remetente
 *   NÃO está autenticado, pelo que é falsificável; null = não é Citius.
 */

/**
 * Classifica um email quanto a ser (ou não) uma notificação Citius E COMO se
 * chegou a essa conclusão. A PROVENIÊNCIA é o que permite ao chamador decidir se
 * pode automatizar (criar prazos) ou se deve exigir confirmação humana: só o
 * remetente autoritativo ('sender') é de confiar para automação; a deteção só
 * por texto ('text') pode ser forjada por um terceiro e nunca deve, sozinha,
 * criar um prazo.
 *
 * @param {{ from?: { address?: string }, subject?: string, body?: string,
 *   bodyContentType?: string }} input  Forma neutra do EmailInput.
 * @returns {{ match: boolean, provenance: CitiusProvenance }}
 */
export function classifyCitius(input) {
  const i = input && typeof input === 'object' ? input : {};
  const from = i.from && typeof i.from === 'object' ? i.from : {};

  // 1) Remetente é um endereço do domínio Citius (ou subdomínio) -> inequívoco.
  const domain = emailDomain(from.address);
  if (domain === CITIUS_DOMAIN || domain.endsWith(`.${CITIUS_DOMAIN}`)) {
    return { match: true, provenance: 'sender' };
  }

  // 2) Marcadores fortes em conjunto (Citius + processo CPC + notificação). É
  //    forte o suficiente para NÃO ignorar o email, mas NÃO para automatizar:
  //    qualquer terceiro pode escrever este texto -> proveniência 'text'.
  const text = extractPlainText(i);
  const hasCitius = /\bcitius\b/i.test(text);
  const hasProcesso = RE_PROCESSO.test(text);
  const hasNotificacao = /notifica[çc]/i.test(text);
  if (hasCitius && hasProcesso && hasNotificacao) {
    return { match: true, provenance: 'text' };
  }

  return { match: false, provenance: null };
}

/**
 * Superfície booleana retrocompatível (outros chamadores — p.ex. o filtro de
 * comunicações do Núcleo — só querem saber "é Citius, sim/não").
 *
 * @param {{ from?: { address?: string }, subject?: string, body?: string,
 *   bodyContentType?: string }} input  Forma neutra do EmailInput.
 * @returns {boolean} true só quando há prova (forte OU por texto) de ser Citius.
 */
export function isCitiusNotification(input) {
  return classifyCitius(input).match;
}
