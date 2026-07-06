import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useSharedCollection,
  createShared,
  appHref,
} from '../shared.js';
import { Badge, toast } from '../components/ui.jsx';
import { useDemoResult } from '../demo.js';
import {
  IconShieldAlert,
  IconSearch,
  IconExternalLink,
  IconCheck,
  IconClock,
} from '../components/Icons.jsx';
import {
  searchConflitos,
  excerptText,
  TIPO_META,
} from './conflitos-search.js';

/* Fragmento destacado (before / MATCH / after) de um excerto de correspondência. */
function Excerpt({ excerto }) {
  if (!excerto) return null;
  return (
    <span className="conflitos-excerpt">
      {excerto.before ? <span>{excerto.before}</span> : null}
      <mark
        className="conflitos-mark"
        style={{
          background: 'var(--accent-weak, #eaeff4)',
          color: 'var(--accent-strong, #16304c)',
          borderRadius: '3px',
          padding: '0 2px',
          fontWeight: 600,
        }}
      >
        {excerto.match}
      </mark>
      {excerto.after ? <span>{excerto.after}</span> : null}
    </span>
  );
}

/* Deep link do hit: cliente -> Núcleo; contraparte/processo -> Dossiê. */
function hitHref(h) {
  if (h.tipo === 'cliente') return appHref('legal-nucleo', `clientes/${h.refId}`);
  return appHref('legal-dossie', `processo/${h.refId}`);
}

const DISCLAIMER =
  'Apoio à decisão nos termos do art. 99.º do EOA - a avaliação do conflito é sempre do advogado.';

