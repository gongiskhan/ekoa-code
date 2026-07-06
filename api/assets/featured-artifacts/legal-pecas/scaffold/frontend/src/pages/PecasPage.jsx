import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useSharedCollection,
  createShared,
  appHref,
  formatDate,
} from '../shared.js';
import {
  Button,
  Badge,
  Field,
  Select,
  Modal,
  SearchInput,
  EmptyState,
} from '../components/ui.jsx';
import { IconPenLine, IconPlus, IconExternalLink } from '../components/Icons.jsx';
import Disclaimer from './Disclaimer.jsx';
import {
  TIPOS,
  ESTADOS,
  tipoLabel,
  estadoLabel,
  estadoTone,
  composeSkeleton,
  defaultTitulo,
} from './pecas-logic.js';

export default function PecasPage() {
  const navigate = useNavigate();
  const { items: pecas, loading } = useSharedCollection('pecas');
  const { items: processos } = useSharedCollection('processos');
  const { items: clientes } = useSharedCollection('clientes');
  const { items: precedentes } = useSharedCollection('precedentes');

  const [query, setQuery] = useState('');
  const [estadoFiltro, setEstadoFiltro] = useState('');

  // Assistente "Nova peça".
  const [modalAberto, setModalAberto] = useState(false);
  const [tipo, setTipo] = useState('peticao_inicial');
  const [processoId, setProcessoId] = useState('');
  const [precedenteId, setPrecedenteId] = useState('');
  const [erro, setErro] = useState(null);
  const [criando, setCriando] = useState(false);
  const criandoRef = useRef(false);

  const processoById = useMemo(() => {
    const map = {};
    for (const p of processos) map[p.id] = p;
    return map;
  }, [processos]);

  const filtradas = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pecas
      .filter((p) => (estadoFiltro ? p.estado === estadoFiltro : true))
      .filter((p) => {
        if (!q) return true;
        const proc = processoById[p.processoId];
        return [p.titulo, tipoLabel(p.tipo), proc && proc.numeroProcesso]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      })
      .slice()
      .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
  }, [pecas, estadoFiltro, query, processoById]);

  function abrirModal() {
    setTipo('peticao_inicial');
    setProcessoId('');
    setPrecedenteId('');
    setErro(null);
    setModalAberto(true);
  }

  async function criarPeca() {
    if (criandoRef.current) return;
    setErro(null);
    const processo = processoById[processoId];
    if (!tipo) { setErro('Escolha o tipo de peça.'); return; }
    if (!processo) { setErro('Selecione o processo.'); return; }
    const cliente = clientes.find((c) => c.id === processo.clienteId) || null;
    const precedente = precedenteId ? precedentes.find((pr) => pr.id === precedenteId) || null : null;

    criandoRef.current = true;
    setCriando(true);
    try {
      const corpo = composeSkeleton({ tipo, processo, cliente, precedente });
      const row = {
        processoId: processo.id,
        tipo,
        titulo: defaultTitulo(tipo, processo),
        corpo,
        estado: 'rascunho',
        versao: 1,
        fundamentacao: [],
      };
      if (precedente) row.precedenteId = precedente.id;
      const created = await createShared('pecas', row);
      if (created && created.id) {
        setModalAberto(false);
        navigate(`/editar/${created.id}`);
        return;
      }
      setErro('Não foi possível criar a peça.');
    } catch {
      setErro('Não foi possível criar a peça.');
    } finally {
      criandoRef.current = false;
      setCriando(false);
    }
  }

  return (
    <div data-testid="pecas-page" data-demo-page="pecas/lista">
      <div className="page-header">
        <div>
          <h1 className="page-title">Peças processuais</h1>
          <p className="page-subtitle">
            Redija peças a partir do processo e dos precedentes. Cada peça parte de um esqueleto
            determinístico, cita as pesquisas guardadas e exporta para o dossiê em .docx.
          </p>
        </div>
        <div className="page-actions">
          <Button data-testid="pecas-nova" data-demo-target="pecas-nova" onClick={abrirModal}>
            <IconPlus /> Nova peça
          </Button>
        </div>
      </div>

      <div className="filters">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Pesquisar por título, tipo ou processo…"
          data-testid="pecas-pesquisa"
        />
        <div className="chip-row">
          <button
            type="button"
            className={`chip as-button${estadoFiltro === '' ? ' is-active' : ''}`}
            onClick={() => setEstadoFiltro('')}
          >
            Todos
          </button>
          {ESTADOS.map((e) => (
            <button
              key={e}
              type="button"
              className={`chip as-button${estadoFiltro === e ? ' is-active' : ''}`}
              onClick={() => setEstadoFiltro((prev) => (prev === e ? '' : e))}
            >
              {estadoLabel(e)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar peças.</span></div>
      ) : filtradas.length === 0 ? (
        <EmptyState
          icon={<IconPenLine />}
          title={pecas.length === 0 ? 'Ainda não há peças' : 'Sem resultados'}
          hint={
            pecas.length === 0
              ? 'Crie a sua primeira peça a partir de um processo para começar a redigir.'
              : 'Nenhuma peça corresponde à pesquisa. Ajuste os filtros.'
          }
          action={
            pecas.length === 0 ? (
              <Button data-testid="pecas-nova-vazio" onClick={abrirModal}>
                <IconPlus /> Nova peça
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="launcher-grid" data-testid="pecas-lista">
          {filtradas.map((p) => {
            const proc = processoById[p.processoId];
            return (
              <article
                key={p.id}
                className="card card-hover"
                data-testid={`peca-card-${p.id}`}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/editar/${p.id}`)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/editar/${p.id}`); } }}
                style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 'var(--space-3, 0.75rem)' }}
              >
                <div className="row-space-between" style={{ alignItems: 'flex-start', gap: 'var(--space-3, 0.75rem)' }}>
                  <span className="launcher-title">{p.titulo || '(sem título)'}</span>
                  <Badge tone="info">{tipoLabel(p.tipo)}</Badge>
                </div>
                <div className="row row-wrap" style={{ gap: 'var(--space-2, 0.5rem)', alignItems: 'center' }}>
                  <Badge tone={estadoTone(p.estado)} data-testid={`peca-estado-${p.id}`}>{estadoLabel(p.estado)}</Badge>
                  <span className="text-small text-subtle">versão {p.versao || 1}</span>
                </div>
                <div className="row-space-between" style={{ marginTop: 'auto' }}>
                  {proc ? (
                    <a
                      className="text-small"
                      href={appHref('legal-dossie', `processo/${proc.id}`)}
                      data-testid={`peca-processo-${p.id}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      Processo {proc.numeroProcesso || '(sem número)'} <IconExternalLink size={12} />
                    </a>
                  ) : <span className="text-small text-subtle">Sem processo</span>}
                  <span className="text-small text-subtle">Atualizado {formatDate(p.updatedAt || p.createdAt)}</span>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Modal
        open={modalAberto}
        title="Nova peça"
        onClose={() => setModalAberto(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setModalAberto(false)}>Cancelar</Button>
            <Button
              data-testid="pecas-criar"
              data-demo-target="pecas-criar"
              onClick={criarPeca}
              disabled={criando || !processoId}
            >
              Criar peça
            </Button>
          </>
        }
      >
        <Disclaimer style={{ marginBottom: 'var(--space-4, 1rem)' }} />
        <div className="form-grid">
          <Field label="Tipo de peça" required>
            <Select
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              data-testid="pecas-tipo"
              data-demo-target="pecas-tipo"
            >
              {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label="Processo" required>
            <Select
              value={processoId}
              onChange={(e) => { setProcessoId(e.target.value); setErro(null); }}
              data-testid="pecas-processo"
              data-demo-target="pecas-processo"
            >
              <option value="">
                {processos.length === 0 ? 'Sem processos - abra um no Núcleo.' : 'Selecione o processo.'}
              </option>
              {processos.map((p) => (
                <option key={p.id} value={p.id}>{p.numeroProcesso || '(sem número)'}</option>
              ))}
            </Select>
          </Field>
          <Field label="Precedente (opcional)" hint="O corpo do precedente entra na peça, com as chaves resolvidas do processo.">
            <Select
              value={precedenteId}
              onChange={(e) => setPrecedenteId(e.target.value)}
              data-testid="pecas-precedente"
              data-demo-target="pecas-precedente"
            >
              <option value="">Sem precedente (estrutura-tipo)</option>
              {precedentes.map((pr) => (
                <option key={pr.id} value={pr.id}>{pr.titulo || '(sem título)'}</option>
              ))}
            </Select>
          </Field>
        </div>
        {erro ? <p className="resultado-erro" data-testid="pecas-modal-erro">{erro}</p> : null}
      </Modal>
    </div>
  );
}
