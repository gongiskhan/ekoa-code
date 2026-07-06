import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getShared, updateShared, createShared, useSharedCollection, formatEur, formatDate, registarEvento } from '../shared.js';
import { Button, Badge, EmptyState, useToast } from '../components/ui.jsx';
import { IconCheck, IconFileText, IconEuro } from '../components/Icons.jsx';
import { useDemoResult } from '../demo.js';
import { ESTADO_LABEL, ESTADO_TONE } from './InsolvenciasPage.jsx';

const NATUREZAS = ['comum', 'privilegiado', 'garantido', 'subordinado'];

export default function InsolvenciaDetailPage() {
  const { id } = useParams();
  const toast = useToast();
  const navigate = useNavigate();
  const [ins, setIns] = useState(null);
  const [natureza, setNatureza] = useState('comum');
  const [garantias, setGarantias] = useState('');
  const [rateio, setRateio] = useState('');
  const [aCorrer, setACorrer] = useState(false);
  const { items: reclamacoes, refresh: refreshRec } = useSharedCollection('reclamacoes_creditos');

  const carregar = async () => setIns(await getShared('insolvencias', id));
  useEffect(() => { carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  const minha = useMemo(() => reclamacoes.find((r) => r.insolvenciaId === id) || null, [reclamacoes, id]);
  const ehDemo = Boolean(ins && ins.demo);
  const extraDemo = ehDemo ? { demoSet: ins.demoSet } : {};

  useDemoResult('insolv-graduada', Boolean(ins && ins.estado === 'graduada'), 'Crédito graduado');

  async function gerarReclamacao() {
    setACorrer(true);
    try {
      const texto = [
        'RECLAMAÇÃO DE CRÉDITOS (CIRE art. 128.º)',
        `Insolvência de: ${ins.devedor}`,
        `Credor: o constituinte (crédito da espinha: ${ins.descricaoCredito || '-'})`,
        `Montante: ${formatEur(ins.credito)}`,
        `Natureza: ${natureza}`,
        `Garantias: ${garantias || 'sem garantias'}`,
        'Documentos: fatura e correspondência de interpelação em anexo (dossiê).',
        `Prazo: até ${formatDate(ins.prazoReclamacao)} (30 dias contínuos do despacho - CIRE art. 9.º).`,
      ].join('\n');
      await createShared('reclamacoes_creditos', {
        insolvenciaId: id, montante: ins.credito, natureza, garantias: garantias || null,
        texto, estado: 'entregue', entregueEm: new Date().toISOString().slice(0, 10),
        ...(ehDemo ? { demo: true, demoSet: ins.demoSet } : {}),
      });
      await updateShared('insolvencias', id, { estado: 'reclamada' });
      await registarEvento({
        app: 'legal-insolvencias', acao: 'reclamacao-gerada',
        fundamentacao: `Reclamação de ${formatEur(ins.credito)} (${natureza}) dentro do prazo de ${formatDate(ins.prazoReclamacao)}.`,
        proveniencia: ehDemo ? 'simulada' : 'manual', demo: ehDemo, extra: extraDemo,
      });
      await carregar();
      await refreshRec();
      toast('Reclamação de créditos gerada.');
    } catch {
      toast('Não foi possível gerar a reclamação.');
    } finally {
      setACorrer(false);
    }
  }

  async function avancar(novo) {
    setACorrer(true);
    try {
      await updateShared('insolvencias', id, { estado: novo });
      await registarEvento({ app: 'legal-insolvencias', acao: `estado:${novo}`, fundamentacao: ESTADO_LABEL[novo] || novo, proveniencia: ehDemo ? 'simulada' : 'manual', demo: ehDemo, extra: extraDemo });
      await carregar();
      toast(`Estado: ${ESTADO_LABEL[novo] || novo}.`);
    } finally {
      setACorrer(false);
    }
  }

  async function lancarRateio() {
    const valor = Number(String(rateio).replace(',', '.'));
    if (!Number.isFinite(valor) || valor <= 0) { toast('Indique o valor do rateio.'); return; }
    setACorrer(true);
    try {
      await createShared('conta_corrente', {
        descricao: `Rateio - insolvência ${ins.devedor}`, valor, tipo: 'credito',
        clienteId: ins.clienteId || null, data: new Date().toISOString().slice(0, 10), insolvenciaId: id,
        ...(ehDemo ? { demo: true, demoSet: ins.demoSet } : {}),
      });
      setRateio('');
      await registarEvento({ app: 'legal-insolvencias', acao: 'rateio-lancado', fundamentacao: `Rateio de ${formatEur(valor)} lançado na conta corrente (legal-financas).`, proveniencia: ehDemo ? 'simulada' : 'manual', demo: ehDemo, extra: extraDemo });
      toast('Rateio lançado na conta corrente.');
    } finally {
      setACorrer(false);
    }
  }

  if (!ins) return <EmptyState title="Insolvência não encontrada" hint="Volte à lista." />;

  return (
    <div className="stack stack-6" data-demo-page="insolvencias/detalhe" data-testid="insolv-detalhe">
      <div className="page-header">
        <div>
          <h1 className="page-title">Insolvência - {ins.devedor}</h1>
          <p className="card-subtitle">
            crédito {formatEur(ins.credito)} · despacho {formatDate(ins.dataDespacho)} ·
            reclamação até <strong data-testid="insolv-prazo">{formatDate(ins.prazoReclamacao)}</strong> (30 dias contínuos, CIRE art. 9.º)
          </p>
        </div>
        <div className="row row-2">
          <Badge tone={ESTADO_TONE[ins.estado] || 'neutral'} data-testid="insolv-estado">{ESTADO_LABEL[ins.estado] || ins.estado}</Badge>
          <Button variant="secondary" onClick={() => navigate('/')}>Voltar</Button>
        </div>
      </div>

      {!minha ? (
        <section className="card" data-testid="insolv-reclamar" data-demo-target="insolv-explicacao">
          <h2 className="card-title">Gerar reclamação de créditos</h2>
          <div className="row row-3" style={{ flexWrap: 'wrap', gap: 'var(--sp-3, 0.75rem)', alignItems: 'end' }}>
            <label className="stack stack-1">
              <span className="text-xs text-subtle">Natureza do crédito</span>
              <select data-testid="rec-natureza" value={natureza} onChange={(e) => setNatureza(e.target.value)}>
                {NATUREZAS.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="stack stack-1" style={{ minWidth: 240 }}>
              <span className="text-xs text-subtle">Garantias (se existirem)</span>
              <input data-testid="rec-garantias" value={garantias} onChange={(e) => setGarantias(e.target.value)} placeholder="ex.: hipoteca sobre..." />
            </label>
            <Button data-testid="rec-gerar" data-demo-target="insolv-reclamar" disabled={aCorrer} onClick={gerarReclamacao}>
              <IconFileText /> Gerar reclamação
            </Button>
          </div>
        </section>
      ) : (
        <section className="card" data-testid="insolv-reclamacao">
          <h2 className="card-title">Reclamação entregue</h2>
          <pre style={{ whiteSpace: 'pre-wrap', background: 'var(--surface-2)', padding: 'var(--sp-3)', borderRadius: 'var(--r-2)', fontSize: '0.8125rem' }} data-testid="rec-texto">{minha.texto}</pre>
        </section>
      )}

      <section className="card">
        <h2 className="card-title">Verificação e graduação</h2>
        <div className="row row-2" style={{ flexWrap: 'wrap' }}>
          {ins.estado === 'reclamada' ? (
            <Button data-testid="insolv-verificacao" data-demo-target="insolv-verificacao" disabled={aCorrer} onClick={() => avancar('verificacao')}>Em verificação</Button>
          ) : null}
          {ins.estado === 'verificacao' ? (
            <Button data-testid="insolv-graduar" data-demo-target="insolv-graduar" disabled={aCorrer} onClick={() => avancar('graduada')}>
              <IconCheck /> Crédito graduado
            </Button>
          ) : null}
        </div>
        {ins.estado === 'graduada' ? (
          <div className="stack stack-2" data-testid="insolv-rateios">
            <p className="text-small">Crédito graduado. Lance os rateios recebidos - entram na conta corrente (legal-financas).</p>
            <div className="row row-2" style={{ alignItems: 'end' }}>
              <input placeholder="Valor (EUR)" data-testid="rateio-valor" value={rateio} onChange={(e) => setRateio(e.target.value)} style={{ width: 140 }} />
              <Button size="sm" data-testid="rateio-lancar" disabled={aCorrer} onClick={lancarRateio}><IconEuro /> Lançar rateio</Button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
