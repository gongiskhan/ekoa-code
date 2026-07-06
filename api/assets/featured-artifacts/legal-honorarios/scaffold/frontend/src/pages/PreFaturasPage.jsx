import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  useSharedCollection,
  listShared,
  getShared,
  createShared,
  updateShared,
  notify,
  appHref,
  formatEur,
  formatDate,
} from '../shared.js';
import {
  Button,
  Field,
  Select,
  Input,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Badge,
  toast,
} from '../components/ui.jsx';
import { IconCoins, IconFilePdf, IconPrinter, IconFolder, IconAlertTriangle } from '../components/Icons.jsx';
import { DisclaimerBanner } from './DashboardPage.jsx';
import {
  computeHonorariosPrefatura,
  renderPrefaturaTexto,
  noPeriodo,
  periodoLabel,
  hojeISO,
  round2,
  DISCLAIMER,
} from './honorarios-logic.js';

const EMPTY_PERIODO = { modo: 'todos', mes: '', de: '', ate: '' };

export default function PreFaturasPage() {
  const [searchParams] = useSearchParams();
  const { items: lancamentos, refresh: refreshLancamentos } = useSharedCollection('lancamentos');
  const { items: processos } = useSharedCollection('processos');
  const { items: clientes, loading: clientesLoading } = useSharedCollection('clientes');
  const { items: documentos, refresh: refreshDocumentos } = useSharedCollection('documentos');

  const [processoId, setProcessoId] = useState('');
  const [periodo, setPeriodo] = useState({ ...EMPTY_PERIODO });
  const [pf, setPf] = useState(null);
  const [erro, setErro] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [emitindo, setEmitindo] = useState(false);
  // Lançamentos que ficaram faturados sem pré-fatura por uma falha irreversível
  // (rollback também falhou) - carecem de correção manual.
  const [recovery, setRecovery] = useState(null);
  // Guarda de re-entrância: impede duas emissões sobrepostas (duplo-clique antes
  // do re-render, ou dois separadores). O ref é síncrono, ao contrário do estado.
  const emitindoRef = useRef(false);

  // Pré-selecção do processo a partir de ?processo= (vinda do Resumo).
  const initedRef = useRef(false);
  useEffect(() => {
    if (initedRef.current) return;
    const q = searchParams.get('processo');
    if (q) { setProcessoId(q); initedRef.current = true; }
  }, [searchParams]);

  const processoById = useMemo(() => {
    const map = new Map();
    processos.forEach((p) => map.set(p.id, p));
    return map;
  }, [processos]);

  const clienteById = useMemo(() => {
    const map = new Map();
    clientes.forEach((c) => map.set(c.id, c));
    return map;
  }, [clientes]);

  const processo = processoById.get(processoId) || null;
  const cliente = processo ? clienteById.get(processo.clienteId) || null : null;
  // O processo aponta um cliente que NÃO resolveu (FK órfã): nunca se assume
  // "particular" às cegas - o cálculo mostra um aviso e não aplica retenção.
  const clienteDesconhecido = !!(processo && processo.clienteId && !cliente);

  // Lançamentos por faturar do processo dentro do período seleccionado.
  const elegiveis = useMemo(() => {
    if (!processoId) return [];
    return lancamentos.filter(
      (l) => l.processoId === processoId && l.faturado !== true && noPeriodo(l, periodo),
    );
  }, [lancamentos, processoId, periodo]);

  // Pré-faturas já emitidas deste processo (documentos origem honorarios).
  const emitidas = useMemo(() => {
    if (!processoId) return [];
    return documentos
      .filter((d) => d.origem === 'honorarios' && d.processoId === processoId)
      .slice()
      .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
  }, [documentos, processoId]);

  /* Invalidação: a pré-fatura calculada deixa de valer assim que muda qualquer
   * entrada do cálculo (processo, período, conjunto elegível). O utilizador
   * volta a calcular - nunca se emite sobre dados desactualizados. */
  const signature = useMemo(() => {
    const ids = elegiveis
      .map((l) => `${l.id}:${l.valor}:${l.tipo || ''}`)
      .sort()
      .join('|');
    return `${processoId}::${periodo.modo}:${periodo.mes}:${periodo.de}:${periodo.ate}::${cliente ? cliente.tipo : ''}::${ids}`;
  }, [processoId, periodo, elegiveis, cliente]);

  const lastSig = useRef(signature);
  useEffect(() => {
    if (lastSig.current !== signature) {
      lastSig.current = signature;
      setPf(null);
      setErro(null);
    }
  }, [signature]);

  function onCalcular() {
    setErro(null);
    setPf(null);
    if (!processoId) { setErro('Seleccione o processo.'); return; }
    if (elegiveis.length === 0) {
      setErro('Não há lançamentos por faturar neste processo e período.');
      return;
    }
    try {
      const r = computeHonorariosPrefatura({
        lancamentos: elegiveis.map((l) => ({ tipo: l.tipo, descricao: l.descricao, valor: round2(l.valor) })),
        clienteTipo: cliente ? cliente.tipo : undefined,
        clienteDesconhecido,
      });
      setPf({ ...r, lancamentoIds: elegiveis.map((l) => l.id) });
    } catch (e) {
      setErro((e && e.message) || 'Não foi possível calcular a pré-fatura.');
    }
  }

  async function onEmitirConfirmado() {
    // Guarda de re-entrância SÍNCRONA: a leitura optimista check-then-act não
    // trava duas emissões sobrepostas (duplo-clique antes do re-render). Fecha o
    // diálogo já, antes de qualquer await.
    if (emitindoRef.current) return;
    emitindoRef.current = true;
    setConfirmOpen(false);
    if (!pf || !processoId) { emitindoRef.current = false; return; }
    setErro(null);
    setRecovery(null);
    setEmitindo(true);
    // Lançamentos que ESTE run já marcou faturado - para rollback em falha.
    const marcados = [];
    // Referência única deste run (atribuída antes da gravação do documento).
    let runRef = null;
    const descById = new Map();
    try {
      // Reler e RECALCULAR agora - a pré-fatura gravada corresponde exactamente
      // ao conjunto que fica faturado, não a um snapshot possivelmente velho.
      const todos = await listShared('lancamentos');
      const porFaturar = todos.filter(
        (l) => l && l.processoId === processoId && l.faturado !== true && noPeriodo(l, periodo),
      );
      if (porFaturar.length === 0) {
        setErro('Não há lançamentos por faturar neste processo e período.');
        setPf(null);
        await refreshLancamentos();
        return;
      }
      porFaturar.forEach((l) => descById.set(l.id, l.descricao || '(sem descrição)'));
      const r = computeHonorariosPrefatura({
        lancamentos: porFaturar.map((l) => ({ tipo: l.tipo, descricao: l.descricao, valor: round2(l.valor) })),
        clienteTipo: cliente ? cliente.tipo : undefined,
        clienteDesconhecido,
      });
      const ids = porFaturar.map((l) => l.id);
      // Verificação optimista: reconfirma que cada lançamento continua por faturar.
      const atuais = await Promise.all(ids.map((id) => getShared('lancamentos', id)));
      if (atuais.some((l) => !l || l.faturado === true)) {
        setErro('Alguns lançamentos já foram faturados entretanto. Recarregue e tente novamente.');
        await refreshLancamentos();
        return;
      }
      // Marca faturado PRIMEIRO; só depois grava o documento - nunca fica um
      // documento cujos lançamentos não tenham sido marcados. Se a gravação
      // falhar, o catch faz rollback (best-effort) dos que foram marcados.
      for (const id of ids) {
        await updateShared('lancamentos', id, { faturado: true });
        marcados.push(id);
      }
      const numeroProcesso = processo ? processo.numeroProcesso : '';
      const clienteNome = cliente ? cliente.nome : '';
      const texto = renderPrefaturaTexto({ numeroProcesso, clienteNome, periodo, pf: r });
      // Referência única DESTE run: permite ao catch distinguir "a gravação
      // falhou mesmo" de "a resposta perdeu-se mas o documento persistiu"
      // (nesse caso o rollback seria ELE a corromper - ver o catch).
      runRef = `pf-${processoId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await createShared('documentos', {
        nome: `Pré-fatura ${numeroProcesso || processoId} ${periodoLabel(periodo)}`.trim(),
        runRef,
        tipo: 'nota',
        texto,
        origem: 'honorarios',
        processoId,
        // FK órfã (cliente desconhecido): nunca gravar um clienteId que não
        // resolve - o documento fica só com o processo.
        clienteId: !clienteDesconhecido && processo ? processo.clienteId : null,
        versao: 1,
        data: hojeISO(),
      });
      await notify({
        tipo: 'documento',
        titulo: 'Nova pré-fatura de honorários',
        corpo: `${numeroProcesso || 'Processo'} - total ${formatEur(r.total)}.`,
        processoId,
        href: appHref('legal-honorarios', 'pre-faturas'),
      });
      await refreshLancamentos();
      await refreshDocumentos();
      setPf(null);
      toast('Pré-fatura emitida e guardada no Dossiê.', { tone: 'ok' });
    } catch (e) {
      // Antes de reverter, confirma que o documento NÃO ficou gravado: um erro
      // ambíguo (resposta perdida após persistir) faria o rollback desmarcar
      // lançamentos de uma pré-fatura que EXISTE. Se o runRef aparece na
      // colecção, o run afinal teve sucesso - não reverter.
      try {
        const docs = runRef ? await listShared('documentos') : [];
        const persistiu = docs.some((d) => d && d.runRef === runRef);
        if (persistiu) {
          setErro(null);
          await refreshLancamentos();
          await refreshDocumentos();
          setPf(null);
          toast('Pré-fatura emitida (confirmada após nova leitura).', { tone: 'ok' });
          return;
        }
      } catch {
        // A releitura falhou - segue para o rollback normal.
      }
      // Rollback best-effort: desmarca os lançamentos que ESTE run marcou, para
      // não deixar honorários faturados sem a pré-fatura correspondente.
      const naoRevertidos = [];
      for (const id of marcados) {
        try {
          await updateShared('lancamentos', id, { faturado: false });
        } catch {
          naoRevertidos.push(id);
        }
      }
      if (naoRevertidos.length > 0) {
        // Nem o rollback foi possível - expõe a lista para correção manual.
        setRecovery(naoRevertidos.map((id) => descById.get(id) || id));
      }
      setErro((e && e.message) || 'Não foi possível emitir a pré-fatura.');
      toast('Falha ao emitir a pré-fatura. Reveja os lançamentos.', { tone: 'error' });
      await refreshLancamentos();
    } finally {
      setEmitindo(false);
      emitindoRef.current = false;
    }
  }

  const semProcessos = processos.length === 0;
  const numeroProcesso = processo ? processo.numeroProcesso : '';
  const clienteNome = cliente ? cliente.nome : '';

  return (
    <div data-testid="prefaturas-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Pré-faturas</h1>
          <p className="page-subtitle">
            Some os lançamentos por faturar de um processo numa pré-fatura de conferência, com o
            cálculo à vista. Ao emitir, fica guardada nos documentos do Dossiê.
          </p>
        </div>
      </div>

      <DisclaimerBanner />

      {recovery && recovery.length > 0 ? (
        <div className="citius-resultado is-erro" data-testid="pf-recovery" role="alert" style={{ marginTop: 'var(--sp-4, 1rem)' }}>
          <span className="citius-resultado-icon" aria-hidden="true"><IconAlertTriangle /></span>
          <span className="citius-resultado-text">
            <span className="citius-resultado-strong">Recuperação necessária</span>
            <span className="citius-resultado-meta">
              Estes lançamentos ficaram marcados como faturados sem pré-fatura - desmarque manualmente:
              {' '}{recovery.join('; ')}
            </span>
          </span>
        </div>
      ) : null}

      <div className="prazos-layout" style={{ marginTop: 'var(--sp-6, 1.5rem)' }}>
        {/* ---------- (A) CÁLCULO ---------- */}
        <section className="card" aria-label="Calcular pré-fatura">
          <h2 className="card-title">Calcular</h2>
          <p className="card-subtitle">Escolha o processo e o período a faturar.</p>

          <div className="form" style={{ marginTop: 'var(--sp-4, 1rem)' }}>
            <Field label="Processo" required>
              <Select data-testid="pf-processo" data-demo-target="hon-processo" value={processoId} onChange={(e) => setProcessoId(e.target.value)}>
                <option value="">{semProcessos ? 'Sem processos - abra um no Núcleo.' : 'Seleccione o processo.'}</option>
                {processos.map((p) => {
                  const c = clienteById.get(p.clienteId);
                  const nome = c ? c.nome : '';
                  return (
                    <option key={p.id} value={p.id}>
                      {p.numeroProcesso || '(sem número)'}{nome ? ` - ${nome}` : ''}
                    </option>
                  );
                })}
              </Select>
            </Field>

            <Field label="Período">
              <Select data-testid="pf-periodo-modo" value={periodo.modo} onChange={(e) => setPeriodo({ ...EMPTY_PERIODO, modo: e.target.value })}>
                <option value="todos">Todos os lançamentos por faturar</option>
                <option value="mes">Um mês</option>
                <option value="intervalo">Intervalo de datas</option>
              </Select>
            </Field>

            {periodo.modo === 'mes' ? (
              <Field label="Mês">
                <Input type="month" data-testid="pf-mes" value={periodo.mes} onChange={(e) => setPeriodo((p) => ({ ...p, mes: e.target.value }))} />
              </Field>
            ) : periodo.modo === 'intervalo' ? (
              <div className="form-grid">
                <Field label="De"><Input type="date" data-testid="pf-de" value={periodo.de} onChange={(e) => setPeriodo((p) => ({ ...p, de: e.target.value }))} /></Field>
                <Field label="Até"><Input type="date" data-testid="pf-ate" value={periodo.ate} onChange={(e) => setPeriodo((p) => ({ ...p, ate: e.target.value }))} /></Field>
              </div>
            ) : null}

            <div className="stack stack-2">
              <span className="nav-section-label" style={{ padding: 0 }}>
                Elegíveis ({elegiveis.length})
                {cliente ? <> · cliente {cliente.tipo === 'empresa' ? 'empresa (com retenção)' : 'particular (sem retenção)'}</> : null}
              </span>
              {!processoId ? (
                <p className="field-hint">Seleccione um processo para ver os lançamentos por faturar.</p>
              ) : elegiveis.length === 0 ? (
                <p className="field-hint">Sem lançamentos por faturar neste processo e período.</p>
              ) : (
                <ul className="passos-list" data-testid="pf-elegiveis">
                  {elegiveis.map((l) => (
                    <li key={l.id} className="passo-item">
                      <span className="passo-nota" style={{ flex: 1 }}>
                        {l.descricao || '(sem descrição)'}
                        <Badge tone={l.tipo === 'despesa' ? 'neutral' : 'info'} style={{ marginLeft: 'var(--sp-2, 0.5rem)' }}>
                          {l.tipo === 'despesa' ? 'Despesa' : 'Honorário'}
                        </Badge>
                      </span>
                      <span className="passo-data" style={{ minWidth: 'auto' }}>{formatEur(l.valor)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="row row-2">
              <Button data-testid="pf-calcular" data-demo-target="hon-calcular" onClick={onCalcular} disabled={!processoId || elegiveis.length === 0 || clientesLoading}>
                <IconCoins /> Calcular pré-fatura
              </Button>
            </div>
          </div>

          {erro ? <p className="resultado-erro" data-testid="pf-erro">{erro}</p> : null}

          {pf ? (
            <div className="resultado-panel" data-testid="pf-resultado">
              <table className="data-table" data-testid="pf-breakdown" data-demo-target="hon-breakdown">
                <tbody>
                  {pf.linhas.map((l) => (
                    <tr
                      key={l.chave}
                      data-testid={`pf-linha-${l.chave}`}
                      className={l.destaque ? 'text-strong' : undefined}
                      style={l.aviso ? { color: 'var(--warn)' } : undefined}
                    >
                      <td>{l.rotulo}</td>
                      <td className="numeric">
                        {l.nota ? l.nota : `${l.negativo ? '−' : ''}${formatEur(l.valor)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p className="field-hint">
                Ao emitir, os {pf.honorariosCount + pf.despesasCount} lançamento(s) passam a faturados e a
                pré-fatura fica guardada nos documentos do processo. Não é emitida nenhuma fatura oficial.
              </p>

              <div className="row row-2">
                <Button data-testid="pf-emitir" onClick={() => setConfirmOpen(true)} disabled={emitindo}>
                  <IconFilePdf /> {emitindo ? 'A emitir.' : 'Emitir pré-fatura'}
                </Button>
                <Button variant="secondary" data-testid="pf-imprimir" onClick={() => window.print()}>
                  <IconPrinter /> Guardar PDF
                </Button>
              </div>
            </div>
          ) : null}
        </section>

        {/* ---------- (B) EMITIDAS ---------- */}
        <section aria-label="Pré-faturas emitidas">
          <div className="page-header" style={{ marginBottom: 'var(--sp-4, 1rem)' }}>
            <div>
              <h2 className="card-title" style={{ fontSize: 'var(--text-lg, 1.125rem)' }}>Emitidas</h2>
              <p className="page-subtitle">Guardadas nos documentos do processo (origem: honorários).</p>
            </div>
          </div>

          {!processoId ? (
            <EmptyState icon={<IconFolder />} title="Seleccione um processo" hint="Escolha um processo para ver as pré-faturas já emitidas." />
          ) : emitidas.length === 0 ? (
            <EmptyState icon={<IconFolder />} title="Sem pré-faturas" hint="Calcule e emita a primeira pré-fatura deste processo." />
          ) : (
            <DataTable
              data-testid="hon-emitidas-tabela"
              columns={[
                { key: 'nome', label: 'Pré-fatura', render: (d) => (
                  <div className="stack stack-1">
                    <span className="text-strong">{d.nome}</span>
                    {d.data ? <span className="text-subtle text-xs">{formatDate(d.data)}</span> : null}
                  </div>
                ) },
                { key: 'estado', label: 'Estado', render: () => <Badge tone="info">Rascunho</Badge> },
              ]}
              rows={emitidas}
              rowKey="id"
            />
          )}
        </section>
      </div>

      {/* Vista para impressão - escondida no ecrã, revelada em window.print(). */}
      {pf ? (
        <div className="print-only" data-testid="pf-print" aria-hidden="true">
          <h1>Pré-fatura de honorários (rascunho de conferência)</h1>
          <p>Processo: {numeroProcesso || '—'}<br />Cliente: {clienteNome || '—'}<br />Período: {periodoLabel(periodo)}</p>
          <table className="data-table">
            <tbody>
              {pf.linhas.map((l) => (
                <tr key={l.chave}>
                  <td>{l.rotulo}</td>
                  <td className="numeric">{l.nota ? l.nota : `${l.negativo ? '−' : ''}${formatEur(l.valor)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p><strong>{DISCLAIMER}</strong></p>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title="Emitir pré-fatura"
        message={pf ? `Vai marcar ${pf.honorariosCount + pf.despesasCount} lançamento(s) como faturados e guardar a pré-fatura (total ${formatEur(pf.total)}) nos documentos do processo. Continuar?` : ''}
        confirmLabel="Emitir"
        onConfirm={onEmitirConfirmado}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
