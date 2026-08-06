/**
 * Served-app DOCUMENT EXTRACTION — the brain behind `POST /api/app-vision/extract`
 * (ported from ekoa-dev `1d4eaf64`).
 *
 * A collections app is only as good as the data somebody typed into it, and nobody wants to type
 * an invoice. So the app hands over the document and gets back structured fields. Two inputs, one
 * contract:
 *
 *   - an IMAGE (a photo or a screenshot of an invoice) → the model looks at it;
 *   - a PDF → the text layer is extracted server-side and a text-only pass reads it. Free, exact,
 *     and it does not ask a vision model to re-read characters the file already contains.
 *
 * A SCANNED PDF IS REFUSED, not guessed at. It has no text layer, and `no_text_layer` tells the
 * app to ask the user to photograph the document instead — which routes to the image branch and
 * actually works. The alternative (feed the model an empty string) produces a confident, empty,
 * wrong answer, and the user has no way to tell it apart from a genuinely blank invoice.
 *
 * The model returns STRICT JSON and the raw reply is NEVER forwarded to the page: an extractor
 * that leaks prose to the caller becomes an unbounded model proxy for anyone who can load the app.
 * Billing goes to the app's OWNER, resolved server-side, labelled `app-vision-extract`.
 *
 * Pure over injected seams (`AppVisionDeps`), so the whole contract is testable with a canned model
 * and no live egress — the same shape `app-assistant.ts` takes.
 */
import type { LlmAttribution, OneShotOptions, OneShotResult, RouterDecision } from '../llm/index.js';
import { NoTextLayerError, PdfUnreadableError } from '../services/pdf-text.js';

export type ExtractKind = 'invoice' | 'bank-statement';

/** The image formats the vision branch accepts. Anything else is refused before a model is called. */
const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type ExtractImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

export interface AppVisionExtractInput {
  kind: ExtractKind;
  /** Base64 image bytes, no `data:` prefix. Exactly one of imageBase64 / pdfBase64. */
  imageBase64?: string;
  mediaType?: string;
  /** Base64 PDF bytes, no `data:` prefix. */
  pdfBase64?: string;
  language?: 'pt' | 'en';
  /** Canonical served-app id — the billing label. */
  appId: string;
  /** The app owner — the billee. */
  ownerUserId: string;
}

export type AppVisionFailureCode =
  | 'invalid_input'
  | 'too_large'
  | 'no_text_layer'
  | 'parse_failed'
  | 'llm_error';

export interface AppVisionExtractResult {
  success: boolean;
  data?: unknown;
  error?: string;
  code?: AppVisionFailureCode;
}

export interface AppVisionDeps {
  /** The chokepoint one-shot (`runOneShot` in prod) — this plane's ONLY model egress. */
  oneShot: (opts: OneShotOptions, attribution: LlmAttribution) => Promise<OneShotResult>;
  /** The routing decision, floored at WORKHORSE in prod (extraction is not a FAST task). */
  decide: (message: string) => RouterDecision;
  /** PDF text-layer extraction (`extractPdfText` in prod). Throws NoTextLayerError on a scan. */
  extractPdfText: (bytes: Buffer) => Promise<string>;
  /** Strict-JSON extraction from the model's reply (`parseFirstJsonObject` in prod). */
  parseJson: (text: string) => unknown;
}

/** ~14 MB of raw bytes once base64-decoded. */
const MAX_BASE64_LEN = 20_000_000;
/** Prompt budget for a PDF's text (statements run long; the tail is rarely the interesting part). */
const MAX_PDF_TEXT_CHARS = 60_000;

const INVOICE_SYSTEM = `És um extrator de dados de faturas portuguesas e europeias.
Recebes uma fatura (imagem ou texto) e devolves APENAS um objeto JSON válido, sem qualquer texto adicional, com esta forma:
{
  "clienteNome": string | null,        // o cliente/destinatário da fatura
  "clienteNif": string | null,
  "emitenteNome": string | null,       // quem emitiu a fatura
  "emitenteNif": string | null,
  "numeroFatura": string | null,       // ex.: "FT 2026/18"
  "dataEmissao": "YYYY-MM-DD" | null,
  "dataVencimento": "YYYY-MM-DD" | null,
  "valorTotal": number | null,         // total com IVA, em euros
  "valorIva": number | null,
  "valorBase": number | null,
  "moeda": string | null,              // "EUR" quando aplicável
  "iban": string | null,
  "descricao": string | null,          // resumo curto do objeto da fatura
  "linhas": [{ "descricao": string, "valor": number }] | null
}
Campos ilegíveis ou ausentes ficam null — NUNCA inventes valores. Datas sempre em ISO (YYYY-MM-DD).`;

