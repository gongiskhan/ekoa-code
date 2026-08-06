import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gerarCandidatos, aplicarRegras } from '../matching.mjs';
import { normalizarDescricao } from '../normalizacao.mjs';

const itens = [
  { dividaId: 'd1', prestacaoId: null, clienteId: 'c1', clienteNome: 'Padaria Central, Lda.', descricao: 'FT 2026/18', valorEmDivida: 442.8, dataVencimento: '2026-07-01' },
  { dividaId: 'd2', prestacaoId: null, clienteId: 'c2', clienteNome: 'João Almeida Ferreira', descricao: 'FT 2026/21', valorEmDivida: 184.5, dataVencimento: '2026-07-20' },
  { dividaId: 'd3', prestacaoId: 'p1', clienteId: 'c1', clienteNome: 'Padaria Central, Lda.', descricao: 'Plano — prestação 1/3', valorEmDivida: 200, dataVencimento: '2026-08-01' },
];

test('sugestões: valor exato + nome no descritivo = confiança alta, 1.º lugar', () => {
  const tx = { data: '2026-07-05', valor: 442.8, descricao: 'TRF 991 PADARIA CENTRAL LDA' };
  const cands = gerarCandidatos(tx, itens);
  assert.ok(cands.length >= 1);
  assert.equal(cands[0].item.dividaId, 'd1');
  assert.equal(cands[0].nivel, 'alta');
  assert.ok(cands[0].motivos.some((m) => m.tipo === 'valor-exato'));
  assert.ok(cands[0].motivos.some((m) => m.tipo === 'nome-contido'));
});

test('sugestões: item sem qualquer sinal não aparece', () => {
  const tx = { data: '2026-07-05', valor: 999.99, descricao: 'TRF MERCEARIA DO BAIRRO' };
  const cands = gerarCandidatos(tx, itens);
  assert.ok(!cands.some((c) => c.item.dividaId === 'd2'));
});

test('sugestões: pagamento parcial pontua mais baixo que exato', () => {
  const txParcial = { data: '2026-07-05', valor: 100, descricao: 'PADARIA CENTRAL LDA' };
  const cands = gerarCandidatos(txParcial, itens);
  const d1 = cands.find((c) => c.item.dividaId === 'd1');
  assert.ok(d1);
  assert.ok(d1.motivos.some((m) => m.tipo === 'valor-parcial'));
});

const regraPadaria = {
  id: 'r1',
  clienteId: 'c1',
  padrao: normalizarDescricao('TRF 991 PADARIA CENTRAL LDA'),
  ativa: true,
};

test('regras: transação nova com o mesmo padrão + um só alvo exato -> auto', () => {
  const tx = { data: '2026-08-02', valor: 442.8, descricao: 'TRF 5522 PADARIA CENTRAL LDA 02/08/2026' };
  const r = aplicarRegras(tx, [regraPadaria], itens);
  assert.equal(r.motivo, 'regra-valor-exato');
  assert.equal(r.auto.dividaId, 'd1');
});

test('regras: dois itens do mesmo cliente com o MESMO valor -> ambiguidade, sem auto', () => {
  const doisIguais = [
    ...itens,
    { dividaId: 'd4', prestacaoId: null, clienteId: 'c1', clienteNome: 'Padaria Central, Lda.', descricao: 'FT 2026/30', valorEmDivida: 442.8, dataVencimento: '2026-08-10' },
  ];
  const tx = { data: '2026-08-02', valor: 442.8, descricao: 'PADARIA CENTRAL LDA' };
  const r = aplicarRegras(tx, [regraPadaria], doisIguais);
  assert.equal(r.auto, null);
  assert.equal(r.motivo, 'valores-ambiguos');
});

test('regras: duas regras de clientes distintos com o mesmo padrão -> sem auto', () => {
  const regraOutro = { id: 'r2', clienteId: 'c2', padrao: regraPadaria.padrao, ativa: true };
  const tx = { data: '2026-08-02', valor: 442.8, descricao: 'PADARIA CENTRAL LDA' };
  const r = aplicarRegras(tx, [regraPadaria, regraOutro], itens);
  assert.equal(r.auto, null);
  assert.equal(r.motivo, 'regras-ambiguas');
});

test('regras: valor sem correspondência exata mas cliente com UM só item -> parcial auto', () => {
  const soUm = [itens[1]];
  const regraJoao = { id: 'r3', clienteId: 'c2', padrao: normalizarDescricao('MBWAY JOAO ALMEIDA FERREIRA'), ativa: true };
  const tx = { data: '2026-08-02', valor: 50, descricao: 'MBWAY JOAO ALMEIDA FERREIRA 12345' };
  const r = aplicarRegras(tx, [regraJoao], soUm);
  assert.equal(r.motivo, 'regra-parcial-unico-item');
  assert.equal(r.auto.dividaId, 'd2');
});

test('regras: cliente com vários itens e valor sem exato -> sem auto (degrada para sugestão)', () => {
  const tx = { data: '2026-08-02', valor: 50, descricao: 'PADARIA CENTRAL LDA' };
  const r = aplicarRegras(tx, [regraPadaria], itens);
  assert.equal(r.auto, null);
  assert.equal(r.motivo, 'sem-alvo-plausivel');
});

test('regras: regra inativa não dispara', () => {
  const tx = { data: '2026-08-02', valor: 442.8, descricao: 'PADARIA CENTRAL LDA' };
  const r = aplicarRegras(tx, [{ ...regraPadaria, ativa: false }], itens);
  assert.equal(r.motivo, 'sem-regra');
});
