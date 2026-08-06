import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gerarPlano,
  validarPlanoPersonalizado,
  itensEmAberto,
  alocarPagamento,
  estadoDerivado,
} from '../prestacoes.mjs';

test('gerarPlano: divisão justa ao cêntimo, resto na primeira', () => {
  const plano = gerarPlano({ valorTotal: 100, numPrestacoes: 3, primeiraData: '2026-08-15', mensal: true });
  assert.equal(plano.length, 3);
  assert.deepEqual(plano.map((p) => p.valor), [33.34, 33.33, 33.33]);
  assert.deepEqual(plano.map((p) => p.dataVencimento), ['2026-08-15', '2026-09-15', '2026-10-15']);
  assert.equal(plano.reduce((s, p) => s + p.valor, 0).toFixed(2), '100.00');
});

test('gerarPlano: meses curtos não transbordam (31 jan -> 28 fev)', () => {
  const plano = gerarPlano({ valorTotal: 300, numPrestacoes: 3, primeiraData: '2026-01-31', mensal: true });
  assert.deepEqual(plano.map((p) => p.dataVencimento), ['2026-01-31', '2026-02-28', '2026-03-31']);
});

test('gerarPlano: intervalo em dias', () => {
  const plano = gerarPlano({ valorTotal: 90, numPrestacoes: 2, primeiraData: '2026-08-01', intervaloDias: 15, mensal: false });
  assert.deepEqual(plano.map((p) => p.dataVencimento), ['2026-08-01', '2026-08-16']);
});

test('validarPlanoPersonalizado: soma tem de bater com o total', () => {
  const erros = validarPlanoPersonalizado(
    [{ valor: 50, dataVencimento: '2026-08-01' }, { valor: 49.99, dataVencimento: '2026-09-01' }],
    100,
  );
  assert.equal(erros.length, 1);
  assert.match(erros[0], /difere do total/);
});

const clientes = new Map([['c1', { nome: 'Padaria Central' }]]);

test('itensEmAberto: dívida sem plano = um item com saldo derivado', () => {
  const dividas = [{ id: 'd1', clienteId: 'c1', descricao: 'FT 1', valor: 100, dataVencimento: '2026-07-01', estado: 'parcial' }];
  const pagamentos = [{ dividaId: 'd1', valor: 40, data: '2026-07-10' }];
  const itens = itensEmAberto(dividas, pagamentos, clientes);
  assert.equal(itens.length, 1);
  assert.equal(itens[0].valorEmDivida, 60);
  assert.equal(itens[0].clienteNome, 'Padaria Central');
});

test('itensEmAberto: com plano, um item POR PRESTAÇÃO em aberto', () => {
  const dividas = [{
    id: 'd2', clienteId: 'c1', descricao: 'Plano', valor: 300, dataVencimento: '2026-07-01', estado: 'aberta',
    prestacoes: [
      { id: 'p1', valor: 100, dataVencimento: '2026-07-01', estado: 'paga' },
      { id: 'p2', valor: 100, dataVencimento: '2026-08-01', estado: 'aberta' },
      { id: 'p3', valor: 100, dataVencimento: '2026-09-01', estado: 'aberta' },
    ],
  }];
  const itens = itensEmAberto(dividas, [], clientes);
  assert.equal(itens.length, 2);
  assert.deepEqual(itens.map((i) => i.prestacaoId), ['p2', 'p3']);
});

test('itensEmAberto: estados suspensos ficam de fora', () => {
  const dividas = [
    { id: 'd3', clienteId: 'c1', descricao: 'Litígio', valor: 500, dataVencimento: '2026-01-01', estado: 'litigio' },
    { id: 'd4', clienteId: 'c1', descricao: 'Disputada', valor: 200, dataVencimento: '2026-01-01', estado: 'disputada' },
  ];
  assert.equal(itensEmAberto(dividas, [], clientes).length, 0);
});

test('alocarPagamento: mais antiga primeiro, com excedente explícito', () => {
  const itensAb = [
    { dividaId: 'd1', prestacaoId: null, valorEmDivida: 60, dataVencimento: '2026-06-01' },
    { dividaId: 'd2', prestacaoId: 'p2', valorEmDivida: 100, dataVencimento: '2026-08-01' },
  ];
  const { alocacoes, excedente } = alocarPagamento({ valor: 200, itens: itensAb });
  assert.deepEqual(alocacoes, [
    { dividaId: 'd1', prestacaoId: null, valor: 60 },
    { dividaId: 'd2', prestacaoId: 'p2', valor: 100 },
  ]);
  assert.equal(excedente, 40);
});

test('alocarPagamento: regra recente-primeiro inverte a ordem', () => {
  const itensAb = [
    { dividaId: 'd1', prestacaoId: null, valorEmDivida: 60, dataVencimento: '2026-06-01' },
    { dividaId: 'd2', prestacaoId: null, valorEmDivida: 100, dataVencimento: '2026-08-01' },
  ];
  const { alocacoes } = alocarPagamento({ valor: 100, itens: itensAb, regra: 'recente-primeiro' });
  assert.equal(alocacoes[0].dividaId, 'd2');
  assert.equal(alocacoes[0].valor, 100);
});

test('estadoDerivado: paga quando os pagamentos cobrem o total', () => {
  const d = { id: 'd1', valor: 100, estado: 'aberta' };
  assert.equal(estadoDerivado(d, [{ dividaId: 'd1', valor: 100, data: '2026-07-01' }]), 'paga');
  assert.equal(estadoDerivado(d, [{ dividaId: 'd1', valor: 30, data: '2026-07-01' }]), 'parcial');
  assert.equal(estadoDerivado(d, []), 'aberta');
});

test('estadoDerivado: estados manuais prevalecem enquanto há saldo', () => {
  const d = { id: 'd1', valor: 100, estado: 'disputada' };
  assert.equal(estadoDerivado(d, [{ dividaId: 'd1', valor: 30, data: '2026-07-01' }]), 'disputada');
  assert.equal(estadoDerivado(d, [{ dividaId: 'd1', valor: 100, data: '2026-07-01' }]), 'paga');
});
