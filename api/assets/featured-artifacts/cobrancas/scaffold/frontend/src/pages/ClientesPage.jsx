/*
 * CLIENTES - lista da base COMUM do espaço de trabalho com o estado de
 * cobrança sobreposto (overlay clientes_cobranca). A criação manual escreve
 * na PRÓPRIA base comum (criarPartilhada) - a app nunca mantém uma segunda
 * base de clientes; o resto da suite vê o cliente novo de imediato.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { tr, useLang } from '../i18n.js';
import { useColecao, useClientes, useDebounced } from '../hooks.js';
import { Badge, Button, DataTable, Field, Input, Modal, Select, SearchInput, EmptyState, Skeleton, toast } from '../components/ui.jsx';
import { resolverPerfil, indexarOverlay, indexarClientes, eur, estaVencida } from '../components/dominio.jsx';
import { IconClientes, IconPesquisar, IconMais } from '../components/Icons.jsx';
import { criarPartilhada } from '../ekoa.js';
import { itensEmAberto } from '../engine/prestacoes.mjs';
import { calcularScore } from '../engine/comportamento.mjs';
import { round2 } from '../engine/dinheiro.mjs';

/** Tom do badge de score: ok >= 70, warn 40-69, danger < 40. */
function tomDoScore(score) {
  if (score >= 70) return 'ok';
  if (score >= 40) return 'warn';
  return 'danger';
}

const MUTED = { color: 'var(--color-text-subtle, #64748B)', fontSize: 'var(--text-xs, 0.75rem)' };

/** Criação manual de um cliente NA BASE COMUM do espaço de trabalho. */
function NovoClienteModal({ open, onClose, onCriado }) {
  useLang();
  const [form, setForm] = useState({ nome: '', nif: '', email: '', telefone: '', tipo: 'empresa', morada: '' });
  const [aGravar, setAGravar] = useState(false);
  const set = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  async function criar() {
    if (!form.nome.trim()) {
      toast(tr('Indique o nome do cliente.', 'Enter the customer name.'), { tone: 'error' });
      return;
    }
    if (form.email && !form.email.includes('@')) {
      toast(tr('O email indicado não é válido.', 'The email address is not valid.'), { tone: 'error' });
      return;
    }
    setAGravar(true);
    try {
      const criado = await criarPartilhada('clientes', {
        nome: form.nome.trim(),
        nif: form.nif.trim() || null,
        email: form.email.trim() || null,
        telefone: form.telefone.trim() || null,
        tipo: form.tipo,
        morada: form.morada.trim() || null,
      });
      toast(tr('Cliente criado na base comum do espaço de trabalho.', 'Customer created in the common workspace database.'), { tone: 'ok' });
      setForm({ nome: '', nif: '', email: '', telefone: '', tipo: 'empresa', morada: '' });
      onCriado(criado);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), { tone: 'error' });
    } finally {
      setAGravar(false);
    }
  }

  return (
    <Modal
      open={open}
      title={tr('Novo cliente', 'New customer')}
      onClose={onClose}
      actions={(
        <>
          <Button variant="ghost" onClick={onClose}>{tr('Cancelar', 'Cancel')}</Button>
          <Button onClick={criar} disabled={aGravar} data-testid="btn-criar-cliente">
            {aGravar ? tr('A criar…', 'Creating…') : tr('Criar cliente', 'Create customer')}
          </Button>
        </>
      )}
    >
      <p style={MUTED}>
        {tr(
          'O cliente é criado na base comum do espaço de trabalho — fica visível em todas as aplicações, não só nas Cobranças.',
          'The customer is created in the common workspace database — visible to every app, not just Collections.',
        )}
      </p>
      <div className="form-grelha">
        <Field label={tr('Nome', 'Name')} required htmlFor="nc-nome">
          <Input id="nc-nome" value={form.nome} onChange={set('nome')} data-testid="nc-nome" />
        </Field>
        <Field label="NIF" htmlFor="nc-nif">
          <Input id="nc-nif" value={form.nif} onChange={set('nif')} data-testid="nc-nif" />
        </Field>
        <Field label={tr('Tipo', 'Type')} htmlFor="nc-tipo">
          <Select id="nc-tipo" value={form.tipo} onChange={set('tipo')}>
            <option value="empresa">{tr('Empresa', 'Company')}</option>
            <option value="particular">{tr('Particular', 'Individual')}</option>
          </Select>
        </Field>
        <Field label="Email" htmlFor="nc-email" hint={tr('Necessário para lembretes por email.', 'Needed for email reminders.')}>
          <Input id="nc-email" type="email" value={form.email} onChange={set('email')} data-testid="nc-email" />
        </Field>
        <Field label={tr('Telefone', 'Phone')} htmlFor="nc-telefone">
          <Input id="nc-telefone" value={form.telefone} onChange={set('telefone')} />
        </Field>
        <Field label={tr('Morada', 'Address')} htmlFor="nc-morada">
          <Input id="nc-morada" value={form.morada} onChange={set('morada')} />
        </Field>
      </div>
    </Modal>
  );
}

