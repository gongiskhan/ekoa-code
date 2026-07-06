import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  getShared, updateShared, createShared, registarEvento, appHref, formatDateTime,
} from '../shared.js';
import { Button, Badge, Modal, Field, Textarea, ConfirmDialog, toast } from '../components/ui.jsx';
import { useDemoResult } from '../demo.js';
import {
  IconSignature, IconShieldCheck, IconCheck, IconAlertTriangle, IconExternalLink, IconBook, IconDownload, IconClock,
} from '../components/Icons.jsx';
import {
  normalizarEnvelope, transitar, registarAssinatura, registarRecusa, anular,
  proximoSignatario, gerarCertificado,
} from '../engine/assinatura.mjs';
import { providerDe, TIPO_LABEL } from '../providers.js';
import { ESTADO_LABEL, ESTADO_TONE, SIG_ESTADO_LABEL, SIG_ESTADO_TONE, agoraISO } from '../model.js';

/* Passos do fluxo CMD orquestrado - a Ekoa prepara e arquiva; o advogado assina na app oficial. */
const CMD_PASSOS = [
  { n: 1, titulo: 'Preparar o documento final', texto: 'Confirme o PDF a assinar. É este o documento que será submetido à assinatura qualificada.' },
  { n: 2, titulo: 'Assinar na app Autenticação.Gov', texto: 'Abra a aplicação oficial Autenticação.Gov (autenticacao.gov.pt) e assine o PDF com a Chave Móvel Digital.' },
  { n: 3, titulo: 'Carregar o PDF assinado', texto: 'Volte à Ekoa e carregue o PDF já assinado, para arquivo probatório.' },
  { n: 4, titulo: 'Verificação e arquivo', texto: 'A Ekoa verifica a presença da assinatura e prepara o certificado de auditoria para o dossiê.' },
];

