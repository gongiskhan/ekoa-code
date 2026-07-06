import { useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useSharedCollection, createShared } from '../shared.js';
import { Button, Field, Select, Input, toast } from '../components/ui.jsx';
import { IconChevronRight, IconLifeBuoy } from '../components/Icons.jsx';
import { TIPO_PEDIDO_OPTIONS } from './apoio-logic.js';
import { SinoaDisclaimer } from './PedidosPage.jsx';

/* 'YYYY-MM-DD' local de hoje - valor por omissão da data do pedido. */
function hojeStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function NovoPedidoPage() {
  const navigate = useNavigate();
  const { items: clientes } = useSharedCollection('clientes');
  const { items: processos } = useSharedCollection('processos');

  const [clienteId, setClienteId] = useState('');
  const [tipoPedido, setTipoPedido] = useState('proteccao_juridica');
  const [processoId, setProcessoId] = useState('');
  const [dataPedido, setDataPedido] = useState(hojeStr());
  const [guardando, setGuardando] = useState(false);

  const clienteNome = useMemo(() => {
    const map = new Map();
    clientes.forEach((c) => map.set(c.id, c.nome));
    return (id) => map.get(id) || '';
  }, [clientes]);

  // Processos do cliente escolhido (o processo é opcional; a protecção jurídica
  // pode preceder a existência de um processo).
  const processosDoCliente = useMemo(
    () => (clienteId ? processos.filter((p) => p.clienteId === clienteId) : processos),
    [processos, clienteId],
  );

  async function onSubmit(e) {
    e.preventDefault();
    if (!clienteId) { toast('Escolha o cliente do pedido.', { tone: 'error' }); return; }
    if (!dataPedido.trim()) { toast('Indique a data do pedido.', { tone: 'error' }); return; }
    setGuardando(true);
    try {
      const created = await createShared('apoio_judiciario', {
        clienteId,
        tipoPedido,
        ...(processoId ? { processoId } : {}),
        estado: 'preparacao',
        datas: { pedido: dataPedido.trim() },
        prazosGerados: [],
        honorarios: { fase: 'inicial', despesas: [] },
      });
      toast('Pedido criado em preparação.', { tone: 'ok' });
      if (created && created.id) {
        navigate(`/pedido/${created.id}`);
      } else {
        navigate('/');
      }
    } catch (err) {
      toast((err && err.message) || 'Não foi possível criar o pedido.', { tone: 'error' });
      setGuardando(false);
    }
  }

  return (
    <div data-testid="novo-pedido-page" data-demo-page="apoio/novo">
      <nav className="row row-1 text-subtle text-xs" aria-label="Migalhas" style={{ alignItems: 'center', marginBottom: 'var(--sp-3, 0.75rem)' }}>
        <Link to="/" className="stat-link">Pedidos</Link>
        <IconChevronRight size={12} />
        <span>Novo pedido</span>
      </nav>

      <div className="page-header">
        <div>
          <h1 className="page-title">Novo pedido de apoio judiciário</h1>
          <p className="page-subtitle">
            O pedido nasce em preparação. Depois de reunido, o advogado submete-o no SinOA e regista
            aqui a notificação da decisão para gerar os prazos.
          </p>
        </div>
      </div>

      <SinoaDisclaimer />

      <div className="prazos-layout" style={{ marginTop: 'var(--sp-6, 1.5rem)' }}>
        <section className="card" aria-label="Dados do pedido">
          <h2 className="card-title">Dados do pedido</h2>
          <form className="form" data-testid="apoio-form" style={{ marginTop: 'var(--sp-4, 1rem)' }} onSubmit={onSubmit}>
            <Field label="Cliente" required>
              <Select
                data-testid="apoio-cliente"
                value={clienteId}
                onChange={(e) => { setClienteId(e.target.value); setProcessoId(''); }}
              >
                <option value="">Seleccione o cliente.</option>
                {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </Select>
            </Field>

            <div className="form-grid">
              <Field label="Tipo de pedido" required>
                <Select data-testid="apoio-tipo" value={tipoPedido} onChange={(e) => setTipoPedido(e.target.value)}>
                  {TIPO_PEDIDO_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </Field>

              <Field label="Data do pedido" required>
                <Input
                  type="date"
                  data-testid="apoio-data"
                  value={dataPedido}
                  onChange={(e) => setDataPedido(e.target.value)}
                />
              </Field>
            </div>

            <Field label="Processo (opcional)" hint="A protecção jurídica pode preceder a abertura do processo.">
              <Select data-testid="apoio-processo" value={processoId} onChange={(e) => setProcessoId(e.target.value)}>
                <option value="">Sem processo associado</option>
                {processosDoCliente.map((p) => {
                  const nome = clienteNome(p.clienteId);
                  return (
                    <option key={p.id} value={p.id}>
                      {(p.numeroProcesso || '(sem número)') + (nome && !clienteId ? ` - ${nome}` : '')}
                    </option>
                  );
                })}
              </Select>
            </Field>

            <div className="row row-2">
              <Button type="submit" data-testid="apoio-criar" disabled={guardando}>
                <IconLifeBuoy size={14} /> {guardando ? 'A criar.' : 'Criar pedido'}
              </Button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
