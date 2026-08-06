import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularAcoesDevidas,
  coalescerAcoes,
  chavePasso,
  renderTemplate,
  variaveisTemplate,
} from '../escalonamento.mjs';

const perfil = {
  id: 'perf1',
  coalescerEmails: true,
  limites: { maxEmailsPorSemana: 2 },
  lembretes: [
    { id: 'l1', offsetDias: -3, tipoAcao: 'email', templateId: 't1', ativo: true },
    { id: 'l2', offsetDias: 3, tipoAcao: 'email', templateId: 't2', ativo: true },
    { id: 'l3', offsetDias: 15, tipoAcao: 'telefone', templateId: 't3', ativo: true },
    { id: 'l4', offsetDias: 30, tipoAcao: 'carta', templateId: 't4', ativo: true },
  ],
};

const item = (over = {}) => ({
  dividaId: 'd1',
  prestacaoId: null,
  clienteId: 'c1',
  clienteNome: 'Padaria Central',
  descricao: 'FT 2026/18',
  valorEmDivida: 442.8,
  dataVencimento: '2026-07-01',
  estado: 'aberta',
  promessaData: null,
  ...over,
});

const deps = (over = {}) => ({
  hoje: '2026-07-04',
  itens: [item()],
  perfilDoCliente: () => perfil,
  flagsDoCliente: () => null,
  executados: new Set(),
  emailsRecentesPorCliente: new Map(),
  ...over,
});

test('dispara o passo devido mais antigo ainda não executado (um por item)', () => {
  const acoes = calcularAcoesDevidas(deps());
  assert.equal(acoes.length, 1);
  assert.equal(acoes[0].lembrete.id, 'l1'); // -3 dias: 2026-06-28, já passou
  assert.equal(acoes[0].atrasado, true);
});

test('passo executado nunca repete; avança para o seguinte quando devido', () => {
  const executados = new Set([chavePasso(item(), 'l1')]);
  const acoes = calcularAcoesDevidas(deps({ executados }));
  assert.equal(acoes.length, 1);
  assert.equal(acoes[0].lembrete.id, 'l2'); // +3: 2026-07-04 = hoje
  assert.equal(acoes[0].atrasado, false);
});

test('passos futuros não disparam', () => {
  const executados = new Set([chavePasso(item(), 'l1'), chavePasso(item(), 'l2')]);
  const acoes = calcularAcoesDevidas(deps({ executados }));
  assert.equal(acoes.length, 0); // l3 é a 2026-07-16, futuro
});

test('flags do cliente suspendem tudo', () => {
  for (const flags of [{ naoContactar: true }, { chasingPausado: true }, { emLitigio: true }, { insolvente: true }]) {
    const acoes = calcularAcoesDevidas(deps({ flagsDoCliente: () => flags }));
    assert.equal(acoes.length, 0);
  }
});

test('promessa ativa suspende até à data prometida', () => {
  const acoes = calcularAcoesDevidas(deps({ itens: [item({ promessaData: '2026-07-10' })] }));
  assert.equal(acoes.length, 0);
});

test('promessa quebrada retoma no passo SEGUINTE ao último executado (escalada)', () => {
  const executados = new Set([chavePasso(item(), 'l1')]);
  const acoes = calcularAcoesDevidas(deps({
    hoje: '2026-07-12',
    itens: [item({ promessaData: '2026-07-10' })],
    executados,
  }));
  assert.equal(acoes.length, 1);
  assert.equal(acoes[0].lembrete.id, 'l2');
  assert.equal(acoes[0].quebraPromessa, true);
});

test('teto de emails por semana bloqueia (visível, não silencioso)', () => {
  const acoes = calcularAcoesDevidas(deps({ emailsRecentesPorCliente: new Map([['c1', 2]]) }));
  assert.equal(acoes.length, 1);
  assert.equal(acoes[0].bloqueadoPorTeto, true);
});

test('coalescência: dois emails do mesmo cliente no mesmo dia fundem num digest', () => {
  const i1 = item();
  const i2 = item({ dividaId: 'd2', descricao: 'FT 2026/30', dataVencimento: '2026-06-25' });
  const acoes = calcularAcoesDevidas(deps({ itens: [i1, i2] }));
  assert.equal(acoes.length, 2);
  const { emails, tarefas } = coalescerAcoes(acoes, () => perfil);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].digest, true);
  assert.equal(emails[0].acoes.length, 2);
  assert.equal(tarefas.length, 0);
});

test('coalescência desligada no perfil: um email por dívida', () => {
  const semCoalescer = { ...perfil, coalescerEmails: false };
  const i1 = item();
  const i2 = item({ dividaId: 'd2', dataVencimento: '2026-06-25' });
  const acoes = calcularAcoesDevidas(deps({ itens: [i1, i2], perfilDoCliente: () => semCoalescer }));
  const { emails } = coalescerAcoes(acoes, () => semCoalescer);
  assert.equal(emails.length, 2);
  assert.ok(emails.every((e) => !e.digest));
});

test('ações não-email vão para tarefas', () => {
  const executados = new Set([chavePasso(item(), 'l1'), chavePasso(item(), 'l2')]);
  const acoes = calcularAcoesDevidas(deps({ hoje: '2026-07-20', executados }));
  assert.equal(acoes[0].lembrete.tipoAcao, 'telefone');
  const { emails, tarefas } = coalescerAcoes(acoes, () => perfil);
  assert.equal(emails.length, 0);
  assert.equal(tarefas.length, 1);
});

test('renderTemplate + variáveis: placeholders preenchidos, desconhecidos vazios', () => {
  const vars = variaveisTemplate({
    cliente: { nome: 'Padaria Central, Lda.' },
    itens: [item()],
    hoje: '2026-07-10',
    lang: 'pt',
    iban: 'PT50 0000 0000 0000 0000 0000 1',
  });
  const corpo = renderTemplate(
    'Exmo.(a) {{nome}}: a fatura {{descricao}} de {{valor}} venceu há {{diasAtraso}} dias. IBAN: {{iban}}. {{desconhecida}}',
    vars,
  );
  assert.match(corpo, /Padaria Central, Lda\./);
  assert.match(corpo, /FT 2026\/18/);
  assert.match(corpo, /9 dias/);
  assert.match(corpo, /PT50/);
  assert.ok(!corpo.includes('{{'));
});

test('variáveis de digest: lista e saldo total', () => {
  const vars = variaveisTemplate({
    cliente: { nome: 'Padaria Central' },
    itens: [item(), item({ dividaId: 'd2', descricao: 'FT 2026/30', valorEmDivida: 100 })],
    hoje: '2026-07-10',
    lang: 'pt',
  });
  assert.match(vars.listaDividas, /FT 2026\/18/);
  assert.match(vars.listaDividas, /FT 2026\/30/);
  assert.match(vars.saldoTotal, /542,80/);
});
