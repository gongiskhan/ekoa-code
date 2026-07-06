import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  useSharedCollection,
  updateShared,
  createShared,
  formatDate,
  formatEur,
  appHref,
  notify,
} from '../shared.js';
import { useDemoResult } from '../demo.js';
import {
  Button,
  Badge,
  Field,
  Input,
  Select,
  EmptyState,
  Skeleton,
  toast,
} from '../components/ui.jsx';
import {
  IconChevronRight,
  IconLifeBuoy,
  IconCalendar,
  IconPlus,
  IconCheck,
  IconExternalLink,
  IconClipboardForm,
  IconMailbox,
  IconTrash,
} from '../components/Icons.jsx';
import { SinoaDisclaimer } from './PedidosPage.jsx';
import {
  TIPO_PEDIDO_LABEL,
  TIPO_PEDIDO_TONE,
  ESTADO_LABEL,
  ESTADO_TONE,
  FASE_OPTIONS,
  gerarPrazosSinOA,
  condensarPassos,
  somaDespesas,
} from './apoio-logic.js';

/* 'YYYY-MM-DD' local de hoje - carimbo da decisão. */
function hojeStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/* Painel "mostra o seu trabalho" de um prazo gerado: data-limite + passos. */
function PrazoResultado({ idx, prazo }) {
  const condensados = useMemo(() => condensarPassos(prazo.resultado.passos), [prazo]);
  return (
    <div className="resultado-panel" data-testid={`apoio-prazo-${idx}`} style={{ marginTop: idx > 0 ? 'var(--sp-4, 1rem)' : 0 }}>
      <div className="row row-space-between" style={{ alignItems: 'baseline', flexWrap: 'wrap', gap: 'var(--sp-2, 0.5rem)' }}>
        <span className="text-strong" data-testid={`apoio-prazo-desc-${idx}`}>{prazo.descricao}</span>
        <span className="row row-2" style={{ alignItems: 'baseline', gap: 'var(--sp-2, 0.5rem)' }}>
          <span className="resultado-value" data-testid={`apoio-prazo-datalimite-${idx}`}>{prazo.resultado.dataLimite}</span>
          <span className="text-xs text-subtle">{formatDate(prazo.resultado.dataLimite)}</span>
        </span>
      </div>
      <div className="stack stack-2" style={{ marginTop: 'var(--sp-3, 0.75rem)' }}>
        <span className="nav-section-label" style={{ padding: 0 }}>Mostra o seu trabalho</span>
        <ul className="passos-list" data-testid={`apoio-prazo-passos-${idx}`}>
          {condensados.map((step, i) => {
            if (step.kind === 'nota') {
              return (
                <li key={`n-${i}`} className="passo-item">
                  <span className="passo-data">{step.data}</span>
                  <span className="passo-nota">{step.nota}</span>
                </li>
              );
            }
            if (step.kind === 'util') {
              return (
                <li key={`u-${i}`} className="passo-item passo-util">
                  <span className="passo-num">{step.dia}</span>
                  <span className="passo-data">{step.data}</span>
                  <span className="passo-nota">dia útil contado</span>
                </li>
              );
            }
            const intervalo = step.count > 1 ? `${step.from} a ${step.to}` : step.from;
            const resumo = step.count > 1 ? `${step.motivo} (${step.count} dias)` : step.motivo;
            return (
              <li key={`s-${i}`} className="passo-item passo-skip">
                <span className="passo-num">—</span>
                <span className="passo-data">{intervalo}</span>
                <span className="passo-nota">{resumo}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export default function PedidoDetailPage() {
  const { id } = useParams();
  const { items: pedidos, loading, refresh } = useSharedCollection('apoio_judiciario');
  const { items: clientes } = useSharedCollection('clientes');
  const { items: processos } = useSharedCollection('processos');
  const { items: correio } = useSharedCollection('correio');
  const { refresh: refreshPrazos } = useSharedCollection('prazos');

  const [notifData, setNotifData] = useState('');
  const [gerando, setGerando] = useState(false);
  const [acting, setActing] = useState(false);
  // Nova despesa (linha em edição).
  const [despDescricao, setDespDescricao] = useState('');
  const [despValor, setDespValor] = useState('');
  const [despCorreioId, setDespCorreioId] = useState('');

  const pedido = useMemo(() => pedidos.find((p) => p.id === id) || null, [pedidos, id]);
  const cliente = useMemo(() => (pedido ? clientes.find((c) => c.id === pedido.clienteId) || null : null), [clientes, pedido]);
  const processo = useMemo(() => (pedido && pedido.processoId ? processos.find((p) => p.id === pedido.processoId) || null : null), [processos, pedido]);

  // Sinaliza ao anfitrião da demo que o detalhe do pedido está visível.
  useDemoResult('apoio-detalhe', Boolean(pedido));

  // Comprovativos de correio disponíveis: só cartas com comprovativo arquivado.
  const comprovativos = useMemo(
    () => (Array.isArray(correio) ? correio.filter((r) => r.comprovativoDocumentoId) : []),
    [correio],
  );
  const correioById = useMemo(() => {
    const map = new Map();
    comprovativos.forEach((r) => map.set(r.id, r));
    return map;
  }, [comprovativos]);

  const prazosGerados = Array.isArray(pedido && pedido.prazosGerados) ? pedido.prazosGerados : [];
  const jaGerou = prazosGerados.length > 0;
  const notifStamp = pedido && pedido.datas ? pedido.datas.notificacao : null;

  // Painel dos prazos SinOA: recomputa o motor a partir da notificação registada
  // (determinístico - a mesma data-limite que foi persistida em `prazos`).
  const prazosPreview = useMemo(() => {
    if (!notifStamp) return [];
    try {
      return gerarPrazosSinOA(notifStamp);
    } catch {
      return [];
    }
  }, [notifStamp]);

  const despesas = Array.isArray(pedido && pedido.honorarios && pedido.honorarios.despesas)
    ? pedido.honorarios.despesas
    : [];
  const fase = (pedido && pedido.honorarios && pedido.honorarios.fase) || 'inicial';

  async function onRegistarNotificacao() {
    if (!pedido) return;
    if (!notifData.trim()) { toast('Indique a data da notificação da decisão.', { tone: 'error' }); return; }
    // Idempotência: se já há prazos gerados, não duplica (guarda dura).
    if (jaGerou) {
      toast('Os prazos SinOA já foram gerados para este pedido.', { tone: 'info' });
      return;
    }
    setGerando(true);
    try {
      // Lança se a data for impossível - preferimos falhar a gerar prazos errados.
      const gerados = gerarPrazosSinOA(notifData.trim());
      const ids = [];
      for (const g of gerados) {
        const row = await createShared('prazos', {
          ...(pedido.processoId ? { processoId: pedido.processoId } : {}),
          descricao: g.descricao,
          dataLimite: g.resultado.dataLimite,
          estado: 'pendente',
          origem: 'apoio',
          tipoContagem: g.contagem,
          showWork: { passos: g.resultado.passos, multaDias: g.resultado.multaDias },
        });
        if (row && row.id) ids.push(row.id);
      }
      await updateShared('apoio_judiciario', id, {
        datas: { ...(pedido.datas || {}), notificacao: notifData.trim() },
        prazosGerados: ids,
      });
      await notify({
        tipo: 'prazo',
        titulo: 'Prazos SinOA gerados',
        corpo: `${gerados.length} prazos do apoio judiciário a acompanhar no radar.`,
        href: appHref('legal-prazos'),
        ...(pedido.processoId ? { processoId: pedido.processoId } : {}),
      });
      await refresh();
      await refreshPrazos();
      toast('Prazos SinOA gerados.', { tone: 'ok' });
    } catch (e) {
      toast((e && e.message) || 'Não foi possível gerar os prazos.', { tone: 'error' });
    } finally {
      setGerando(false);
    }
  }

  async function onTransicao(novoEstado) {
    if (!pedido) return;
    setActing(true);
    try {
      const patch = { estado: novoEstado };
      // submetido_manual NÃO carimba mais nada (a submissão é feita no SinOA).
      // deferido/indeferido carimbam a data da decisão.
      if (novoEstado === 'deferido' || novoEstado === 'indeferido') {
        patch.datas = { ...(pedido.datas || {}), decisao: hojeStr() };
      }
      await updateShared('apoio_judiciario', id, patch);
      await refresh();
      toast(`Pedido marcado como ${ESTADO_LABEL[novoEstado] || novoEstado}.`, { tone: 'ok' });
    } catch (e) {
      toast((e && e.message) || 'Não foi possível actualizar o estado.', { tone: 'error' });
    } finally {
      setActing(false);
    }
  }

  async function onFaseChange(value) {
    if (!pedido) return;
    try {
      await updateShared('apoio_judiciario', id, { honorarios: { ...(pedido.honorarios || {}), fase: value, despesas } });
      await refresh();
    } catch {
      toast('Não foi possível actualizar a fase.', { tone: 'error' });
    }
  }

  async function onAddDespesa() {
    if (!pedido) return;
    const valorNum = Number(despValor);
    if (!despDescricao.trim()) { toast('Descreva a despesa.', { tone: 'error' }); return; }
    if (!Number.isFinite(valorNum) || valorNum <= 0) { toast('Indique um valor válido.', { tone: 'error' }); return; }
    const correioRow = despCorreioId ? correioById.get(despCorreioId) : null;
    const nova = {
      id: newId('desp'),
      descricao: despDescricao.trim(),
      valor: valorNum,
      ...(correioRow ? { correioId: correioRow.id, registoRef: correioRow.registoRef || null } : {}),
    };
    try {
      await updateShared('apoio_judiciario', id, {
        honorarios: { ...(pedido.honorarios || {}), fase, despesas: [...despesas, nova] },
      });
      await refresh();
      setDespDescricao('');
      setDespValor('');
      setDespCorreioId('');
      toast('Despesa adicionada.', { tone: 'ok' });
    } catch {
      toast('Não foi possível adicionar a despesa.', { tone: 'error' });
    }
  }

  async function onRemoveDespesa(despId) {
    if (!pedido) return;
    try {
      await updateShared('apoio_judiciario', id, {
        honorarios: { ...(pedido.honorarios || {}), fase, despesas: despesas.filter((d) => d.id !== despId) },
      });
      await refresh();
    } catch {
      toast('Não foi possível remover a despesa.', { tone: 'error' });
    }
  }

  if (loading && !pedido) {
    return <div data-testid="pedido-detail"><Skeleton lines={6} /></div>;
  }

  if (!pedido) {
    return (
      <div data-testid="pedido-detail">
        <EmptyState
          icon={<IconLifeBuoy />}
          title="Pedido não encontrado"
          hint="O pedido pode ter sido removido ou o endereço está incorreto."
          action={<Link className="btn btn-secondary" to="/">Voltar aos pedidos</Link>}
        />
      </div>
    );
  }

  const estado = pedido.estado || 'preparacao';
  const total = somaDespesas(despesas);

  return (
    <div data-testid="pedido-detail" data-demo-page="apoio/detalhe" data-demo-target="apoio-detalhe">
      <nav className="row row-1 text-subtle text-xs" aria-label="Migalhas" style={{ alignItems: 'center', marginBottom: 'var(--sp-3, 0.75rem)' }}>
        <Link to="/" className="stat-link">Pedidos</Link>
        <IconChevronRight size={12} />
        <span>{cliente ? cliente.nome : '(cliente removido)'}</span>
      </nav>

      <div className="page-header">
        <div>
          <h1 className="page-title">{cliente ? cliente.nome : 'Pedido de apoio judiciário'}</h1>
          <p className="page-subtitle row row-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Badge tone={TIPO_PEDIDO_TONE[pedido.tipoPedido] || 'neutral'}>{TIPO_PEDIDO_LABEL[pedido.tipoPedido] || pedido.tipoPedido}</Badge>
            <Badge tone={ESTADO_TONE[estado] || 'neutral'} data-testid="pedido-estado">{ESTADO_LABEL[estado] || estado}</Badge>
          </p>
        </div>
        <div className="row row-2">
          {estado === 'preparacao' ? (
            <Button data-testid="apoio-submeter" onClick={() => onTransicao('submetido_manual')} disabled={acting}>
              <IconCheck size={14} /> Marcar submetido (manual)
            </Button>
          ) : null}
          {estado === 'submetido_manual' ? (
            <>
              <Button variant="secondary" data-testid="apoio-indeferir" onClick={() => onTransicao('indeferido')} disabled={acting}>
                Indeferido
              </Button>
              <Button data-testid="apoio-deferir" onClick={() => onTransicao('deferido')} disabled={acting}>
                <IconCheck size={14} /> Deferido
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {estado === 'preparacao' || estado === 'submetido_manual' ? <SinoaDisclaimer /> : null}

      <div className="prazos-layout" style={{ marginTop: 'var(--sp-6, 1.5rem)' }}>
        {/* ---- Coluna principal: notificação/prazos + honorários ---- */}
        <div className="stack stack-6">
          <section className="card" aria-label="Notificação e prazos SinOA">
            <h2 className="card-title">Notificação da decisão e prazos SinOA</h2>
            <p className="card-subtitle">
              Ao registar a notificação da decisão, o motor de prazos gera as duas balizas do SinOA -
              o registo do pedido (5 dias úteis) e a documentação (30 dias) - e mostra a contagem.
            </p>

            {/* A acção fica SEMPRE presente; o handler é idempotente (não duplica
                prazos se já foram gerados). Após a geração, mostra-se também o
                aviso com a data registada e o atalho para o radar de prazos. */}
            <div className="row row-2" data-demo-target="apoio-notificacao" style={{ marginTop: 'var(--sp-4, 1rem)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Field label="Data da notificação">
                <Input
                  type="date"
                  data-testid="apoio-notif-data"
                  value={notifData}
                  onChange={(e) => setNotifData(e.target.value)}
                />
              </Field>
              <Button data-testid="apoio-notif-registar" onClick={onRegistarNotificacao} disabled={gerando}>
                <IconCalendar size={14} /> {gerando ? 'A gerar.' : 'Registar notificação'}
              </Button>
            </div>

            {jaGerou ? (
              <div className="citius-resultado is-review" role="note" data-testid="apoio-notif-registada" style={{ marginTop: 'var(--sp-4, 1rem)' }}>
                <span className="citius-resultado-icon" aria-hidden="true"><IconCalendar /></span>
                <span className="citius-resultado-text">
                  <span className="citius-resultado-strong">Notificação registada em {formatDate(notifStamp)}</span>
                  <span className="citius-resultado-meta row row-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    {prazosGerados.length} prazos gerados.
                    <a href={appHref('legal-prazos')} className="stat-link" data-testid="apoio-prazos-radar" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                      Ver no radar de prazos <IconExternalLink size={12} />
                    </a>
                  </span>
                </span>
              </div>
            ) : null}

            {prazosPreview.length > 0 ? (
              <div data-testid="apoio-prazos" data-demo-target="apoio-prazos" style={{ marginTop: 'var(--sp-4, 1rem)' }}>
                {prazosPreview.map((pz, idx) => <PrazoResultado key={idx} idx={idx} prazo={pz} />)}
              </div>
            ) : null}
          </section>

          <section className="card" aria-label="Pedido de honorários">
            <div className="row row-space-between" style={{ alignItems: 'baseline', flexWrap: 'wrap', gap: 'var(--sp-2, 0.5rem)' }}>
              <h2 className="card-title">Pedido de honorários</h2>
              <span className="text-strong numeric" data-testid="apoio-despesas-total">{formatEur(total)}</span>
            </div>
            <p className="card-subtitle">
              Reúna a fase e as despesas com comprovativo de correio registado. Este pedido é depois
              apresentado pelo advogado - a aplicação apenas o organiza.
            </p>

            <div data-demo-target="apoio-despesas" style={{ marginTop: 'var(--sp-4, 1rem)' }}>
              <Field label="Fase processual">
                <Select data-testid="apoio-fase" value={fase} onChange={(e) => onFaseChange(e.target.value)}>
                  {FASE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </Field>

              {despesas.length > 0 ? (
                <ul className="documentos-list" data-testid="apoio-despesas-lista" style={{ marginTop: 'var(--sp-3, 0.75rem)' }}>
                  {despesas.map((d, idx) => (
                    <li key={d.id} className="passo-item" data-testid={`apoio-despesa-${idx}`} style={{ alignItems: 'center' }}>
                      <span className="passo-nota" style={{ flex: 1, minWidth: 0 }}>
                        <span className="text-strong">{d.descricao}</span>
                        {d.registoRef ? (
                          <span className="text-subtle text-xs row row-2" data-testid={`apoio-despesa-comprovativo-${idx}`} style={{ alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                            <IconMailbox size={13} /> Comprovativo {d.registoRef}
                            <a href={appHref('legal-correio')} className="stat-link" onClick={(e) => e.stopPropagation()} style={{ color: 'var(--accent)' }}>
                              <IconExternalLink size={11} />
                            </a>
                          </span>
                        ) : null}
                      </span>
                      <span className="numeric text-strong">{formatEur(d.valor)}</span>
                      <Button variant="ghost" size="sm" data-testid={`apoio-despesa-remover-${idx}`} onClick={() => onRemoveDespesa(d.id)} aria-label="Remover despesa">
                        <IconTrash size={14} />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="field-hint" style={{ marginTop: 'var(--sp-2, 0.5rem)' }}>Sem despesas registadas.</p>
              )}

              <div className="form-grid" style={{ marginTop: 'var(--sp-4, 1rem)' }}>
                <Field label="Descrição da despesa">
                  <Input
                    type="text"
                    data-testid="apoio-despesa-descricao"
                    placeholder="Ex.: Certidão permanente"
                    value={despDescricao}
                    onChange={(e) => setDespDescricao(e.target.value)}
                  />
                </Field>
                <Field label="Valor (EUR)">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    data-testid="apoio-despesa-valor"
                    placeholder="0,00"
                    value={despValor}
                    onChange={(e) => setDespValor(e.target.value)}
                  />
                </Field>
                <Field label="Comprovativo de correio" hint={comprovativos.length === 0 ? 'Sem comprovativos arquivados no Correio.' : 'Cartas com comprovativo arquivado.'}>
                  <Select data-testid="apoio-despesa-correio" value={despCorreioId} onChange={(e) => setDespCorreioId(e.target.value)}>
                    <option value="">Sem comprovativo</option>
                    {comprovativos.map((r) => (
                      <option key={r.id} value={r.id}>
                        {(r.registoRef || 'Sem referência') + (r.conteudoDescricao ? ` - ${r.conteudoDescricao}` : '')}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="row row-2" style={{ marginTop: 'var(--sp-3, 0.75rem)' }}>
                <Button variant="secondary" data-testid="apoio-despesa-add" onClick={onAddDespesa}>
                  <IconPlus size={14} /> Adicionar despesa
                </Button>
              </div>
            </div>
          </section>
        </div>

        {/* ---- Coluna lateral: dados + formulário PJ ---- */}
        <div className="stack stack-6">
          <section className="card" aria-label="Dados do pedido">
            <h2 className="card-title">Dados</h2>
            <table className="data-table" style={{ marginTop: 'var(--sp-3, 0.75rem)' }}>
              <tbody>
                <tr><td>Tipo</td><td>{TIPO_PEDIDO_LABEL[pedido.tipoPedido] || pedido.tipoPedido}</td></tr>
                <tr>
                  <td>Processo</td>
                  <td>
                    {processo ? (
                      <a href={appHref('legal-nucleo', `processos/${processo.id}`)} style={{ color: 'var(--accent)', fontWeight: 600 }}>
                        {processo.numeroProcesso || '(sem número)'}
                      </a>
                    ) : <span className="text-subtle">Sem processo</span>}
                  </td>
                </tr>
                <tr><td>Data do pedido</td><td>{pedido.datas && pedido.datas.pedido ? formatDate(pedido.datas.pedido) : '—'}</td></tr>
                <tr><td>Notificação</td><td>{notifStamp ? formatDate(notifStamp) : '—'}</td></tr>
                <tr><td>Decisão</td><td data-testid="apoio-data-decisao">{pedido.datas && pedido.datas.decisao ? formatDate(pedido.datas.decisao) : '—'}</td></tr>
              </tbody>
            </table>
          </section>

          <section className="card" aria-label="Formulário de protecção jurídica">
            <h2 className="card-title">Formulário PJ</h2>
            <p className="card-subtitle">
              O modelo do formulário de protecção jurídica é escolhido e preenchido no módulo de
              Formulários, sobre os dados deste cliente e processo.
            </p>
            <div className="row row-2" style={{ marginTop: 'var(--sp-3, 0.75rem)' }}>
              <a
                href={appHref('legal-forms', 'preencher')}
                className="btn btn-secondary"
                data-testid="apoio-pj"
                data-demo-target="apoio-pj"
              >
                <IconClipboardForm size={14} /> Preencher formulário PJ <IconExternalLink size={12} />
              </a>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
