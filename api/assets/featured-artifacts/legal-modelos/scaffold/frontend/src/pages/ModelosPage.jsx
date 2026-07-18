import { useMemo, useState } from 'react';
import {
  useSharedCollection,
  updateShared,
  deleteShared,
  appHref,
} from '../shared.js';
import { useDemoResult } from '../demo.js';
import { criarEnvelope } from '../assinatura-cliente.js';
import {
  Button,
  Badge,
  Field,
  Input,
  Select,
  Modal,
  SearchInput,
  ConfirmDialog,
  EmptyState,
  toast,
} from '../components/ui.jsx';
import { IconFileText, IconPlus, IconTrash, IconExternalLink } from '../components/Icons.jsx';
import { ORIGENS, fonteMeta, categoriaDe, versaoDe, foldText } from './modelos-util.js';

const CATEGORIAS_SUGERIDAS = ['Procurações', 'Requerimentos', 'Declarações', 'Contratos', 'Apoio judiciário'];

function novaVariavel() {
  return { chave: '', rotulo: '', origem: 'manual', obrigatoria: false };
}

/*
 * "Os meus modelos" - a vista da colecção partilhada `modelos`. Mostra todas as
 * linhas (as duas semeadas pelo Núcleo + as importadas da biblioteca), com a
 * proveniência (fonte), a licença e a versão. Editar grava com versão+1; a
 * mesma linha é usável no app de Contratos (galeria/editor/wizard).
 */
