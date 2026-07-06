import { useEffect, useMemo, useState } from 'react';
import { useSharedCollection, formatDate } from '../shared.js';
import {
  Button,
  Badge,
  Select,
  Field,
  EmptyState,
  Skeleton,
  toast,
} from '../components/ui.jsx';
import {
  IconFolder,
  IconFileText,
  IconCalendar,
  IconCheck,
  IconShieldCheck,
} from '../components/Icons.jsx';
import { partilhar, retirar } from '../portal.js';

const ORIGEM_LABEL = {
  upload: 'Carregado',
  portal: 'Do cliente',
  nota: 'Nota',
  contratos: 'Contratos',
  honorarios: 'Honorários',
  email: 'Email',
  whatsapp: 'WhatsApp',
};

/* Uma linha partilhável (estado / documento / evento) com o seu toggle. */
function ItemRow({ icon, titulo, meta, shared, busy, onToggle, testid, demoTarget }) {
  return (
    <li className="row row-space-between" style={{ padding: 'var(--sp-3) 0', borderTop: '1px solid var(--line-1)', gap: 'var(--sp-3)' }}>
      <div className="row row-2" style={{ minWidth: 0, alignItems: 'flex-start' }}>
        <span className="row-icon" aria-hidden="true" style={{ marginTop: 2 }}>{icon}</span>
        <div className="stack stack-1" style={{ minWidth: 0 }}>
          <span className="text-strong" style={{ wordBreak: 'break-word' }}>{titulo}</span>
          {meta ? <span className="text-subtle text-xs">{meta}</span> : null}
        </div>
      </div>
      <div className="row row-2" style={{ flexShrink: 0, alignItems: 'center' }}>
        {shared ? <Badge tone="ok"><IconCheck size={12} /> Partilhado</Badge> : null}
        <Button
          size="sm"
          variant={shared ? 'ghost' : 'secondary'}
          data-testid={testid}
          data-demo-target={demoTarget}
          disabled={busy}
          onClick={onToggle}
        >
          {shared ? 'Retirar' : 'Partilhar'}
        </Button>
      </div>
    </li>
  );
}

