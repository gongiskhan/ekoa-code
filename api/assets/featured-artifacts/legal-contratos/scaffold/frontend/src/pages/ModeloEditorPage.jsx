import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getShared,
  updateShared,
  useDebounced,
} from '../shared.js';
import {
  Button,
  Field,
  Input,
  Select,
  EmptyState,
  toast,
} from '../components/ui.jsx';
import { IconFileText, IconPlus, IconTrash } from '../components/Icons.jsx';
import { ORIGENS, extractPlaceholders } from './modelo-util.js';

const AREAS_SUGERIDAS = ['Cível', 'Comercial', 'Laboral', 'Família', 'Criminal', 'Administrativo', 'Fiscal'];

function novaVariavel() {
  return { chave: '', rotulo: '', origem: 'manual', obrigatoria: false };
}

export default function ModeloEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [nome, setNome] = useState('');
  const [area, setArea] = useState('');
  const [descricao, setDescricao] = useState('');
  const [corpo, setCorpo] = useState('');
  const [variaveis, setVariaveis] = useState([]);

  const hydratedRef = useRef(false);
  const lastSavedRef = useRef(null);
  const corpoRef = useRef(null);

  // Carrega o modelo uma vez; permite o auto-guardar só depois da hidratação.
  useEffect(() => {
    let alive = true;
    hydratedRef.current = false;
    setLoading(true);
    setNotFound(false);
    getShared('modelos', id)
      .then((m) => {
        if (!alive) return;
        if (!m) { setNotFound(true); setLoading(false); return; }
        setNome(m.nome || '');
        setArea(m.area || '');
        setDescricao(m.descricao || '');
        setCorpo(m.corpo || '');
        setVariaveis(Array.isArray(m.variaveis) ? m.variaveis.map((v) => ({ ...v })) : []);
        lastSavedRef.current = JSON.stringify({
          nome: m.nome || '', area: m.area || '', descricao: m.descricao || '',
          corpo: m.corpo || '', variaveis: Array.isArray(m.variaveis) ? m.variaveis : [],
        });
        setLoading(false);
        // Só ligar o auto-guardar após a pintura inicial, para não regravar o carregado.
        requestAnimationFrame(() => { if (alive) hydratedRef.current = true; });
      })
      .catch(() => { if (alive) { setNotFound(true); setLoading(false); } });
    return () => { alive = false; };
  }, [id]);

  const snapshot = useMemo(
    () => JSON.stringify({ nome, area, descricao, corpo, variaveis }),
    [nome, area, descricao, corpo, variaveis],
  );
  const debounced = useDebounced(snapshot, 700);

  // Auto-guardar: persiste o snapshot estabilizado se diferir do último gravado.
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (debounced === lastSavedRef.current) return;
    let cancelled = false;
    const data = JSON.parse(debounced);
    updateShared('modelos', id, data)
      .then(() => { if (!cancelled) { lastSavedRef.current = debounced; toast('Modelo guardado.', { tone: 'ok' }); } })
      .catch(() => { if (!cancelled) toast('Não foi possível guardar.', { tone: 'error' }); });
    return () => { cancelled = true; };
  }, [debounced, id]);

  async function guardarAgora() {
    const data = { nome, area, descricao, corpo, variaveis };
    const serial = JSON.stringify(data);
    try {
      await updateShared('modelos', id, data);
      lastSavedRef.current = serial;
      toast('Modelo guardado.', { tone: 'ok' });
    } catch {
      toast('Não foi possível guardar.', { tone: 'error' });
    }
  }

  // Antes de sair do editor, força a gravação de edições ainda pendentes (o
  // auto-guardar tem 700ms de atraso), para os últimos toques não se perderem.
  async function flushPending() {
    const data = { nome, area, descricao, corpo, variaveis };
    const serial = JSON.stringify(data);
    if (serial === lastSavedRef.current) return;
    try {
      await updateShared('modelos', id, data);
      lastSavedRef.current = serial;
    } catch {
      /* melhor-esforço - a navegação segue mesmo assim */
    }
  }

  async function sairPara(destino) {
    await flushPending();
    navigate(destino);
  }

  function setVar(index, patch) {
    setVariaveis((prev) => prev.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  }

  function removerVar(index) {
    setVariaveis((prev) => prev.filter((_, i) => i !== index));
  }

  function adicionarVar() {
    setVariaveis((prev) => [...prev, novaVariavel()]);
  }

  // Insere {{chave}} no cursor do corpo (ou no fim, se não houver seleção).
  function inserirPlaceholder(chave) {
    if (!chave) return;
    const token = `{{${chave}}}`;
    const el = corpoRef.current;
    if (el && typeof el.selectionStart === 'number') {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = corpo.slice(0, start) + token + corpo.slice(end);
      setCorpo(next);
      requestAnimationFrame(() => {
        try { el.focus(); const pos = start + token.length; el.setSelectionRange(pos, pos); } catch { /* noop */ }
      });
    } else {
      setCorpo((c) => (c && !c.endsWith('\n') && !c.endsWith(' ') ? `${c} ${token}` : `${c}${token}`));
    }
  }

  // Validação: {{placeholders}} no corpo sem variável (e variáveis sem uso no corpo).
  const validacao = useMemo(() => {
    const placeholders = extractPlaceholders(corpo);
    const chaves = new Set(variaveis.map((v) => (v.chave || '').trim()).filter(Boolean));
    const semVariavel = placeholders.filter((p) => !chaves.has(p));
    const semUso = Array.from(chaves).filter((c) => !placeholders.includes(c));
    return { placeholders, semVariavel, semUso };
  }, [corpo, variaveis]);

  if (loading) {
    return (
      <div data-testid="modelo-editor">
        <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar modelo.</span></div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div data-testid="modelo-editor">
        <EmptyState
          icon={<IconFileText />}
          title="Modelo não encontrado"
          hint="O modelo pode ter sido eliminado. Volte à galeria."
          action={<Button onClick={() => navigate('/')}>Voltar aos modelos</Button>}
        />
      </div>
    );
  }

  return (
    <div data-testid="modelo-editor">
      <div className="page-header">
        <div>
          <h1 className="page-title">{nome || '(sem nome)'}</h1>
          <p className="page-subtitle">
            Edite o corpo com {'{{'}chaves{'}}'} e mapeie cada variável a uma origem do cliente/processo.
            As alterações são guardadas automaticamente.
          </p>
        </div>
        <div className="page-actions">
          <Button variant="ghost" onClick={() => sairPara('/')}>Voltar</Button>
          <Button variant="secondary" data-testid="guardar-modelo" onClick={guardarAgora}>Guardar</Button>
          <Button data-testid="modelo-gerar-documento" onClick={() => sairPara(`/gerar/${id}`)}>Gerar documento</Button>
        </div>
      </div>

      <div className="stack stack-6">
        {/* ---------- Metadados ---------- */}
        <section className="card">
          <h2 className="card-title">Detalhes</h2>
          <div className="form-grid" style={{ marginTop: 'var(--space-4, 1rem)' }}>
            <Field label="Nome">
              <Input value={nome} onChange={(e) => setNome(e.target.value)} data-testid="modelo-nome" placeholder="Ex.: Contrato de prestação de serviços" />
            </Field>
            <Field label="Área">
              <Input value={area} onChange={(e) => setArea(e.target.value)} data-testid="modelo-area" list="areas-sugeridas" placeholder="Ex.: Cível" />
              <datalist id="areas-sugeridas">
                {AREAS_SUGERIDAS.map((a) => <option key={a} value={a} />)}
              </datalist>
            </Field>
            <Field label="Descrição">
              <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} data-testid="modelo-descricao" placeholder="Uma linha sobre o modelo." />
            </Field>
          </div>
        </section>

        {/* ---------- Corpo ---------- */}
        <section className="card">
          <div className="row-space-between">
            <div>
              <h2 className="card-title">Corpo do contrato</h2>
              <p className="card-subtitle">
                Use {'{{'}chave{'}}'} onde a variável deve aparecer. Insira uma variável com o botão respetivo na tabela abaixo.
              </p>
            </div>
          </div>
          <textarea
            ref={corpoRef}
            className="textarea field-textarea citius-textarea"
            data-testid="modelo-corpo"
            value={corpo}
            onChange={(e) => setCorpo(e.target.value)}
            placeholder={'CONTRATO…\n\nEntre {{cliente_nome}}, com o NIF {{cliente_nif}}…'}
            style={{ marginTop: 'var(--space-4, 1rem)', width: '100%' }}
            rows={16}
          />

          {(validacao.semVariavel.length > 0 || validacao.semUso.length > 0) ? (
            <div className="resultado-erro" data-testid="modelo-validacao" style={{ marginTop: 'var(--space-3, 0.75rem)' }}>
              {validacao.semVariavel.length > 0 && (
                <div>Placeholders no corpo sem variável definida: {validacao.semVariavel.map((p) => `{{${p}}}`).join(', ')}.</div>
              )}
              {validacao.semUso.length > 0 && (
                <div>Variáveis sem uso no corpo: {validacao.semUso.join(', ')}.</div>
              )}
            </div>
          ) : validacao.placeholders.length > 0 ? (
            <p className="field-hint" data-testid="modelo-validacao-ok" style={{ marginTop: 'var(--space-3, 0.75rem)' }}>
              Todas as {validacao.placeholders.length} variáveis do corpo estão mapeadas.
            </p>
          ) : null}
        </section>

        {/* ---------- Variáveis ---------- */}
        <section className="card">
          <div className="row-space-between">
            <div>
              <h2 className="card-title">Variáveis</h2>
              <p className="card-subtitle">
                Cada variável mapeia a uma origem do cliente/processo (pré-preenchida na geração) ou é manual.
              </p>
            </div>
            <Button size="sm" data-testid="variavel-add" onClick={adicionarVar}>
              <IconPlus /> Adicionar variável
            </Button>
          </div>

          {variaveis.length === 0 ? (
            <p className="field-hint" style={{ marginTop: 'var(--space-4, 1rem)' }}>
              Ainda não há variáveis. Adicione uma e insira {'{{'}chave{'}}'} no corpo.
            </p>
          ) : (
            <div className="table-wrap" style={{ marginTop: 'var(--space-4, 1rem)' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: '22%' }}>Chave</th>
                    <th style={{ width: '26%' }}>Rótulo</th>
                    <th style={{ width: '24%' }}>Origem</th>
                    <th style={{ width: '12%' }}>Obrigatória</th>
                    <th style={{ width: '16%' }} aria-label="Ações" />
                  </tr>
                </thead>
                <tbody>
                  {variaveis.map((v, i) => (
                    <tr key={i} data-testid={`variavel-row-${i}`}>
                      <td>
                        <Input
                          value={v.chave || ''}
                          onChange={(e) => setVar(i, { chave: e.target.value.replace(/[^a-zA-Z0-9_.-]/g, '_') })}
                          data-testid={`variavel-chave-${i}`}
                          placeholder="cliente_nome"
                        />
                      </td>
                      <td>
                        <Input
                          value={v.rotulo || ''}
                          onChange={(e) => setVar(i, { rotulo: e.target.value })}
                          data-testid={`variavel-rotulo-${i}`}
                          placeholder="Nome do cliente"
                        />
                      </td>
                      <td>
                        <Select
                          value={v.origem || 'manual'}
                          onChange={(e) => setVar(i, { origem: e.target.value })}
                          data-testid={`variavel-origem-${i}`}
                        >
                          {ORIGENS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </Select>
                      </td>
                      <td>
                        <label className="checkbox-field">
                          <input
                            type="checkbox"
                            checked={!!v.obrigatoria}
                            onChange={(e) => setVar(i, { obrigatoria: e.target.checked })}
                            data-testid={`variavel-obrigatoria-${i}`}
                          />
                          <span className="text-small">Obrigatória</span>
                        </label>
                      </td>
                      <td>
                        <div className="row row-wrap" style={{ gap: 'var(--space-2, 0.5rem)' }}>
                          <Button
                            size="sm"
                            variant="ghost"
                            data-testid={`variavel-inserir-${i}`}
                            onClick={() => inserirPlaceholder((v.chave || '').trim())}
                            disabled={!(v.chave || '').trim()}
                          >
                            Inserir
                          </Button>
                          <Button size="sm" variant="ghost" data-testid={`variavel-remover-${i}`} onClick={() => removerVar(i)}>
                            <IconTrash /> Remover
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