/* Linha do tempo da proveniência a partir do trilho do envelope. */
function ProvenanceTimeline({ trilho }) {
  const eventos = Array.isArray(trilho) ? trilho : [];
  if (eventos.length === 0) return null;
  return (
    <ul className="dossie-timeline" data-testid="assinatura-trilho" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {eventos.map((t, i) => (
        <li key={i} className="dossie-timeline-item">
          <div className="dossie-timeline-body">
            <span className="dossie-timeline-tipo">{t.acao}</span>
            <span className="dossie-timeline-titulo">
              {t.signatario ? `${t.signatario}${t.metodo ? ` · ${t.metodo}` : ''}` : (t.detalhe || t.para || '')}
            </span>
            {t.proveniencia ? <span className="dossie-timeline-desc">Proveniência: {t.proveniencia}</span> : null}
            {t.motivo ? <span className="dossie-timeline-desc">Motivo: {t.motivo}</span> : null}
            <span className="dossie-timeline-date">{formatDateTime(t.quando)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function EnvelopeDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [env, setEnv] = useState(null);
  const [arquivo, setArquivo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  const [aProcessar, setAProcessar] = useState(false);

  // Estado do fluxo CMD orquestrado (por signatário corrente).
  const [oaAtestada, setOaAtestada] = useState(false);
  const [passosFeitos, setPassosFeitos] = useState(0);
  const [recusaAberta, setRecusaAberta] = useState(false);
  const [motivoRecusa, setMotivoRecusa] = useState('');
  const [anularAberto, setAnularAberto] = useState(false);

  async function load() {
    setLoading(true);
    setErro(null);
    try {
      const row = await getShared('envelopes', id);
      if (!row) { setEnv(null); setErro('Envelope não encontrado.'); return; }
      setEnv(normalizarEnvelope(row));
      setArquivo(row.arquivo || null);
    } catch (e) {
      setErro(e && e.message ? e.message : 'Não foi possível abrir o envelope.');
      setEnv(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  const proximo = useMemo(() => (env && env.estado === 'em_assinatura' ? proximoSignatario(env) : null), [env]);
  const certificado = useMemo(() => (env ? gerarCertificado(env, { emitidoEm: env.atualizadoEm || agoraISO() }) : null), [env]);

  // Sinaliza a ponte de demos quando o certificado de um envelope concluído está visível.
  useDemoResult('assinatura-explicacao', !!env && env.estado === 'concluido');
  useDemoResult('assinatura-arquivado', !!arquivo);

  // Reinicia o fluxo CMD quando muda o signatário corrente.
  useEffect(() => { setOaAtestada(false); setPassosFeitos(0); }, [proximo && proximo.index]);

  async function persistir(novo) {
    await updateShared('envelopes', id, {
      estado: novo.estado,
      signatarios: novo.signatarios,
      documentos: novo.documentos,
      trilho: novo.trilho,
      metodoPadrao: novo.metodoPadrao,
      atualizadoEm: novo.atualizadoEm,
    });
    setEnv({ ...novo, id });
  }

  async function fazer(fn, evento) {
    if (aProcessar) return;
    setAProcessar(true);
    setErro(null);
    try {
      const novo = fn();
      await persistir(novo);
      if (evento) await registarEvento({ app: 'legal-assinatura', proveniencia: 'manual', ...evento, extra: { envelopeId: id, ...(evento.extra || {}) } });
    } catch (e) {
      setErro(e && e.message ? e.message : 'Ação não permitida.');
    } finally {
      setAProcessar(false);
    }
  }

  const marcarPronto = () => fazer(
    () => transitar(env, 'pronto', { quando: agoraISO() }),
    { acao: 'envelope:pronto', fundamentacao: 'Envelope marcado como pronto a assinar.' },
  );
  const iniciar = () => fazer(
    () => transitar(env, 'em_assinatura', { quando: agoraISO() }),
    { acao: 'envelope:iniciado', fundamentacao: 'Assinatura iniciada.' },
  );
  const reabrir = () => fazer(
    () => transitar(env, 'rascunho', { quando: agoraISO() }),
    { acao: 'envelope:reaberto', fundamentacao: 'Envelope reaberto para edição.' },
  );

  async function confirmarAnular() {
    setAnularAberto(false);
    await fazer(
      () => anular(env, { quando: agoraISO(), motivo: 'Anulado pelo utilizador.' }),
      { acao: 'envelope:anulado', fundamentacao: 'Envelope anulado.' },
    );
  }

  // Assinatura simulada do signatário corrente.
  async function assinarSimulado() {
    if (!proximo) return;
    await fazer(
      () => registarAssinatura(env, { signatarioIndex: proximo.index, quando: agoraISO(), proveniencia: 'simulada' }),
      { acao: 'assinatura:simulada', proveniencia: 'simulada', fundamentacao: `Assinatura simulada de ${proximo.signatario.nome}.`, extra: { signatario: proximo.signatario.nome } },
    );
  }

  // Assinatura via Adobe (avançada): atestação manual da conclusão externa.
  async function confirmarAdobe() {
    if (!proximo) return;
    await fazer(
      () => registarAssinatura(env, { signatarioIndex: proximo.index, quando: agoraISO(), proveniencia: 'adobe-sign' }),
      { acao: 'assinatura:adobe', proveniencia: 'adobe-sign', fundamentacao: `Assinatura Adobe Sign confirmada para ${proximo.signatario.nome}.`, extra: { signatario: proximo.signatario.nome } },
    );
  }

  // Passo do fluxo CMD orquestrado - regista proveniência por passo; o 4.º assina.
  async function concluirPasso(n) {
    if (!proximo) return;
    if (!oaAtestada) { setErro('Ateste primeiro que a inscrição na Ordem dos Advogados está em vigor.'); return; }
    await registarEvento({
      app: 'legal-assinatura',
      acao: `cmd-orquestrado:passo-${n}`,
      fundamentacao: CMD_PASSOS[n - 1].titulo,
      proveniencia: 'manual-assistido',
      extra: { envelopeId: id, signatario: proximo.signatario.nome },
    });
    if (n < 4) {
      setPassosFeitos(n);
      return;
    }
    // Passo 4 -> regista a assinatura qualificada (com a atestação OA).
    await fazer(
      () => registarAssinatura(env, { signatarioIndex: proximo.index, quando: agoraISO(), atestacaoOA: true, proveniencia: 'manual-assistido' }),
      { acao: 'assinatura:cmd-orquestrado', proveniencia: 'manual-assistido', fundamentacao: `Assinatura qualificada orquestrada de ${proximo.signatario.nome}, inscrição OA atestada.`, extra: { signatario: proximo.signatario.nome } },
    );
    setPassosFeitos(4);
  }

  async function confirmarRecusa() {
    if (!proximo) return;
    const motivo = motivoRecusa.trim();
    setRecusaAberta(false);
    setMotivoRecusa('');
    await fazer(
      () => registarRecusa(env, { signatarioIndex: proximo.index, quando: agoraISO(), motivo }),
      { acao: 'assinatura:recusa', fundamentacao: `Recusa de ${proximo.signatario.nome}.`, extra: { signatario: proximo.signatario.nome, motivo } },
    );
  }

  // Arquivar no dossiê: cria a linha `assinaturas` e a linha `documentos`
  // (certificado + referência ao documento assinado) ligadas ao processo.
  async function arquivar() {
    if (aProcessar || arquivo) return;
    setAProcessar(true);
    setErro(null);
    try {
      const cert = gerarCertificado(env, { emitidoEm: agoraISO() });
      const docPrincipal = (env.documentos && env.documentos[0]) || null;
      const ass = await createShared('assinaturas', {
        envelopeId: id,
        processoId: env.processoId || undefined,
        titulo: env.titulo,
        estado: env.estado,
        metodoPadrao: env.metodoPadrao,
        signatarios: env.signatarios,
        certificado: cert,
        origem: 'legal-assinatura',
        data: agoraISO(),
      });
      const temFicheiro = !!(docPrincipal && docPrincipal.url);
      const docRow = await createShared('documentos', {
        nome: `Certificado de assinatura - ${env.titulo}`,
        tipo: temFicheiro ? 'pdf' : 'certificado',
        processoId: env.processoId || undefined,
        origem: 'legal-assinatura',
        data: agoraISO(),
        envelopeId: id,
        certificado: cert,
        ficheiro: temFicheiro ? { fileId: docPrincipal.fileId, url: docPrincipal.url, mime: docPrincipal.mime || 'application/pdf' } : undefined,
        versao: 1,
      });
      const arq = { assinaturaId: ass && ass.id, documentoId: docRow && docRow.id, arquivadoEm: agoraISO() };
      await updateShared('envelopes', id, { arquivo: arq });
      setArquivo(arq);
      await registarEvento({
        app: 'legal-assinatura',
        acao: 'envelope:arquivado',
        fundamentacao: `Certificado de auditoria arquivado no dossiê${env.processoId ? ' do processo' : ''}.`,
        proveniencia: 'sistema',
        extra: { envelopeId: id, documentoId: docRow && docRow.id },
      });
      toast('Certificado arquivado no dossiê.', { tone: 'ok' });
    } catch (e) {
      setErro(e && e.message ? e.message : 'Não foi possível arquivar no dossiê.');
    } finally {
      setAProcessar(false);
    }
  }

  function descarregarCertificado() {
    try {
      const blob = new Blob([JSON.stringify(certificado, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `certificado-${id}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { /* não fatal */ }
  }

  if (loading) {
    return <div className="loading" data-testid="assinatura-detalhe-loading"><span className="spinner" aria-hidden="true" /><span>A abrir o envelope.</span></div>;
  }
  if (!env) {
    return (
      <div data-testid="assinatura-detalhe-erro">
        <p className="resultado-erro">{erro || 'Envelope não encontrado.'}</p>
        <Button variant="secondary" onClick={() => navigate('/')}>Voltar aos envelopes</Button>
      </div>
    );
  }

  const provMetodo = proximo ? providerDe(proximo.signatario.metodo) : null;
  const ehTerminal = ['concluido', 'recusado', 'anulado'].includes(env.estado);

  return (
    <div data-demo-page="assinatura/envelope" data-testid="assinatura-detalhe-page">
      <div className="page-header">
        <div>
          <div className="row row-2" style={{ alignItems: 'center' }}>
            <h1 className="page-title" style={{ margin: 0 }}>{env.titulo}</h1>
            <Badge tone={ESTADO_TONE[env.estado] || 'neutral'} data-testid="assinatura-detalhe-estado">{ESTADO_LABEL[env.estado] || env.estado}</Badge>
          </div>
          <p className="page-subtitle" style={{ marginTop: 'var(--sp-2, 0.5rem)' }}>
            {env.documentos.length} documento(s) · {env.signatarios.length} signatário(s) · método {providerDe(env.metodoPadrao).nome}
            {env.processoId ? (
              <> · <Link to={appHref('legal-dossie', `processo/${env.processoId}`)} className="stat-link">Ver processo <IconExternalLink /></Link></>
            ) : null}
          </p>
        </div>
        <div className="page-actions">
          <Button variant="ghost" onClick={() => navigate('/')}>Voltar</Button>
        </div>
      </div>

      {erro ? <p className="resultado-erro" data-testid="assinatura-detalhe-erro-msg">{erro}</p> : null}

      {/* Ações de estado */}
      <section className="card" aria-label="Ações">
        <div className="row row-wrap" style={{ gap: 'var(--sp-2, 0.5rem)' }}>
          {env.estado === 'rascunho' ? (
            <Button data-testid="assinatura-marcar-pronto" data-demo-target="assinatura-marcar-pronto" onClick={marcarPronto} disabled={aProcessar}>
              <IconCheck /> Marcar como pronto
            </Button>
          ) : null}
          {env.estado === 'pronto' ? (
            <>
              <Button data-testid="assinatura-iniciar" data-demo-target="assinatura-iniciar" onClick={iniciar} disabled={aProcessar}>
                <IconSignature /> Iniciar assinatura
              </Button>
              <Button variant="ghost" data-testid="assinatura-reabrir" onClick={reabrir} disabled={aProcessar}>Reabrir rascunho</Button>
            </>
          ) : null}
          {!ehTerminal ? (
            <Button variant="ghost" data-testid="assinatura-anular" onClick={() => setAnularAberto(true)} disabled={aProcessar}>Anular envelope</Button>
          ) : null}
        </div>
      </section>

      {/* Signatários */}
      <section className="card" style={{ marginTop: 'var(--sp-4, 1rem)' }} aria-label="Signatários">
        <h2 className="card-title">Signatários</h2>
        <ul className="stack stack-2" data-testid="assinatura-detalhe-sigs" style={{ listStyle: 'none', margin: 'var(--sp-3, 0.75rem) 0 0', padding: 0 }}>
          {env.signatarios.map((s, i) => {
            const p = providerDe(s.metodo);
            const ehProximo = proximo && proximo.index === i;
            return (
              <li
                key={i}
                className="passo-item"
                data-testid={`assinatura-detalhe-sig-${i}`}
                style={{
                  border: `1px solid ${ehProximo ? 'var(--accent-strong, #16304c)' : 'var(--line-1, #e2e8f0)'}`,
                  borderRadius: 'var(--r-2, 0.5rem)',
                  padding: 'var(--sp-3, 0.75rem) var(--sp-4, 1rem)',
                }}
              >
                <div className="row-space-between" style={{ alignItems: 'center', gap: 'var(--sp-3, 0.75rem)' }}>
                  <div className="stack stack-1" style={{ minWidth: 0 }}>
                    <div className="row row-2" style={{ alignItems: 'center' }}>
                      <Badge tone="neutral">Ordem {s.ordem}</Badge>
                      <span className="text-strong">{s.nome}</span>
                      <span className="text-subtle text-xs">{s.papel}</span>
                    </div>
                    <span className="text-subtle text-xs">
                      {p.nome} · {TIPO_LABEL[p.tipo] || p.tipo}
                      {s.assinadoEm ? ` · assinado ${formatDateTime(s.assinadoEm)}` : ''}
                      {s.proveniencia ? ` · proveniência ${s.proveniencia}` : ''}
                    </span>
                  </div>
                  <Badge tone={SIG_ESTADO_TONE[s.estado] || 'neutral'} data-testid={`assinatura-sig-estado-${i}`}>
                    {SIG_ESTADO_LABEL[s.estado] || s.estado}
                  </Badge>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Bloco de assinatura do signatário corrente */}
      {env.estado === 'em_assinatura' && proximo ? (
        <section className="card" style={{ marginTop: 'var(--sp-4, 1rem)' }} aria-label="Assinar" data-testid="assinatura-bloco-assinar">
          <h2 className="card-title">A assinar: {proximo.signatario.nome}</h2>
          <p className="card-subtitle">{provMetodo.nome} · {provMetodo.resumo}</p>

          {/* Simulado */}
          {proximo.signatario.metodo === 'simulado' ? (
            <div className="row row-wrap" style={{ gap: 'var(--sp-2, 0.5rem)', marginTop: 'var(--sp-3, 0.75rem)' }}>
              <Button data-testid="assinatura-assinar" data-demo-target="assinatura-assinar" onClick={assinarSimulado} disabled={aProcessar}>
                <IconSignature /> Assinar (simulado)
              </Button>
              <Button variant="ghost" data-testid="assinatura-recusar" onClick={() => setRecusaAberta(true)} disabled={aProcessar}>Recusar</Button>
            </div>
          ) : null}

          {/* Adobe (avançada) */}
          {proximo.signatario.metodo === 'adobe' ? (
            <div className="stack stack-3" style={{ marginTop: 'var(--sp-3, 0.75rem)' }}>
              <p className="text-subtle text-xs">
                A assinatura Adobe Sign corre pela integração da plataforma (assinatura avançada, não qualificada). Depois de
                assinado no Adobe Sign, confirme aqui a receção para arquivo.
              </p>
              <div className="row row-wrap" style={{ gap: 'var(--sp-2, 0.5rem)' }}>
                <Button data-testid="assinatura-adobe-confirmar" onClick={confirmarAdobe} disabled={aProcessar}>
                  <IconCheck /> Confirmar assinatura (Adobe)
                </Button>
                <Button variant="ghost" data-testid="assinatura-recusar" onClick={() => setRecusaAberta(true)} disabled={aProcessar}>Recusar</Button>
              </div>
            </div>
          ) : null}

          {/* CMD orquestrado / Cartão de Cidadão */}
          {(proximo.signatario.metodo === 'cmd-orquestrado' || proximo.signatario.metodo === 'cc-middleware') ? (
            <div className="stack stack-3" style={{ marginTop: 'var(--sp-3, 0.75rem) ' }} data-testid="assinatura-cmd-fluxo">
              <label className="checkbox-field" style={{ display: 'flex', gap: 'var(--sp-2, 0.5rem)', alignItems: 'flex-start' }}>
                <input
                  type="checkbox"
                  data-testid="assinatura-oa"
                  checked={oaAtestada}
                  onChange={(e) => { setOaAtestada(e.target.checked); setErro(null); }}
                />
                <span className="text-small">
                  Atesto que a inscrição na Ordem dos Advogados do signatário se encontra em vigor. Sem esta atestação
                  o fluxo qualificado não avança.
                </span>
              </label>

              <ol className="stack stack-2" data-testid="assinatura-passos" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {CMD_PASSOS.map((passo) => {
                  const feito = passosFeitos >= passo.n;
                  const ativo = oaAtestada && passosFeitos === passo.n - 1;
                  return (
                    <li
                      key={passo.n}
                      className="passo-item"
                      data-testid={`assinatura-passo-item-${passo.n}`}
                      style={{
                        border: '1px solid var(--line-1, #e2e8f0)',
                        borderRadius: 'var(--r-2, 0.5rem)',
                        padding: 'var(--sp-3, 0.75rem) var(--sp-4, 1rem)',
                        opacity: feito || ativo ? 1 : 0.6,
                      }}
                    >
                      <div className="row-space-between" style={{ alignItems: 'center', gap: 'var(--sp-3, 0.75rem)' }}>
                        <div className="stack stack-1" style={{ minWidth: 0 }}>
                          <div className="row row-2" style={{ alignItems: 'center' }}>
                            <Badge tone={feito ? 'ok' : 'neutral'}>Passo {passo.n}</Badge>
                            <span className="text-strong">{passo.titulo}</span>
                          </div>
                          <span className="text-subtle text-xs">{passo.texto}</span>
                          {passo.n === 2 ? (
                            <a href="https://www.autenticacao.gov.pt" target="_blank" rel="noopener noreferrer" className="stat-link text-xs" data-testid="assinatura-link-autgov">
                              Abrir Autenticação.Gov <IconExternalLink />
                            </a>
                          ) : null}
                        </div>
                        {feito ? (
                          <span aria-hidden="true" style={{ color: 'var(--ok, #16a34a)', display: 'inline-flex' }}><IconCheck /></span>
                        ) : (
                          <Button
                            size="sm"
                            data-testid={`assinatura-passo-${passo.n}`}
                            onClick={() => concluirPasso(passo.n)}
                            disabled={!ativo || aProcessar}
                          >
                            {passo.n === 4 ? 'Concluir e assinar' : 'Concluir passo'}
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
              <Button variant="ghost" data-testid="assinatura-recusar" onClick={() => setRecusaAberta(true)} disabled={aProcessar}>Recusar</Button>
            </div>
          ) : null}

          {/* Métodos-stub, caso surjam num envelope importado */}
          {provMetodo.fluxo === 'stub' ? (
            <p className="resultado-erro" style={{ marginTop: 'var(--sp-3, 0.75rem)' }}>
              {provMetodo.motivo || 'Este método ainda não está disponível.'}
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Certificado de auditoria + arquivo */}
      {ehTerminal ? (
        <section className="resultado-panel" style={{ marginTop: 'var(--sp-4, 1rem)' }} data-testid="assinatura-certificado" data-demo-target="assinatura-explicacao" aria-label="Certificado de auditoria">
          <div className="row-space-between" style={{ alignItems: 'center', gap: 'var(--sp-3, 0.75rem)' }}>
            <div className="row row-2" style={{ alignItems: 'center' }}>
              <span aria-hidden="true" style={{ color: 'var(--accent-strong, #16304c)', display: 'inline-flex' }}><IconShieldCheck /></span>
              <h2 className="card-title" style={{ margin: 0 }}>Certificado de auditoria</h2>
            </div>
            <Button variant="ghost" size="sm" data-testid="assinatura-descarregar-cert" onClick={descarregarCertificado}><IconDownload /> Descarregar (JSON)</Button>
          </div>

          {/* Documentos + impressões digitais */}
          <h3 className="text-strong" style={{ margin: 'var(--sp-3, 0.75rem) 0 var(--sp-2, 0.5rem)' }}>Documentos</h3>
          <ul className="documentos-list" data-testid="assinatura-cert-docs" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {certificado.documentos.map((d, i) => (
              <li key={i} className="stack stack-1" style={{ padding: 'var(--sp-2, 0.5rem) 0', borderBottom: '1px solid var(--line-1, #e2e8f0)' }}>
                <span className="text-strong">{d.nome}</span>
                <span className="text-subtle text-xs" style={{ wordBreak: 'break-all' }}>
                  {d.hash ? `${d.algoritmo}: ${d.hash}` : 'sem impressão digital'}
                </span>
              </li>
            ))}
          </ul>

          {/* Signatários do certificado */}
          <h3 className="text-strong" style={{ margin: 'var(--sp-3, 0.75rem) 0 var(--sp-2, 0.5rem)' }}>Signatários</h3>
          <ul className="stack stack-1" data-testid="assinatura-cert-sigs" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {certificado.signatarios.map((s, i) => (
              <li key={i} className="row-space-between" style={{ padding: 'var(--sp-1, 0.25rem) 0' }}>
                <span className="text-small">{s.nome} · {s.papel} · {s.metodo}</span>
                <span className="text-subtle text-xs">
                  {SIG_ESTADO_LABEL[s.estado] || s.estado}{s.assinadoEm ? ` · ${formatDateTime(s.assinadoEm)}` : ''}{s.proveniencia ? ` · ${s.proveniencia}` : ''}
                </span>
              </li>
            ))}
          </ul>

          {/* Trilho de proveniência */}
          <h3 className="text-strong" style={{ margin: 'var(--sp-3, 0.75rem) 0 var(--sp-2, 0.5rem)' }}>Proveniência</h3>
          <ProvenanceTimeline trilho={env.trilho} />

          {/* Mostra o trabalho */}
          <ul className="passos-list" data-testid="assinatura-cert-passos" style={{ listStyle: 'none', margin: 'var(--sp-3, 0.75rem) 0 0', padding: 0 }}>
            {certificado.showWork.passos.map((p, i) => (
              <li key={i} className="passo-item text-small" style={{ padding: 'var(--sp-1, 0.25rem) 0' }}>{p}</li>
            ))}
          </ul>

          <p className="text-subtle text-xs" data-testid="assinatura-cert-aviso" style={{ marginTop: 'var(--sp-3, 0.75rem)' }}>{certificado.aviso}</p>

          {/* Arquivo no dossiê (só faz sentido em concluído) */}
          {env.estado === 'concluido' ? (
            <div className="row row-wrap" style={{ gap: 'var(--sp-2, 0.5rem)', marginTop: 'var(--sp-4, 1rem)', paddingTop: 'var(--sp-3, 0.75rem)', borderTop: '1px solid var(--line-1, #e2e8f0)' }}>
              {arquivo ? (
                <div className="stack stack-1" data-testid="assinatura-arquivado" data-demo-target="assinatura-arquivado">
                  <div className="row row-2" style={{ alignItems: 'center' }}>
                    <span aria-hidden="true" style={{ color: 'var(--ok, #16a34a)', display: 'inline-flex' }}><IconCheck /></span>
                    <span className="text-strong">Arquivado no dossiê.</span>
                  </div>
                  <span className="text-subtle text-xs">Certificado e referência do documento guardados em {formatDateTime(arquivo.arquivadoEm)}.</span>
                  {env.processoId ? (
                    <Link to={appHref('legal-dossie', `processo/${env.processoId}`)} className="btn btn-secondary btn-sm" data-testid="assinatura-ver-dossie">
                      <IconBook /> Abrir no dossiê
                    </Link>
                  ) : null}
                </div>
              ) : (
                <Button data-testid="assinatura-arquivar" data-demo-target="assinatura-arquivar" onClick={arquivar} disabled={aProcessar}>
                  <IconBook /> Arquivar no dossiê
                </Button>
              )}
            </div>
          ) : null}
        </section>
      ) : (
        /* Proveniência visível também antes do fim (rascunho/pronto/em_assinatura). */
        <section className="card" style={{ marginTop: 'var(--sp-4, 1rem)' }} aria-label="Proveniência">
          <div className="row row-2" style={{ alignItems: 'center' }}>
            <span aria-hidden="true" style={{ display: 'inline-flex', color: 'var(--accent-strong, #16304c)' }}><IconClock /></span>
            <h2 className="card-title" style={{ margin: 0 }}>Proveniência</h2>
          </div>
          <div style={{ marginTop: 'var(--sp-3, 0.75rem)' }}>
            <ProvenanceTimeline trilho={env.trilho} />
          </div>
        </section>
      )}

      {/* Modais */}
      <Modal
        open={recusaAberta}
        title="Recusar assinatura"
        onClose={() => setRecusaAberta(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setRecusaAberta(false)}>Cancelar</Button>
            <Button variant="danger" data-testid="assinatura-recusar-confirmar" onClick={confirmarRecusa}>Confirmar recusa</Button>
          </>
        }
      >
        <Field label="Motivo (opcional)">
          <Textarea rows={3} value={motivoRecusa} onChange={(e) => setMotivoRecusa(e.target.value)} placeholder="Motivo da recusa" data-testid="assinatura-recusar-motivo" />
        </Field>
      </Modal>

      <ConfirmDialog
        open={anularAberto}
        title="Anular envelope"
        message="Anular o envelope? Esta ação é definitiva e não pode ser revertida."
        confirmLabel="Anular"
        danger
        onConfirm={confirmarAnular}
        onCancel={() => setAnularAberto(false)}
      />
    </div>
  );
}
