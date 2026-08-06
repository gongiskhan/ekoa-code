import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarDescricao,
  fingerprintTransacao,
  semelhancaNomes,
  nomeContidoNoDescritivo,
} from '../normalizacao.mjs';

// A normalização é o núcleo da reconciliação (brief) - cada regra tem teste.

test('regra 1: maiúsculas + fold de acentos', () => {
  assert.equal(normalizarDescricao('Construções Horizonte, S.A.'), 'CONSTRUCOES HORIZONTE S A');
  assert.equal(normalizarDescricao("Farmácia Sant'Ana"), 'FARMACIA SANT ANA');
});

test('regra 2: datas caem em todos os formatos comuns', () => {
  assert.equal(normalizarDescricao('PAGAMENTO 04/07/2026 PADARIA'), 'PAGAMENTO PADARIA');
  assert.equal(normalizarDescricao('PADARIA 2026-07-04'), 'PADARIA');
  assert.equal(normalizarDescricao('PADARIA 04-07-26'), 'PADARIA');
  assert.equal(normalizarDescricao('PADARIA 4.7'), 'PADARIA');
});

test('regra 3: tokens com >= 3 dígitos caem (refs, ids, contas)', () => {
  assert.equal(normalizarDescricao('TRF 0001123 PADARIA CENTRAL'), 'PADARIA CENTRAL');
  assert.equal(normalizarDescricao('MB12345 PADARIA'), 'PADARIA');
  assert.equal(normalizarDescricao('PADARIA P2026/18'), 'PADARIA');
});

test('regra 3: 1-2 dígitos misturados perdem só os dígitos', () => {
  assert.equal(normalizarDescricao('LOJA22 CENTRO'), 'LOJA CENTRO');
});

test('regra 3b: marcadores de referência caem em qualquer posição', () => {
  assert.equal(normalizarDescricao('PADARIA CENTRAL REF 991'), 'PADARIA CENTRAL');
  assert.equal(normalizarDescricao('DOC 12 PADARIA NUM X'), 'PADARIA X');
});

test('regra 4: pontuação e mascaramento colapsam', () => {
  assert.equal(normalizarDescricao('PADARIA***CENTRAL,LDA.'), 'PADARIA CENTRAL LDA');
});

test('regra 5: prefixos de canal no início caem em cadeia', () => {
  assert.equal(normalizarDescricao('TRF CRED SEPA PADARIA CENTRAL LDA'), 'PADARIA CENTRAL LDA');
  assert.equal(normalizarDescricao('TRF P2P MBWAY JOAO ALMEIDA'), 'JOAO ALMEIDA');
});

test('regra 5: nunca esvazia por completo (um só token de canal fica)', () => {
  assert.equal(normalizarDescricao('TRF 123456'), 'TRF');
});

test('estabilidade: o mesmo pagador em meses diferentes converge', () => {
  const jul = normalizarDescricao('TRF 12345 Padaria Central, Lda. 04/07/2026 REF.2026001827');
  const ago = normalizarDescricao('TRF 99881 PADARIA CENTRAL LDA 02/08/2026 REF.2026002911');
  assert.equal(jul, 'PADARIA CENTRAL LDA');
  assert.equal(jul, ago);
});

test('fingerprint: data + valor + descritivo normalizado', () => {
  const fp = fingerprintTransacao({ data: '2026-07-01', valor: 442.8, descricao: 'TRF PADARIA REF 991' });
  assert.equal(fp, '2026-07-01|442.80|PADARIA');
  // Reimportação do mesmo movimento com descritivo cosmético diferente -> mesmo fingerprint.
  assert.equal(
    fingerprintTransacao({ data: '2026-07-01', valor: 442.8, descricao: 'TRF  PADARIA   REF 992' }),
    fp,
  );
});

test('semelhança de nomes: idênticos = 1, sem relação ~ 0', () => {
  assert.equal(semelhancaNomes('Padaria Central', 'PADARIA CENTRAL'), 1);
  assert.ok(semelhancaNomes('Padaria Central', 'Construções Horizonte') < 0.3);
  assert.ok(semelhancaNomes('João Almeida Ferreira', 'TRF JOAO ALMEIDA FERREIRA') > 0.9);
});

test('nome contido no descritivo', () => {
  assert.ok(nomeContidoNoDescritivo('Padaria Central, Lda.', 'TRF 991 PADARIA CENTRAL LDA 07/07'));
  assert.ok(!nomeContidoNoDescritivo('Padaria Central', 'TRF MERCEARIA DO BAIRRO'));
});
