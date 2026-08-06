/*
 * MAPEADOR Honorários -> Cobranças - A fronteira ÚNICA com o esquema do app
 * Jurídico · Honorários (brief: "Treat the Honorários schema as an external
 * contract: map it into Cobranças' own model at one well-defined boundary so
 * schema drift breaks one mapper, not the whole app").
 *
 * CONTRATO EXTERNO observado (legal-honorarios, ekoa-data/featured-artifacts):
 *  - Uma pré-fatura EMITIDA é uma linha da coleção PARTILHADA `documentos` com
 *    `origem: 'honorarios'`, `runRef` único ('pf-<processoId>-<ts>-<rand>'),
 *    `processoId`, `clienteId` (pode ser null quando o cliente não resolveu),
 *    `data` ('YYYY-MM-DD') e `texto` - o corpo determinístico produzido por
 *    renderPrefaturaTexto(), que inclui as linhas de cálculo:
 *        "  - Total (honorários + IVA + despesas): 1 234,56 €"
 *        "  - Valor a receber (total − retenção): 1 003,56 €"
 *  - Os lançamentos que a compõem ficam `faturado: true` na coleção
 *    `lancamentos` (é ESSA a marcação "final/aceite" do honorário).
 *
 * O que este mapeador produz: os campos de uma dívida Cobranças. O VALOR da
 * dívida é o "Valor a receber" (o que o cliente tem de transferir ao
 * escritório - na retenção na fonte o cliente entrega o IRS à AT, não ao
 * escritório); na sua ausência, o Total. O id do documento é a CHAVE DE
 * DEDUPLICAÇÃO da sincronização (brief: idempotente, nunca duplica).
 */
import { parseMontante, round2 } from './dinheiro.mjs';
import { addDias } from './datas.mjs';

/** True quando a linha `documentos` é uma pré-fatura de honorários emitida. */
export function ehPrefaturaHonorarios(doc) {
  return !!doc && doc.origem === 'honorarios' && typeof doc.texto === 'string' && !!doc.id;
}

/** Extrai um montante de uma linha "rótulo: 1 234,56 €" do texto da pré-fatura. */
function montanteDaLinha(texto, rotuloRegex) {
  const linha = String(texto).split('\n').find((l) => rotuloRegex.test(l));
  if (!linha) return null;
  const m = linha.match(/:\s*[−-]?\s*([\d.\s ]+,\d{2})\s*€/);
  if (!m) return null;
  return parseMontante(m[1]);
}

/** Extrai "Cliente: X" / "Processo: Y" / "Período: Z" do texto. */
function campoDaLinha(texto, rotulo) {
  const linha = String(texto).split('\n').find((l) => l.startsWith(`${rotulo}:`));
  if (!linha) return null;
  const v = linha.slice(rotulo.length + 1).trim();
  return v && v !== '—' ? v : null;
}

/**
 * Mapeia UMA pré-fatura emitida para os campos de uma dívida Cobranças.
 *
 * @param {object} doc  linha da coleção partilhada `documentos`
 * @param {{ prazoPagamentoDias?: number }} opts  prazo de vencimento a contar
 *   da data de emissão (por omissão 30 dias)
 * @returns {{ ok: true, divida: object } | { ok: false, erro: string }}
 */
