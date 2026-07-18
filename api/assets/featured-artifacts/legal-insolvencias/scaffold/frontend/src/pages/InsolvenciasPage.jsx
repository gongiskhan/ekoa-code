import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSharedCollection, createShared, updateShared, deleteShared, listShared, formatEur, formatDate, registarEvento } from '../shared.js';
import { isDemoActive } from '../demo.js';
import { Button, Badge, EmptyState, useToast } from '../components/ui.jsx';
import { IconTrendingDown, IconChevronRight, IconBell } from '../components/Icons.jsx';
import { computePrazo } from '../engine/prazo.mjs';

export const ESTADO_LABEL = {
  registada: 'Registada',
  reclamada: 'Créditos reclamados',
  verificacao: 'Em verificação',
  graduada: 'Graduada',
  encerrada: 'Encerrada',
};

export const ESTADO_TONE = {
  registada: 'neutral', reclamada: 'info', verificacao: 'info', graduada: 'ok', encerrada: 'neutral',
};

/*
 * Registo da insolvência do DEVEDOR ligada ao crédito da espinha. O prazo de
 * reclamação (30 dias do despacho, editais) corre CONTÍNUO - regime 'cire' do
 * motor de prazos (art. 9.º CIRE), calculado aqui e entregue ao radar.
 */
