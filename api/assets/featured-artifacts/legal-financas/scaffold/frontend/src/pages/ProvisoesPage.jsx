import { useMemo, useState } from 'react';
import {
  useSharedCollection,
  createShared,
  updateShared,
  formatEur,
  formatDate,
} from '../shared.js';
import {
  Button,
  Modal,
  Field,
  Input,
  Select,
  DataTable,
  Badge,
  EmptyState,
  toast,
} from '../components/ui.jsx';
import { IconPlus, IconCoins, IconCheck } from '../components/Icons.jsx';
import {
  round2,
  hojeISO,
  PROVISAO_ESTADO_LABEL,
  PROVISAO_ESTADO_TONE,
} from './financas-logic.js';

const EMPTY_FORM = { clienteId: '', processoId: '', valor: '' };

export default function ProvisoesPage() {
  const { items: provisoes, loading, refresh } = useSharedCollection('provisoes');
  const { items: clientes } = useSharedCollection('clientes');
  const { items: processos } = useSharedCollection('processos');

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState(null);
  const [busyId, setBusyId] = useState(null);

  // Modal de consumo: aplica parte do saldo de uma provisão recebida.
  const [consumo, setConsumo] = useState(null); // { provisao, valor }

  const clienteNome = useMemo(() => {
    const map = new Map();
    clientes.forEach((c) => map.set(c.id, c.nome));
    return (id) => map.get(id) || '';
  }, [clientes]);

  const processoLabel = useMemo(() => {
    const map = new Map();
    processos.forEach((p) => map.set(p.id, p.numeroProcesso || '(sem número)'));
    return (id) => (id ? map.get(id) || '—' : '—');
  }, [processos]);

  const processosDoCliente = useMemo(
    () => processos.filter((p) => !form.clienteId || p.clienteId === form.clienteId),
    [processos, form.clienteId],
  );

  const rows = useMemo(() => {
    return provisoes.slice().sort((a, b) =>
      String(b.dataPedido || '').localeCompare(String(a.dataPedido || '')),
    );
  }, [provisoes]);

  const totalEmPoder = useMemo(
    () => round2(provisoes.filter((p) => p.estado === 'recebida').reduce((acc, p) => acc + (Number(p.saldo) || 0), 0)),
    [provisoes],
  );

  function onOpen() {
    setForm({ ...EMPTY_FORM });
    setErro(null);
    setOpen(true);
  }

  const valor = form.valor === '' ? null : round2(form.valor);
  const saveDisabled = saving || !form.clienteId || valor == null || !Number.isFinite(valor) || valor <= 0;

  async function onSave() {
    setErro(null);
    if (!form.clienteId) { setErro('Seleccione o cliente.'); return; }
    if (valor == null || !Number.isFinite(valor) || valor <= 0) {
      setErro('Indique um valor válido, maior do que zero.');
      return;
    }
    setSaving(true);
    try {
      await createShared('provisoes', {
        clienteId: form.clienteId,
        processoId: form.processoId || null,
        valor,
        dataPedido: hojeISO(),
        estado: 'pedida',
        saldo: 0,
      });
      await refresh();
      setOpen(false);
      toast('Provisão pedida ao cliente.', { tone: 'ok' });
    } catch (e) {
      setErro((e && e.message) || 'Não foi possível pedir a provisão.');
    } finally {
      setSaving(false);
    }
  }

  /*
   * Marcar recebida: a provisão passa a 'recebida', o saldo fica igual ao valor
   * pedido, e escreve-se um CRÉDITO na conta corrente do cliente (origem
   * 'pagamento'). A guarda de estado evita o duplo lançamento.
   */
  async function onReceber(prov) {
    if (!prov || prov.estado !== 'pedida') return;
    setBusyId(prov.id);
    try {
      await createShared('conta_corrente', {
        clienteId: prov.clienteId,
        tipo: 'credito',
        origem: 'pagamento',
        valor: round2(prov.valor),
        data: hojeISO(),
        notas: 'Provisão recebida do cliente',
      });
      await updateShared('provisoes', prov.id, {
        estado: 'recebida',
        saldo: round2(prov.valor),
        dataRecebida: hojeISO(),
      });
      await refresh();
      toast('Provisão recebida e creditada na conta corrente.', { tone: 'ok' });
    } catch (e) {
      toast((e && e.message) || 'Não foi possível marcar a provisão como recebida.', { tone: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  /*
   * Registar consumo: decrementa o saldo da provisão pelo valor aplicado (uso de
   * fundos já recebidos - não gera novo movimento de conta corrente, para não
   * duplicar). Quando o saldo chega a zero, a provisão fica 'consumida'.
   */
  async function onConfirmarConsumo() {
    const prov = consumo && consumo.provisao;
    const aplicar = consumo && consumo.valor === '' ? null : round2(consumo && consumo.valor);
    if (!prov) return;
    if (aplicar == null || !Number.isFinite(aplicar) || aplicar <= 0) {
      setConsumo((c) => ({ ...c, erro: 'Indique um valor válido.' }));
      return;
    }
    if (aplicar > Number(prov.saldo)) {
      setConsumo((c) => ({ ...c, erro: 'O consumo não pode exceder o saldo da provisão.' }));
      return;
    }
    setBusyId(prov.id);
    try {
      const novoSaldo = round2(Number(prov.saldo) - aplicar);
      await updateShared('provisoes', prov.id, {
        saldo: novoSaldo,
        estado: novoSaldo <= 0 ? 'consumida' : 'recebida',
      });
      await refresh();
      setConsumo(null);
      toast('Consumo registado sobre a provisão.', { tone: 'ok' });
    } catch (e) {
      setConsumo((c) => ({ ...c, erro: (e && e.message) || 'Não foi possível registar o consumo.' }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div data-testid="provisoes-page" data-demo-page="financas/provisoes">
      <div className="page-header">
        <div>
          <h1 className="page-title">Provisões</h1>
          <p className="page-subtitle">
            Fundos pedidos ao cliente por conta de despesas e honorários futuros. Ao receber, o valor
            é creditado na conta corrente; o saldo desce à medida que é consumido.
          </p>
        </div>
        <Button data-testid="financas-provisao-nova" data-demo-target="financas-provisao-nova" onClick={onOpen}>
          <IconPlus /> Pedir provisão
        </Button>
      </div>

      <div className="kpi-grid" style={{ marginTop: 'var(--sp-6, 1.5rem)' }}>
        <div className="kpi-card">
          <span className="kpi-label">Saldo em poder do escritório</span>
          <span className="kpi-value is-accent" data-testid="provisoes-saldo-total">{formatEur(totalEmPoder)}</span>
          <span className="field-hint">Soma dos saldos das provisões recebidas</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Provisões</span>
          <span className="kpi-value" data-testid="provisoes-count">{provisoes.length}</span>
          <span className="field-hint">Pedidas, recebidas e consumidas</span>
        </div>
      </div>

      {loading ? (
        <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar provisões.</span></div>
      ) : (
        <DataTable
          data-testid="provisoes-tabela"
          className="table-spaced"
          columns={[
            { key: 'cliente', label: 'Cliente / Processo', render: (p) => (
              <div className="stack stack-1">
                <span className="text-strong">{clienteNome(p.clienteId) || '—'}</span>
                <span className="text-subtle text-xs">{processoLabel(p.processoId)}</span>
              </div>
            ) },
            { key: 'dataPedido', label: 'Pedida', render: (p) => formatDate(p.dataPedido) },
            { key: 'valor', label: 'Valor', align: 'right', render: (p) => (
              <span className="text-strong">{formatEur(p.valor)}</span>
            ) },
            { key: 'saldo', label: 'Saldo', align: 'right', render: (p) => (
              <span data-testid={`provisao-saldo-${p.id}`}>{formatEur(p.saldo)}</span>
            ) },
            { key: 'estado', label: 'Estado', render: (p) => (
              <Badge tone={PROVISAO_ESTADO_TONE[p.estado] || 'neutral'} data-testid={`provisao-estado-${p.id}`}>
                {PROVISAO_ESTADO_LABEL[p.estado] || p.estado || '—'}
              </Badge>
            ) },
            { key: 'acoes', label: '', render: (p) => (
              <span className="row" style={{ gap: 'var(--sp-2, 0.5rem)', justifyContent: 'flex-end' }}>
                {p.estado === 'pedida' ? (
                  <Button
                    size="sm"
                    data-testid={`provisao-receber-${p.id}`}
                    disabled={busyId === p.id}
                    onClick={() => onReceber(p)}
                  >
                    <IconCheck /> Marcar recebida
                  </Button>
                ) : p.estado === 'recebida' && Number(p.saldo) > 0 ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid={`provisao-consumir-${p.id}`}
                    disabled={busyId === p.id}
                    onClick={() => setConsumo({ provisao: p, valor: '', erro: null })}
                  >
                    Registar consumo
                  </Button>
                ) : null}
              </span>
            ) },
          ]}
          rows={rows}
          rowKey="id"
          empty={<EmptyState icon={<IconCoins />} title="Sem provisões" hint="Peça a primeira provisão a um cliente." />}
        />
      )}

      <Modal
        open={open}
        title="Pedir provisão"
        onClose={() => setOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button data-testid="provisao-guardar" onClick={onSave} disabled={saveDisabled}>
              {saving ? 'A guardar.' : 'Pedir provisão'}
            </Button>
          </>
        }
      >
        <div className="form">
          <Field label="Cliente" required>
            <Select data-testid="provisao-cliente" value={form.clienteId} onChange={(e) => setForm((p) => ({ ...p, clienteId: e.target.value, processoId: '' }))}>
              <option value="">Seleccione o cliente.</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </Select>
          </Field>
          <Field label="Processo (opcional)">
            <Select data-testid="provisao-processo" value={form.processoId} onChange={(e) => setForm((p) => ({ ...p, processoId: e.target.value }))}>
              <option value="">Sem processo associado</option>
              {processosDoCliente.map((p) => (
                <option key={p.id} value={p.id}>{p.numeroProcesso || '(sem número)'}</option>
              ))}
            </Select>
          </Field>
          <Field label="Valor (€)" required>
            <Input
              type="number" min="0" step="0.01" inputMode="decimal"
              data-testid="provisao-valor"
              placeholder="500.00"
              value={form.valor}
              onChange={(e) => setForm((p) => ({ ...p, valor: e.target.value }))}
            />
          </Field>
          {erro ? <p className="resultado-erro" data-testid="provisao-erro">{erro}</p> : null}
        </div>
      </Modal>

      <Modal
        open={!!consumo}
        title="Registar consumo da provisão"
        onClose={() => setConsumo(null)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setConsumo(null)}>Cancelar</Button>
            <Button data-testid="consumo-guardar" onClick={onConfirmarConsumo} disabled={busyId != null}>
              Registar consumo
            </Button>
          </>
        }
      >
        {consumo ? (
          <div className="form">
            <p className="text-muted" style={{ margin: 0 }}>
              Saldo disponível: <span className="text-strong">{formatEur(consumo.provisao.saldo)}</span>
            </p>
            <Field label="Valor a consumir (€)" required>
              <Input
                type="number" min="0" step="0.01" inputMode="decimal"
                data-testid="consumo-valor"
                value={consumo.valor}
                onChange={(e) => setConsumo((c) => ({ ...c, valor: e.target.value, erro: null }))}
              />
            </Field>
            {consumo.erro ? <p className="resultado-erro" data-testid="consumo-erro">{consumo.erro}</p> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
