import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useSharedCollection,
  createShared,
  notify,
  appHref,
} from '../shared.js';
import { useDemoResult } from '../demo.js';
import {
  Button,
  Badge,
  Field,
  Textarea,
  Select,
  EmptyState,
  toast,
} from '../components/ui.jsx';
import {
  IconSearchText,
  IconExternalLink,
  IconShieldCheck,
  IconShieldAlert,
  IconInbox,
} from '../components/Icons.jsx';
import {
  DISCLAIMER,
  FONTES,
  fonteLabel,
  fonteTone,
  verificacaoOk,
  verificacaoLabel,
  verificacaoTone,
  agoraISO,
  truncarPergunta,
  hitsParaCitacoes,
  citacoesParaTexto,
} from './pesquisa-logic.js';

function ekoaApi() {
  return typeof window !== 'undefined' ? window.__ekoa : null;
}

/* Aviso fixo, mostrado no topo de cada superfície de resultado. */
function Disclaimer() {
  return (
    <p
      className="resultado-ok"
      data-demo-target="pesquisa-disclaimer"
      data-testid="pesquisa-disclaimer"
      style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}
    >
      <IconShieldCheck size={16} /> {DISCLAIMER}
    </p>
  );
}

/* Distintivo do estado de verificação de uma ligação ao vivo. */
function VerificacaoBadge({ verification }) {
  const ok = verificacaoOk(verification);
  return (
    <Badge tone={verificacaoTone(verification)} data-testid="pesquisa-verificacao">
      {ok ? <IconShieldCheck size={12} /> : <IconShieldAlert size={12} />} {verificacaoLabel(verification)}
    </Badge>
  );
}

/*
 * Cartão de um resultado ao vivo. A citação renderiza-se SEMPRE como uma CHIP que
 * é uma ligação real (<a href>) para a fonte, com o distintivo de verificação -
 * nunca uma citação sem URL. O título é também uma ligação para a mesma fonte.
 */
function ResultadoCard({ hit }) {
  const citacaoTexto = (hit.citation && String(hit.citation).trim()) || 'Abrir fonte';
  return (
    <li className="card" data-testid="pesquisa-resultado">
      <div className="row row-space-between" style={{ alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
        <Badge tone={fonteTone(hit.source)}>{fonteLabel(hit.source)}</Badge>
        <VerificacaoBadge verification={hit.verification} />
      </div>
      <a
        className="card-title stat-link"
        href={hit.url}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="pesquisa-resultado-titulo"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 'var(--sp-2)' }}
      >
        {hit.title || hit.url} <IconExternalLink size={13} />
      </a>
      {hit.snippet ? (
        <p className="card-subtitle" style={{ marginTop: 'var(--sp-1)' }}>{hit.snippet}</p>
      ) : null}
      <div className="chip-row" style={{ marginTop: 'var(--sp-3)' }}>
        <a
          className="chip as-button"
          href={hit.url}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="pesquisa-citacao"
          title={hit.url}
        >
          <IconExternalLink size={12} /> {citacaoTexto}
        </a>
      </div>
    </li>
  );
}