export default function ClientesPage() {
  useLang();
  const navigate = useNavigate();

  const clientes = useClientes();
  const overlay = useColecao('clientes_cobranca');
  const dividas = useColecao('dividas');
  const pagamentos = useColecao('pagamentos');
  const perfis = useColecao('perfis');
  const tempo = useColecao('linha_tempo');

  const [pesquisa, setPesquisa] = useState('');
  const [perfilFiltro, setPerfilFiltro] = useState('');
  const [soComDivida, setSoComDivida] = useState(false);
  const pesquisaLenta = useDebounced(pesquisa, 250);

  const carregando = clientes.loading || overlay.loading || dividas.loading
    || pagamentos.loading || perfis.loading || tempo.loading;

  const erroCarregamento = overlay.error || dividas.error || pagamentos.error
    || perfis.error || tempo.error;
  useEffect(() => {
    if (erroCarregamento) {
      toast(tr('Falha ao carregar os dados de cobrança. Tente recarregar a página.', 'Failed to load collection data. Try reloading the page.'), { tone: 'error' });
    }
  }, [erroCarregamento]);

  const overlayMap = useMemo(() => indexarOverlay(overlay.items), [overlay.items]);
  const clientesById = useMemo(() => indexarClientes(clientes.items), [clientes.items]);

  // Saldos em aberto/vencidos por cliente (mesma aritmética do resto da app).
  const saldosPorCliente = useMemo(() => {
    const itens = itensEmAberto(dividas.items, pagamentos.items, clientesById);
    const m = new Map();
    for (const it of itens) {
      const agg = m.get(it.clienteId) || { aberto: 0, vencido: 0 };
      agg.aberto = round2(agg.aberto + Number(it.valorEmDivida || 0));
      if (estaVencida(it)) agg.vencido = round2(agg.vencido + Number(it.valorEmDivida || 0));
      m.set(it.clienteId, agg);
    }
    return m;
  }, [dividas.items, pagamentos.items, clientesById]);

  const nDividasPorCliente = useMemo(() => {
    const m = new Map();
    for (const d of dividas.items) m.set(d.clienteId, (m.get(d.clienteId) || 0) + 1);
    return m;
  }, [dividas.items]);

  // Score de comportamento por cliente; promessas quebradas contam-se na
  // linha do tempo imutável (tipo 'promessa-quebrada').
  const scorePorCliente = useMemo(() => {
    const dividasDe = new Map();
    for (const d of dividas.items) {
      const lista = dividasDe.get(d.clienteId) || [];
      lista.push(d);
      dividasDe.set(d.clienteId, lista);
    }
    const pagamentosDe = new Map();
    for (const p of pagamentos.items) {
      const lista = pagamentosDe.get(p.clienteId) || [];
      lista.push(p);
      pagamentosDe.set(p.clienteId, lista);
    }
    const quebradasDe = new Map();
    for (const ev of tempo.items) {
      if (ev.tipo === 'promessa-quebrada') quebradasDe.set(ev.clienteId, (quebradasDe.get(ev.clienteId) || 0) + 1);
    }
    const m = new Map();
    for (const c of clientes.items) {
      m.set(c.id, calcularScore({
        dividas: dividasDe.get(c.id) || [],
        pagamentos: pagamentosDe.get(c.id) || [],
        promessasQuebradas: quebradasDe.get(c.id) || 0,
      }));
    }
    return m;
  }, [clientes.items, dividas.items, pagamentos.items, tempo.items]);

  const linhas = useMemo(() => {
    const termo = pesquisaLenta.trim().toLowerCase();
    const filtradas = clientes.items.filter((c) => {
      if (termo) {
        const nome = String(c.nome || '').toLowerCase();
        const nif = String(c.nif || '').toLowerCase();
        if (!nome.includes(termo) && !nif.includes(termo)) return false;
      }
      if (perfilFiltro) {
        const p = resolverPerfil(overlayMap, perfis.items, c.id);
        if (!p || p.id !== perfilFiltro) return false;
      }
      if (soComDivida) {
        const s = saldosPorCliente.get(c.id);
        if (!s || s.aberto <= 0) return false;
      }
      return true;
    });
    // Por omissão: maior dívida aberta primeiro; empate por nome.
    return filtradas.sort((a, b) => {
      const sa = (saldosPorCliente.get(a.id) || { aberto: 0 }).aberto;
      const sb = (saldosPorCliente.get(b.id) || { aberto: 0 }).aberto;
      if (sb !== sa) return sb - sa;
      return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt');
    });
  }, [clientes.items, pesquisaLenta, perfilFiltro, soComDivida, overlayMap, perfis.items, saldosPorCliente]);

  const colunas = [
    {
      key: 'nome',
      label: tr('Cliente', 'Customer'),
      render: (c) => (
        <div>
          <div style={{ fontWeight: 600 }}>{c.nome || '—'}</div>
          {c.nif ? <div style={MUTED}>{tr('NIF', 'Tax ID')} {c.nif}</div> : null}
        </div>
      ),
    },
    {
      key: 'perfil',
      label: tr('Perfil', 'Profile'),
      render: (c) => {
        const p = resolverPerfil(overlayMap, perfis.items, c.id);
        return p ? p.nome : <span style={MUTED}>—</span>;
      },
    },
    {
      key: 'score',
      label: tr('Score', 'Score'),
      render: (c) => {
        const r = scorePorCliente.get(c.id);
        if (!r || (r.inputs.itensLiquidados === 0 && r.inputs.promessasQuebradas === 0)) {
          return <Badge tone="neutral">—</Badge>;
        }
        return <Badge tone={tomDoScore(r.score)}>{r.score}</Badge>;
      },
    },
    {
      key: 'flags',
      label: tr('Sinalizações', 'Flags'),
      render: (c) => {
        const o = overlayMap.get(c.id);
        const flags = [];
        if (o && o.naoContactar) flags.push(<Badge key="nc" tone="danger">{tr('Não contactar', 'Do not contact')}</Badge>);
        if (o && o.chasingPausado) flags.push(<Badge key="pa" tone="neutral">{tr('Cobrança pausada', 'Chasing paused')}</Badge>);
        if (o && o.emLitigio) flags.push(<Badge key="li" tone="danger">{tr('Em contencioso', 'In litigation')}</Badge>);
        if (o && o.insolvente) flags.push(<Badge key="in" tone="warn">{tr('Insolvente', 'Insolvent')}</Badge>);
        if (!flags.length) return <span style={MUTED}>—</span>;
        return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{flags}</div>;
      },
    },
    {
      key: 'aberto',
      label: tr('Em dívida', 'Outstanding'),
      alinhar: 'direita',
      render: (c) => {
        const s = saldosPorCliente.get(c.id);
        return s && s.aberto > 0 ? <strong>{eur(s.aberto)}</strong> : <span style={MUTED}>{eur(0)}</span>;
      },
    },
    {
      key: 'vencido',
      label: tr('Vencido', 'Overdue'),
      alinhar: 'direita',
      render: (c) => {
        const s = saldosPorCliente.get(c.id);
        if (!s || s.vencido <= 0) return <span style={MUTED}>—</span>;
        return <span style={{ color: 'var(--color-danger, #DC2626)', fontWeight: 600 }}>{eur(s.vencido)}</span>;
      },
    },
    {
      key: 'ndividas',
      label: tr('Dívidas', 'Debts'),
      alinhar: 'direita',
      render: (c) => nDividasPorCliente.get(c.id) || 0,
    },
  ];

  const baseVazia = !clientes.loading && clientes.items.length === 0;
  const [novoAberto, setNovoAberto] = useState(false);

  const aoCriarCliente = (criado) => {
    setNovoAberto(false);
    clientes.refresh();
    if (criado && criado.id) navigate(`/clientes/${criado.id}`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4, 1rem)' }}>
      <NovoClienteModal open={novoAberto} onClose={() => setNovoAberto(false)} onCriado={aoCriarCliente} />
      <p style={{ color: 'var(--color-text-muted, #475569)', fontSize: 'var(--text-sm, 0.875rem)' }} data-testid="nota-base-comum">
        {tr(
          'Os clientes vivem na base comum do espaço de trabalho — criar aqui é criar para todas as aplicações.',
          'Customers live in the common workspace database — creating one here creates it for every app.',
        )}
      </p>

      {carregando ? (
        <div className="cartao"><Skeleton lines={6} /></div>
      ) : baseVazia ? (
        <div className="cartao">
          <EmptyState
            icon={<IconClientes size={40} />}
            title={tr('Sem clientes no espaço de trabalho', 'No customers in the workspace')}
            hint={tr(
              'A base comum ainda não tem clientes. Crie o primeiro aqui — fica disponível em todas as aplicações do espaço de trabalho.',
              'The common database has no customers yet. Create the first one here — it becomes available to every workspace app.',
            )}
            action={(
              <Button onClick={() => setNovoAberto(true)} data-testid="btn-novo-cliente-vazio">
                <IconMais size={16} />
                {tr('Novo cliente', 'New customer')}
              </Button>
            )}
          />
        </div>
      ) : (
        <>
          <div className="linha-acoes no-print">
            <SearchInput
              value={pesquisa}
              onChange={setPesquisa}
              placeholder={tr('Pesquisar por nome ou NIF…', 'Search by name or tax ID…')}
              data-testid="pesquisa-clientes"
              aria-label={tr('Pesquisar clientes', 'Search customers')}
            />
            <Select
              value={perfilFiltro}
              onChange={(e) => setPerfilFiltro(e.target.value)}
              data-testid="filtro-perfil"
              aria-label={tr('Filtrar por perfil', 'Filter by profile')}
              style={{ maxWidth: 220 }}
            >
              <option value="">{tr('Todos os perfis', 'All profiles')}</option>
              {perfis.items.map((p) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </Select>
            <label
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-sm, 0.875rem)', cursor: 'pointer', userSelect: 'none' }}
              data-testid="filtro-so-divida-aberta"
              data-demo-target="filtro-so-divida-aberta"
            >
              <input
                type="checkbox"
                checked={soComDivida}
                onChange={(e) => setSoComDivida(e.target.checked)}
              />
              {tr('Só com dívida aberta', 'Only with open debt')}
            </label>
            <span className="espacador" />
            <span style={MUTED} data-testid="contagem-clientes">
              {tr(
                `${linhas.length} de ${clientes.items.length} clientes`,
                `${linhas.length} of ${clientes.items.length} customers`,
              )}
            </span>
            <Button onClick={() => setNovoAberto(true)} data-testid="btn-novo-cliente" data-demo-target="clientes-novo">
              <IconMais size={16} />
              {tr('Novo cliente', 'New customer')}
            </Button>
          </div>

          <div data-demo-target="tabela-clientes">
            <DataTable
              columns={colunas}
              rows={linhas}
              rowKey={(c) => c.id}
              onRowClick={(c) => navigate(`/clientes/${c.id}`)}
              data-testid="tabela-clientes"
              empty={(
                <div className="cartao">
                  <EmptyState
                    icon={<IconPesquisar size={36} />}
                    title={tr('Sem resultados', 'No results')}
                    hint={tr('Ajuste a pesquisa ou os filtros para ver clientes.', 'Adjust the search or the filters to see customers.')}
                  />
                </div>
              )}
            />
          </div>
        </>
      )}
    </div>
  );
}
