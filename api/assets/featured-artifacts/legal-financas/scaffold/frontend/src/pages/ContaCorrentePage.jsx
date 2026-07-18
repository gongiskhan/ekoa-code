import { useEffect, useMemo, useState } from 'react';
import { useSharedCollection, formatEur, formatDate } from '../shared.js';
import { useDemoResult } from '../demo.js';
import { Button, Field, Select, DataTable, EmptyState, Badge } from '../components/ui.jsx';
import { IconWallet, IconFolder } from '../components/Icons.jsx';
import { contaSaldo, contaExtrato, origemLabel } from './financas-logic.js';
import { extratoCsv, descarregarCsv } from './financas-csv.js';

/*
 * Conta corrente por cliente sobre a espinha partilhada. Lê `conta_corrente`
 * (débitos e créditos com origem) e mostra o extrato ordenado com o saldo
 * corrente acumulado + o saldo em dívida em destaque. Não escreve nada aqui - os
 * movimentos entram por despesas aprovadas, provisões recebidas ou pré-faturas.
 *
 * Vista por processo: um segundo filtro opcional restringe o extrato aos
 * movimentos com `processoId` e soma as provisões recebidas desse processo.
 * Movimentos antigos sem `processoId` NUNCA desaparecem em silêncio - a vista
 * por processo declara quantos ficaram de fora (só a vista de cliente os tem).
 */