export default function PesquisarPage() {
  const { items: processos } = useSharedCollection('processos');

  const [pergunta, setPergunta] = useState('');
  const [fontes, setFontes] = useState({ dgsi: true, dre: true });
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState(null); // { ok, hits, note } | { ok:false, error }
  const [processoId, setProcessoId] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);

  const processosOrdenados = useMemo(
    () => processos.slice().sort((a, b) => String(a.numeroProcesso || '').localeCompare(String(b.numeroProcesso || ''), 'pt')),
    [processos],
  );

  const fontesSelecionadas = FONTES.filter((f) => fontes[f.id]).map((f) => f.id);
  const podePesquisar = pergunta.trim().length > 0 && fontesSelecionadas.length > 0 && !searching;
  const hits = result && result.ok && Array.isArray(result.hits) ? result.hits : [];

  // Sinaliza à ponte de demonstração que o resultado está visível.
  useDemoResult('pesquisa-resultados', result !== null && !searching);

  function toggleFonte(id) {
    setFontes((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function pesquisar() {
    if (!podePesquisar) return;
    const q = pergunta.trim();
    setSearching(true);
    setResult(null);
    setGuardado(false);
    const api = ekoaApi();
    if (!api || typeof api.fetch !== 'function') {
      setResult({ ok: false, hits: [], error: 'Pesquisa indisponível neste contexto.' });
      setSearching(false);
      return;
    }
    try {
      const url = `/api/legal-research?q=${encodeURIComponent(q)}&sources=${fontesSelecionadas.join(',')}&verify=1`;
      const res = await api.fetch(url);
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (res.ok && data && data.ok) {
        setResult({ ok: true, hits: Array.isArray(data.hits) ? data.hits : [], note: data.note || '' });
      } else {
        const msg = (data && (data.error || data.note)) || 'Pesquisa jurídica indisponível.';
        setResult({ ok: false, hits: [], error: msg });
      }
    } catch {
      setResult({ ok: false, hits: [], error: 'Pesquisa jurídica indisponível.' });
    } finally {
      setSearching(false);
    }
  }

  async function guardar() {
    if (!processoId || guardando) return;
    const q = pergunta.trim();
    if (!q) return;
    setGuardando(true);
    try {
      const citacoes = hitsParaCitacoes(hits);
      const executadaEm = agoraISO();
      const processo = processos.find((p) => p.id === processoId) || null;

      // Linha de pesquisa: guardamos os HITS (sem síntese por LLM nesta máquina).
      await createShared('pesquisas', {
        pergunta: q,
        executadaEm,
        resposta: '',
        citacoes,
        estado: 'concluida',
        processoId,
      });

      // Nota do dossiê: a mesma pesquisa arquivada como documento (origem
      // 'legal-pesquisa'), com as citações renderizadas em texto - aterra no
      // separador Documentos do processo.
      await createShared('documentos', {
        nome: `Pesquisa: ${truncarPergunta(q)}`,
        tipo: 'nota',
        processoId,
        data: executadaEm.slice(0, 10),
        origem: 'legal-pesquisa',
        texto: citacoesParaTexto(q, citacoes),
        versao: 1,
        ...(processo && processo.clienteId ? { clienteId: processo.clienteId } : {}),
      });

      await notify({
        titulo: 'Pesquisa jurídica arquivada',
        corpo: citacoes.length
          ? `"${truncarPergunta(q, 60)}" guardada no dossiê com ${citacoes.length} citação(ões) verificável(eis).`
          : `"${truncarPergunta(q, 60)}" guardada no dossiê (sem citações verificáveis - índice local vazio).`,
        href: appHref('legal-dossie', `processo/${processoId}`),
      });

      setGuardado(true);
      toast('Pesquisa guardada no processo.', { tone: 'ok' });
    } catch {
      toast('Não foi possível guardar a pesquisa.', { tone: 'error' });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div data-testid="pesquisa-pesquisar-page" data-demo-page="pesquisa/pesquisar">
      <div className="page-header">
        <div>
          <h1 className="page-title">Pesquisa fundamentada</h1>
          <p className="page-subtitle">
            Pesquisa em DGSI (jurisprudência) e DRE (legislação) sobre a base de conhecimento do
            escritório. Cada fonte só é mostrada com a ligação confirmada; nada é inventado.
          </p>
        </div>
      </div>

      <Disclaimer />

      <div className="form" style={{ maxWidth: 720, marginTop: 'var(--sp-5, 1.25rem)' }}>
        <Field label="Pergunta jurídica" required>
          <Textarea
            data-testid="pesquisa-pergunta"
            data-demo-target="pesquisa-pergunta"
            placeholder="Ex.: prazo de contestação em acção declarativa comum"
            rows={3}
            value={pergunta}
            onChange={(e) => setPergunta(e.target.value)}
          />
        </Field>

        <Field label="Fontes" hint="A pesquisa cobre as fontes seleccionadas.">
          <div className="row row-3" style={{ flexWrap: 'wrap', gap: 'var(--sp-4)' }}>
            {FONTES.map((f) => (
              <label key={f.id} className="checkbox-field" data-testid={`pesquisa-fonte-${f.id}-label`}>
                <input
                  type="checkbox"
                  data-testid={`pesquisa-fonte-${f.id}`}
                  checked={!!fontes[f.id]}
                  onChange={() => toggleFonte(f.id)}
                />
                <span>
                  <span className="text-strong">{f.label}</span>{' '}
                  <span className="text-subtle text-xs">- {f.descricao}</span>
                </span>
              </label>
            ))}
          </div>
        </Field>

        <div className="row row-2">
          <Button
            variant="primary"
            disabled={!podePesquisar}
            data-testid="pesquisa-executar"
            data-demo-target="pesquisa-executar"
            onClick={pesquisar}
          >
            <IconSearchText size={16} /> {searching ? 'A pesquisar.' : 'Pesquisar'}
          </Button>
        </div>
      </div>

      {/* ---- Resultados ---- */}
      <section
        data-testid="pesquisa-resultados"
        data-demo-target="pesquisa-resultados"
        style={{ marginTop: 'var(--sp-6, 1.5rem)' }}
      >
        {searching ? (
          <div className="loading"><span className="spinner" aria-hidden="true" /><span>A consultar a base de conhecimento.</span></div>
        ) : !result ? (
          <EmptyState
            icon={<IconSearchText />}
            title="Ainda sem pesquisa"
            hint="Escreva uma pergunta e escolha as fontes para começar."
          />
        ) : !result.ok ? (
          <p className="resultado-erro" data-testid="pesquisa-erro" style={{ marginTop: 0 }}>
            {result.error}
          </p>
        ) : hits.length > 0 ? (
          <ul className="stack stack-3" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {hits.map((hit, i) => (
              <ResultadoCard key={`${hit.url || 'hit'}-${i}`} hit={hit} />
            ))}
          </ul>
        ) : (
          <div className="resultado-panel" data-testid="pesquisa-nota-vazia">
            <div className="row" style={{ alignItems: 'flex-start', gap: 'var(--sp-2)' }}>
              <span className="row-icon" aria-hidden="true"><IconInbox size={18} /></span>
              <div className="stack stack-1">
                <span className="text-strong">Base de conhecimento local vazia</span>
                <span className="text-subtle text-small">
                  A base de conhecimento local está vazia - a pesquisa fundamentada fica ativa quando o
                  índice DGSI/DRE estiver carregado. Pode ainda assim guardar esta pesquisa manualmente
                  no processo para revisão.
                </span>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ---- Guardar no processo (após qualquer pesquisa) ---- */}
      {result ? (
        <section
          className="card"
          data-testid="pesquisa-guardar-panel"
          style={{ marginTop: 'var(--sp-6, 1.5rem)', maxWidth: 720 }}
        >
          <h2 className="card-title">Guardar no processo</h2>
          <p className="card-subtitle">
            Arquiva esta pesquisa no dossiê de um processo - fica como linha de histórico e como nota do
            processo, com as citações verificáveis{hits.length ? '' : ' (nenhuma, nesta máquina)'}.
          </p>
          <div className="form" style={{ marginTop: 'var(--sp-3)' }}>
            <Field label="Processo" required>
              <Select
                data-testid="pesquisa-guardar-processo"
                value={processoId}
                onChange={(e) => { setProcessoId(e.target.value); setGuardado(false); }}
              >
                <option value="">Seleccione um processo…</option>
                {processosOrdenados.map((p) => (
                  <option key={p.id} value={p.id}>{p.numeroProcesso || '(sem número)'}</option>
                ))}
              </Select>
            </Field>
            <div className="row row-2" style={{ flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
              <Button
                variant="primary"
                disabled={!processoId || guardando}
                data-testid="pesquisa-guardar"
                data-demo-target="pesquisa-guardar"
                onClick={guardar}
              >
                {guardando ? 'A guardar.' : 'Guardar no processo'}
              </Button>
              {guardado ? (
                <Link className="btn btn-ghost" to="/historico" data-testid="pesquisa-ver-historico">
                  Ver no histórico <IconExternalLink size={14} />
                </Link>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
