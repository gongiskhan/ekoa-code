import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSharedCollection, formatDate } from '../shared.js';
import { Button, Badge, SearchInput, Select, EmptyState } from '../components/ui.jsx';
import { IconSignature, IconPlus, IconCalendarClock, IconExternalLink } from '../components/Icons.jsx';
import { ESTADO_LABEL, ESTADO_TONE } from '../model.js';
import { providerDe } from '../providers.js';

/* Contagem de assinados / total de um envelope. */
function progresso(env) {
  const sigs = Array.isArray(env.signatarios) ? env.signatarios : [];
  const assinados = sigs.filter((s) => s.estado === 'assinado').length;
  return { assinados, total: sigs.length };
}

export default function EnvelopesPage() {
  const navigate = useNavigate();
  const { items: envelopes, loading } = useSharedCollection('envelopes');
  const [query, setQuery] = useState('');
  const [estadoFiltro, setEstadoFiltro] = useState('');

  const filtrados = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (Array.isArray(envelopes) ? envelopes : [])
      .filter((e) => (estadoFiltro ? e.estado === estadoFiltro : true))
      .filter((e) => {
        if (!q) return true;
        const sigNomes = (e.signatarios || []).map((s) => s.nome).join(' ');
        return [e.titulo, sigNomes, ESTADO_LABEL[e.estado]].filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
      })
      .slice()
      .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
  }, [envelopes, query, estadoFiltro]);

  return (
    <div data-demo-page="assinatura/envelopes" data-testid="assinatura-envelopes-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Envelopes de assinatura</h1>
          <p className="page-subtitle">
            Prepare documentos para assinatura, conduza o fluxo qualificado ou simulado, e arquive o
            certificado de auditoria no dossiê do processo.
          </p>
        </div>
        <div className="page-actions">
          <Link to="/novo" className="btn btn-primary" data-testid="assinatura-novo" data-demo-target="assinatura-novo">
            <IconPlus /> Novo envelope
          </Link>
        </div>
      </div>

      {/* Destaque do calendário 2027 - diferenciador, sempre visível na entrada. */}
      <section className="resultado-panel" data-testid="assinatura-calendario-destaque" data-demo-target="assinatura-calendario">
        <div className="row-space-between" style={{ alignItems: 'flex-start', gap: 'var(--sp-3, 0.75rem)', flexWrap: 'wrap' }}>
          <div className="row row-2" style={{ alignItems: 'flex-start' }}>
            <span aria-hidden="true" style={{ display: 'inline-flex', color: 'var(--accent-strong, #16304c)', marginTop: 2 }}><IconCalendarClock /></span>
            <div className="stack stack-1" style={{ minWidth: 0 }}>
              <span className="text-strong">Assinatura qualificada obrigatória a partir de 1 de janeiro de 2027</span>
              <span className="text-muted">
                Até 31 de dezembro de 2026 admite-se a assinatura avançada para advogados, advogados
                estagiários e solicitadores. Fonte: Portaria n.º 350-A/2025, de 09 de Outubro.
              </span>
            </div>
          </div>
          <Link to="/calendario" className="btn btn-secondary btn-sm" data-testid="assinatura-ver-calendario" style={{ flexShrink: 0 }}>
            Ver calendário <IconExternalLink />
          </Link>
        </div>
      </section>

      <div className="filters" style={{ marginTop: 'var(--sp-5, 1.25rem)', display: 'flex', gap: 'var(--sp-2, 0.5rem)', flexWrap: 'wrap' }}>
        <SearchInput value={query} onChange={setQuery} placeholder="Pesquisar por título ou signatário…" data-testid="assinatura-pesquisa" />
        <Select value={estadoFiltro} onChange={(e) => setEstadoFiltro(e.target.value)} data-testid="assinatura-filtro-estado" aria-label="Filtrar por estado">
          <option value="">Todos os estados</option>
          {Object.keys(ESTADO_LABEL).map((k) => (
            <option key={k} value={k}>{ESTADO_LABEL[k]}</option>
          ))}
        </Select>
      </div>

      {loading ? (
        <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar envelopes.</span></div>
      ) : filtrados.length === 0 ? (
        <EmptyState
          icon={<IconSignature />}
          title={(envelopes || []).length === 0 ? 'Ainda não há envelopes' : 'Sem resultados'}
          hint={
            (envelopes || []).length === 0
              ? 'Crie o primeiro envelope a partir de um documento do dossiê ou de um PDF carregado.'
              : 'Nenhum envelope corresponde ao filtro.'
          }
          action={<Button data-testid="assinatura-novo-vazio" onClick={() => navigate('/novo')}><IconPlus /> Novo envelope</Button>}
        />
      ) : (
        <div className="launcher-grid" data-testid="assinatura-lista">
          {filtrados.map((env) => {
            const { assinados, total } = progresso(env);
            const prov = providerDe(env.metodoPadrao);
            return (
              <article
                key={env.id}
                className="card card-hover"
                data-testid={`assinatura-card-${env.id}`}
                style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3, 0.75rem)' }}
              >
                <div className="row-space-between" style={{ alignItems: 'flex-start', gap: 'var(--sp-3, 0.75rem)' }}>
                  <span className="launcher-title">{env.titulo || '(sem título)'}</span>
                  <Badge tone={ESTADO_TONE[env.estado] || 'neutral'} data-testid={`assinatura-estado-${env.id}`}>
                    {ESTADO_LABEL[env.estado] || env.estado}
                  </Badge>
                </div>
                <div className="row-space-between">
                  <span className="text-small text-subtle">{assinados} de {total} assinado(s)</span>
                  <span className="text-small text-subtle">{prov.nome}</span>
                </div>
                <div className="row-space-between" style={{ marginTop: 'auto' }}>
                  <span className="text-small text-subtle">{formatDate(env.updatedAt || env.createdAt)}</span>
                  <Link to={`/envelopes/${env.id}`} className="btn btn-secondary btn-sm" data-testid={`assinatura-abrir-${env.id}`}>
                    Abrir
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
