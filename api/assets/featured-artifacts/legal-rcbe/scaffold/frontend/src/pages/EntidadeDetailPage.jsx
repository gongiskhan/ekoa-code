import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getShared, updateShared, createShared, useSharedCollection, formatDate, registarEvento } from '../shared.js';
import { Button, Badge, EmptyState, useToast } from '../components/ui.jsx';
import { IconBuilding, IconCheck, IconFileText, IconPlus } from '../components/Icons.jsx';
import { useDemoResult } from '../demo.js';
import { calendarioObrigacoes, buildRcbeDeepLink } from '../rcbe.js';

const TIPO_LABEL = { inicial: 'Declaração inicial', atualizacao: 'Atualização', confirmacao_anual: 'Confirmação anual' };

/* Passos da submissão ASSISTIDA no Portal da Justiça (RCBE não tem API - o
 * compensatório é a proveniência, um evento por passo, §3.2.5). */
const PASSOS_PORTAL = [
  'Rever a declaração pré-preenchida abaixo.',
  'Autenticar-se no portal RCBE (rcbe.justica.gov.pt).',
  'Transcrever os beneficiários para o formulário do portal.',
  'Submeter e descarregar o comprovativo.',
];

export default function EntidadeDetailPage() {
  const { id } = useParams();
  const toast = useToast();
  const navigate = useNavigate();
  const [ent, setEnt] = useState(null);
  const { items: bos, refresh: refreshBos } = useSharedCollection('beneficiarios_efetivos');
  const { items: obrigacoes, refresh: refreshObr } = useSharedCollection('rcbe_obrigacoes');
  const [novoBo, setNovoBo] = useState({ nome: '', nif: '', percentagem: '' });
  const [passos, setPassos] = useState({});
  const [declaracao, setDeclaracao] = useState('');
  const [aCorrer, setACorrer] = useState(false);

  const carregar = async () => {
    const r = await getShared('rcbe_entidades', id);
    setEnt(r);
    if (r && r.passosPortal) setPassos(r.passosPortal);
  };
  useEffect(() => { carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  const hoje = new Date().toISOString().slice(0, 10);
  const meusBos = useMemo(() => (ent ? bos.filter((b) => b.entidadeNipc === ent.nipc || b.entidadeId === ent.id) : []), [bos, ent]);
  const minhasObr = useMemo(() => (ent ? obrigacoes.filter((o) => o.entidadeId === ent.id) : []), [obrigacoes, ent]);
  const calendario = useMemo(() => {
    if (!ent) return [];
    try { return calendarioObrigacoes(ent, hoje); } catch { return []; }
  }, [ent, hoje]);

  const ehDemo = Boolean(ent && ent.demo);
  const extraDemo = ehDemo ? { demoSet: ent.demoSet } : {};

  useDemoResult('rcbe-comprovativo', Boolean(minhasObr.some((o) => o.estado === 'cumprida')), 'Obrigação cumprida com comprovativo arquivado');

  async function adicionarBo() {
    const pct = Number(String(novoBo.percentagem).replace(',', '.'));
    if (!novoBo.nome.trim() || !Number.isFinite(pct) || pct <= 0 || pct > 100) {
      toast('Indique nome e percentagem (0-100).');
      return;
    }
    if (pct < 25) {
      toast('Abaixo de 25% do capital/votos: só entra como beneficiário por outra via de controlo ou direção de topo.');
    }
    await createShared('beneficiarios_efetivos', {
      entidadeId: ent.id, entidadeNipc: ent.nipc || null,
      nome: novoBo.nome.trim(), nif: novoBo.nif.trim() || null,
      natureza: 'capital', percentagem: pct,
      ...(ehDemo ? { demo: true, demoSet: ent.demoSet } : {}),
    });
    setNovoBo({ nome: '', nif: '', percentagem: '' });
    await refreshBos();
    toast('Beneficiário registado na estrutura partilhada (KYC vê o mesmo).');
  }

  function prepararDeclaracao() {
    const linhas = [
      'DECLARAÇÃO RCBE (pré-preenchida a partir da espinha)',
      `Entidade: ${ent.nome} · NIPC ${ent.nipc || '-'}`,
      `Forma jurídica: ${ent.formaJuridica || 'sociedade'}`,
      '',
      'Beneficiários efetivos (>= 25% capital/direitos de voto):',
      ...meusBos.map((b) => `  - ${b.nome}${b.nif ? ` · NIF ${b.nif}` : ''} · ${b.natureza || 'capital'} · ${b.percentagem}%`),
      '',
      `Portal: ${buildRcbeDeepLink({ nipc: ent.nipc })}`,
      'Base: Lei n.º 89/2017 (RJRCBE); Portaria n.º 233/2018.',
    ];
    setDeclaracao(linhas.join('\n'));
  }

  async function marcarPasso(i) {
    const prox = { ...passos, [i]: true };
    setPassos(prox);
    await updateShared('rcbe_entidades', id, { passosPortal: prox });
    await registarEvento({
      app: 'legal-rcbe', acao: `portal:passo-${i + 1}`, fundamentacao: PASSOS_PORTAL[i],
      proveniencia: ehDemo ? 'simulada' : 'manual-assistido', demo: ehDemo, extra: extraDemo,
    });
  }

  async function arquivarComprovativo() {
    setACorrer(true);
    try {
      await createShared('documentos', {
        nome: `Comprovativo RCBE - ${ent.nome} (${hoje}).pdf`, tipo: 'comprovativo-rcbe',
        origem: ehDemo ? 'demonstracao' : 'portal-justica', entidadeId: ent.id,
        ...(ehDemo ? { demo: true, demoSet: ent.demoSet } : {}),
      });
      const alvo = minhasObr.find((o) => o.estado !== 'cumprida');
      if (alvo) await updateShared('rcbe_obrigacoes', alvo.id, { estado: 'cumprida', cumpridaEm: hoje });
      else await createShared('rcbe_obrigacoes', { entidadeId: ent.id, entidadeNipc: ent.nipc, tipo: 'confirmacao_anual', dataLimite: `${hoje.slice(0, 4)}-12-31`, estado: 'cumprida', cumpridaEm: hoje, ...(ehDemo ? { demo: true, demoSet: ent.demoSet } : {}) });
      await updateShared('rcbe_entidades', id, { ultimaDeclaracaoEm: hoje, passosPortal: {} });
      // Gancho de avença (serviço recorrente) - lançamento para honorários.
      await createShared('lancamentos', {
        descricao: `Avença RCBE - ${ent.nome} (confirmação anual)`, valor: 90, tipo: 'avenca-rcbe',
        clienteId: ent.clienteId || null, data: hoje,
        ...(ehDemo ? { demo: true, demoSet: ent.demoSet } : {}),
      });
      await registarEvento({
        app: 'legal-rcbe', acao: 'comprovativo-arquivado',
        fundamentacao: 'Comprovativo arquivado no dossiê; obrigação fechada; avença lançada para honorários.',
        proveniencia: ehDemo ? 'simulada' : 'portal-justica', demo: ehDemo, extra: extraDemo,
      });
      await carregar();
      await refreshObr();
      toast('Comprovativo arquivado - obrigação cumprida e avença lançada.');
    } catch {
      toast('Não foi possível arquivar o comprovativo.');
    } finally {
      setACorrer(false);
    }
  }

  if (!ent) return <EmptyState title="Entidade não encontrada" hint="Volte à carteira." />;

  const todos = PASSOS_PORTAL.every((_, i) => passos[i]);

  return (
    <div className="stack stack-6" data-demo-page="rcbe/entidade" data-testid="rcbe-detalhe">
      <div className="page-header">
        <div>
          <h1 className="page-title">{ent.nome}</h1>
          <p className="card-subtitle">NIPC {ent.nipc || '-'} · {ent.formaJuridica || 'sociedade'} {ent.ultimaDeclaracaoEm ? `· última declaração ${formatDate(ent.ultimaDeclaracaoEm)}` : ''}</p>
        </div>
        <Button variant="secondary" onClick={() => navigate('/')}>Voltar</Button>
      </div>

      <section className="card" data-testid="rcbe-bos" data-demo-target="rcbe-explicacao">
        <h2 className="card-title">Beneficiários efetivos (estrutura partilhada com o KYC)</h2>
        {meusBos.length === 0 ? (
          <p className="field-hint">Sem beneficiários registados. Regra: 25% ou mais do capital ou votos; sem ninguém no limiar, declara-se a direção de topo.</p>
        ) : (
          <ul className="stack stack-1" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {meusBos.map((b) => (
              <li key={b.id} className="text-small" data-testid="rcbe-bo-row">
                <strong>{b.nome}</strong>{b.nif ? ` · NIF ${b.nif}` : ''} · {b.natureza || 'capital'} · {b.percentagem}%
              </li>
            ))}
          </ul>
        )}
        <div className="row row-3" style={{ flexWrap: 'wrap', gap: 'var(--sp-2, 0.5rem)', alignItems: 'end' }}>
          <input placeholder="Nome" data-testid="bo-nome" value={novoBo.nome} onChange={(e) => setNovoBo({ ...novoBo, nome: e.target.value })} />
          <input placeholder="NIF" data-testid="bo-nif" value={novoBo.nif} onChange={(e) => setNovoBo({ ...novoBo, nif: e.target.value })} style={{ width: 130 }} />
          <input placeholder="%" data-testid="bo-pct" value={novoBo.percentagem} onChange={(e) => setNovoBo({ ...novoBo, percentagem: e.target.value })} style={{ width: 70 }} />
          <Button size="sm" data-testid="bo-adicionar" onClick={adicionarBo}><IconPlus /> Adicionar</Button>
        </div>
      </section>

      <section className="card" data-testid="rcbe-calendario">
        <h2 className="card-title">Calendário de obrigações</h2>
        {calendario.length === 0 && minhasObr.length === 0 ? (
          <p className="field-hint">Sem obrigações devidas com os dados atuais.</p>
        ) : (
          <ul className="stack stack-1" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {minhasObr.map((o) => (
              <li key={o.id} className="row row-2 text-small" data-testid="rcbe-obrigacao">
                <Badge tone={o.estado === 'cumprida' ? 'ok' : (o.estado === 'em_atraso' ? 'alta' : 'media')}>
                  {o.estado === 'cumprida' ? 'Cumprida' : (o.estado === 'em_atraso' ? 'Em atraso' : 'Pendente')}
                </Badge>
                <span>{TIPO_LABEL[o.tipo] || o.tipo} · limite {formatDate(o.dataLimite)}</span>
              </li>
            ))}
            {calendario.filter((c) => !minhasObr.some((o) => o.tipo === c.tipo && o.estado !== 'cumprida')).map((c, i) => (
              <li key={`c-${i}`} className="row row-2 text-small">
                <Badge tone={c.emAtraso ? 'alta' : 'neutral'}>{c.emAtraso ? 'Em atraso' : 'Prevista'}</Badge>
                <span>{TIPO_LABEL[c.tipo] || c.tipo} · limite {formatDate(c.dataLimite)} · {c.base}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" data-testid="rcbe-declaracao-card">
        <h2 className="card-title">Declaração e submissão assistida</h2>
        {!declaracao ? (
          <Button data-testid="rcbe-preparar" data-demo-target="rcbe-preparar" onClick={prepararDeclaracao}>
            <IconFileText /> Preparar declaração pré-preenchida
          </Button>
        ) : (
          <>
            <pre data-testid="rcbe-declaracao" style={{ whiteSpace: 'pre-wrap', background: 'var(--surface-2)', padding: 'var(--sp-3)', borderRadius: 'var(--r-2)', fontSize: '0.8125rem' }}>{declaracao}</pre>
            <p className="card-subtitle">O RCBE não tem API: a submissão é assistida - cada passo fica com proveniência registada.</p>
            <ol className="stack stack-2" style={{ margin: 0, paddingLeft: '1.25rem' }}>
              {PASSOS_PORTAL.map((p, i) => (
                <li key={i} className="row row-2" style={{ alignItems: 'center' }}>
                  <input type="checkbox" data-testid={`portal-passo-${i}`} data-demo-target={`portal-passo-${i}`} checked={Boolean(passos[i])} disabled={Boolean(passos[i])} onChange={() => marcarPasso(i)} />
                  <span className="text-small">{p}</span>
                </li>
              ))}
            </ol>
            <Button data-testid="rcbe-arquivar" data-demo-target="rcbe-arquivar" disabled={aCorrer || !todos} onClick={arquivarComprovativo}>
              <IconCheck /> Arquivar comprovativo e fechar obrigação
            </Button>
          </>
        )}
      </section>
    </div>
  );
}
