import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSharedCollection, createShared, updateShared, deleteShared, listShared, formatDate } from '../shared.js';
import { isDemoActive } from '../demo.js';
import { Button, Badge, EmptyState, useToast } from '../components/ui.jsx';
import { IconBuilding, IconChevronRight, IconPlus } from '../components/Icons.jsx';
import { calendarioObrigacoes } from '../rcbe.js';

/*
 * Carteira de entidades clientes sujeitas a RCBE. Cada entidade liga a um
 * cliente-empresa da espinha; os BOs vivem na colecção PARTILHADA
 * `beneficiarios_efetivos` (uma estrutura, duas apps - P2-007).
 */
export default function EntidadesPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const { items: entidades, refresh } = useSharedCollection('rcbe_entidades');
  const { items: clientes } = useSharedCollection('clientes');
  const { items: bos } = useSharedCollection('beneficiarios_efetivos');
  const [clienteId, setClienteId] = useState('');
  const [aCriar, setACriar] = useState(false);

  const hoje = new Date().toISOString().slice(0, 10);

  // REPETIBILIDADE da demonstração: com uma tour activa, a entidade demo volta
  // ao estado inicial (obrigação em atraso, sem declaração) e os artefactos
  // produzidos por tours anteriores (comprovativos/avenças demo) são removidos.
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
        const ents = (await listShared('rcbe_entidades')).filter((e) => e && e.demo === true);
        for (const e of ents) {
          await updateShared('rcbe_entidades', e.id, { ultimaDeclaracaoEm: null, passosPortal: {} });
          const obr = (await listShared('rcbe_obrigacoes')).filter((o) => o && o.demo === true && o.entidadeId === e.id);
          for (const o of obr) await updateShared('rcbe_obrigacoes', o.id, { estado: 'em_atraso', cumpridaEm: null });
          for (const col of ['documentos', 'lancamentos']) {
            const derivadas = (await listShared(col)).filter((r) => r && r.demo === true && (r.entidadeId === e.id || /Avença RCBE/i.test(String(r.descricao || r.nome || ''))));
            for (const r of derivadas) await deleteShared(col, r.id);
          }
        }
        if (ents.length > 0) await refresh();
      } catch { /* não fatal */ }
    }, 350);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const empresasSemEntidade = useMemo(() => {
    const usados = new Set(entidades.map((e) => e.clienteId).filter(Boolean));
    return clientes.filter((c) => c.tipo === 'empresa' && !usados.has(c.id));
  }, [clientes, entidades]);

  const bosDe = (e) => bos.filter((b) => b.entidadeNipc === e.nipc || b.entidadeId === e.id);
  const atrasosDe = (e) => {
    try { return calendarioObrigacoes(e, hoje).filter((o) => o.emAtraso).length; } catch { return 0; }
  };

  async function criar() {
    const cliente = empresasSemEntidade.find((c) => c.id === clienteId);
    if (!cliente) return;
    setACriar(true);
    try {
      const row = await createShared('rcbe_entidades', {
        nome: cliente.nome, nipc: cliente.nif || null, clienteId: cliente.id,
        formaJuridica: 'sociedade',
      });
      if (!row || !row.id) throw new Error('falhou');
      toast('Entidade adicionada à carteira RCBE.');
      await refresh();
      navigate(`/entidade/${row.id}`);
    } catch {
      toast('Não foi possível adicionar a entidade.');
    } finally {
      setACriar(false);
    }
  }

  return (
    <div className="stack stack-6" data-demo-page="rcbe/">
      <div className="page-header">
        <div>
          <h1 className="page-title">Beneficiário efetivo - carteira</h1>
          <p className="card-subtitle">
            Entidades clientes com obrigações RCBE: beneficiários com 25% ou mais do capital ou dos direitos de voto
            (com o recurso à direção de topo quando nenhum atinge o limiar), calendário e declarações preparadas.
          </p>
        </div>
      </div>

      <section className="card" data-testid="rcbe-nova">
        <h2 className="card-title">Adicionar entidade</h2>
        <div className="row row-3" style={{ flexWrap: 'wrap', gap: 'var(--sp-3, 0.75rem)', alignItems: 'end' }}>
          <label className="stack stack-1" style={{ minWidth: 280 }}>
            <span className="text-xs text-subtle">Cliente (empresa)</span>
            <select data-testid="rcbe-cliente" value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
              <option value="">Escolher…</option>
              {empresasSemEntidade.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>
          <Button data-testid="rcbe-criar" disabled={aCriar || !clienteId} onClick={criar}>
            <IconPlus /> Adicionar
          </Button>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">Entidades</h2>
        {entidades.length === 0 ? (
          <EmptyState title="Sem entidades em carteira" hint="Adicione o primeiro cliente-empresa sujeito a RCBE." />
        ) : (
          <ul className="stack stack-2" style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="rcbe-lista">
            {entidades.map((e) => {
              const atrasos = atrasosDe(e);
              return (
                <li key={e.id} data-testid="rcbe-row" data-demo-target={e.demo ? 'rcbe-row' : undefined}>
                  <a
                    href={`entidade/${e.id}`}
                    onClick={(ev) => { ev.preventDefault(); navigate(`/entidade/${e.id}`); }}
                    className="row row-3"
                    style={{ padding: 'var(--sp-3, 0.75rem)', border: '1px solid var(--color-border)', borderRadius: 'var(--r-2, 0.5rem)', alignItems: 'center' }}
                  >
                    <span className="row-icon" aria-hidden="true"><IconBuilding /></span>
                    <span className="stack stack-1" style={{ flex: 1, minWidth: 0 }}>
                      <span className="text-strong">{e.nome}</span>
                      <span className="text-xs text-subtle">NIPC {e.nipc || '-'} · {bosDe(e).length} beneficiário(s) efetivo(s)</span>
                    </span>
                    {atrasos > 0 ? <Badge tone="alta">{atrasos} obrigação(ões) em atraso</Badge> : <Badge tone="ok">Em dia</Badge>}
                    <IconChevronRight />
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
