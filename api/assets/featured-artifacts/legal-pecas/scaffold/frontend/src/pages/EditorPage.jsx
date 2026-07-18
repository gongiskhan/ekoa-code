import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Packer } from 'docx';
import { criarEnvelope } from '../assinatura-cliente.js';
import {
  getShared,
  updateShared,
  createShared,
  useSharedCollection,
  notify,
  appHref,
} from '../shared.js';
import {
  Button,
  Badge,
  Field,
  Input,
  EmptyState,
  toast,
} from '../components/ui.jsx';
import {
  IconPenLine,
  IconDownload,
  IconExternalLink,
  IconBook,
  IconCheck,
} from '../components/Icons.jsx';
import Disclaimer from './Disclaimer.jsx';
import {
  tipoLabel,
  estadoLabel,
  estadoTone,
  nextEstado,
  appendCitacao,
  substitute,
  resolveValues,
  slugFile,
  hojeISO,
} from './pecas-logic.js';
import { buildPecaDocx } from './pecas-docx.js';

/*
 * Extrai a árvore (outline) da peça a partir dos cabeçalhos do corpo, para a
 * navegação lateral. Um cabeçalho é uma linha em MAIÚSCULAS com pelo menos duas
 * letras (a mesma noção do gerador de .docx): "I. DOS FACTOS", "II. DO DIREITO",
 * "EXMO. SENHOR…". Devolve { linha, texto } por ordem de aparição.
 */
function extractOutline(corpo) {
  const linhas = String(corpo || '').split('\n');
  const out = [];
  for (let i = 0; i < linhas.length; i += 1) {
    const t = linhas[i].trim();
    if (!t) continue;
    const letras = t.replace(/[^A-Za-zÀ-ÿ]/g, '');
    if (letras.length < 2) continue;
    if (t === t.toUpperCase() && /[A-ZÀ-Þ]/.test(t)) out.push({ linha: i, texto: t });
  }
  return out;
}

