import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSharedCollection, createShared, updateShared, formatDate } from '../shared.js';
import { isDemoActive } from '../demo.js';
import { Button, Badge, EmptyState, useToast } from '../components/ui.jsx';
import { IconMic, IconUpload, IconChevronRight } from '../components/Icons.jsx';

const ESTADO_TONE = {
  por_transcrever: 'neutral',
  a_transcrever: 'info',
  transcrito: 'info',
  revisto: 'ok',
  erro: 'alta',
};

const ESTADO_LABEL = {
  por_transcrever: 'Por transcrever',
  a_transcrever: 'A transcrever',
  transcrito: 'Transcrito - por rever',
  revisto: 'Revisto',
  erro: 'Erro',
};

/*
 * Lista de trabalhos de transcrição + novo trabalho por carregamento de
 * gravação (MP3/WAV genérico - os formatos Habilus validam-se com amostras
 * reais na sessão de configuração). RGPD: aviso permanente de acesso restrito.
 */
export default function TranscricoesPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const { items: transcricoes, refresh } = useSharedCollection('transcricoes');
  const { items: processos } = useSharedCollection('processos');
  const [aCarregar, setACarregar] = useState(false);
  const [processoId, setProcessoId] = useState('');
  const [dataAudiencia, setDataAudiencia] = useState('');
  const [segredo, setSegredo] = useState(false);

  const ordenadas = [...transcricoes].sort(
    (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
  );

  // REPETIBILIDADE da demonstração: quando uma tour está activa, o trabalho
  // demo-marcado volta ao estado inicial (por_transcrever) para que a história
  // se possa viver do zero em cada execução. Só toca registos demo-marcados.
  // O handshake da ponte completa DEPOIS do mount - sondar brevemente.
  const demoReposto = useRef(false);
  useEffect(() => {
    let tentativas = 0;
    const timer = setInterval(async () => {
      tentativas += 1;
      if (demoReposto.current || tentativas > 12) { clearInterval(timer); return; }
      if (!isDemoActive()) return;
      demoReposto.current = true;
      clearInterval(timer);
      try {
        const { listShared } = await import('../shared.js');
        const rows = await listShared('transcricoes');
        const alvo = rows.filter((t) => t && t.demo === true && t.estado && t.estado !== 'por_transcrever');
        await Promise.all(alvo.map((t) => updateShared('transcricoes', t.id, {
          estado: 'por_transcrever', percent: 0, segmentos: null, oradores: null, revistoEm: null, engine: null,
        })));
        if (alvo.length > 0) await refresh();
      } catch { /* não fatal - a tour continua sobre o estado existente */ }
    }, 350);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onFicheiro(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    if (!/\.(mp3|wav|m4a|ogg)$/i.test(file.name)) {
      toast('Formato não suportado - carregue MP3, WAV, M4A ou OGG.');
      return;
    }
    setACarregar(true);
    try {
      let ficheiro = null;
      if (window.__ekoa && typeof window.__ekoa.uploadFile === 'function') {
        ficheiro = await window.__ekoa.uploadFile(file);
      }
      const row = await createShared('transcricoes', {
        titulo: file.name.replace(/\.[a-z0-9]+$/i, ''),
        ficheiroNome: file.name,
        ficheiro: ficheiro ? { fileId: ficheiro.id, url: ficheiro.url, size: ficheiro.size, type: ficheiro.type } : null,
        processoId: processoId || null,
        dataAudiencia: dataAudiencia || null,
        segredoJustica: segredo,
        retencaoMeses: 24,
        estado: 'por_transcrever',
        percent: 0,
      });
      if (!row || !row.id) throw new Error('criação falhou');
      toast('Gravação carregada. Pode iniciar a transcrição.');
      await refresh();
      navigate(`/trabalho/${row.id}`);
    } catch {
      toast('Não foi possível carregar a gravação.');
    } finally {
      setACarregar(false);
    }
  }

  return (
    <div className="stack stack-6" data-demo-page="transcricao/">
      <div className="page-header">
        <div>
          <h1 className="page-title">Transcrições de audiência</h1>
          <p className="card-subtitle">
            Carregue a gravação, transcreva com oradores e tempos por palavra, reveja e gere excertos para recurso.
          </p>
        </div>
      </div>

      <section className="card" data-testid="transcricao-nova">
        <h2 className="card-title">Nova transcrição</h2>
        <p className="card-subtitle">
          Gravações de audiência em MP3/WAV. O acesso é restrito: a voz é dado pessoal de terceiros (RGPD);
          a retenção por omissão é de 24 meses por trabalho.
        </p>
        <div className="row row-3" style={{ flexWrap: 'wrap', gap: 'var(--sp-3, 0.75rem)', alignItems: 'end' }}>
          <label className="stack stack-1">
            <span className="text-xs text-subtle">Processo</span>
            <select data-testid="transcricao-processo" value={processoId} onChange={(e) => setProcessoId(e.target.value)}>
              <option value="">Sem processo</option>
              {processos.map((p) => (
                <option key={p.id} value={p.id}>{p.numeroProcesso || p.id}</option>
              ))}
            </select>
          </label>
          <label className="stack stack-1">
            <span className="text-xs text-subtle">Data da audiência</span>
            <input type="date" data-testid="transcricao-data" value={dataAudiencia} onChange={(e) => setDataAudiencia(e.target.value)} />
          </label>
          <label className="row row-2" style={{ alignItems: 'center' }}>
            <input type="checkbox" data-testid="transcricao-segredo" checked={segredo} onChange={(e) => setSegredo(e.target.checked)} />
            <span className="text-small">Processo penal - segredo de justiça</span>
          </label>
          <label className="btn btn-primary" style={{ cursor: 'pointer' }} data-testid="transcricao-carregar" data-demo-target="transcricao-carregar">
            <IconUpload /> {aCarregar ? 'A carregar…' : 'Carregar gravação'}
            <input type="file" accept=".mp3,.wav,.m4a,.ogg,audio/*" style={{ display: 'none' }} onChange={onFicheiro} disabled={aCarregar} />
          </label>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">Trabalhos</h2>
        {ordenadas.length === 0 ? (
          <EmptyState title="Ainda não há transcrições" hint="Carregue a primeira gravação de audiência." />
        ) : (
          <ul className="stack stack-2" style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="transcricoes-lista">
            {ordenadas.map((t) => (
              <li key={t.id} data-testid="transcricao-row" data-demo-target={t.demo ? 'transcricao-row' : undefined}>
                <a
                  href={`trabalho/${t.id}`}
                  onClick={(e) => { e.preventDefault(); navigate(`/trabalho/${t.id}`); }}
                  className="row row-3"
                  style={{ padding: 'var(--sp-3, 0.75rem)', border: '1px solid var(--color-border)', borderRadius: 'var(--r-2, 0.5rem)', alignItems: 'center' }}
                >
                  <span className="row-icon" aria-hidden="true"><IconMic /></span>
                  <span className="stack stack-1" style={{ flex: 1, minWidth: 0 }}>
                    <span className="text-strong">{t.titulo || t.ficheiroNome || 'Transcrição'}</span>
                    <span className="text-xs text-subtle">
                      {t.numeroProcesso || ''} {t.dataAudiencia ? `· audiência de ${formatDate(t.dataAudiencia)}` : ''}
                      {t.segredoJustica ? ' · segredo de justiça' : ''}
                    </span>
                  </span>
                  <Badge tone={ESTADO_TONE[t.estado] || 'neutral'}>{ESTADO_LABEL[t.estado] || t.estado}</Badge>
                  <IconChevronRight />
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