export default function VerificarPage() {
  const { items: clientes } = useSharedCollection('clientes');
  const { items: processos } = useSharedCollection('processos');
  const { items: pessoas } = useSharedCollection('pessoas');

  const [termo, setTermo] = useState('');
  const [nif, setNif] = useState('');
  // resultado === null antes da 1.ª verificação; senão { termo, nif, hits }.
  const [resultado, setResultado] = useState(null);

  const [decisao, setDecisao] = useState('');
  const [decididoPor, setDecididoPor] = useState('');
  const [notas, setNotas] = useState('');
  const [registando, setRegistando] = useState(false);
  const [registado, setRegistado] = useState(null);
  const [erro, setErro] = useState(null);

  // decididoPor: selecção da equipa quando `pessoas` existe, texto livre senão.
  const pessoasNomes = useMemo(
    () => (Array.isArray(pessoas) ? pessoas.map((p) => p.nome).filter(Boolean) : []),
    [pessoas],
  );
  const temEquipa = pessoasNomes.length > 0;

  // O resultado foi computado pelo menos uma vez -> sinaliza a ponte de demos.
  useDemoResult('conflitos-resultado', resultado !== null);

  const verificarDisabled = !termo.trim() && !nif.trim();

  function onVerificar() {
    const t = termo.trim();
    const n = nif.trim();
    if (!t && !n) {
      setErro('Indique um nome ou um NIF para verificar.');
      return;
    }
    const hits = searchConflitos({ termo: t, nif: n, clientes, processos });
    // Uma nova verificação recomeça a decisão do zero (nunca pré-seleccionada).
    setResultado({ termo: t, nif: n, hits });
    setDecisao('');
    setDecididoPor('');
    setNotas('');
    setRegistado(null);
    setErro(null);
  }

  async function onRegistar() {
    if (!resultado || !decisao) return;
    setRegistando(true);
    setErro(null);
    try {
      const payload = {
        termo: resultado.termo,
        executadoEm: new Date().toISOString(),
        resultado: resultado.hits.map((h) => ({
          tipo: h.tipo,
          refId: h.refId,
          campo: h.campo,
          excerto: excerptText(h.excerto),
        })),
        decisao,
        decididoPor: (decididoPor || '').trim(),
        notas: (notas || '').trim(),
      };
      if (resultado.nif) payload.nif = resultado.nif;
      const created = await createShared('conflitos_check', payload);
      setRegistado(created || { id: null });
      toast('Verificação registada.', { tone: 'ok' });
    } catch (e) {
      setErro(e && e.message ? e.message : 'Não foi possível registar a verificação.');
    } finally {
      setRegistando(false);
    }
  }

  function onNovaVerificacao() {
    setTermo('');
    setNif('');
    setResultado(null);
    setDecisao('');
    setDecididoPor('');
    setNotas('');
    setRegistado(null);
    setErro(null);
  }

  const hits = resultado ? resultado.hits : [];

  return (
    <div data-demo-page="conflitos/verificar" data-testid="verificar-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Verificação de conflitos</h1>
          <p className="page-subtitle">
            Pesquise um nome ou NIF na base de clientes e nas contrapartes dos processos antes de
            abrir um dossiê. O resultado é apoio à decisão nos termos do art. 99.º do EOA.
          </p>
        </div>
      </div>

      {/* ---------- Formulário de pesquisa ---------- */}
      <section className="card" aria-label="Verificar conflito">
        <h2 className="card-title">Verificar</h2>
        <p className="card-subtitle">
          O nome coincide por subcadeia (ignora acentos e maiúsculas). O NIF coincide por
          correspondência exacta.
        </p>

        <form
          className="form"
          data-testid="conflitos-form"
          style={{ marginTop: 'var(--sp-4, 1rem)' }}
          onSubmit={(e) => { e.preventDefault(); onVerificar(); }}
        >
          <div className="form-grid">
            <label className="field">
              <span className="field-label">Nome</span>
              <input
                className="field-input"
                type="text"
                data-testid="conflitos-termo"
                data-demo-target="conflitos-termo"
                placeholder="Nome do cliente ou da contraparte"
                value={termo}
                onChange={(e) => { setTermo(e.target.value); setErro(null); }}
              />
            </label>
            <label className="field">
              <span className="field-label">NIF (opcional)</span>
              <input
                className="field-input"
                type="text"
                inputMode="numeric"
                data-testid="conflitos-nif"
                data-demo-target="conflitos-nif"
                placeholder="Ex.: 510000028"
                value={nif}
                onChange={(e) => { setNif(e.target.value); setErro(null); }}
              />
            </label>
          </div>

          <div className="row row-2">
            <button
              type="submit"
              className="btn btn-primary"
              data-testid="conflitos-verificar"
              data-demo-target="conflitos-verificar"
              disabled={verificarDisabled}
            >
              <IconSearch /> Verificar
            </button>
          </div>
        </form>

        {erro ? <p className="resultado-erro" data-testid="conflitos-erro">{erro}</p> : null}
      </section>

      {/* ---------- Resultado + disclaimer + decisão ---------- */}
      {resultado ? (
        <section className="card" aria-label="Resultado da verificação" style={{ marginTop: 'var(--sp-5, 1.25rem)' }}>
          <div className="row-space-between">
            <h2 className="card-title">
              Correspondências
              <span className="text-subtle" style={{ fontWeight: 400 }}> ({hits.length})</span>
            </h2>
            <span className="text-subtle text-xs">
              Termo: <span className="text-strong">{resultado.termo || '—'}</span>
              {resultado.nif ? <> · NIF: <span className="text-strong">{resultado.nif}</span></> : null}
            </span>
          </div>

          <ul
            className="conflitos-resultado stack stack-3"
            data-testid="conflitos-resultado"
            data-demo-target="conflitos-resultado"
            style={{ listStyle: 'none', margin: 'var(--sp-3, 0.75rem) 0 0', padding: 0 }}
          >
            {hits.length === 0 ? (
              <li className="empty-state" data-testid="conflitos-sem-hits">
                <span className="empty-icon" aria-hidden="true"><IconShieldAlert /></span>
                <p className="empty-title">Sem correspondências</p>
                <p className="empty-text">
                  Não foram encontrados clientes nem contrapartes que coincidam. Registe a
                  verificação para deixar constância da diligência.
                </p>
              </li>
            ) : (
              hits.map((h) => {
                const meta = TIPO_META[h.tipo] || TIPO_META.processo;
                return (
                  <li
                    key={h.key}
                    className="conflitos-hit"
                    data-testid="conflitos-hit"
                    data-hit-tipo={h.tipo}
                    style={{
                      border: '1px solid var(--line-1, #e2e8f0)',
                      borderRadius: 'var(--r-2, 0.5rem)',
                      background: 'var(--surface-1, #f8fafc)',
                      padding: 'var(--sp-3, 0.75rem) var(--sp-4, 1rem)',
                    }}
                  >
                    <div className="row-space-between">
                      <div className="stack stack-1" style={{ minWidth: 0 }}>
                        <div className="row row-2" style={{ alignItems: 'center' }}>
                          <Badge tone={meta.tone} data-testid="conflitos-hit-tipo">{meta.label}</Badge>
                          <span className="text-strong">{h.nome || '(sem nome)'}</span>
                        </div>
                        <span className="text-subtle text-xs conflitos-hit-campo">
                          {h.campo}: <Excerpt excerto={h.excerto} />
                        </span>
                        {h.tipo === 'contraparte' && h.processoNumero ? (
                          <span className="text-subtle text-xs">Processo {h.processoNumero}</span>
                        ) : null}
                      </div>
                      <a
                        href={hitHref(h)}
                        className="btn btn-secondary btn-sm"
                        data-testid="conflitos-hit-link"
                        style={{ flexShrink: 0 }}
                      >
                        Abrir <IconExternalLink />
                      </a>
                    </div>
                  </li>
                );
              })
            )}
          </ul>

          <p
            className="conflitos-disclaimer text-subtle text-xs"
            data-testid="conflitos-disclaimer"
            data-demo-target="conflitos-disclaimer"
            style={{ marginTop: 'var(--sp-4, 1rem)' }}
          >
            {DISCLAIMER}
          </p>

          {/* ---------- Bloco de decisão OU sucesso ---------- */}
          {registado ? (
            <div className="resultado-panel" data-testid="conflitos-sucesso" style={{ marginTop: 'var(--sp-4, 1rem)' }}>
              <div className="row row-2" style={{ alignItems: 'center' }}>
                <span className="conflitos-sucesso-icon" aria-hidden="true" style={{ color: 'var(--ok, #16a34a)', display: 'inline-flex' }}><IconCheck /></span>
                <span className="text-strong">Verificação registada.</span>
              </div>
              <p className="text-muted" style={{ margin: 'var(--sp-2, 0.5rem) 0 0' }}>
                Ficou registada no histórico, com a decisão e o responsável.
              </p>
              <div className="row row-2" style={{ marginTop: 'var(--sp-3, 0.75rem)' }}>
                <Link to="/historico" className="btn btn-primary btn-sm" data-testid="conflitos-ir-historico">
                  <IconClock /> Ver histórico
                </Link>
                <button type="button" className="btn btn-secondary btn-sm" data-testid="conflitos-nova" onClick={onNovaVerificacao}>
                  Nova verificação
                </button>
              </div>
            </div>
          ) : (
            <div
              className="conflitos-decisao stack stack-4"
              data-testid="conflitos-decisao"
              data-demo-target="conflitos-decisao"
              style={{ marginTop: 'var(--sp-4, 1rem)', paddingTop: 'var(--sp-4, 1rem)', borderTop: '1px solid var(--line-1, #e2e8f0)' }}
            >
              <div>
                <h3 className="card-title" style={{ fontSize: 'var(--text-base, 1rem)' }}>Decisão do advogado</h3>
                <p className="card-subtitle">Registe a avaliação do conflito. A decisão é sempre do advogado.</p>
              </div>

              <div className="form-grid">
                <label className="field">
                  <span className="field-label">Decisão</span>
                  <select
                    className="field-select"
                    data-testid="conflitos-decisao-select"
                    value={decisao}
                    onChange={(e) => setDecisao(e.target.value)}
                  >
                    <option value="">Selecionar decisão...</option>
                    <option value="sem_conflito">Sem conflito</option>
                    <option value="conflito_potencial">Conflito potencial</option>
                    <option value="conflito">Conflito</option>
                  </select>
                </label>

                <label className="field">
                  <span className="field-label">Decidido por</span>
                  {temEquipa ? (
                    <select
                      className="field-select"
                      data-testid="conflitos-decidido-por"
                      value={decididoPor}
                      onChange={(e) => setDecididoPor(e.target.value)}
                    >
                      <option value="">Selecionar responsável...</option>
                      {pessoasNomes.map((nome) => (
                        <option key={nome} value={nome}>{nome}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="field-input"
                      type="text"
                      data-testid="conflitos-decidido-por"
                      placeholder="Nome do responsável"
                      value={decididoPor}
                      onChange={(e) => setDecididoPor(e.target.value)}
                    />
                  )}
                </label>
              </div>

              <label className="field">
                <span className="field-label">Notas (opcional)</span>
                <textarea
                  className="field-textarea"
                  rows={3}
                  data-testid="conflitos-notas"
                  placeholder="Fundamentação da decisão, ressalvas ou barreiras de informação aplicadas."
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                />
              </label>

              <div className="row row-2">
                <button
                  type="button"
                  className="btn btn-primary"
                  data-testid="conflitos-registar"
                  onClick={onRegistar}
                  disabled={!decisao || registando}
                >
                  <IconShieldAlert /> {registando ? 'A registar.' : 'Registar verificação'}
                </button>
              </div>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