export default function EditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [peca, setPeca] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Estado editável (hidratado da peça).
  const [titulo, setTitulo] = useState('');
  const [corpo, setCorpo] = useState('');
  const [estado, setEstado] = useState('rascunho');
  const [versao, setVersao] = useState(1);
  const [fundamentacao, setFundamentacao] = useState([]);

  const { items: processos } = useSharedCollection('processos');
  const { items: clientes } = useSharedCollection('clientes');
  const { items: pesquisas } = useSharedCollection('pesquisas');
  const { items: calculos } = useSharedCollection('calculos');
  const { items: precedentes } = useSharedCollection('precedentes');

  const [erro, setErro] = useState(null);
  const [exportando, setExportando] = useState(false);
  const [resultado, setResultado] = useState(null); // { url, filename, processoId }
  const [guardandoPrecedente, setGuardandoPrecedente] = useState(false);
  const corpoRef = useRef(null);
  const exportandoRef = useRef(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setNotFound(false);
    getShared('pecas', id)
      .then((p) => {
        if (!alive) return;
        if (!p) { setNotFound(true); setLoading(false); return; }
        setPeca(p);
        setTitulo(p.titulo || '');
        setCorpo(p.corpo || '');
        setEstado(p.estado || 'rascunho');
        setVersao(Number(p.versao) || 1);
        setFundamentacao(Array.isArray(p.fundamentacao) ? p.fundamentacao : []);
        setLoading(false);
      })
      .catch(() => { if (alive) { setNotFound(true); setLoading(false); } });
    return () => { alive = false; };
  }, [id]);

  const processo = useMemo(
    () => (peca ? processos.find((p) => p.id === peca.processoId) || null : null),
    [processos, peca],
  );
  const cliente = useMemo(
    () => (processo ? clientes.find((c) => c.id === processo.clienteId) || null : null),
    [clientes, processo],
  );

  // Pesquisas com citações verificáveis, priorizando as do processo da peça.
  const pesquisasCitaveis = useMemo(() => {
    const withCit = pesquisas.filter((q) => Array.isArray(q.citacoes) && q.citacoes.length > 0);
    const pid = peca && peca.processoId;
    return withCit
      .slice()
      .sort((a, b) => {
        const ap = a.processoId === pid ? 0 : 1;
        const bp = b.processoId === pid ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return String(b.executadaEm || '').localeCompare(String(a.executadaEm || ''));
      });
  }, [pesquisas, peca]);

  const proximoEstado = nextEstado(estado);

  // Árvore da peça para a navegação lateral, recalculada a cada edição do corpo.
  const outline = useMemo(() => extractOutline(corpo), [corpo]);

  // Precedentes relevantes, priorizando os do mesmo tipo da peça.
  const precedentesRelevantes = useMemo(() => {
    const tipoPeca = peca && peca.tipo;
    return precedentes
      .slice()
      .sort((a, b) => {
        const at = a.tipo === tipoPeca ? 0 : 1;
        const bt = b.tipo === tipoPeca ? 0 : 1;
        if (at !== bt) return at - bt;
        return String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
      });
  }, [precedentes, peca]);

  // Salta a navegação lateral para um cabeçalho: foca o corpo e coloca o cursor
  // no início dessa linha (a textarea faz scroll para o cursor).
  function saltarPara(linhaIdx) {
    const ta = corpoRef.current;
    if (!ta) return;
    const linhas = corpo.split('\n');
    let pos = 0;
    for (let i = 0; i < linhaIdx && i < linhas.length; i += 1) pos += linhas[i].length + 1;
    ta.focus();
    try { ta.setSelectionRange(pos, pos); } catch { /* browsers antigos */ }
    // Aproxima a linha do topo visível de forma proporcional (sem depender de
    // métricas exactas): scrollTop = fração da linha * altura de scroll.
    const frac = linhas.length > 1 ? linhaIdx / linhas.length : 0;
    ta.scrollTop = Math.max(0, Math.round(frac * ta.scrollHeight - ta.clientHeight / 3));
  }

  // Insere o corpo de um precedente no fim da peça, com as {{chaves}} resolvidas
  // do processo/cliente (mesma via determinística da criação). Persiste logo.
  async function inserirPrecedente(precedente) {
    const bruto = String(precedente && precedente.corpo || '').trim();
    if (!bruto) { toast('O precedente não tem corpo.', { tone: 'error' }); return; }
    const resolvido = substitute(bruto, resolveValues(processo, cliente));
    const base = String(corpo || '');
    const sep = base.length === 0 ? '' : base.endsWith('\n') ? '\n' : '\n\n';
    const novoCorpo = `${base}${sep}${resolvido}\n`;
    setCorpo(novoCorpo);
    try {
      await updateShared('pecas', id, { corpo: novoCorpo });
      toast('Precedente inserido.', { tone: 'ok' });
    } catch {
      toast('Não foi possível inserir o precedente.', { tone: 'error' });
    }
  }

  async function guardar() {
    const novaVersao = versao + 1;
    try {
      await updateShared('pecas', id, { titulo, corpo, estado, versao: novaVersao });
      setVersao(novaVersao);
      toast('Peça guardada.', { tone: 'ok' });
    } catch {
      toast('Não foi possível guardar a peça.', { tone: 'error' });
    }
  }

  async function avancarEstado() {
    if (!proximoEstado) return;
    try {
      await updateShared('pecas', id, { estado: proximoEstado });
      setEstado(proximoEstado);
      toast(`Estado: ${estadoLabel(proximoEstado)}.`, { tone: 'ok' });
    } catch {
      toast('Não foi possível mudar o estado.', { tone: 'error' });
    }
  }

  // RET-CONS (fase 2): insere uma memória de cálculo do serviço legal-calculos
  // no corpo da peça - o texto citado por troços/Avisos vem TODO do serviço
  // (fronteira P2-001: nenhuma fórmula nem taxa nesta app).
  async function inserirMemoria(calculo) {
    const r = calculo.resultado || {};
    const passos = (r.showWork && Array.isArray(r.showWork.passos)) ? r.showWork.passos : [];
    const linhas = [
      '',
      `MEMÓRIA DE CÁLCULO - ${calculo.titulo || (calculo.tipo === 'custas' ? 'Taxa de justiça' : 'Juros de mora')}`,
      ...passos.map((p) => `  ${p}`),
      '',
    ];
    const novoCorpo = `${corpo}${linhas.join('\n')}`;
    setCorpo(novoCorpo);
    try {
      await updateShared('pecas', id, { corpo: novoCorpo, memoriaCalculoIds: [...(new Set([...(peca?.memoriaCalculoIds || []), calculo.id]))] });
      toast('Memória de cálculo inserida.', { tone: 'ok' });
    } catch {
      toast('Não foi possível inserir a memória.', { tone: 'error' });
    }
  }

  // Insere no corpo a fundamentação de uma pesquisa (uma linha por citação) e
  // regista cada citação em `peca.fundamentacao`. Persiste imediatamente.
  async function inserirFundamentacao(pesquisa) {
    const citacoes = Array.isArray(pesquisa.citacoes) ? pesquisa.citacoes : [];
    if (citacoes.length === 0) return;
    let novoCorpo = corpo;
    const novos = [];
    for (const citacao of citacoes) {
      novoCorpo = appendCitacao(novoCorpo, citacao);
      novos.push({ pesquisaId: pesquisa.id, citacao });
    }
    const novaFund = [...fundamentacao, ...novos];
    setCorpo(novoCorpo);
    setFundamentacao(novaFund);
    try {
      await updateShared('pecas', id, { corpo: novoCorpo, fundamentacao: novaFund });
      toast('Fundamentação inserida.', { tone: 'ok' });
    } catch {
      toast('Não foi possível registar a fundamentação.', { tone: 'error' });
    }
  }

  async function exportarDocx() {
    if (exportandoRef.current) return;
    setErro(null);
    if (!processo) { setErro('A peça não tem um processo associado.'); return; }
    const api = typeof window !== 'undefined' ? window.__ekoa : null;
    if (!api || typeof api.uploadFile !== 'function') { setErro('Carregamento de ficheiros indisponível neste contexto.'); return; }

    exportandoRef.current = true;
    setExportando(true);
    let uploaded = null;
    try {
      // Persiste o corpo actual antes de exportar, para o dossiê e o ficheiro
      // coincidirem com o que está no editor.
      await updateShared('pecas', id, { titulo, corpo });

      const hoje = hojeISO();
      const doc = buildPecaDocx({ corpo });
      const blob = await Packer.toBlob(doc);
      const filename = `${slugFile(titulo)}.docx`;

      uploaded = await api.uploadFile(blob, { name: filename });
      if (!uploaded || !uploaded.id || !uploaded.url) throw new Error('O carregamento não devolveu um ficheiro válido.');

      const appId = typeof window !== 'undefined' ? window.__EKOA_APP_ID : undefined;
      try {
        const row = {
          nome: `${titulo}.docx`,
          tipo: 'docx',
          processoId: processo.id,
          data: hoje,
          origem: 'legal-pecas',
          ficheiro: { fileId: uploaded.id, appId, url: uploaded.url, mime: uploaded.type || 'application/octet-stream', size: uploaded.size || blob.size },
          versao: versao,
        };
        if (processo.clienteId) row.clienteId = processo.clienteId;
        await createShared('documentos', row);
      } catch {
        // O ficheiro subiu mas a linha de metadados falhou: apaga o blob órfão (o
        // registo é a fonte de verdade) e falha com um erro fiel.
        if (uploaded && uploaded.id && typeof api.deleteFile === 'function') {
          try { await api.deleteFile(uploaded.id); } catch { /* melhor-esforço */ }
        }
        throw new Error('A peça foi criada mas não foi possível registá-la no dossiê. Tente novamente.');
      }

      setResultado({ url: uploaded.url, filename, processoId: processo.id });
      // A notificação é ACESSÓRIA e corre FORA do caminho crítico.
      Promise.resolve(
        notify({
          tipo: 'documento',
          titulo: 'Peça exportada',
          corpo: titulo,
          processoId: processo.id,
          href: appHref('legal-dossie', `processo/${processo.id}`),
        }),
      ).catch(() => { /* não fatal */ });
    } catch (e) {
      setErro(e && e.message ? e.message : 'Não foi possível exportar a peça.');
    } finally {
      exportandoRef.current = false;
      setExportando(false);
    }
  }

  async function guardarComoPrecedente() {
    if (guardandoPrecedente || !peca) return;
    setGuardandoPrecedente(true);
    try {
      await createShared('precedentes', {
        tipo: peca.tipo,
        area: (processo && processo.area) || '',
        titulo: titulo || 'Precedente',
        corpo,
        notas: `Guardado a partir da peça "${titulo || 'sem título'}".`,
      });
      toast('Peça guardada como precedente.', { tone: 'ok' });
    } catch {
      toast('Não foi possível guardar como precedente.', { tone: 'error' });
    } finally {
      setGuardandoPrecedente(false);
    }
  }

  if (loading) {
    return (
      <div data-testid="pecas-editor" data-demo-page="pecas/editor">
        <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar peça.</span></div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div data-testid="pecas-editor" data-demo-page="pecas/editor">
        <EmptyState
          icon={<IconPenLine />}
          title="Peça não encontrada"
          hint="A peça pode ter sido eliminada. Volte à lista."
          action={<Button onClick={() => navigate('/')}>Voltar às peças</Button>}
        />
      </div>
    );
  }

  return (
    <div data-testid="pecas-editor" data-demo-page="pecas/editor">
      <div className="page-header">
        <div>
          <h1 className="page-title">{titulo || '(sem título)'}</h1>
          <p className="page-subtitle">
            {tipoLabel(peca.tipo)}
            {processo ? (
              <>
                {' · '}
                <a href={appHref('legal-dossie', `processo/${processo.id}`)} data-testid="pecas-processo-link">
                  Processo {processo.numeroProcesso || '(sem número)'}
                </a>
              </>
            ) : null}
          </p>
        </div>
        <div className="page-actions">
          <Button variant="ghost" onClick={() => navigate('/')}>Voltar</Button>
          <Button variant="secondary" data-testid="pecas-guardar" onClick={guardar}>Guardar</Button>
          <Button data-testid="pecas-exportar" data-demo-target="pecas-exportar" onClick={exportarDocx} disabled={exportando}>
            <IconDownload /> {exportando ? 'A exportar…' : 'Exportar .docx'}
          </Button>
        </div>
      </div>

      <div style={{ marginBottom: 'var(--space-4, 1rem)' }}>
        <Disclaimer />
      </div>

      {/* Barra de estado + ações secundárias */}
      <div className="row row-wrap row-space-between" style={{ marginBottom: 'var(--space-4, 1rem)', gap: 'var(--space-3, 0.75rem)', alignItems: 'center' }}>
        <div className="row row-wrap" style={{ gap: 'var(--space-2, 0.5rem)', alignItems: 'center' }}>
          <span className="text-small text-subtle">Estado:</span>
          <Badge tone={estadoTone(estado)} data-testid="pecas-estado">{estadoLabel(estado)}</Badge>
          <span className="text-small text-subtle" data-testid="pecas-versao">versão {versao}</span>
          {proximoEstado ? (
            <Button size="sm" variant="ghost" data-testid="pecas-estado-avancar" onClick={avancarEstado}>
              <IconCheck /> Avançar para {estadoLabel(proximoEstado)}
            </Button>
          ) : null}
        </div>
        <Button
          size="sm"
          variant="ghost"
          data-testid="pecas-precedente"
          data-demo-target="pecas-precedente"
          onClick={guardarComoPrecedente}
          disabled={guardandoPrecedente}
        >
          <IconBook /> Guardar como precedente
        </Button>
      </div>

      {resultado ? (
        <section className="card" data-testid="pecas-export-sucesso" style={{ marginBottom: 'var(--space-4, 1rem)' }}>
          <h2 className="card-title">Peça exportada</h2>
          <div className="resultado-ok" style={{ marginTop: 'var(--space-2, 0.5rem)' }}>Documento .docx guardado no dossiê do processo.</div>
          <div className="row row-wrap" style={{ marginTop: 'var(--space-4, 1rem)', gap: 'var(--space-2, 0.5rem)' }}>
            <a className="btn btn-primary" href={`${resultado.url}?download=1`} download={resultado.filename} data-testid="pecas-download">
              <IconDownload /> Descarregar .docx
            </a>
            <a className="btn btn-secondary" href={appHref('legal-dossie', `processo/${resultado.processoId}`)} data-testid="pecas-abrir-dossie">
              <IconExternalLink /> Abrir no Dossiê
            </a>
            <Button
              variant="secondary"
              data-testid="pecas-enviar-assinatura"
              onClick={async () => {
                try {
                  const env = await criarEnvelope({
                    titulo: `${titulo || 'Peça processual'} - assinatura`,
                    ficheiro: { nome: resultado.filename, url: resultado.url },
                    signatarios: [{ nome: 'Mandatário responsável', papel: 'advogado', metodo: 'cmd-orquestrado' }],
                    processoId: resultado.processoId,
                  });
                  window.location.assign(env.href);
                } catch {
                  toast('Não foi possível criar o envelope de assinatura.', { tone: 'error' });
                }
              }}
            >
              Enviar para assinatura
            </Button>
          </div>
        </section>
      ) : null}

      {erro ? <p className="resultado-erro" data-testid="pecas-erro" style={{ marginBottom: 'var(--space-4, 1rem)' }}>{erro}</p> : null}

      {/* Editor + fundamentação lado a lado */}
      <div className="pecas-editor-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 'var(--space-4, 1rem)', alignItems: 'start' }}>
        <div className="stack stack-4">
          <section className="card">
            <Field label="Título">
              <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} data-testid="pecas-titulo" placeholder="Título da peça" />
            </Field>
          </section>
          {outline.length > 0 ? (
            <section className="card" data-testid="pecas-outline">
              <h2 className="card-title">Estrutura</h2>
              <p className="card-subtitle" style={{ marginBottom: 'var(--space-2, 0.5rem)' }}>
                Navegação pela peça. Clique num cabeçalho para saltar para essa secção.
              </p>
              <nav className="chip-row" aria-label="Estrutura da peça">
                {outline.map((h, i) => (
                  <button
                    key={`${h.linha}-${i}`}
                    type="button"
                    className="chip as-button"
                    data-testid={`pecas-outline-${i}`}
                    onClick={() => saltarPara(h.linha)}
                    title={h.texto}
                    style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {h.texto}
                  </button>
                ))}
              </nav>
            </section>
          ) : null}
          <section className="card">
            <div className="row-space-between">
              <div>
                <h2 className="card-title">Corpo da peça</h2>
                <p className="card-subtitle">Esqueleto determinístico, pronto a rever e completar. Insira fundamentação a partir das pesquisas.</p>
              </div>
            </div>
            <textarea
              ref={corpoRef}
              className="textarea field-textarea citius-textarea"
              data-testid="pecas-corpo"
              data-demo-target="pecas-editor-corpo"
              value={corpo}
              onChange={(e) => setCorpo(e.target.value)}
              placeholder={'EXMO. SENHOR DOUTOR JUIZ DE DIREITO…'}
              style={{ marginTop: 'var(--space-4, 1rem)', width: '100%' }}
              rows={22}
            />
          </section>
        </div>

        <aside className="card" data-testid="pecas-fundamentacao" data-demo-target="pecas-fundamentacao" style={{ position: 'sticky', top: 'var(--space-4, 1rem)' }}>
          <h2 className="card-title">Fundamentação</h2>

          {calculos.length > 0 ? (
            <div className="stack stack-2" data-testid="pecas-memorias" style={{ marginBottom: 'var(--space-4, 1rem)' }}>
              <p className="card-subtitle" style={{ margin: 0 }}>Memórias de cálculo (serviço de cálculos - cada troço cita o seu Aviso).</p>
              {calculos.slice(0, 6).map((c) => (
                <div key={c.id} className="row row-2" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                  <span className="text-small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.titulo || (c.tipo === 'custas' ? 'Taxa de justiça' : 'Juros de mora')}
                  </span>
                  <Button size="sm" data-testid={`inserir-memoria-${c.id}`} onClick={() => inserirMemoria(c)}>
                    Inserir memória
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          {precedentesRelevantes.length > 0 ? (
            <div className="stack stack-2" data-testid="pecas-precedentes-inserir" style={{ marginBottom: 'var(--space-4, 1rem)' }}>
              <p className="card-subtitle" style={{ margin: 0 }}>
                Precedentes do escritório. Inserir acrescenta o corpo ao fim da peça, com as chaves resolvidas do processo.
              </p>
              {precedentesRelevantes.slice(0, 6).map((pr) => (
                <div key={pr.id} className="row row-2" style={{ alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2, 0.5rem)' }}>
                  <span className="text-small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {pr.titulo || '(sem título)'}
                    {pr.tipo === (peca && peca.tipo) ? <Badge tone="info" style={{ marginLeft: 'var(--space-2, 0.5rem)' }}>mesmo tipo</Badge> : null}
                  </span>
                  <Button size="sm" data-testid={`pecas-inserir-precedente-${pr.id}`} onClick={() => inserirPrecedente(pr)}>
                    Inserir
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          <p className="card-subtitle">Cite as pesquisas jurídicas guardadas. Cada citação entra no corpo e fica registada na peça.</p>
          {pesquisasCitaveis.length === 0 ? (
            <p className="field-hint" style={{ marginTop: 'var(--space-4, 1rem)' }}>
              Ainda não há pesquisas com citações. Faça uma pesquisa jurídica para poder citar.
            </p>
          ) : (
            <div className="stack stack-3" style={{ marginTop: 'var(--space-4, 1rem)' }}>
              {pesquisasCitaveis.map((q) => (
                <div key={q.id} className="card" data-testid={`pesquisa-${q.id}`} style={{ padding: 'var(--space-3, 0.75rem)' }}>
                  <p className="text-strong" style={{ margin: '0 0 var(--space-2, 0.5rem)' }}>{q.pergunta || 'Pesquisa'}</p>
                  <ul className="stack stack-1" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {(q.citacoes || []).map((c, ci) => (
                      <li key={ci} className="text-small text-subtle" style={{ lineHeight: 1.5 }}>
                        {c.titulo ? <span className="text-strong" style={{ color: 'var(--color-text, #0F172A)' }}>{c.titulo}</span> : null}
                        {c.fonte ? <span> · {c.fonte}</span> : null}
                      </li>
                    ))}
                  </ul>
                  <div className="row" style={{ marginTop: 'var(--space-2, 0.5rem)' }}>
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid={`pecas-inserir-${q.id}`}
                      onClick={() => inserirFundamentacao(q)}
                    >
                      Inserir citação
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