const STATEMENT_SYSTEM = `És um extrator de movimentos de extratos bancários portugueses e europeus.
Recebes um extrato (imagem ou texto) e devolves APENAS um objeto JSON válido, sem qualquer texto adicional, com esta forma:
{
  "iban": string | null,
  "periodo": { "de": "YYYY-MM-DD" | null, "ate": "YYYY-MM-DD" | null },
  "transacoes": [
    {
      "data": "YYYY-MM-DD",
      "descricao": string,             // descritivo EXATO tal como impresso
      "valor": number,                 // valor absoluto em euros, 2 casas
      "tipo": "credito" | "debito",    // credito = entrada de dinheiro
      "saldo": number | null
    }
  ]
}
Inclui TODAS as linhas de movimento visíveis, pela ordem do extrato. Preserva o descritivo original (não normalizes, não traduzas). Campos ilegíveis ficam null — NUNCA inventes valores.`;

function systemFor(kind: ExtractKind): string {
  return kind === 'invoice' ? INVOICE_SYSTEM : STATEMENT_SYSTEM;
}

export async function appVisionExtract(
  input: AppVisionExtractInput,
  deps: AppVisionDeps,
): Promise<AppVisionExtractResult> {
  const hasImage = !!input.imageBase64;
  const hasPdf = !!input.pdfBase64;
  // Exactly one. Both would make "which did the model actually read?" unanswerable; neither is a
  // request to extract nothing.
  if (hasImage === hasPdf) {
    return { success: false, code: 'invalid_input', error: 'Indique exatamente um de imageBase64 / pdfBase64.' };
  }
  if ((input.imageBase64?.length ?? 0) > MAX_BASE64_LEN || (input.pdfBase64?.length ?? 0) > MAX_BASE64_LEN) {
    return { success: false, code: 'too_large', error: 'Ficheiro demasiado grande (máx. ~14 MB).' };
  }

  let message: string;
  let images: Array<{ mediaType: string; data: string }> | undefined;

  if (hasImage) {
    const mediaType = input.mediaType ?? 'image/jpeg';
    if (!(IMAGE_MEDIA_TYPES as readonly string[]).includes(mediaType)) {
      return { success: false, code: 'invalid_input', error: `mediaType não suportado: ${mediaType}` };
    }
    message =
      input.kind === 'invoice'
        ? 'Extrai os dados desta fatura para o JSON pedido.'
        : 'Extrai os movimentos deste extrato bancário para o JSON pedido.';
    images = [{ mediaType, data: input.imageBase64 as string }];
  } else {
    let text: string;
    try {
      text = await deps.extractPdfText(Buffer.from(input.pdfBase64 as string, 'base64'));
    } catch (err) {
      // A scan and a broken file are different problems with different fixes, so they are told
      // apart rather than collapsed into one unhelpful message.
      if (err instanceof NoTextLayerError) {
        return {
          success: false,
          code: 'no_text_layer',
          error: 'O PDF não tem camada de texto pesquisável (parece digitalizado). Fotografe o documento e envie como imagem.',
        };
      }
      if (err instanceof PdfUnreadableError) {
        return { success: false, code: 'invalid_input', error: `Não foi possível ler o PDF: ${err.message}` };
      }
      return { success: false, code: 'invalid_input', error: 'Não foi possível ler o PDF.' };
    }
    const label = input.kind === 'invoice' ? 'Texto extraído da fatura' : 'Texto extraído do extrato bancário';
    message = `${label} (camada de texto do PDF):\n\n${text.slice(0, MAX_PDF_TEXT_CHARS)}`;
  }

  // Billed to the app OWNER against the app's artifact id — never to the anonymous visitor, who
  // has no account, and never to the platform.
  const attribution: LlmAttribution = {
    kind: 'user_work',
    agentType: 'app-vision-extract',
    billeeUserId: input.ownerUserId,
    artifactId: input.appId,
  };

  let reply: string;
  try {
    const res = await deps.oneShot(
      { prompt: message, systemPrompt: systemFor(input.kind), decision: deps.decide(message), ...(images ? { images } : {}) },
      attribution,
    );
    reply = res.text;
  } catch (err) {
    return { success: false, code: 'llm_error', error: err instanceof Error ? err.message : String(err) };
  }

  const parsed = deps.parseJson(reply);
  if (!parsed || typeof parsed !== 'object') {
    // The reply itself is NEVER returned: it is unvalidated model output, and this plane answers
    // an anonymous page.
    return { success: false, code: 'parse_failed', error: 'A extração não devolveu JSON válido. Tente novamente.' };
  }
  return { success: true, data: parsed };
}