export function mapearDocumentoHonorarios(doc, opts = {}) {
  if (!ehPrefaturaHonorarios(doc)) {
    return { ok: false, erro: 'A linha não é uma pré-fatura de honorários emitida.' };
  }
  const aReceber = montanteDaLinha(doc.texto, /Valor a receber/);
  const total = montanteDaLinha(doc.texto, /^\s*-\s*Total \(/);
  const valor = aReceber != null ? aReceber : total;
  if (valor == null || !(valor > 0)) {
    return {
      ok: false,
      erro: 'Não foi possível ler o valor da pré-fatura (o formato do texto mudou?). Reveja o documento no Honorários.',
    };
  }
  const prazo = Number.isFinite(Number(opts.prazoPagamentoDias)) ? Number(opts.prazoPagamentoDias) : 30;
  const dataEmissao = typeof doc.data === 'string' && /^\d{4}-\d{2}-\d{2}/.test(doc.data)
    ? doc.data.slice(0, 10)
    : null;
  if (!dataEmissao) {
    return { ok: false, erro: 'A pré-fatura não tem data de emissão legível.' };
  }
  const processo = campoDaLinha(doc.texto, 'Processo');
  const clienteNomeNoTexto = campoDaLinha(doc.texto, 'Cliente');

  return {
    ok: true,
    divida: {
      clienteId: doc.clienteId || null,
      descricao: doc.nome || `Pré-fatura de honorários${processo ? ` ${processo}` : ''}`,
      numeroFatura: null,
      valor: round2(valor),
      dataVencimento: addDias(dataEmissao, prazo),
      estado: 'aberta',
      origem: 'honorarios',
      origemId: doc.id,
      origemRunRef: doc.runRef || null,
      origemSnapshot: {
        valor: round2(valor),
        total: total != null ? round2(total) : null,
        clienteId: doc.clienteId || null,
        clienteNome: clienteNomeNoTexto,
        processo,
        nome: doc.nome || '',
        data: dataEmissao,
      },
    },
  };
}

/**
 * Sincronização IDEMPOTENTE: dado o conjunto atual de documentos partilhados e
 * as dívidas existentes, devolve { novas, avisos }:
 *  - `novas`: dívidas a criar (documentos de honorários sem dívida com o mesmo
 *    origemId);
 *  - `avisos`: discrepâncias em dívidas já sincronizadas cujo documento de
 *    origem mudou ou desapareceu - NUNCA se muta a dívida em silêncio (brief).
 */
export function sincronizarHonorarios({ documentos, dividas, prazoPagamentoDias = 30 }) {
  const docs = (Array.isArray(documentos) ? documentos : []).filter(ehPrefaturaHonorarios);
  const sincronizadas = (Array.isArray(dividas) ? dividas : []).filter((d) => d.origem === 'honorarios' && d.origemId);
  const porOrigem = new Map(sincronizadas.map((d) => [d.origemId, d]));
  const docsPorId = new Map(docs.map((d) => [d.id, d]));

  const novas = [];
  const falhas = [];
  for (const doc of docs) {
    if (porOrigem.has(doc.id)) continue; // dedupe: nunca duplica (chave = doc.id)
    const r = mapearDocumentoHonorarios(doc, { prazoPagamentoDias });
    if (r.ok) novas.push(r.divida);
    else falhas.push({ documentoId: doc.id, nome: doc.nome || '', erro: r.erro });
  }

  const avisos = [];
  for (const divida of sincronizadas) {
    const doc = docsPorId.get(divida.origemId);
    if (!doc) {
      avisos.push({
        dividaId: divida.id,
        documentoId: divida.origemId,
        tipo: 'removido',
        detalhe: 'A pré-fatura de origem já não existe no Honorários.',
      });
      continue;
    }
    const r = mapearDocumentoHonorarios(doc, { prazoPagamentoDias });
    if (!r.ok) continue; // ilegível agora - a criação original mantém-se
    const antes = divida.origemSnapshot || {};
    const depois = r.divida.origemSnapshot;
    const difs = [];
    if (antes.valor != null && Math.abs(Number(antes.valor) - depois.valor) > 0.01) {
      difs.push(`valor: ${antes.valor} -> ${depois.valor}`);
    }
    if (antes.clienteId !== depois.clienteId) difs.push('cliente alterado');
    if ((antes.nome || '') !== (depois.nome || '')) difs.push('nome do documento alterado');
    if (difs.length > 0) {
      avisos.push({
        dividaId: divida.id,
        documentoId: doc.id,
        tipo: 'alterado',
        detalhe: `A pré-fatura de origem mudou (${difs.join('; ')}). Reveja e ajuste a dívida manualmente se fizer sentido.`,
      });
    }
  }

  return { novas, avisos, falhas };
}
