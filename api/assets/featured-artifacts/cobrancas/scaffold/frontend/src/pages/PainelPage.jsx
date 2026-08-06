/*
 * PAINEL DE ENVELHECIMENTO (rota "/") - visão executiva da carteira de
 * créditos: totais em dívida/vencidos, escalões de envelhecimento, principais
 * devedores e as ações de cobrança devidas hoje. Página SÓ-LEITURA: deriva
 * tudo dos motores puros; nenhuma escrita, logo nenhum evento de linha do
 * tempo é gerado aqui.
 */
import { useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { tr, useLang } from '../i18n.js';
import { useColecao, useClientes } from '../hooks.js';
import {
  Button, DataTable, EmptyState, Skeleton, Stat, toast,
} from '../components/ui.jsx';
import {
  estaVencida, eur, formatData, indexarClientes, indexarOverlay, resolverPerfil,
} from '../components/dominio.jsx';
import {
  IconDividas, IconEmail, IconFila, IconMais, IconPerfis, IconRelogio,
} from '../components/Icons.jsx';
import { itensEmAberto } from '../engine/prestacoes.mjs';
import { AGING_BUCKETS, agingBucket, diasAtraso, hojeISO } from '../engine/datas.mjs';
import { somaEuros } from '../engine/dinheiro.mjs';
import { calcularAcoesDevidas, coalescerAcoes } from '../engine/escalonamento.mjs';

const SETE_DIAS_MS = 7 * 86400000;

/** Rótulo humano de um escalão de envelhecimento. */
function rotuloEscalao(id) {
  if (id === '90+') return tr('Mais de 90 dias', 'Over 90 days');
  return `${id} ${tr('dias', 'days')}`;
}

export default function PainelPage() {
  useLang();
  const navigate = useNavigate();

  const dividas = useColecao('dividas');
  const pagamentos = useColecao('pagamentos');
  const perfis = useColecao('perfis');
  const overlay = useColecao('clientes_cobranca');
  const fila = useColecao('fila_envios');
  const tarefas = useColecao('tarefas_cobranca');
  const tempo = useColecao('linha_tempo');
  const clientes = useClientes();

  const loading = dividas.loading || pagamentos.loading || perfis.loading
    || overlay.loading || fila.loading || tarefas.loading || tempo.loading
    || clientes.loading;

  useEffect(() => {
    if (dividas.error || pagamentos.error || perfis.error || overlay.error
      || fila.error || tarefas.error || tempo.error) {
      toast(tr('Falha ao carregar os dados do painel.', 'Failed to load dashboard data.'), { tone: 'error' });
    }
  }, [dividas.error, pagamentos.error, perfis.error, overlay.error, fila.error, tarefas.error, tempo.error]);

  const hoje = hojeISO();

  /* Visão plana dos itens em aberto (dívida inteira ou prestação). */
  const itens = useMemo(
    () => itensEmAberto(dividas.items, pagamentos.items, indexarClientes(clientes.items)),
    [dividas.items, pagamentos.items, clientes.items],
  );

  /* 1) Estatísticas de topo. */
  const resumo = useMemo(() => {
    const vencidos = itens.filter((i) => estaVencida(i, hoje));
    const previstos = itens.filter((i) => {
      const d = diasAtraso(i.dataVencimento, hoje);
      return Number.isFinite(d) && d <= 0 && d >= -30;
    });
    return {
      totalAberto: somaEuros(itens.map((i) => i.valorEmDivida)),
      totalVencido: somaEuros(vencidos.map((i) => i.valorEmDivida)),
      nVencidos: vencidos.length,
      nDividas: new Set(itens.map((i) => i.dividaId)).size,
      nItens: itens.length,
      totalPrevisto: somaEuros(previstos.map((i) => i.valorEmDivida)),
      nPrevistos: previstos.length,
    };
  }, [itens, hoje]);

  /* 2) Escalões de envelhecimento - só itens VENCIDOS; o resto em "Por vencer". */
  const envelhecimento = useMemo(() => {
    const porEscalao = new Map(AGING_BUCKETS.map((b) => [b.id, { n: 0, valores: [] }]));
    const porVencer = { n: 0, valores: [] };
    for (const item of itens) {
      const dias = diasAtraso(item.dataVencimento, hoje);
      if (Number.isFinite(dias) && dias > 0) {
        const alvo = porEscalao.get(agingBucket(dias));
        if (alvo) {
          alvo.n += 1;
          alvo.valores.push(item.valorEmDivida);
        }
      } else {
        porVencer.n += 1;
        porVencer.valores.push(item.valorEmDivida);
      }
    }
    return {
      escaloes: AGING_BUCKETS.map((b) => {
        const x = porEscalao.get(b.id);
        return { id: b.id, n: x.n, total: somaEuros(x.valores) };
      }),
      porVencer: { n: porVencer.n, total: somaEuros(porVencer.valores) },
    };
  }, [itens, hoje]);

  /* 3) Principais devedores (top 5 por total em aberto). */
  const topDevedores = useMemo(() => {
    const porCliente = new Map();
    for (const item of itens) {
      const atual = porCliente.get(item.clienteId)
        || { clienteId: item.clienteId, nome: '', valores: [], vencidaMaisAntiga: null };
      if (!atual.nome && item.clienteNome) atual.nome = item.clienteNome;
      atual.valores.push(item.valorEmDivida);
      const dias = diasAtraso(item.dataVencimento, hoje);
      if (Number.isFinite(dias) && dias > 0) {
        const venc = String(item.dataVencimento || '');
        if (venc && (!atual.vencidaMaisAntiga || venc < atual.vencidaMaisAntiga)) {
          atual.vencidaMaisAntiga = venc;
        }
      }
      porCliente.set(item.clienteId, atual);
    }
    return [...porCliente.values()]
      .map((c) => ({ ...c, total: somaEuros(c.valores) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [itens, hoje]);

  /* 4) "Para hoje" - ações do plano de escalonamento devidas no dia. */
  const paraHoje = useMemo(() => {
    if (!perfis.items.length) {
      return { emails: [], tarefas: [], atrasadas: 0, bloqueadas: 0, semPerfis: itens.length > 0 };
    }
    const overlayMap = indexarOverlay(overlay.items);

    // Deduplicação: chaves de passos já executados/agendados/ignorados.
    const executados = new Set();
    for (const envio of fila.items) {
      for (const chave of (Array.isArray(envio.lembreteChaves) ? envio.lembreteChaves : [])) {
        executados.add(chave);
      }
    }
    for (const tarefa of tarefas.items) {
      if (tarefa.lembreteChave) executados.add(tarefa.lembreteChave);
    }
    for (const evento of tempo.items) {
      if (evento.tipo !== 'ignorado') continue;
      const chaves = evento.meta && Array.isArray(evento.meta.chaves) ? evento.meta.chaves : [];
      for (const chave of chaves) executados.add(chave);
    }

    // Teto de frequência: envios efetivos nos últimos 7 dias, por cliente.
    const emailsRecentes = new Map();
    const corte = Date.now() - SETE_DIAS_MS;
    for (const envio of fila.items) {
      if (envio.estado !== 'enviado' || !envio.enviadoEm) continue;
      const quando = new Date(envio.enviadoEm).getTime();
      if (Number.isFinite(quando) && quando >= corte) {
        emailsRecentes.set(envio.clienteId, (emailsRecentes.get(envio.clienteId) || 0) + 1);
      }
    }

    const perfilDoCliente = (clienteId) => resolverPerfil(overlayMap, perfis.items, clienteId);
    const flagsDoCliente = (clienteId) => overlayMap.get(clienteId) || null;
    const acoes = calcularAcoesDevidas({
      hoje,
      itens,
      perfilDoCliente,
      flagsDoCliente,
      executados,
      emailsRecentesPorCliente: emailsRecentes,
    });
    const { emails, tarefas: tarefasDevidas } = coalescerAcoes(acoes, perfilDoCliente);
    return {
      emails,
      tarefas: tarefasDevidas,
      atrasadas: acoes.filter((a) => a.atrasado).length,
      bloqueadas: acoes.filter((a) => a.bloqueadoPorTeto).length,
      semPerfis: false,
    };
  }, [perfis.items, overlay.items, fila.items, tarefas.items, tempo.items, itens, hoje]);

  /* ------------------------------ render -------------------------------- */

  if (loading) {
    return (
      <div data-testid="painel-loading">
        <section className="grelha-stats">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="cartao"><Skeleton lines={2} /></div>
          ))}
        </section>
        <section className="cartao" style={{ marginTop: '1rem' }}><Skeleton lines={3} /></section>
        <section className="cartao" style={{ marginTop: '1rem' }}><Skeleton lines={5} /></section>
      </div>
    );
  }

  if (!dividas.items.length) {
    return (
      <div className="cartao" data-testid="painel-vazio">
        <EmptyState
          icon={<IconDividas size={32} />}
          title={tr('Ainda não há dívidas registadas', 'No debts recorded yet')}
          hint={tr(
            'Registe a primeira dívida manualmente ou sincronize as pré-faturas emitidas do Honorários.',
            'Record the first debt manually or sync the issued pre-invoices from Fees.',
          )}
          action={(
            <Button
              variant="primary"
              data-testid="painel-cta-nova-divida"
              data-demo-target="painel-cta"
              onClick={() => navigate('/nova')}
            >
              <IconMais size={16} /> {tr('Nova dívida', 'New debt')}
            </Button>
          )}
        />
      </div>
    );
  }

  const totalDevido = paraHoje.emails.length + paraHoje.tarefas.length;

  return (
    <div data-testid="painel-page">
      {/* 1) Estatísticas de topo */}
      <section className="grelha-stats" data-demo-target="painel-stats">
        <Stat
          label={tr('Total em dívida', 'Total outstanding')}
          value={eur(resumo.totalAberto)}
          sub={`${resumo.nItens} ${tr('itens em aberto', 'open items')}`}
          demoTarget="painel-total-divida"
        />
        <Stat
          label={tr('Total vencido', 'Total overdue')}
          value={eur(resumo.totalVencido)}
          sub={`${resumo.nVencidos} ${tr('itens vencidos', 'overdue items')}`}
          tone={resumo.totalVencido > 0 ? 'alerta' : undefined}
          demoTarget="painel-total-vencido"
        />
        <Stat
          label={tr('Dívidas em aberto', 'Open debts')}
          value={String(resumo.nDividas)}
          sub={tr('dívidas com saldo por receber', 'debts with a balance receivable')}
        />
        <Stat
          label={tr('Previsto em 30 dias', 'Expected within 30 days')}
          value={eur(resumo.totalPrevisto)}
          sub={`${resumo.nPrevistos} ${tr('vencimentos até 30 dias', 'due dates within 30 days')}`}
          tone={resumo.totalPrevisto > 0 ? 'ok' : undefined}
        />
      </section>

      {/* 2) Escalões de envelhecimento */}
      <section className="cartao" style={{ marginTop: '1rem' }} data-demo-target="painel-envelhecimento">
        <h2 className="cartao__titulo">{tr('Envelhecimento da dívida vencida', 'Overdue debt ageing')}</h2>
        {resumo.nVencidos === 0 && envelhecimento.porVencer.n === 0 ? (
          <EmptyState
            icon={<IconRelogio size={28} />}
            title={tr('Sem itens para envelhecer', 'Nothing to age')}
            hint={tr('Quando houver itens em aberto, os escalões aparecem aqui.', 'Once there are open items, the ageing buckets appear here.')}
          />
        ) : (
          <>
            {/* Barra proporcional do vencido por escalão - a legenda são os
                próprios cartões abaixo (dados como tinta, sem decoração). */}
            {resumo.nVencidos > 0 ? (
              <div
                className="envelhecimento-barra"
                role="img"
                aria-label={tr('Proporção do valor vencido por escalão', 'Share of overdue value per bucket')}
                data-testid="barra-envelhecimento"
              >
                {envelhecimento.escaloes.map((b, i) => (
                  b.total > 0 ? (
                    <div
                      key={b.id}
                      className={`envelhecimento-barra__seg envelhecimento-barra__seg--b${i}`}
                      style={{ flexGrow: b.total }}
                      title={`${rotuloEscalao(b.id)} — ${eur(b.total)}`}
                    />
                  ) : null
                ))}
              </div>
            ) : null}
            <div className="grelha-stats">
              {envelhecimento.escaloes.map((b) => (
                <Stat
                  key={b.id}
                  label={rotuloEscalao(b.id)}
                  value={eur(b.total)}
                  sub={`${b.n} ${b.n === 1 ? tr('item vencido', 'overdue item') : tr('itens vencidos', 'overdue items')}`}
                  tone={b.id === '90+' && b.n > 0 ? 'alerta' : undefined}
                  demoTarget={`painel-escalao-${b.id}`}
                />
              ))}
              <Stat
                label={tr('Por vencer', 'Not yet due')}
                value={eur(envelhecimento.porVencer.total)}
                sub={`${envelhecimento.porVencer.n} ${envelhecimento.porVencer.n === 1 ? tr('item', 'item') : tr('itens', 'items')}`}
                demoTarget="painel-por-vencer"
              />
            </div>
          </>
        )}
      </section>

      {/* 3) Principais devedores */}
      <section className="cartao" style={{ marginTop: '1rem' }} data-demo-target="painel-top-devedores">
        <h2 className="cartao__titulo">{tr('Principais devedores', 'Top debtors')}</h2>
        <DataTable
          data-testid="painel-tabela-devedores"
          columns={[
            {
              key: 'nome',
              label: tr('Cliente', 'Customer'),
              render: (r) => (
                <Link
                  to={`/clientes/${r.clienteId}`}
                  onClick={(e) => e.stopPropagation()}
                  data-testid={`painel-devedor-${r.clienteId}`}
                  style={{ fontWeight: 600, color: 'inherit', textDecoration: 'underline' }}
                >
                  {r.nome || tr('Cliente sem nome', 'Unnamed customer')}
                </Link>
              ),
            },
            {
              key: 'total',
              label: tr('Em dívida', 'Outstanding'),
              alinhar: 'direita',
              render: (r) => eur(r.total),
            },
            {
              key: 'vencidaMaisAntiga',
              label: tr('Vencida mais antiga', 'Oldest overdue'),
              alinhar: 'direita',
              render: (r) => (r.vencidaMaisAntiga ? formatData(r.vencidaMaisAntiga) : '—'),
            },
          ]}
          rows={topDevedores}
          rowKey={(r) => r.clienteId}
          onRowClick={(r) => navigate(`/clientes/${r.clienteId}`)}
          empty={(
            <EmptyState
              icon={<IconDividas size={28} />}
              title={tr('Sem devedores em aberto', 'No open debtors')}
              hint={tr('Todos os itens estão pagos ou suspensos.', 'Every item is either paid or suspended.')}
            />
          )}
        />
      </section>

      {/* 4) Para hoje */}
      <section
        className={`cartao ${totalDevido > 0 ? 'cartao--aviso' : ''}`}
        style={{ marginTop: '1rem' }}
        data-demo-target="painel-para-hoje"
      >
        <h2 className="cartao__titulo">{tr('Para hoje', 'For today')}</h2>
        {paraHoje.semPerfis ? (
          <div className="linha-acoes">
            <p>
              {tr(
                'Ainda não existe nenhum perfil de cobrança, pelo que os lembretes não podem ser calculados.',
                'There is no collection profile yet, so reminders cannot be computed.',
              )}
            </p>
            <span className="espacador" />
            <Button
              variant="secondary"
              data-testid="painel-ir-perfis"
              onClick={() => navigate('/perfis')}
            >
              <IconPerfis size={16} /> {tr('Configurar perfis', 'Set up profiles')}
            </Button>
          </div>
        ) : totalDevido === 0 ? (
          <EmptyState
            icon={<IconFila size={28} />}
            title={tr('Sem ações devidas hoje', 'No actions due today')}
            hint={tr('O plano de escalonamento está em dia para todos os clientes.', 'The escalation plan is up to date for every customer.')}
          />
        ) : (
          <div className="linha-acoes">
            <span data-testid="painel-emails-devidos">
              <IconEmail size={16} />{' '}
              <strong>{paraHoje.emails.length}</strong>{' '}
              {paraHoje.emails.length === 1 ? tr('email devido', 'email due') : tr('emails devidos', 'emails due')}
            </span>
            <span data-testid="painel-tarefas-devidas">
              <IconRelogio size={16} />{' '}
              <strong>{paraHoje.tarefas.length}</strong>{' '}
              {paraHoje.tarefas.length === 1 ? tr('tarefa devida', 'task due') : tr('tarefas devidas', 'tasks due')}
            </span>
            {paraHoje.atrasadas > 0 ? (
              <span>{paraHoje.atrasadas} {tr('em atraso', 'overdue')}</span>
            ) : null}
            {paraHoje.bloqueadas > 0 ? (
              <span>
                {paraHoje.bloqueadas}{' '}
                {tr('bloqueado(s) pelo teto semanal de emails', 'blocked by the weekly email cap')}
              </span>
            ) : null}
            <span className="espacador" />
            <Button
              variant="primary"
              data-testid="painel-abrir-fila"
              data-demo-target="painel-abrir-fila"
              onClick={() => navigate('/fila')}
            >
              <IconFila size={16} /> {tr('Abrir fila de trabalho', 'Open work queue')}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