export default function ModelosPage() {
  const { items: modelos, loading, refresh } = useSharedCollection('modelos');

  const [edit, setEdit] = useState(null); // { id, nome, categoria, licenca, corpo, variaveis, versaoAtual }
  const [guardando, setGuardando] = useState(false);
  const [aEliminar, setAEliminar] = useState(null);
  const [preview, setPreview] = useState(null); // modelo a pré-visualizar (só leitura)
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState(''); // categoria (tag) selecionada

  const ordenados = useMemo(() => (
    modelos
      .slice()
      .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
  ), [modelos]);

  // Tags = categorias distintas presentes (para os chips de filtro).
  const tags = useMemo(() => {
    const set = new Set();
    for (const m of ordenados) { const c = categoriaDe(m); if (c) set.add(c); }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt'));
  }, [ordenados]);

  // Pesquisa (nome/categoria/fonte/licença, sem acentos) + filtro por tag.
  const rows = useMemo(() => {
    const folded = foldText(query.trim());
    return ordenados
      .filter((m) => (tag ? categoriaDe(m) === tag : true))
      .filter((m) => {
        if (!folded) return true;
        return foldText(`${m.nome} ${categoriaDe(m)} ${m.fonte || ''} ${m.licenca || ''} ${m.descricao || ''}`).includes(folded);
      });
  }, [ordenados, query, tag]);

  // Sinaliza à ponte de demos que a lista tem conteúdo (annotate-result).
  useDemoResult('modelos-lista', ordenados.length > 0);

  function abrirEdicao(m) {
    setEdit({
      id: m.id,
      nome: m.nome || '',
      categoria: categoriaDe(m),
      licenca: m.licenca || '',
      corpo: m.corpo || '',
      variaveis: Array.isArray(m.variaveis) ? m.variaveis.map((v) => ({ ...v })) : [],
      versaoAtual: versaoDe(m),
    });
  }

  function setEditVar(index, patch) {
    setEdit((prev) => ({ ...prev, variaveis: prev.variaveis.map((v, i) => (i === index ? { ...v, ...patch } : v)) }));
  }
  function removerEditVar(index) {
    setEdit((prev) => ({ ...prev, variaveis: prev.variaveis.filter((_, i) => i !== index) }));
  }
  function adicionarEditVar() {
    setEdit((prev) => ({ ...prev, variaveis: [...prev.variaveis, novaVariavel()] }));
  }

  async function guardarEdicao() {
    if (!edit || guardando) return;
    setGuardando(true);
    try {
      const proximaVersao = (Number(edit.versaoAtual) || 0) + 1;
      await updateShared('modelos', edit.id, {
        nome: edit.nome,
        categoria: edit.categoria,
        area: edit.categoria, // mantém a `area` legada em sincronia (Contratos filtra por ela)
        licenca: edit.licenca,
        corpo: edit.corpo,
        variaveis: edit.variaveis,
        versao: proximaVersao,
      });
      await refresh();
      setEdit(null);
      toast(`Modelo guardado (versão ${proximaVersao}).`, { tone: 'ok' });
    } catch {
      toast('Não foi possível guardar o modelo.', { tone: 'error' });
    } finally {
      setGuardando(false);
    }
  }

  async function onEliminarConfirmado() {
    const alvo = aEliminar;
    setAEliminar(null);
    if (!alvo) return;
    try {
      await deleteShared('modelos', alvo.id);
      await refresh();
      toast('Modelo eliminado.', { tone: 'ok' });
    } catch {
      toast('Não foi possível eliminar o modelo.', { tone: 'error' });
    }
  }

  return (
    <div data-testid="modelos-page" data-demo-page="modelos/lista">
      <div className="page-header">
        <div>
          <h1 className="page-title">Os meus modelos</h1>
          <p className="page-subtitle">
            As minutas do escritório e as importadas da biblioteca vivem na espinha partilhada. Edite
            uma (a versão sobe a cada gravação) ou use-a diretamente no app de Contratos.
          </p>
        </div>
      </div>

      {ordenados.length > 0 && (
        <div className="filters">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Pesquisar por nome, categoria, fonte ou licença…"
            data-testid="modelos-pesquisa"
          />
          {tags.length > 0 && (
            <div className="chip-row">
              <button
                type="button"
                className={`chip as-button${tag === '' ? ' is-active' : ''}`}
                data-testid="modelos-tag-todas"
                onClick={() => setTag('')}
              >
                Todas
              </button>
              {tags.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`chip as-button${tag === t ? ' is-active' : ''}`}
                  data-testid={`modelos-tag-${t}`}
                  onClick={() => setTag((prev) => (prev === t ? '' : t))}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar modelos.</span></div>
      ) : ordenados.length === 0 ? (
        <EmptyState
          icon={<IconFileText />}
          title="Ainda não há modelos"
          hint="Importe uma minuta da biblioteca para começar."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<IconFileText />}
          title="Sem resultados"
          hint="Nenhum modelo corresponde à pesquisa. Ajuste os filtros."
        />
      ) : (
        <div className="table-wrap" data-testid="modelos-lista" data-demo-target="modelos-lista">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '26%' }}>Nome</th>
                <th style={{ width: '14%' }}>Categoria</th>
                <th style={{ width: '12%' }}>Fonte</th>
                <th style={{ width: '20%' }}>Licença</th>
                <th style={{ width: '8%' }}>Versão</th>
                <th style={{ width: '6%' }}>Variáveis</th>
                <th style={{ width: '14%' }} aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              {rows.map((m, idx) => {
                const meta = fonteMeta(m.fonte);
                const nVars = Array.isArray(m.variaveis) ? m.variaveis.length : 0;
                const first = idx === 0;
                return (
                  <tr key={m.id} data-testid={`modelo-row-${m.id}`}>
                    <td>{m.nome || '(sem nome)'}</td>
                    <td>{categoriaDe(m) || '-'}</td>
                    <td>
                      <Badge tone={meta.tone} data-testid={`modelo-fonte-${m.id}`}>{meta.label}</Badge>
                    </td>
                    <td className="text-small text-subtle">{m.licenca || '-'}</td>
                    <td data-testid={`modelo-versao-${m.id}`}>v{versaoDe(m)}</td>
                    <td>{nVars}</td>
                    <td>
                      <div className="row row-wrap" style={{ gap: 'var(--space-2, 0.5rem)' }}>
                        <Button
                          size="sm"
                          variant="ghost"
                          data-testid={`modelo-preview-${m.id}`}
                          onClick={() => setPreview(m)}
                        >
                          Pré-visualizar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          data-testid={`modelo-editar-${m.id}`}
                          {...(first ? { 'data-demo-target': 'modelos-editar' } : {})}
                          onClick={() => abrirEdicao(m)}
                        >
                          Editar
                        </Button>
                        <a
                          className="btn btn-ghost btn-sm"
                          href={appHref('legal-contratos', `gerar/${m.id}`)}
                          data-testid={`modelo-usar-${m.id}`}
                        >
                          Usar em Contratos <IconExternalLink size={14} />
                        </a>
                        <a
                          className="btn btn-ghost btn-sm"
                          href={appHref('legal-pecas', `?modelo=${m.id}`)}
                          data-testid={`modelo-usar-pecas-${m.id}`}
                        >
                          Usar em Peças <IconExternalLink size={14} />
                        </a>
                        <Button
                          size="sm"
                          variant="ghost"
                          data-testid={`modelo-assinatura-${m.id}`}
                          onClick={async () => {
                            try {
                              const env = await criarEnvelope({
                                titulo: `${m.nome || 'Minuta'} - assinatura`,
                                documentos: [{ nome: m.nome || 'Minuta' }],
                                signatarios: [{ nome: 'Mandatário responsável', papel: 'advogado', metodo: 'cmd-orquestrado' }],
                              });
                              window.location.assign(env.href);
                            } catch { /* envelope indisponível fora da plataforma - sem efeito */ }
                          }}
                        >
                          Preparar assinatura
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          data-testid={`modelo-eliminar-${m.id}`}
                          onClick={() => setAEliminar(m)}
                        >
                          <IconTrash /> Eliminar
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ---------- Gaveta de edição ---------- */}
      <Modal
        open={!!edit}
        title="Editar modelo"
        onClose={() => (guardando ? null : setEdit(null))}
        data-testid="modelo-edit-drawer"
        style={{ maxWidth: '760px' }}
        actions={
          <>
            <Button variant="ghost" onClick={() => setEdit(null)} disabled={guardando}>Cancelar</Button>
            <Button data-testid="modelo-edit-guardar" onClick={guardarEdicao} disabled={guardando}>
              {guardando ? 'A guardar…' : `Guardar (v${edit ? (Number(edit.versaoAtual) || 0) + 1 : ''})`}
            </Button>
          </>
        }
      >
        {edit && (
          <div className="stack stack-4">
            <div className="form-grid">
              <Field label="Nome">
                <Input value={edit.nome} onChange={(e) => setEdit((p) => ({ ...p, nome: e.target.value }))} data-testid="modelo-edit-nome" />
              </Field>
              <Field label="Categoria">
                <Input
                  value={edit.categoria}
                  onChange={(e) => setEdit((p) => ({ ...p, categoria: e.target.value }))}
                  data-testid="modelo-edit-categoria"
                  list="categorias-sugeridas"
                  placeholder="Ex.: Requerimentos"
                />
                <datalist id="categorias-sugeridas">
                  {CATEGORIAS_SUGERIDAS.map((c) => <option key={c} value={c} />)}
                </datalist>
              </Field>
              <Field label="Licença">
                <Input value={edit.licenca} onChange={(e) => setEdit((p) => ({ ...p, licenca: e.target.value }))} data-testid="modelo-edit-licenca" placeholder="Ex.: domínio público / uso livre" />
              </Field>
            </div>

            <Field label="Corpo">
              <textarea
                className="textarea field-textarea"
                data-testid="modelo-edit-corpo"
                value={edit.corpo}
                onChange={(e) => setEdit((p) => ({ ...p, corpo: e.target.value }))}
                rows={12}
                style={{ width: '100%' }}
              />
            </Field>

            <div>
              <div className="row-space-between" style={{ alignItems: 'center' }}>
                <span className="field-label">Variáveis</span>
                <Button size="sm" data-testid="modelo-edit-var-add" onClick={adicionarEditVar}>
                  <IconPlus /> Adicionar variável
                </Button>
              </div>
              {edit.variaveis.length === 0 ? (
                <p className="field-hint" style={{ marginTop: 'var(--space-3, 0.75rem)' }}>
                  Sem variáveis. Adicione uma e insira {'{{'}chave{'}}'} no corpo.
                </p>
              ) : (
                <div className="table-wrap" style={{ marginTop: 'var(--space-3, 0.75rem)' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={{ width: '24%' }}>Chave</th>
                        <th style={{ width: '26%' }}>Rótulo</th>
                        <th style={{ width: '26%' }}>Origem</th>
                        <th style={{ width: '12%' }}>Obrigatória</th>
                        <th style={{ width: '12%' }} aria-label="Ações" />
                      </tr>
                    </thead>
                    <tbody>
                      {edit.variaveis.map((v, i) => (
                        <tr key={i} data-testid={`modelo-edit-var-${i}`}>
                          <td>
                            <Input
                              value={v.chave || ''}
                              onChange={(e) => setEditVar(i, { chave: e.target.value.replace(/[^a-zA-Z0-9_.-]/g, '_') })}
                              data-testid={`modelo-edit-var-chave-${i}`}
                              placeholder="cliente_nome"
                            />
                          </td>
                          <td>
                            <Input
                              value={v.rotulo || ''}
                              onChange={(e) => setEditVar(i, { rotulo: e.target.value })}
                              data-testid={`modelo-edit-var-rotulo-${i}`}
                              placeholder="Nome do cliente"
                            />
                          </td>
                          <td>
                            <Select
                              value={v.origem || 'manual'}
                              onChange={(e) => setEditVar(i, { origem: e.target.value })}
                              data-testid={`modelo-edit-var-origem-${i}`}
                            >
                              {ORIGENS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </Select>
                          </td>
                          <td>
                            <label className="checkbox-field">
                              <input
                                type="checkbox"
                                checked={!!v.obrigatoria}
                                onChange={(e) => setEditVar(i, { obrigatoria: e.target.checked })}
                                data-testid={`modelo-edit-var-obrigatoria-${i}`}
                              />
                              <span className="text-small">Obrigatória</span>
                            </label>
                          </td>
                          <td>
                            <Button size="sm" variant="ghost" data-testid={`modelo-edit-var-remover-${i}`} onClick={() => removerEditVar(i)}>
                              <IconTrash /> Remover
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* ---------- Pré-visualização (só leitura) ---------- */}
      <Modal
        open={!!preview}
        title={preview ? `Pré-visualizar: ${preview.nome || '(sem nome)'}` : 'Pré-visualizar'}
        onClose={() => setPreview(null)}
        data-testid="modelo-preview-drawer"
        style={{ maxWidth: '760px' }}
        actions={
          preview ? (
            <>
              <Button variant="ghost" onClick={() => setPreview(null)}>Fechar</Button>
              <a
                className="btn btn-secondary"
                href={appHref('legal-pecas', `?modelo=${preview.id}`)}
                data-testid="modelo-preview-usar-pecas"
              >
                Usar em Peças <IconExternalLink size={14} />
              </a>
              <a
                className="btn btn-primary"
                href={appHref('legal-contratos', `gerar/${preview.id}`)}
                data-testid="modelo-preview-usar"
              >
                Usar em Contratos <IconExternalLink size={14} />
              </a>
            </>
          ) : null
        }
      >
        {preview && (
          <div className="stack stack-4">
            <div className="row row-wrap" style={{ gap: 'var(--space-2, 0.5rem)', alignItems: 'center' }}>
              {categoriaDe(preview) ? <Badge tone="info">{categoriaDe(preview)}</Badge> : null}
              <Badge tone={fonteMeta(preview.fonte).tone}>{fonteMeta(preview.fonte).label}</Badge>
              <span className="text-small text-subtle">v{versaoDe(preview)}</span>
            </div>
            {/* Proveniência CITADA: fonte de origem e licença, quando declaradas. */}
            {preview.fonteOriginal || preview.licenca ? (
              <div className="stack" style={{ gap: '2px' }}>
                {preview.fonteOriginal ? (
                  <span className="text-small text-subtle" data-testid="modelo-preview-fonte">
                    Fonte: {preview.fonteOriginal}
                  </span>
                ) : null}
                {preview.licenca ? (
                  <span className="text-small text-subtle" data-testid="modelo-preview-licenca">
                    Licença: {preview.licenca}
                  </span>
                ) : null}
              </div>
            ) : null}
            <div>
              <span className="field-label">Corpo</span>
              <div
                className="clausulas-list"
                data-testid="modelo-preview-corpo"
                style={{ marginTop: 'var(--space-2, 0.5rem)', padding: 'var(--space-4, 1rem)', display: 'block', whiteSpace: 'pre-wrap', maxHeight: '46vh', overflowY: 'auto' }}
              >
                {String(preview.corpo || '').trim()
                  ? String(preview.corpo).split('\n').map((line, i) => (
                      line.trim()
                        ? <p key={i} style={{ margin: '0 0 0.5rem' }}>{line}</p>
                        : <div key={i} style={{ height: '0.5rem' }} />
                    ))
                  : <p className="text-small text-subtle" style={{ margin: 0 }}>Este modelo ainda não tem corpo.</p>}
              </div>
            </div>
            {Array.isArray(preview.variaveis) && preview.variaveis.length > 0 ? (
              <div>
                <span className="field-label">Variáveis ({preview.variaveis.length})</span>
                <div className="chip-row" style={{ marginTop: 'var(--space-2, 0.5rem)' }}>
                  {preview.variaveis.map((v, i) => (
                    <span key={v.chave || `pv-${i}`} className="chip" data-testid={`modelo-preview-var-${i}`}>
                      {v.rotulo || v.chave}{v.obrigatoria ? ' *' : ''}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!aEliminar}
        title="Eliminar modelo"
        message={aEliminar ? `Eliminar o modelo "${aEliminar.nome || '(sem nome)'}"? Esta ação não pode ser anulada.` : ''}
        confirmLabel="Eliminar"
        danger
        onConfirm={onEliminarConfirmado}
        onCancel={() => setAEliminar(null)}
      />
    </div>
  );
}
