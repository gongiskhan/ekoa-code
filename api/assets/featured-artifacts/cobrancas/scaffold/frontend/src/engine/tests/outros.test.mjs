import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMontante, round2, somaEuros } from '../dinheiro.mjs';
import { parseDataFlex, addDias, diasAtraso, agingBucket } from '../datas.mjs';
import { parseCsvExtrato } from '../csv.mjs';
import { calcularScore, sugerirPerfil } from '../comportamento.mjs';
import { computeJuros } from '../juros.mjs';
import { TABELA_TAXAS } from '../taxas.mjs';

test('parseMontante: formatos pt e internacionais', () => {
  assert.equal(parseMontante('1 234,56'), 1234.56);
  assert.equal(parseMontante('1.234,56'), 1234.56);
  assert.equal(parseMontante('1,234.56'), 1234.56);
  assert.equal(parseMontante('1234.56'), 1234.56);
  assert.equal(parseMontante('-12,30'), -12.3);
  assert.equal(parseMontante('(12,30)'), -12.3);
  assert.equal(parseMontante('442,80 €'), 442.8);
  assert.equal(parseMontante('1.234'), 1234); // milhares pt
  assert.equal(parseMontante('abc'), null);
});

test('datas: flex + atraso + escalões do brief (0-30/31-60/61-90/90+)', () => {
  assert.equal(parseDataFlex('04/07/2026'), '2026-07-04');
  assert.equal(parseDataFlex('04-07-26'), '2026-07-04');
  assert.equal(parseDataFlex('2026-07-04'), '2026-07-04');
  assert.equal(parseDataFlex('31/02/2026'), null);
  assert.equal(addDias('2026-07-04', 30), '2026-08-03');
  assert.equal(diasAtraso('2026-07-01', '2026-07-31'), 30);
  assert.equal(agingBucket(0), '0-30');
  assert.equal(agingBucket(30), '0-30');
  assert.equal(agingBucket(31), '31-60');
  assert.equal(agingBucket(90), '61-90');
  assert.equal(agingBucket(91), '90+');
});

test('csv: extrato pt com separador ; preâmbulo e montantes pt', () => {
  const csv = [
    'Extrato de conta;;;',
    'Conta: 1234567;;;',
    'Data Mov.;Descritivo;Montante;Saldo',
    '04-07-2026;TRF 991 PADARIA CENTRAL LDA;442,80;10.442,80',
    '05-07-2026;PAGAMENTO AGUA;-35,10;10.407,70',
    'ilegível;;;',
  ].join('\n');
  const { transacoes, erros } = parseCsvExtrato(csv);
  assert.equal(transacoes.length, 2);
  assert.deepEqual(transacoes[0], {
    data: '2026-07-04',
    descricao: 'TRF 991 PADARIA CENTRAL LDA',
    valor: 442.8,
    tipo: 'credito',
    saldo: 10442.8,
  });
  assert.equal(transacoes[1].tipo, 'debito');
  assert.equal(erros.length, 1);
});

test('csv: colunas débito/crédito separadas', () => {
  const csv = [
    'Data;Descrição;Débito;Crédito',
    '01/08/2026;TRF JOAO ALMEIDA;;184,50',
    '02/08/2026;SEGURO;12,00;',
  ].join('\n');
  const { transacoes, erros } = parseCsvExtrato(csv);
  assert.equal(erros.length, 0);
  assert.equal(transacoes[0].tipo, 'credito');
  assert.equal(transacoes[0].valor, 184.5);
  assert.equal(transacoes[1].tipo, 'debito');
});

test('score: bom pagador fica alto; promessas quebradas e atrasos afundam', () => {
  const bom = calcularScore({
    dividas: [{ id: 'd1', valor: 100, dataVencimento: '2026-06-01', estado: 'paga' }],
    pagamentos: [{ dividaId: 'd1', valor: 100, data: '2026-05-28' }],
  });
  assert.ok(bom.score >= 90);
  assert.equal(bom.inputs.pctDentroPrazo, 100);

  const mau = calcularScore({
    dividas: [
      { id: 'd1', valor: 100, dataVencimento: '2026-01-01', estado: 'paga' },
      { id: 'd2', valor: 500, dataVencimento: '2026-02-01', estado: 'incobravel' },
    ],
    pagamentos: [{ dividaId: 'd1', valor: 100, data: '2026-02-15' }],
    promessasQuebradas: 2,
  });
  assert.ok(mau.score < 40, `esperado <40, veio ${mau.score}`);
  assert.equal(mau.inputs.promessasQuebradas, 2);
  assert.equal(mau.inputs.valorIncobravel, 500);
});

test('score sem histórico não inventa 100% pontualidade nem sugere nada', () => {
  const s = calcularScore({ dividas: [], pagamentos: [] });
  assert.equal(s.inputs.pctDentroPrazo, null);
  assert.equal(sugerirPerfil({ score: s.score, perfilAtualTom: 'assertivo', temHistorico: false }), null);
});

test('sugestões de perfil respeitam limiares e o perfil atual', () => {
  assert.equal(sugerirPerfil({ score: 80, perfilAtualTom: 'suave' }), null);
  assert.equal(sugerirPerfil({ score: 80, perfilAtualTom: 'assertivo' }).perfilSugerido, 'suave');
  assert.equal(sugerirPerfil({ score: 20, perfilAtualTom: 'suave' }).perfilSugerido, 'assertivo');
});

test('juros comerciais: motor vendorizado calcula por troços com aviso citado', () => {
  const r = computeJuros({
    valor: 1000,
    dataVencimento: '2024-06-01',
    dataFim: '2024-08-30',
    tipo: 'comercial',
    tabela: TABELA_TAXAS,
  });
  assert.equal(r.trocos.length, 2); // 2024-S1 (12,5%) + 2024-S2 (12,25%)
  assert.equal(r.trocos[0].taxa, 12.5);
  assert.match(r.trocos[0].aviso, /1274\/2024/);
  assert.equal(r.diasTotais, 90);
  assert.ok(r.totalJuros > 0);
});

test('juros: período sem taxa publicada fica marcado incompleto, nunca inventado', () => {
  const r = computeJuros({
    valor: 1000,
    dataVencimento: '2027-01-01',
    dataFim: '2027-03-01',
    tipo: 'comercial',
    tabela: TABELA_TAXAS,
  });
  assert.equal(r.incompleto, true);
});

test('dinheiro: soma em cêntimos sem erro de vírgula flutuante', () => {
  assert.equal(somaEuros([0.1, 0.2]), 0.3);
  assert.equal(round2(1.005), 1.01);
});