export default function PartilhasPage() {
  const { items: clientes, loading: loadingClientes } = useSharedCollection('clientes');
  const { items: acessos } = useSharedCollection('portal_acessos');
  const { items: processos } = useSharedCollection('processos');
  const { items: documentos } = useSharedCollection('documentos');
  const { items: eventos } = useSharedCollection('eventos');
  const { items: partilhas, refresh: refreshPartilhas } = useSharedCollection('portal_partilhas');

  const [clienteId, setClienteId] = useState('');
  const [processoId, setProcessoId] = useState('');
  const [busyKey, setBusyKey] = useState(null);

  const acessoIds = useMemo(() => new Set(acessos.map((a) => a.clienteId)), [acessos]);

  // Clientes com acesso primeiro (o portal só interessa a esses), depois os restantes.
  const clientesOrdenados = useMemo(() => {
    return [...clientes].sort((a, b) => {
      const aa = acessoIds.has(a.id) ? 0 : 1;
      const bb = acessoIds.has(b.id) ? 0 : 1;
      if (aa !== bb) return aa - bb;
      return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt');
    });
  }, [clientes, acessoIds]);

  // Auto-selecção do primeiro cliente COM processos (para abrir logo com
  // conteúdo partilhável e para a demo ter sempre um toggle 'portal-partilhar').
  useEffect(() => {
    if (clienteId || clientesOrdenados.length === 0) return;
    const comProcesso = clientesOrdenados.find((c) => processos.some((p) => p.clienteId === c.id));
    setClienteId((comProcesso || clientesOrdenados[0]).id);
  }, [clienteId, clientesOrdenados, processos]);

  const processosDoCliente = useMemo(
    () => processos.filter((p) => p.clienteId === clienteId),
    [processos, clienteId],
  );

  useEffect(() => {
    // Ao trocar de cliente, selecciona o primeiro processo desse cliente.
    if (processosDoCliente.length === 0) {
      setProcessoId('');
    } else if (!processosDoCliente.some((p) => p.id === processoId)) {
      setProcessoId(processosDoCliente[0].id);
    }
  }, [processosDoCliente, processoId]);

  const processo = processosDoCliente.find((p) => p.id === processoId) || null;
  const docsDoProcesso = useMemo(
    () => documentos.filter((d) => d.processoId === processoId),
    [documentos, processoId],
  );
  const eventosDoProcesso = useMemo(
    () => eventos.filter((e) => e.processoId === processoId && e.tipo !== 'portal_acesso'),
    [eventos, processoId],
  );

  const minhas = useMemo(() => partilhas.filter((p) => p.clienteId === clienteId), [partilhas, clienteId]);
  const shareOf = (tipo, refId) => minhas.find((p) => p.tipo === tipo && p.refId === refId) || null;

  async function toggle(tipo, refId, procId, key) {
    setBusyKey(key);
    try {
      const existing = shareOf(tipo, refId);
      if (existing) {
        await retirar(existing.id);
        toast('Deixou de estar partilhado com o cliente.', { tone: 'ok' });
      } else {
        await partilhar({ clienteId, tipo, refId, processoId: procId });
        toast('Partilhado com o cliente.', { tone: 'ok' });
      }
      await refreshPartilhas();
    } catch {
      toast('Não foi possível alterar a partilha.', { tone: 'error' });
    } finally {
      setBusyKey(null);
    }
  }

  const resumo = useMemo(() => {
    const estados = minhas.filter((p) => p.tipo === 'estado').length;
    const docs = minhas.filter((p) => p.tipo === 'documento').length;
    const evs = minhas.filter((p) => p.tipo === 'evento').length;
    return { estados, docs, evs, total: estados + docs + evs };
  }, [minhas]);

  const clienteSel = clientesOrdenados.find((c) => c.id === clienteId) || null;

  return (
    <div className="stack stack-6" data-demo-page="portal/partilhas" data-testid="partilhas-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Partilhas com o cliente</h1>
          <p className="page-subtitle">
            Escolha o cliente e o processo e decida, item a item, o que fica visível no portal. Nada é partilhado por
            omissão - só o que ligar aqui aparece do lado do cliente.
          </p>
        </div>
      </div>

      {loadingClientes ? (
        <Skeleton lines={5} />
      ) : clientesOrdenados.length === 0 ? (
        <EmptyState icon={<IconFolder />} title="Sem clientes" hint="Registe clientes no Núcleo para poder partilhar." />
      ) : (
        <>
          <div className="row row-4" style={{ flexWrap: 'wrap', alignItems: 'flex-end', gap: 'var(--sp-4)' }}>
            <Field label="Cliente">
              <Select value={clienteId} data-testid="partilhas-cliente" onChange={(e) => setClienteId(e.target.value)}>
                {clientesOrdenados.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome || c.email || c.id}
                    {acessoIds.has(c.id) ? '' : ' (sem acesso)'}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Processo">
              <Select
                value={processoId}
                data-testid="partilhas-processo"
                disabled={processosDoCliente.length === 0}
                onChange={(e) => setProcessoId(e.target.value)}
              >
                {processosDoCliente.length === 0 ? (
                  <option value="">Sem processos deste cliente</option>
                ) : (
                  processosDoCliente.map((p) => (
                    <option key={p.id} value={p.id}>{p.numeroProcesso || p.id}</option>
                  ))
                )}
              </Select>
            </Field>
          </div>

          {!clienteSel || !acessoIds.has(clienteSel.id) ? (
            <div className="card" style={{ padding: 'var(--sp-4)' }}>
              <p className="text-muted" style={{ margin: 0 }}>
                Este cliente ainda não foi convidado para o portal. Pode preparar as partilhas, mas só as verá depois de
                aceitar o convite (separador <strong>Acessos</strong>).
              </p>
            </div>
          ) : null}

          {processo ? (
            <div className="card stack stack-4" style={{ padding: 'var(--sp-5)' }}>
              <div className="stack stack-1">
                <span className="text-strong">{processo.numeroProcesso}</span>
                <span className="text-subtle text-xs">{processo.tribunal || ''}</span>
              </div>

              <div className="stack stack-2">
                <span className="nav-section-label">Estado do processo</span>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                  <ItemRow
                    icon={<IconShieldCheck size={16} />}
                    titulo="Estado atual do processo"
                    meta={`Situação: ${processo.estado || 'ativo'}`}
                    shared={!!shareOf('estado', processo.id)}
                    busy={busyKey === `estado-${processo.id}`}
                    testid="partilhar-estado"
                    demoTarget="portal-partilhar"
                    onToggle={() => toggle('estado', processo.id, processo.id, `estado-${processo.id}`)}
                  />
                </ul>
              </div>

              <div className="stack stack-2">
                <span className="nav-section-label">Documentos do processo</span>
                {docsDoProcesso.length === 0 ? (
                  <p className="text-subtle text-xs" style={{ margin: 0 }}>Sem documentos neste processo.</p>
                ) : (
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                    {docsDoProcesso.map((d) => (
                      <ItemRow
                        key={d.id}
                        icon={<IconFileText size={16} />}
                        titulo={d.nome || '(sem nome)'}
                        meta={`${ORIGEM_LABEL[d.origem] || 'Documento'} · ${formatDate(d.data || d.createdAt)}`}
                        shared={!!shareOf('documento', d.id)}
                        busy={busyKey === `documento-${d.id}`}
                        testid={`partilhar-doc-${d.id}`}
                        onToggle={() => toggle('documento', d.id, d.processoId, `documento-${d.id}`)}
                      />
                    ))}
                  </ul>
                )}
              </div>

              <div className="stack stack-2">
                <span className="nav-section-label">Eventos do processo</span>
                {eventosDoProcesso.length === 0 ? (
                  <p className="text-subtle text-xs" style={{ margin: 0 }}>Sem eventos neste processo.</p>
                ) : (
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                    {eventosDoProcesso.map((ev) => (
                      <ItemRow
                        key={ev.id}
                        icon={<IconCalendar size={16} />}
                        titulo={ev.titulo || '(evento)'}
                        meta={formatDate(ev.data || ev.createdAt)}
                        shared={!!shareOf('evento', ev.id)}
                        busy={busyKey === `evento-${ev.id}`}
                        testid={`partilhar-evento-${ev.id}`}
                        onToggle={() => toggle('evento', ev.id, ev.processoId, `evento-${ev.id}`)}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <EmptyState
              icon={<IconFolder />}
              title="Sem processos"
              hint="Este cliente não tem processos associados no Núcleo."
            />
          )}

          <div className="card stack stack-2" style={{ padding: 'var(--sp-5)' }} data-demo-target="portal-resumo" data-testid="portal-resumo">
            <span className="text-strong">O que {clienteSel ? clienteSel.nome || 'o cliente' : 'o cliente'} vê no portal</span>
            <div className="row row-3" style={{ flexWrap: 'wrap' }}>
              <Badge tone={resumo.estados ? 'ok' : 'neutral'}>{resumo.estados} estado(s) de processo</Badge>
              <Badge tone={resumo.docs ? 'ok' : 'neutral'}>{resumo.docs} documento(s)</Badge>
              <Badge tone={resumo.evs ? 'ok' : 'neutral'}>{resumo.evs} evento(s)</Badge>
            </div>
            {resumo.total === 0 ? (
              <p className="text-subtle text-xs" style={{ margin: 0 }}>
                Nada partilhado com este cliente ainda. Enquanto assim for, o portal mostra-lhe apenas uma mensagem de
                estado vazio.
              </p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