export default function InsolvenciasPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const { items: insolvencias, refresh } = useSharedCollection('insolvencias');
  const { items: cobrancas } = useSharedCollection('cobrancas');
  const { items: clientes } = useSharedCollection('clientes');
  const { items: citiusNotifs } = useSharedCollection('citius_notificacoes');
  const [cobrancaId, setCobrancaId] = useState('');
  const [dataDespacho, setDataDespacho] = useState(new Date().toISOString().slice(0, 10));
  const [aCriar, setACriar] = useState(false);

  // REPETIBILIDADE da demonstração (mesmo padrão das outras apps da fase 2).
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
        const rows = (await listShared('insolvencias')).filter((i) => i && i.demo === true);
        for (const ins of rows) {
          for (const col of ['reclamacoes_creditos', 'prazos', 'conta_corrente']) {
            const der = (await listShared(col)).filter((r) => r && r.insolvenciaId === ins.id);
            for (const r of der) await deleteShared(col, r.id);
          }
          await deleteShared('insolvencias', ins.id);
        }
        if (rows.length > 0) await refresh();
      } catch { /* não fatal */ }
    }, 350);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nomeCliente = (id) => (clientes.find((c) => c.id === id) || {}).nome || '(devedor)';
  const creditosDisponiveis = useMemo(() => {
    const usados = new Set(insolvencias.map((i) => i.cobrancaId).filter(Boolean));
    return cobrancas.filter((c) => c.estado !== 'paga' && !usados.has(c.id));
  }, [cobrancas, insolvencias]);

  // Detecção via Caixa Citius: notificações monitorizadas que refiram insolvência.
  const despachosDetetados = useMemo(
    () => citiusNotifs.filter((n) => /insolv/i.test(`${n.assunto || ''} ${n.resumo || ''} ${n.tipo || ''}`)).slice(0, 3),
    [citiusNotifs],
  );

  // Comparativo de contagem para a data escolhida: o prazo REAL (CIRE, 30 dias
  // contínuos) lado a lado com o que seria nas regras gerais do CPC (30 dias
  // úteis, com suspensão em férias) - que aqui NÃO se aplicam. Determinístico;
  // data inválida devolve null (não se mostra um comparativo errado).
  const comparativo = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dataDespacho || ''))) return null;
    try {
      return {
        cire: computePrazo({ dataNotificacao: dataDespacho, dias: 30, regime: 'cire' }),
        cpc: computePrazo({ dataNotificacao: dataDespacho, dias: 30, contagem: 'uteis', suspendeFerias: true }),
      };
    } catch {
      return null;
    }
  }, [dataDespacho]);

  async function registar() {
    const cobranca = creditosDisponiveis.find((c) => c.id === cobrancaId);
    if (!cobranca) return;
    setACriar(true);
    try {
      // 30 dias CONTÍNUOS a partir do despacho - regime CIRE (sem suspensão
      // nas férias judiciais); o motor devolve a data-limite exacta.
      const prazo = computePrazo({ dataNotificacao: dataDespacho, dias: 30, regime: 'cire' });
      const ehDemo = cobranca.demo === true;
      const row = await createShared('insolvencias', {
        cobrancaId: cobranca.id, clienteId: cobranca.clienteId,
        devedor: nomeCliente(cobranca.clienteId), credito: cobranca.valor,
        descricaoCredito: cobranca.descricao, dataDespacho,
        prazoReclamacao: prazo.dataLimite, estado: 'registada',
        ...(ehDemo ? { demo: true, demoSet: cobranca.demoSet } : {}),
      });
      if (!row || !row.id) throw new Error('falhou');
      await createShared('prazos', {
        descricao: `Reclamação de créditos - ${row.devedor} (30 dias contínuos, CIRE art. 128.º)`,
        dataLimite: prazo.dataLimite, estado: 'pendente', regime: 'cire', tipoContagem: 'corridos', insolvenciaId: row.id,
        regraAplicada: 'CIRE art. 128.º n.º 1 - reclamação no prazo fixado na sentença (até 30 dias); contagem contínua, sem suspensão em férias: CIRE art. 9.º n.º 1',
        showWork: { passos: prazo.passos },
        ...(ehDemo ? { demo: true, demoSet: cobranca.demoSet } : {}),
      });
      // Escalada: o crédito fica marcado - cobranças/injunções propõem a reclamação.
      await updateShared('cobrancas', cobranca.id, { devedorInsolvente: true, insolvenciaId: row.id });
      await registarEvento({
        app: 'legal-insolvencias', acao: 'registar-insolvencia',
        fundamentacao: `Prazo de reclamação: ${prazo.dataLimite} (30 dias contínuos - CIRE art. 128.º n.º 1; sem suspensão em férias - CIRE art. 9.º n.º 1).`,
        proveniencia: ehDemo ? 'simulada' : 'manual', demo: ehDemo, extra: ehDemo ? { demoSet: cobranca.demoSet } : {},
      });
      toast('Insolvência registada; prazo de reclamação no radar.');
      await refresh();
      navigate(`/insolvencia/${row.id}`);
    } catch (err) {
      toast(String((err && err.message) || 'Não foi possível registar.'));
    } finally {
      setACriar(false);
    }
  }

  return (
    <div className="stack stack-6" data-demo-page="insolvencias/">
      <div className="page-header">
        <div>
          <h1 className="page-title">Insolvências - lado do credor</h1>
          <p className="card-subtitle">
            Registe a insolvência do devedor ligada ao crédito. O prazo de reclamação (CIRE art. 128.º n.º 1)
            corre em 30 dias contínuos, sem suspensão nas férias judiciais (CIRE art. 9.º n.º 1).
          </p>
        </div>
      </div>

      {despachosDetetados.length > 0 ? (
        <section className="card" data-testid="insolv-detecao">
          <div className="row row-2"><span className="row-icon"><IconBell /></span>
            <h2 className="card-title" style={{ margin: 0 }}>Despachos detetados na Caixa Citius</h2>
          </div>
          <ul className="stack stack-1" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {despachosDetetados.map((n) => (
              <li key={n.id} className="text-small">{n.assunto || n.resumo || 'Notificação'} {n.numeroProcesso ? `· ${n.numeroProcesso}` : ''}</li>
            ))}
          </ul>
          <p className="field-hint">Confirme o despacho e registe a insolvência abaixo com a data correta.</p>
        </section>
      ) : null}

      <section className="card" data-testid="insolv-nova">
        <h2 className="card-title">Registar insolvência do devedor</h2>
        <div className="row row-3" style={{ flexWrap: 'wrap', gap: 'var(--sp-3, 0.75rem)', alignItems: 'end' }}>
          <label className="stack stack-1" style={{ minWidth: 320 }}>
            <span className="text-xs text-subtle">Crédito na espinha</span>
            <select data-testid="insolv-credito" data-demo-target="insolv-credito" value={cobrancaId} onChange={(e) => setCobrancaId(e.target.value)}>
              <option value="">Escolher…</option>
              {creditosDisponiveis.map((c) => (
                <option key={c.id} value={c.id}>{c.descricao} · {formatEur(c.valor)} · {nomeCliente(c.clienteId)}</option>
              ))}
            </select>
          </label>
          <label className="stack stack-1">
            <span className="text-xs text-subtle">Data do despacho (editais)</span>
            <input type="date" data-testid="insolv-despacho" value={dataDespacho} onChange={(e) => setDataDespacho(e.target.value)} />
          </label>
          <Button data-testid="insolv-registar" data-demo-target="insolv-registar" disabled={aCriar || !cobrancaId} onClick={registar}>
            <IconTrendingDown /> Registar
          </Button>
        </div>

        {comparativo ? (
          <div className="stack stack-2" data-testid="insolv-contagem" style={{ marginTop: 'var(--sp-4, 1rem)' }}>
            <div
              style={{ padding: 'var(--sp-3, 0.75rem)', border: '2px solid var(--accent, #2563EB)', borderRadius: 'var(--r-2, 0.5rem)' }}
            >
              <span className="text-xs text-subtle" style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Prazo real - CIRE (30 dias contínuos)
              </span>
              <p className="text-strong" style={{ margin: '2px 0 4px', fontSize: 'var(--text-lg, 1.125rem)' }}>
                <span data-testid="insolv-cire-limite">{comparativo.cire.dataLimite}</span>
                <span className="text-xs text-subtle" style={{ marginLeft: 8, fontWeight: 400 }}>{formatDate(comparativo.cire.dataLimite)}</span>
              </p>
              <p className="text-xs text-subtle" data-testid="insolv-cire-citacao" style={{ margin: 0 }}>
                CIRE art. 128.º n.º 1 - reclamação no prazo fixado na sentença (até 30 dias). Contagem contínua,
                sem suspensão em férias judiciais: o processo é urgente e corre em férias (CIRE art. 9.º n.º 1).
                Termo em dia não útil transfere para o dia útil seguinte (CC art. 279.º al. e)).
              </p>
            </div>
            <div
              style={{ padding: 'var(--sp-3, 0.75rem)', border: '1px dashed var(--color-border, #CBD5E1)', borderRadius: 'var(--r-2, 0.5rem)', opacity: 0.85 }}
            >
              <span className="text-xs text-subtle" style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Comparação - regras gerais do CPC (30 dias úteis): NÃO se aplicam aqui
              </span>
              <p className="text-xs text-subtle" style={{ margin: '4px 0 0' }}>
                Se este prazo seguisse o CPC (dias úteis, com suspensão em férias judiciais - CPC art. 138.º),
                o termo cairia em <strong data-testid="insolv-cpc-limite">{comparativo.cpc.dataLimite}</strong>
                {' '}({formatDate(comparativo.cpc.dataLimite)}). Na insolvência não há esse fôlego - a diferença é
                exactamente o risco de contar mal.
              </p>
            </div>
          </div>
        ) : (
          <p className="field-hint" data-testid="insolv-contagem-invalida" style={{ marginTop: 'var(--sp-3, 0.75rem)' }}>
            Indique uma data de despacho válida para ver a contagem do prazo.
          </p>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">Em acompanhamento</h2>
        {insolvencias.length === 0 ? (
          <EmptyState title="Sem insolvências registadas" hint="Registe a primeira a partir de um crédito da espinha." />
        ) : (
          <ul className="stack stack-2" style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="insolv-lista">
            {insolvencias.map((i) => (
              <li key={i.id} data-testid="insolv-row" data-demo-target={i.demo ? 'insolv-row' : undefined}>
                <a
                  href={`insolvencia/${i.id}`}
                  onClick={(e) => { e.preventDefault(); navigate(`/insolvencia/${i.id}`); }}
                  className="row row-3"
                  style={{ padding: 'var(--sp-3, 0.75rem)', border: '1px solid var(--color-border)', borderRadius: 'var(--r-2, 0.5rem)', alignItems: 'center' }}
                >
                  <span className="row-icon" aria-hidden="true"><IconTrendingDown /></span>
                  <span className="stack stack-1" style={{ flex: 1, minWidth: 0 }}>
                    <span className="text-strong">{i.devedor}</span>
                    <span className="text-xs text-subtle">crédito {formatEur(i.credito)} · reclamação até {formatDate(i.prazoReclamacao)}</span>
                  </span>
                  <Badge tone={ESTADO_TONE[i.estado] || 'neutral'}>{ESTADO_LABEL[i.estado] || i.estado}</Badge>
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