export default function ContaCorrentePage() {
  const { items: clientes, loading: clientesLoading } = useSharedCollection('clientes');
  const { items: movimentos, loading: movLoading } = useSharedCollection('conta_corrente');
  const { items: processos } = useSharedCollection('processos');
  const { items: provisoes } = useSharedCollection('provisoes');

  const [clienteId, setClienteId] = useState('');
  const [processoId, setProcessoId] = useState('');
  // Movimentos sem cliente (p. ex. um pagamento de reserva pública cujo email
  // não corresponde a nenhum cliente) NÃO podem ficar invisíveis no razão.
  const SEM_CLIENTE = '__sem_cliente__';

  // Selecção por omissão: o primeiro cliente, assim que a lista carrega. Assim a
  // conta corrente mostra logo um saldo (a demo destaca-o em '/').
  useEffect(() => {
    if (!clienteId && clientes.length > 0) setClienteId(clientes[0].id);
  }, [clientes, clienteId]);

  const clienteById = useMemo(() => {
    const map = new Map();
    clientes.forEach((c) => map.set(c.id, c));
    return map;
  }, [clientes]);

  const doCliente = useMemo(
    () => movimentos.filter((m) => (clienteId === SEM_CLIENTE
      ? m.clienteId == null
      : m.clienteId === clienteId)),
    [movimentos, clienteId],
  );

  // Vista por processo (opcional). '' = extrato completo do cliente, o
  // comportamento original - os testes e as demos dependem dessa omissão.
  const processosDoCliente = useMemo(
    () => (clienteId && clienteId !== SEM_CLIENTE
      ? processos.filter((p) => p.clienteId === clienteId)
      : []),
    [processos, clienteId],
  );
  const visiveis = useMemo(
    () => (processoId ? doCliente.filter((m) => m.processoId === processoId) : doCliente),
    [doCliente, processoId],
  );
  // Honestidade: movimentos do cliente sem processoId (lançados antes desta
  // vista, ou genuinamente sem processo) ficam FORA da vista por processo.
  const semProcessoCount = useMemo(
    () => (processoId ? doCliente.filter((m) => m.processoId == null).length : 0),
    [doCliente, processoId],
  );

  const extrato = useMemo(() => contaExtrato(visiveis), [visiveis]);
  const { debitos, creditos, saldo } = useMemo(() => contaSaldo(visiveis), [visiveis]);

  // Provisões com saldo disponível (estado 'recebida') no âmbito seleccionado:
  // do processo quando há filtro, senão de todo o cliente.
  const provisoesAmbito = useMemo(() => {
    if (!clienteId || clienteId === SEM_CLIENTE) return [];
    return provisoes.filter((p) => p.clienteId === clienteId
      && p.estado === 'recebida'
      && (!processoId || p.processoId === processoId));
  }, [provisoes, clienteId, processoId]);
  const provisoesDisponiveis = useMemo(
    () => provisoesAmbito.reduce((sum, p) => sum + (Number(p.saldo) || 0), 0),
    [provisoesAmbito],
  );

  const cliente = clienteById.get(clienteId) || null;
  const processo = useMemo(
    () => processosDoCliente.find((p) => p.id === processoId) || null,
    [processosDoCliente, processoId],
  );
  const temSemCliente = useMemo(() => movimentos.some((m) => m && m.clienteId == null), [movimentos]);
  const loading = clientesLoading || movLoading;

  function onExportarCsv() {
    const nomeCliente = clienteId === SEM_CLIENTE ? '(movimentos por associar)' : (cliente ? cliente.nome : '');
    const texto = extratoCsv({
      clienteNome: nomeCliente,
      processoNumero: processo ? processo.numeroProcesso : '',
      geradoEm: new Date().toISOString().slice(0, 10),
      extrato: extrato.map((m) => ({ ...m, origemLabel: origemLabel(m.origem) })),
    });
    descarregarCsv(`conta-corrente ${nomeCliente}${processo ? ` ${processo.numeroProcesso}` : ''}`, texto);
  }

  // Sinaliza à ponte de demos que o saldo está visível (annotate-result).
  useDemoResult('financas-saldo', !loading && !!clienteId);

  const saldoLabel = saldo > 0 ? 'Saldo em dívida' : saldo < 0 ? 'Saldo a favor do cliente' : 'Conta saldada';

  return (
    <div data-testid="conta-corrente-page" data-demo-page="financas/conta">
      <div className="page-header">
        <div>
          <h1 className="page-title">Conta corrente</h1>
          <p className="page-subtitle">
            O extrato de cada cliente sobre a espinha partilhada - débitos e créditos, com a origem
            de cada movimento e o saldo corrente acumulado.
          </p>
        </div>
      </div>

      <div className="filters" style={{ marginTop: 'var(--sp-6, 1.5rem)' }}>
        <Field label="Cliente">
          <Select
            data-testid="cc-cliente"
            value={clienteId}
            onChange={(e) => { setClienteId(e.target.value); setProcessoId(''); }}
          >
            <option value="">{clientes.length === 0 ? 'Sem clientes - abra um no Núcleo.' : 'Seleccione o cliente.'}</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}{c.nif ? ` · ${c.nif}` : ''}</option>
            ))}
            {temSemCliente && (
              <option value={SEM_CLIENTE}>(Movimentos por associar a cliente)</option>
            )}
          </Select>
        </Field>
        {clienteId && clienteId !== SEM_CLIENTE && (
          <Field label="Processo" hint="Opcional - restringe o extrato aos movimentos imputados ao processo.">
            <Select data-testid="cc-processo" value={processoId} onChange={(e) => setProcessoId(e.target.value)}>
              <option value="">Todos os movimentos do cliente</option>
              {processosDoCliente.map((p) => (
                <option key={p.id} value={p.id}>{p.numeroProcesso || '(sem número)'}</option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      {processoId && semProcessoCount > 0 && (
        <p className="field-hint" data-testid="cc-sem-processo-aviso" style={{ marginTop: 'var(--sp-3, 0.75rem)' }}>
          {semProcessoCount === 1
            ? '1 movimento deste cliente não tem processo associado e fica fora desta vista.'
            : `${semProcessoCount} movimentos deste cliente não têm processo associado e ficam fora desta vista.`}
          {' '}Para o extrato completo, escolha "Todos os movimentos do cliente".
        </p>
      )}

      <div className="kpi-grid" style={{ marginTop: 'var(--sp-6, 1.5rem)' }}>
        <div className="kpi-card">
          <span className="kpi-label">{saldoLabel}</span>
          <span
            className="kpi-value is-accent"
            data-testid="financas-saldo"
            data-demo-target="financas-saldo"
          >
            {formatEur(saldo)}
          </span>
          <span className="field-hint">
            {cliente ? cliente.nome : 'Sem cliente seleccionado'}
            {processo ? ` - processo ${processo.numeroProcesso}` : ''}
          </span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Total debitado</span>
          <span className="kpi-value" data-testid="cc-debitos">{formatEur(debitos)}</span>
          <span className="field-hint">Honorários, despesas e taxas imputadas</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Total creditado</span>
          <span className="kpi-value" data-testid="cc-creditos">{formatEur(creditos)}</span>
          <span className="field-hint">Pagamentos e provisões recebidas</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Provisões disponíveis</span>
          <span className="kpi-value" data-testid="cc-provisoes">{formatEur(provisoesDisponiveis)}</span>
          <span className="field-hint">
            {provisoesAmbito.length === 0
              ? (processoId ? 'Sem provisões recebidas neste processo' : 'Sem provisões recebidas')
              : `Saldo por consumir de ${provisoesAmbito.length === 1 ? '1 provisão recebida' : `${provisoesAmbito.length} provisões recebidas`}${processoId ? ' do processo' : ' do cliente'}`}
          </span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Movimentos</span>
          <span className="kpi-value" data-testid="cc-count">{visiveis.length}</span>
          <span className="field-hint">{processoId ? 'No extrato do processo' : 'No extrato do cliente'}</span>
        </div>
      </div>

      <section className="card" aria-label="Extrato de conta corrente" style={{ marginTop: 'var(--sp-7, 2rem)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--sp-4, 1rem)' }}>
          <div>
            <h2 className="card-title">Extrato</h2>
            <p className="card-subtitle">Do mais antigo para o mais recente, com o saldo corrente à direita.</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            data-testid="cc-exportar-csv"
            disabled={loading || !clienteId || extrato.length === 0}
            onClick={onExportarCsv}
          >
            Exportar CSV
          </Button>
        </div>
        {loading ? (
          <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar o extrato.</span></div>
        ) : !clienteId ? (
          <EmptyState icon={<IconWallet />} title="Seleccione um cliente" hint="Escolha um cliente para ver a sua conta corrente." />
        ) : extrato.length === 0 ? (
          <EmptyState icon={<IconFolder />} title="Sem movimentos" hint="Este cliente ainda não tem movimentos na conta corrente." />
        ) : (
          <DataTable
            data-testid="cc-ledger"
            columns={[
              { key: 'data', label: 'Data', render: (m) => formatDate(m.data) },
              { key: 'tipo', label: 'Tipo', render: (m) => (
                <Badge tone={m.tipo === 'credito' ? 'ok' : 'media'}>
                  {m.tipo === 'credito' ? 'Crédito' : 'Débito'}
                </Badge>
              ) },
              { key: 'origem', label: 'Origem', render: (m) => <Badge tone="neutral">{origemLabel(m.origem)}</Badge> },
              { key: 'notas', label: 'Descrição', render: (m) => m.notas || m.refExterna || '-' },
              { key: 'valor', label: 'Valor', align: 'right', render: (m) => (
                <span className="text-strong">{m.tipo === 'credito' ? '−' : ''}{formatEur(m.valor)}</span>
              ) },
              { key: 'saldoCorrente', label: 'Saldo', align: 'right', render: (m) => (
                <span className="text-strong" data-testid="cc-saldo-corrente">{formatEur(m.saldoCorrente)}</span>
              ) },
            ]}
            rows={extrato}
            rowKey="id"
          />
        )}
      </section>
    </div>
  );
}
