import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getShared, updateShared, createShared, useSharedCollection, formatEur, formatDate, registarEvento, appHref } from '../shared.js';
import { Button, Badge, EmptyState, useToast } from '../components/ui.jsx';
import { IconCheck, IconFileText, IconEuro, IconExternalLink } from '../components/Icons.jsx';
import { useDemoResult } from '../demo.js';
import { computePrazo } from '../engine/prazo.mjs';
import { ESTADO_LABEL, ESTADO_TONE } from './InsolvenciasPage.jsx';

const NATUREZAS = ['comum', 'privilegiado', 'garantido', 'subordinado'];

/*
 * Checklist do credor para a reclamação de créditos (CIRE art. 128.º) -
 * persistida na própria linha da insolvência (campo `checklist`), para que o
 * progresso sobreviva a recarregamentos e seja partilhado entre sessões.
 */
const CHECKLIST_ITENS = [
  { key: 'titulo', label: 'Título do crédito (fatura, contrato ou sentença)' },
  { key: 'interpelacao', label: 'Prova da interpelação do devedor' },
  { key: 'calculo', label: 'Cálculo do montante: capital e juros à data do despacho' },
  { key: 'procuracao', label: 'Procuração com poderes para reclamar créditos' },
  { key: 'reclamacao', label: 'Reclamação assinada, com natureza e garantias (CIRE art. 128.º)' },
  { key: 'certidao', label: 'Certidão ou registo da garantia, se o crédito for garantido' },
];

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

  // O que este prazo seria nas regras gerais do CPC (30 dias ÚTEIS, com
  // suspensão em férias) - mostrado apenas como contraste honesto; aqui vale
  // a contagem contínua do CIRE. null se a data do despacho for inválida.
  const contrasteCpc = useMemo(() => {
    if (!ins || !/^\d{4}-\d{2}-\d{2}$/.test(String(ins.dataDespacho || ''))) return null;
    try {
      return computePrazo({ dataNotificacao: ins.dataDespacho, dias: 30, contagem: 'uteis', suspendeFerias: true });
    } catch {
      return null;
    }
  }, [ins]);

  const checklist = (ins && typeof ins.checklist === 'object' && ins.checklist) || {};
  const feitos = CHECKLIST_ITENS.filter((it) => checklist[it.key] === true).length;

  async function onToggleChecklist(key) {
    // Atualização otimista: a caixa responde de imediato; em erro repomos o
    // estado persistido (senão a caixa controlada reverte visualmente até o
    // round-trip terminar).
    const novaChecklist = { ...checklist, [key]: !checklist[key] };
    setIns((cur) => (cur ? { ...cur, checklist: novaChecklist } : cur));
    try {
      await updateShared('insolvencias', id, { checklist: novaChecklist });
      await carregar();
    } catch {
      await carregar();
      toast('Não foi possível guardar a checklist.');
    }
  }

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
        `Prazo: até ${formatDate(ins.prazoReclamacao)} (prazo fixado na sentença, até 30 dias - CIRE art. 36.º, n.º 1, al. j)).`,
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
          <p className="card-subtitle" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            crédito {formatEur(ins.credito)} · despacho {formatDate(ins.dataDespacho)} ·
            reclamação até <strong data-testid="insolv-prazo">{formatDate(ins.prazoReclamacao)}</strong>
            <Badge tone="media" data-testid="insolv-contagem-badge">Dias contínuos - CIRE art. 128.º</Badge>
          </p>
          {contrasteCpc ? (
            <p className="text-xs text-subtle" data-testid="insolv-cpc-contraste" style={{ margin: 'var(--sp-2, 0.5rem) 0 0', maxWidth: 640 }}>
              Nas regras gerais do CPC (30 dias úteis, com suspensão em férias judiciais) o termo seria{' '}
              {formatDate(contrasteCpc.dataLimite)} - aqui NÃO se aplica: o processo de insolvência é urgente e
              corre em férias (CIRE art. 9.º n.º 1; contagem contínua da reclamação: CIRE art. 128.º n.º 1).
            </p>
          ) : null}
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

      <section className="card" data-testid="insolv-checklist">
        <div className="row row-space-between" style={{ alignItems: 'baseline', flexWrap: 'wrap', gap: 'var(--sp-2, 0.5rem)' }}>
          <h2 className="card-title">Checklist do credor</h2>
          <span className="text-xs text-subtle" data-testid="insolv-checklist-progresso">{feitos} de {CHECKLIST_ITENS.length}</span>
        </div>
        <p className="card-subtitle">
          O que a reclamação de créditos deve levar (CIRE art. 128.º). O progresso fica guardado nesta insolvência.
        </p>
        <ul className="stack stack-2" style={{ listStyle: 'none', margin: 'var(--sp-3, 0.75rem) 0 0', padding: 0 }}>
          {CHECKLIST_ITENS.map((it) => (
            <li key={it.key}>
              <label className="row row-2" style={{ alignItems: 'flex-start', cursor: 'pointer', gap: 8 }}>
                <input
                  type="checkbox"
                  data-testid={`insolv-check-${it.key}`}
                  checked={checklist[it.key] === true}
                  onChange={() => onToggleChecklist(it.key)}
                  style={{ marginTop: 3 }}
                />
                <span className="text-small" style={{ textDecoration: checklist[it.key] === true ? 'line-through' : 'none' }}>
                  {it.label}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section className="card" data-testid="insolv-ligacoes">
        <h2 className="card-title">Ligações na espinha</h2>
        <p className="card-subtitle">
          O crédito ficou marcado como de devedor insolvente - novas injunções contra ele devem dar lugar à
          reclamação de créditos, não a cobrança paralela.
        </p>
        <div className="row row-2" style={{ flexWrap: 'wrap', marginTop: 'var(--sp-3, 0.75rem)' }}>
          {ins.cobrancaId ? (
            <a className="btn btn-secondary" data-testid="insolv-link-cobranca" href={appHref('legal-cobrancas', `cobranca/${ins.cobrancaId}`)}>
              Abrir o crédito em Cobranças <IconExternalLink size={12} />
            </a>
          ) : (
            <span className="text-xs text-subtle">Sem crédito de cobranças ligado a esta insolvência.</span>
          )}
          <a className="btn btn-secondary" data-testid="insolv-link-injuncoes" href={appHref('legal-injuncoes')}>
            Ver em Injunções <IconExternalLink size={12} />
          </a>
        </div>
      </section>

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
