import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useSharedCollection } from '../shared.js';
import { Badge, EmptyState, Skeleton } from '../components/ui.jsx';
import { IconFolder, IconChevronRight } from '../components/Icons.jsx';
import VisaoGeralTab from './tabs/VisaoGeralTab.jsx';
import DocumentosTab from './tabs/DocumentosTab.jsx';
import ComunicacoesTab from './tabs/ComunicacoesTab.jsx';
import CronologiaTab from './tabs/CronologiaTab.jsx';
import PrazosTab from './tabs/PrazosTab.jsx';
import DossieTab from './tabs/DossieTab.jsx';

/* Estado M365 do utilizador (SSO delegado). Lê whoami() uma vez; expõe se está
 * autenticado, para o botão "Editar no Office" saber se pode agir. */
function useSso() {
  const [state, setState] = useState({ loading: true, identity: null });
  const refresh = useCallback(async () => {
    try {
      const api = typeof window !== 'undefined' ? window.__ekoa : null;
      if (!api || typeof api.whoami !== 'function') {
        setState({ loading: false, identity: null });
        return;
      }
      const identity = await api.whoami();
      setState({ loading: false, identity: identity || null });
    } catch {
      setState({ loading: false, identity: null });
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { loading: state.loading, identity: state.identity, signedIn: !!state.identity, refresh };
}

const TAB_DEFS = [
  { id: 'visao', label: 'Visão geral', testid: 'tab-visao' },
  { id: 'documentos', label: 'Documentos', testid: 'tab-documentos' },
  { id: 'comunicacoes', label: 'Comunicações', testid: 'tab-comunicacoes' },
  { id: 'cronologia', label: 'Cronologia', testid: 'tab-cronologia' },
  { id: 'prazos', label: 'Prazos', testid: 'tab-prazos' },
  { id: 'print', label: 'Dossiê', testid: 'tab-print' },
];
const TAB_IDS = TAB_DEFS.map((t) => t.id);

/*
 * Workspace de um processo. Lê a espinha partilhada UMA vez aqui e distribui as
 * fatias já filtradas pelas tabs; as tabs de escrita recebem o `refresh` da
 * respetiva coleção. O deep link /processo/:id sobrevive a um reload forçado
 * (o cortex serve o index.html para qualquer rota de navegação do app).
 */
export default function ProcessoPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const sso = useSso();

  const { items: processos, loading: loadingProcessos } = useSharedCollection('processos');
  const { items: clientes } = useSharedCollection('clientes');
  const { items: documentos, refresh: refreshDocumentos } = useSharedCollection('documentos');
  const { items: comunicacoes, refresh: refreshComunicacoes } = useSharedCollection('comunicacoes');
  const { items: prazos } = useSharedCollection('prazos');
  const { items: eventos, refresh: refreshEventos } = useSharedCollection('eventos');
  const { items: lancamentos } = useSharedCollection('lancamentos');

  // O separador activo vive no URL (?tab=) - assim um reload forçado e o regresso
  // do redirect de sessão M365 (signIn preserva pathname+search) reabrem o mesmo
  // separador. Escrita com replace para não empilhar histórico a cada clique.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const active = TAB_IDS.includes(tabParam) ? tabParam : 'visao';
  const setActive = useCallback(
    (id) => {
      const next = new URLSearchParams(searchParams);
      next.set('tab', id);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const processo = useMemo(() => processos.find((p) => p.id === id) || null, [processos, id]);
  const cliente = useMemo(() => {
    if (!processo) return null;
    return clientes.find((c) => c.id === processo.clienteId) || null;
  }, [clientes, processo]);

  const documentosProcesso = useMemo(() => {
    if (!processo) return [];
    return documentos
      .filter((d) => d.processoId === processo.id)
      .slice()
      .sort((a, b) => String(b.data || b.createdAt || '').localeCompare(String(a.data || a.createdAt || '')));
  }, [documentos, processo]);

  const prazosProcesso = useMemo(() => {
    if (!processo) return [];
    return prazos.filter((p) => p.processoId === processo.id);
  }, [prazos, processo]);

  const eventosProcesso = useMemo(() => {
    if (!processo) return [];
    return eventos.filter((e) => e.processoId === processo.id);
  }, [eventos, processo]);

  const lancamentosProcesso = useMemo(() => {
    if (!processo) return [];
    return lancamentos.filter((l) => l.processoId === processo.id);
  }, [lancamentos, processo]);

  // Isolamento de matérias: uma comunicação entra no workspace de um processo SÓ
  // se estiver ligada a ESTE processo, OU se for uma mensagem ainda ao nível do
  // cliente (SEM processo) do mesmo cliente. Uma mensagem já associada a OUTRO
  // processo do mesmo cliente NUNCA aparece aqui - as matérias são estanques
  // (sigilo entre processos). Esta é a única fonte que alimenta a timeline, as
  // contagens, a cronologia e o dossiê impresso, por isso a regra fica só aqui.
  const comunicacoesProcesso = useMemo(() => {
    if (!processo) return [];
    return comunicacoes.filter(
      (c) =>
        c.processoId === processo.id ||
        (!c.processoId && processo.clienteId && c.clienteId === processo.clienteId),
    );
  }, [comunicacoes, processo]);

  // Enquanto os processos carregam, mostra esqueleto; se após carregar não
  // existe, mostra um vazio com regresso à lista (nunca um ecrã em branco).
  if (loadingProcessos && !processo) {
    return (
      <div data-testid="processo-page" data-demo-target="dossie-processo">
        <Skeleton lines={5} />
      </div>
    );
  }
  if (!processo) {
    return (
      <div data-testid="processo-page" data-demo-target="dossie-processo">
        <EmptyState
          icon={<IconFolder />}
          title="Processo não encontrado"
          hint="O processo pode ter sido removido. Volte à lista e escolha outro."
          action={
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/')}>
              Voltar à lista
            </button>
          }
        />
      </div>
    );
  }

  const badgeFor = { documentos: documentosProcesso.length, comunicacoes: comunicacoesProcesso.length, prazos: prazosProcesso.length };

  return (
    <div data-testid="processo-page" data-demo-target="dossie-processo">
      {/* ---------- Cabeçalho (não impresso) ---------- */}
      <div className="no-print">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          data-testid="voltar-lista"
          onClick={() => navigate('/')}
          style={{ marginBottom: 'var(--sp-2)', paddingLeft: 0 }}
        >
          <span style={{ transform: 'rotate(180deg)', display: 'inline-flex' }}>
            <IconChevronRight size={14} />
          </span>
          Dossiês
        </button>
        <div className="page-header">
          <div>
            <h1 className="page-title" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {processo.numeroProcesso || '(sem número)'}
            </h1>
            <p className="page-subtitle row row-2" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              {cliente ? cliente.nome : 'Sem cliente associado'}
              {processo.area ? <Badge tone="neutral">{processo.area}</Badge> : null}
              <Badge tone={processo.estado === 'ativo' ? 'ok' : processo.estado === 'suspenso' ? 'media' : 'neutral'}>
                {processo.estado || '—'}
              </Badge>
            </p>
          </div>
        </div>

        <div className="tabs" role="tablist" aria-label="Separadores do processo">
          {TAB_DEFS.map((t) => {
            const badge = badgeFor[t.id];
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active === t.id}
                data-testid={t.testid}
                className={`tab${active === t.id ? ' is-active' : ''}`}
                onClick={() => setActive(t.id)}
              >
                <span>{t.label}</span>
                {badge != null && badge > 0 ? <span className="tab-badge">{badge}</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* ---------- Conteúdo do separador ativo ---------- */}
      {active === 'visao' && (
        <VisaoGeralTab
          processo={processo}
          cliente={cliente}
          prazos={prazosProcesso}
          eventos={eventosProcesso}
          documentos={documentosProcesso}
          comunicacoes={comunicacoesProcesso}
          lancamentos={lancamentosProcesso}
          onNavigateTab={setActive}
        />
      )}
      {active === 'documentos' && (
        <DocumentosTab
          processo={processo}
          documentos={documentosProcesso}
          refresh={refreshDocumentos}
          sso={sso}
        />
      )}
      {active === 'comunicacoes' && (
        <ComunicacoesTab
          processo={processo}
          cliente={cliente}
          comunicacoesProcesso={comunicacoesProcesso}
          todas={comunicacoes}
          refresh={refreshComunicacoes}
        />
      )}
      {active === 'cronologia' && (
        <CronologiaTab
          processo={processo}
          eventos={eventosProcesso}
          documentos={documentosProcesso}
          prazos={prazosProcesso}
          comunicacoes={comunicacoesProcesso}
          refresh={refreshEventos}
        />
      )}
      {active === 'prazos' && <PrazosTab prazos={prazosProcesso} />}
      {active === 'print' && (
        <DossieTab
          processo={processo}
          cliente={cliente}
          eventos={eventosProcesso}
          prazos={prazosProcesso}
          documentos={documentosProcesso}
          comunicacoes={comunicacoesProcesso}
          lancamentos={lancamentosProcesso}
        />
      )}
    </div>
  );
}
