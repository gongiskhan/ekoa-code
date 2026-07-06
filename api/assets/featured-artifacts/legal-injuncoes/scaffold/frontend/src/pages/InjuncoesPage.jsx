import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSharedCollection, createShared, deleteShared, listShared, formatEur, formatDate, registarEvento } from '../shared.js';
import { isDemoActive } from '../demo.js';
import { Button, Badge, EmptyState, useToast } from '../components/ui.jsx';
import { IconGavel, IconChevronRight } from '../components/Icons.jsx';
import { verificarElegibilidade } from '../engine/injuncoes.mjs';

export const ESTADO_LABEL = {
  preparada: 'Preparada',
  submetida: 'Submetida',
  notificada: 'Notificada',
  oposicao: 'Oposição - segue como ação',
  pagamento: 'Paga',
  formula_executoria: 'Fórmula executória',
};

export const ESTADO_TONE = {
  preparada: 'neutral',
  submetida: 'info',
  notificada: 'info',
  oposicao: 'media',
  pagamento: 'ok',
  formula_executoria: 'ok',
};

/*
 * Lista de injunções + criação a partir de uma cobrança vencida da espinha
 * (o crédito). A elegibilidade é verificada e CITADA no momento da escolha.
 */
export default function InjuncoesPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const { items: injuncoes, refresh } = useSharedCollection('injuncoes');
  const { items: cobrancas } = useSharedCollection('cobrancas');
  const { items: clientes } = useSharedCollection('clientes');
  const [aCriar, setACriar] = useState(false);
  const [cobrancaId, setCobrancaId] = useState('');
  const [transacaoComercial, setTransacaoComercial] = useState(true);
  const [devedorConsumidor, setDevedorConsumidor] = useState(false);

  const nomeCliente = (id) => (clientes.find((c) => c.id === id) || {}).nome || '(devedor)';

  // REPETIBILIDADE da demonstração: com uma tour activa, as injunções
  // demo-marcadas (e as linhas derivadas) são repostas para que a história se
  // viva do zero. Só toca registos demo-marcados. O handshake da ponte
  // completa depois do mount - sondagem breve (mesmo padrão da transcrição).
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
        const rows = await listShared('injuncoes');
        const alvo = rows.filter((i) => i && i.demo === true);
        for (const inj of alvo) {
          for (const col of ['prazos', 'tarefas', 'correio', 'calculos']) {
            const derivadas = (await listShared(col)).filter((r) => r && r.injuncaoId === inj.id);
            for (const r of derivadas) await deleteShared(col, r.id);
          }
          await deleteShared('injuncoes', inj.id);
        }
        if (alvo.length > 0) await refresh();
      } catch { /* não fatal - a tour segue sobre o estado existente */ }
    }, 350);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const vencidasSemInjuncao = useMemo(() => {
    const usadas = new Set(injuncoes.map((i) => i.cobrancaId).filter(Boolean));
    const hoje = new Date();
    return cobrancas.filter((c) => c.estado !== 'paga' && c.dataVencimento && new Date(c.dataVencimento) < hoje && !usadas.has(c.id));
  }, [cobrancas, injuncoes]);

  const escolhida = vencidasSemInjuncao.find((c) => c.id === cobrancaId) || null;
  const elegibilidade = useMemo(() => {
    if (!escolhida) return null;
    try {
      return verificarElegibilidade({ valor: escolhida.valor, transacaoComercial, devedorConsumidor });
    } catch {
      return null;
    }
  }, [escolhida, transacaoComercial, devedorConsumidor]);

  async function criar() {
    if (!escolhida || !elegibilidade || !elegibilidade.elegivel) return;
    setACriar(true);
    try {
      const row = await createShared('injuncoes', {
        cobrancaId: escolhida.id,
        clienteId: escolhida.clienteId,
        devedor: nomeCliente(escolhida.clienteId),
        descricao: escolhida.descricao,
        capital: escolhida.valor,
        transacaoComercial,
        devedorConsumidor,
        elegibilidade,
        estado: 'preparada',
        trilho: [{ acao: 'criada', quando: new Date().toISOString() }],
        demo: escolhida.demo === true ? true : undefined,
        demoSet: escolhida.demo === true ? escolhida.demoSet : undefined,
      });
      if (!row || !row.id) throw new Error('criação falhou');
      await registarEvento({
        app: 'legal-injuncoes', acao: 'criar-injuncao',
        fundamentacao: elegibilidade.fundamento, proveniencia: 'decisao-do-mandatario',
        demo: escolhida.demo === true, extra: escolhida.demo === true ? { demoSet: escolhida.demoSet } : {},
      });
      toast('Injunção preparada.');
      await refresh();
      navigate(`/injuncao/${row.id}`);
    } catch {
      toast('Não foi possível criar a injunção.');
    } finally {
      setACriar(false);
    }
  }

  return (
    <div className="stack stack-6" data-demo-page="injuncoes/">
      <div className="page-header">
        <div>
          <h1 className="page-title">Injunções</h1>
          <p className="card-subtitle">
            A fase judicial da recuperação: quando a sequência de cobrança se esgota, o crédito segue para injunção.
          </p>
        </div>
      </div>

      <section className="card" data-testid="injuncao-nova">
        <h2 className="card-title">Nova injunção a partir de um crédito vencido</h2>
        <div className="row row-3" style={{ flexWrap: 'wrap', gap: 'var(--sp-3, 0.75rem)', alignItems: 'end' }}>
          <label className="stack stack-1" style={{ minWidth: 320 }}>
            <span className="text-xs text-subtle">Cobrança vencida</span>
            <select data-testid="injuncao-cobranca" data-demo-target="injuncoes-credito" value={cobrancaId} onChange={(e) => setCobrancaId(e.target.value)}>
              <option value="">Escolher…</option>
              {vencidasSemInjuncao.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.descricao} · {formatEur(c.valor)} · vencida {formatDate(c.dataVencimento)}
                </option>
              ))}
            </select>
          </label>
          <label className="row row-2" style={{ alignItems: 'center' }}>
            <input type="checkbox" data-testid="injuncao-comercial" checked={transacaoComercial} onChange={(e) => setTransacaoComercial(e.target.checked)} />
            <span className="text-small">Transação comercial (DL 62/2013)</span>
          </label>
          <label className="row row-2" style={{ alignItems: 'center' }}>
            <input type="checkbox" data-testid="injuncao-consumidor" checked={devedorConsumidor} onChange={(e) => setDevedorConsumidor(e.target.checked)} />
            <span className="text-small">Devedor é consumidor</span>
          </label>
        </div>
        {elegibilidade ? (
          <p className="text-small" data-testid="injuncao-elegibilidade" style={{ color: elegibilidade.elegivel ? 'var(--ok)' : 'var(--danger)' }}>
            {elegibilidade.fundamento}
          </p>
        ) : null}
        <Button data-testid="injuncao-criar" data-demo-target="injuncoes-criar" disabled={aCriar || !elegibilidade || !elegibilidade.elegivel} onClick={criar}>
          <IconGavel /> Preparar injunção
        </Button>
      </section>

      <section className="card">
        <h2 className="card-title">Em curso</h2>
        {injuncoes.length === 0 ? (
          <EmptyState title="Sem injunções" hint="Escolha um crédito vencido acima para preparar a primeira." />
        ) : (
          <ul className="stack stack-2" style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="injuncoes-lista">
            {injuncoes.map((i) => (
              <li key={i.id} data-testid="injuncao-row" data-demo-target={i.demo ? 'injuncao-row' : undefined}>
                <a
                  href={`injuncao/${i.id}`}
                  onClick={(e) => { e.preventDefault(); navigate(`/injuncao/${i.id}`); }}
                  className="row row-3"
                  style={{ padding: 'var(--sp-3, 0.75rem)', border: '1px solid var(--color-border)', borderRadius: 'var(--r-2, 0.5rem)', alignItems: 'center' }}
                >
                  <span className="row-icon" aria-hidden="true"><IconGavel /></span>
                  <span className="stack stack-1" style={{ flex: 1, minWidth: 0 }}>
                    <span className="text-strong">{i.descricao || 'Injunção'}</span>
                    <span className="text-xs text-subtle">{i.devedor} · capital {formatEur(i.capital)}</span>
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
