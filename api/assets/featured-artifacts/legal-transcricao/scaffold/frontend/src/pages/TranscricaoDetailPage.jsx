import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getShared, updateShared, createShared, useSharedCollection, formatDate, registarEvento } from '../shared.js';
import { useDemoResult } from '../demo.js';
import { Button, Badge, EmptyState, useToast } from '../components/ui.jsx';
import { IconMic, IconCheck, IconFileText } from '../components/Icons.jsx';

const PAPEIS = ['juiz', 'mandatário', 'testemunha', 'perito', 'arguido', 'outro'];

function fmtTs(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = (s % 60).toFixed(1).padStart(4, '0');
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${r}`;
}

/*
 * Editor de revisão: segmentos com oradores e tempos por palavra; clicar numa
 * palavra posiciona o áudio nesse instante; palavras corrigem-se inline; os
 * oradores rotulam-se (papel + nome). O excerto art. 640.º SÓ se gera depois de
 * o trabalho estar marcado "revisto" (§3.2.2 - regra testada): o bloco leva
 * ficheiro, tempos início/fim, data da audiência e a transcrição.
 */
export default function TranscricaoDetailPage() {
  const { id } = useParams();
  const toast = useToast();
  const navigate = useNavigate();
  const [row, setRow] = useState(null);
  const [aCorrer, setACorrer] = useState(false);
  const [selecionada, setSelecionada] = useState(null); // {seg, word}
  const [correcao, setCorrecao] = useState('');
  const [oradores, setOradores] = useState({}); // ORADOR_1 -> {papel, nome}
  const [selecionados, setSelecionados] = useState({}); // segIndex -> bool
  const [excertoGerado, setExcertoGerado] = useState('');
  const audioRef = useRef(null);
  const { items: excertos, refresh: refreshExcertos } = useSharedCollection('excertos');

  const carregar = async () => {
    const r = await getShared('transcricoes', id);
    setRow(r);
    if (r && r.oradores) setOradores(r.oradores);
  };
  useEffect(() => { carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  const meusExcertos = useMemo(
    () => excertos.filter((e) => e.transcricaoId === id),
    [excertos, id],
  );

  // Ponte de demonstração: sinaliza o passo annotate-result quando o bloco
  // 640.º fica visível (no-op fora de uma tour).
  useDemoResult('excerto-bloco', Boolean(excertoGerado), 'Excerto art. 640.º gerado');

  async function transcrever() {
    setACorrer(true);
    try {
      const api = window.__ekoa;
      if (!api || typeof api.fetch !== 'function') throw new Error('plataforma indisponível');
      const res = await api.fetch('/api/legal/transcricao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcricaoId: id, consentCloud: false }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.ok !== true) throw new Error((data && data.error) || 'falhou');
      toast(`Transcrição concluída (${data.segmentos} segmentos, motor ${data.engine}).`);
      await carregar();
    } catch (err) {
      toast(String((err && err.message) || 'A transcrição falhou.'));
      await carregar();
    } finally {
      setACorrer(false);
    }
  }

  function tocarDesde(sec) {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.max(0, sec - 0.2);
    a.play().catch(() => {});
  }

  async function corrigirPalavra() {
    if (!selecionada || !correcao.trim() || !row) return;
    const segmentos = (row.segmentos || []).map((s, si) => {
      if (si !== selecionada.seg) return s;
      const words = s.words.map((w, wi) => (wi === selecionada.word ? { ...w, w: correcao.trim() } : w));
      return { ...s, words, text: words.map((w) => w.w).join(' ') };
    });
    await updateShared('transcricoes', id, { segmentos, corrigidoEm: new Date().toISOString() });
    setSelecionada(null);
    setCorrecao('');
    await carregar();
    toast('Palavra corrigida.');
  }

  async function guardarOradores(prox) {
    setOradores(prox);
    await updateShared('transcricoes', id, { oradores: prox });
  }

  async function marcarRevisto() {
    await updateShared('transcricoes', id, { estado: 'revisto', revistoEm: new Date().toISOString() });
    await registarEvento({
      app: 'legal-transcricao', acao: 'marcar-revisto',
      fundamentacao: `Trabalho ${row?.titulo || id} revisto por humano - excertos ficam exportáveis.`,
      proveniencia: 'revisao-humana', demo: Boolean(row?.demo), extra: row?.demo ? { demoSet: row.demoSet } : {},
    });
    await carregar();
    toast('Trabalho marcado como revisto - os excertos ficam exportáveis.');
  }

  function rotulo(speaker) {
    const o = oradores[speaker] || {};
    const papel = o.papel || speaker;
    return o.nome ? `${papel} - ${o.nome}` : papel;
  }

  async function gerarExcerto() {
    if (!row || row.estado !== 'revisto') return; // gate §3.2.2 (também no disabled)
    const escolhidos = (row.segmentos || []).filter((_, i) => selecionados[i]);
    if (escolhidos.length === 0) { toast('Selecione pelo menos um segmento.'); return; }
    const inicio = Math.min(...escolhidos.map((s) => s.start));
    const fim = Math.max(...escolhidos.map((s) => s.end));
    const corpo = escolhidos
      .map((s) => `[${fmtTs(s.start)} - ${fmtTs(s.end)}] ${rotulo(s.speaker)}:\n"${s.text}"`)
      .join('\n\n');
    const bloco = [
      'Excerto para efeitos do art. 640.º, n.º 2, al. a) do CPC',
      `Ficheiro: ${row.ficheiroNome || row.titulo || 'gravação da audiência'}`,
      `Audiência de ${row.dataAudiencia ? formatDate(row.dataAudiencia) : 'data por indicar'}`,
      `Passagens: ${fmtTs(inicio)} a ${fmtTs(fim)}`,
      '',
      corpo,
    ].join('\n');
    const criado = await createShared('excertos', {
      transcricaoId: id,
      processoId: row.processoId || null,
      ficheiro: row.ficheiroNome || null,
      inicio, fim,
      dataAudiencia: row.dataAudiencia || null,
      texto: bloco,
      revisto: true,
      demo: Boolean(row.demo) || undefined,
      demoSet: row.demo ? row.demoSet : undefined,
    });
    if (criado && criado.id) {
      setExcertoGerado(bloco);
      await refreshExcertos();
      toast('Excerto gerado e arquivado.');
    } else {
      toast('Não foi possível guardar o excerto.');
    }
  }

  async function copiarExcerto() {
    try {
      await navigator.clipboard.writeText(excertoGerado);
      toast('Bloco copiado - pronto a colar na peça.');
    } catch {
      toast('Copie manualmente o bloco apresentado.');
    }
  }

  if (!row) {
    return <EmptyState title="Trabalho não encontrado" hint="Volte à lista de transcrições." />;
  }

  const revisto = row.estado === 'revisto';
  const temSegmentos = Array.isArray(row.segmentos) && row.segmentos.length > 0;
  const speakers = temSegmentos ? [...new Set(row.segmentos.map((s) => s.speaker))] : [];

  return (
    <div className="stack stack-6" data-demo-page="transcricao/trabalho" data-testid="transcricao-detalhe">
      <div className="page-header">
        <div>
          <h1 className="page-title">{row.titulo || 'Transcrição'}</h1>
          <p className="card-subtitle">
            {row.ficheiroNome || 'sem ficheiro'} {row.dataAudiencia ? `· audiência de ${formatDate(row.dataAudiencia)}` : ''}
            {row.segredoJustica ? ' · SEGREDO DE JUSTIÇA - acesso restrito' : ''}
          </p>
        </div>
        <div className="row row-2">
          <Badge tone={revisto ? 'ok' : 'neutral'} data-testid="transcricao-estado">
            {revisto ? 'Revisto' : (row.estado === 'transcrito' ? 'Transcrito - por rever' : row.estado)}
          </Badge>
          <Button onClick={() => navigate('/')} variant="secondary">Voltar</Button>
        </div>
      </div>

      {row.ficheiro && row.ficheiro.url ? (
        <audio ref={audioRef} controls src={row.ficheiro.url} style={{ width: '100%' }} data-testid="transcricao-audio" />
      ) : null}

      {!temSegmentos ? (
        <section className="card">
          <h2 className="card-title">Transcrever</h2>
          <p className="card-subtitle">
            Motor PT-PT com diarização e tempos por palavra. Antes da sessão de configuração corre o motor
            simulado determinístico; WhisperX (auto-alojado) e ElevenLabs (nuvem, com consentimento por processo)
            ativam-se quando aprovisionados. O custo é medido por minuto de áudio.
          </p>
          {row.estado === 'erro' ? <p className="text-small" style={{ color: 'var(--danger)' }}>{row.erro}</p> : null}
          <Button data-testid="transcricao-transcrever" data-demo-target="transcricao-transcrever" disabled={aCorrer} onClick={transcrever}>
            <IconMic /> {aCorrer ? `A transcrever… ${row.percent ? `${row.percent}%` : ''}` : 'Iniciar transcrição'}
          </Button>
        </section>
      ) : (
        <>
          <section className="card" data-testid="oradores-card">
            <h2 className="card-title">Oradores</h2>
            <p className="card-subtitle">Rotule cada orador detetado (papel + nome) - os rótulos entram nos excertos.</p>
            <div className="row row-3" style={{ flexWrap: 'wrap', gap: 'var(--sp-3, 0.75rem)' }}>
              {speakers.map((sp) => (
                <div key={sp} className="stack stack-1" data-testid={`orador-${sp}`}>
                  <span className="text-xs text-subtle">{sp}</span>
                  <div className="row row-2">
                    <select
                      data-testid={`orador-papel-${sp}`}
                      data-demo-target={`orador-papel-${sp}`}
                      value={(oradores[sp] && oradores[sp].papel) || ''}
                      onChange={(e) => guardarOradores({ ...oradores, [sp]: { ...(oradores[sp] || {}), papel: e.target.value } })}
                    >
                      <option value="">papel…</option>
                      {PAPEIS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <input
                      data-testid={`orador-nome-${sp}`}
                      placeholder="nome"
                      value={(oradores[sp] && oradores[sp].nome) || ''}
                      onChange={(e) => guardarOradores({ ...oradores, [sp]: { ...(oradores[sp] || {}), nome: e.target.value } })}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="card" data-testid="editor-card" data-demo-target="transcricao-explicacao">
            <div className="row row-2" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 className="card-title" style={{ margin: 0 }}>Revisão</h2>
                <p className="card-subtitle" style={{ margin: 0 }}>
                  Clique numa palavra para ouvir esse instante e corrigi-la. Marque o trabalho como revisto quando terminar.
                </p>
              </div>
              {!revisto ? (
                <Button data-testid="marcar-revisto" data-demo-target="marcar-revisto" onClick={marcarRevisto}>
                  <IconCheck /> Marcar como revisto
                </Button>
              ) : null}
            </div>

            {selecionada ? (
              <div className="row row-2" style={{ alignItems: 'center', padding: 'var(--sp-2) 0' }}>
                <span className="text-small">Corrigir palavra:</span>
                <input data-testid="correcao-input" value={correcao} onChange={(e) => setCorrecao(e.target.value)} />
                <Button size="sm" data-testid="correcao-aplicar" onClick={corrigirPalavra}>Aplicar</Button>
                <Button size="sm" variant="secondary" onClick={() => { setSelecionada(null); setCorrecao(''); }}>Cancelar</Button>
              </div>
            ) : null}

            <div className="stack stack-3" data-testid="segmentos">
              {row.segmentos.map((s, si) => (
                <div key={si} className="row row-3" style={{ alignItems: 'flex-start', gap: 'var(--sp-3, 0.75rem)' }} data-testid="segmento-row">
                  <input
                    type="checkbox"
                    aria-label={`Selecionar segmento ${si + 1} para excerto`}
                    data-testid={`seg-check-${si}`}
                    data-demo-target={`seg-check-${si}`}
                    checked={Boolean(selecionados[si])}
                    onChange={(e) => setSelecionados({ ...selecionados, [si]: e.target.checked })}
                    style={{ marginTop: 4 }}
                  />
                  <div className="stack stack-1" style={{ flex: 1 }}>
                    <span className="text-xs text-subtle numeric">
                      [{fmtTs(s.start)} - {fmtTs(s.end)}] · {rotulo(s.speaker)}
                    </span>
                    <p style={{ margin: 0, lineHeight: 1.8 }}>
                      {s.words.map((w, wi) => (
                        <span
                          key={wi}
                          role="button"
                          tabIndex={0}
                          data-testid={si === 0 && wi === 0 ? 'primeira-palavra' : undefined}
                          data-demo-target={si === 0 && wi === 0 ? 'primeira-palavra' : undefined}
                          onClick={() => { tocarDesde(w.start); setSelecionada({ seg: si, word: wi }); setCorrecao(w.w); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') { tocarDesde(w.start); setSelecionada({ seg: si, word: wi }); setCorrecao(w.w); } }}
                          style={{
                            cursor: 'pointer',
                            padding: '0 2px',
                            borderRadius: 3,
                            background: selecionada && selecionada.seg === si && selecionada.word === wi ? 'var(--accent-weak)' : 'transparent',
                          }}
                        >
                          {w.w}{' '}
                        </span>
                      ))}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="card" data-testid="excerto-card">
            <h2 className="card-title">Excerto para recurso (art. 640.º CPC)</h2>
            <p className="card-subtitle">
              Selecione os segmentos acima e gere o bloco pronto a colar - ficheiro, tempos de início e fim,
              data da audiência e transcrição. {revisto ? '' : 'Disponível apenas depois de o trabalho estar marcado como revisto.'}
            </p>
            <div className="row row-2">
              <Button
                data-testid="gerar-excerto"
                data-demo-target="gerar-excerto"
                disabled={!revisto}
                title={revisto ? '' : 'O trabalho tem de estar revisto antes de exportar excertos (art. 640.º).'}
                onClick={gerarExcerto}
              >
                <IconFileText /> Gerar excerto
              </Button>
              {excertoGerado ? (
                <Button variant="secondary" data-testid="copiar-excerto" onClick={copiarExcerto}>Copiar bloco</Button>
              ) : null}
            </div>
            {excertoGerado ? (
              <pre data-testid="excerto-bloco" data-demo-target="excerto-bloco" style={{ whiteSpace: 'pre-wrap', background: 'var(--surface-2)', padding: 'var(--sp-3)', borderRadius: 'var(--r-2)', fontSize: '0.8125rem' }}>
                {excertoGerado}
              </pre>
            ) : null}
            {meusExcertos.length > 0 ? (
              <div className="stack stack-2">
                <span className="text-xs text-subtle">Excertos arquivados: {meusExcertos.length}</span>
              </div>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
