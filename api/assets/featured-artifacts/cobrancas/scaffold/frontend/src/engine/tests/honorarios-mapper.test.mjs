import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ehPrefaturaHonorarios,
  mapearDocumentoHonorarios,
  sincronizarHonorarios,
} from '../honorarios-mapper.mjs';

// Texto EXATAMENTE no formato de renderPrefaturaTexto() do legal-honorarios
// (o contrato externo que o mapeador interpreta).
const TEXTO = [
  'PRÉ-FATURA DE HONORÁRIOS (rascunho de conferência)',
  '',
  'Processo: 1234/26.0T8LSB',
  'Cliente: Padaria Central, Lda.',
  'Período: até à data',
  '',
  'Cálculo:',
  '  - Honorários (2 lançamento(s)): 1 080,00 €',
  '  - IVA 23% sobre honorários: 248,40 €',
  '  - Despesas (1 lançamento(s)): 306,00 €',
  '  - Retenção IRS 23% sobre honorários: −248,40 €',
  '  - Total (honorários + IVA + despesas): 1 634,40 €',
  '  - Valor a receber (total − retenção): 1 386,00 €',
  '',
  'Pré-fatura de conferência - não substitui fatura certificada.',
].join('\n');

const doc = {
  id: 'doc-1',
  nome: 'Pré-fatura 1234/26.0T8LSB até à data',
  runRef: 'pf-proc1-1720000000-abc123',
  tipo: 'nota',
  texto: TEXTO,
  origem: 'honorarios',
  processoId: 'proc1',
  clienteId: 'c1',
  versao: 1,
  data: '2026-07-04',
};

test('reconhece pré-faturas emitidas e ignora o resto', () => {
  assert.ok(ehPrefaturaHonorarios(doc));
  assert.ok(!ehPrefaturaHonorarios({ ...doc, origem: 'nota' }));
  assert.ok(!ehPrefaturaHonorarios({ ...doc, texto: undefined }));
});

test('mapeia o VALOR A RECEBER como valor da dívida (retenção vai para a AT)', () => {
  const r = mapearDocumentoHonorarios(doc);
  assert.ok(r.ok);
  assert.equal(r.divida.valor, 1386);
  assert.equal(r.divida.origemId, 'doc-1');
  assert.equal(r.divida.origemRunRef, 'pf-proc1-1720000000-abc123');
  assert.equal(r.divida.clienteId, 'c1');
  assert.equal(r.divida.origem, 'honorarios');
  assert.equal(r.divida.origemSnapshot.total, 1634.4);
  assert.equal(r.divida.origemSnapshot.processo, '1234/26.0T8LSB');
});

test('vencimento = data de emissão + prazo configurável (30 por omissão)', () => {
  assert.equal(mapearDocumentoHonorarios(doc).divida.dataVencimento, '2026-08-03');
  assert.equal(mapearDocumentoHonorarios(doc, { prazoPagamentoDias: 15 }).divida.dataVencimento, '2026-07-19');
});

test('sem retenção: cai para o Total', () => {
  const texto = TEXTO.split('\n').filter((l) => !/Valor a receber/.test(l)).join('\n');
  const r = mapearDocumentoHonorarios({ ...doc, texto });
  assert.ok(r.ok);
  assert.equal(r.divida.valor, 1634.4);
});

test('formato de texto alterado (drift) -> erro do mapeador, nunca um valor inventado', () => {
  const r = mapearDocumentoHonorarios({ ...doc, texto: 'FORMATO NOVO QUALQUER' });
  assert.ok(!r.ok);
  assert.match(r.erro, /formato do texto mudou/);
});

test('sincronização idempotente: segunda passagem não cria duplicados', () => {
  const r1 = sincronizarHonorarios({ documentos: [doc], dividas: [] });
  assert.equal(r1.novas.length, 1);
  const dividas = [{ id: 'd1', ...r1.novas[0] }];
  const r2 = sincronizarHonorarios({ documentos: [doc], dividas });
  assert.equal(r2.novas.length, 0);
  assert.equal(r2.avisos.length, 0);
});

test('documento de origem ALTERADO -> aviso de discrepância, nunca mutação silenciosa', () => {
  const r1 = sincronizarHonorarios({ documentos: [doc], dividas: [] });
  const dividas = [{ id: 'd1', ...r1.novas[0] }];
  const alterado = { ...doc, texto: TEXTO.replace('1 386,00', '1 500,00') };
  const r2 = sincronizarHonorarios({ documentos: [alterado], dividas });
  assert.equal(r2.novas.length, 0);
  assert.equal(r2.avisos.length, 1);
  assert.equal(r2.avisos[0].tipo, 'alterado');
  assert.match(r2.avisos[0].detalhe, /valor/);
});

test('documento de origem REMOVIDO -> aviso', () => {
  const r1 = sincronizarHonorarios({ documentos: [doc], dividas: [] });
  const dividas = [{ id: 'd1', ...r1.novas[0] }];
  const r2 = sincronizarHonorarios({ documentos: [], dividas });
  assert.equal(r2.avisos.length, 1);
  assert.equal(r2.avisos[0].tipo, 'removido');
});

test('documento ilegível na sincronização -> falha visível, os legíveis passam', () => {
  const mau = { ...doc, id: 'doc-2', texto: 'ILEGÍVEL' };
  const r = sincronizarHonorarios({ documentos: [doc, mau], dividas: [] });
  assert.equal(r.novas.length, 1);
  assert.equal(r.falhas.length, 1);
  assert.equal(r.falhas[0].documentoId, 'doc-2');
});
