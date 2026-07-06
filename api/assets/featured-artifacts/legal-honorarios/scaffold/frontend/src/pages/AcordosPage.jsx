import { useMemo, useState } from 'react';
import {
  useSharedCollection,
  createShared,
  updateShared,
  formatEur,
} from '../shared.js';
import {
  Button,
  Modal,
  Field,
  Input,
  Select,
  Textarea,
  DataTable,
  Badge,
  EmptyState,
  toast,
} from '../components/ui.jsx';
import { IconPlus, IconEdit, IconCoins } from '../components/Icons.jsx';
import { DisclaimerBanner } from './DashboardPage.jsx';
import { round2 } from './honorarios-logic.js';

const EMPTY_FORM = {
  id: null,
  clienteId: '',
  processoId: '',
  tipo: 'hora',
  tarifaHora: '',
  avencaMensal: '',
  valorFixo: '',
  notas: '',
};

const TIPO_LABEL = { hora: 'À hora', avenca: 'Avença', fixo: 'Valor fixo' };

export default function AcordosPage() {
  const { items: acordos, loading, refresh } = useSharedCollection('acordos');
  const { items: clientes } = useSharedCollection('clientes');
  const { items: processos } = useSharedCollection('processos');

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState(null);

  const clienteNome = useMemo(() => {
    const map = new Map();
    clientes.forEach((c) => map.set(c.id, c.nome));
    return (id) => map.get(id) || '—';
  }, [clientes]);

  const processoNumero = useMemo(() => {
    const map = new Map();
    processos.forEach((p) => map.set(p.id, p.numeroProcesso || '(sem número)'));
    return (id) => map.get(id) || '—';
  }, [processos]);

  // Processos do cliente seleccionado no formulário (para o override).
  const processosDoCliente = useMemo(
    () => processos.filter((p) => p.clienteId === form.clienteId),
    [processos, form.clienteId],
  );

  const rows = useMemo(
    () =>
      acordos.slice().sort((a, b) => clienteNome(a.clienteId).localeCompare(clienteNome(b.clienteId))),
    [acordos, clienteNome],
  );

  function onNew() {
    setForm({ ...EMPTY_FORM });
    setErro(null);
    setOpen(true);
  }

  function onEdit(a) {
    setForm({
      id: a.id,
      clienteId: a.clienteId || '',
      processoId: a.processoId || '',
      tipo: a.tipo || 'hora',
      tarifaHora: a.tarifaHora != null ? String(a.tarifaHora) : '',
      avencaMensal: a.avencaMensal != null ? String(a.avencaMensal) : '',
      valorFixo: a.valorFixo != null ? String(a.valorFixo) : '',
      notas: a.notas || '',
    });
    setErro(null);
    setOpen(true);
  }

  function valorDoForm() {
    if (form.tipo === 'hora') return form.tarifaHora === '' ? null : round2(form.tarifaHora);
    if (form.tipo === 'avenca') return form.avencaMensal === '' ? null : round2(form.avencaMensal);
    return form.valorFixo === '' ? null : round2(form.valorFixo);
  }

  const valor = valorDoForm();
  const saveDisabled = saving || !form.clienteId || valor == null || !Number.isFinite(valor) || valor < 0;

  async function onSave() {
    setErro(null);
    if (!form.clienteId) { setErro('Seleccione o cliente.'); return; }
    if (valor == null || !Number.isFinite(valor) || valor < 0) {
      setErro('Indique um valor válido para o tipo de acordo.');
      return;
    }
    // Um âmbito (cliente + processo-ou-ausência) só pode ter UM acordo - senão a
    // resolução "mais específico vence" fica ambígua. Bloqueia o duplicado (na
    // criação ou ao editar para um âmbito já ocupado por outro acordo).
    const mesmoAmbito = acordos.find(
      (a) => a && a.id !== form.id &&
        a.clienteId === form.clienteId &&
        (a.processoId || '') === (form.processoId || ''),
    );
    if (mesmoAmbito) {
      toast('Já existe um acordo para este âmbito. Edite o existente.', { tone: 'error' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        clienteId: form.clienteId,
        tipo: form.tipo,
        notas: form.notas.trim() || null,
      };
      // Override ao nível do processo (opcional) - só quando escolhido.
      if (form.processoId) payload.processoId = form.processoId;
      else payload.processoId = null;
      // Só o campo de valor do tipo escolhido é persistido; os outros ficam a null.
      payload.tarifaHora = form.tipo === 'hora' ? round2(form.tarifaHora) : null;
      payload.avencaMensal = form.tipo === 'avenca' ? round2(form.avencaMensal) : null;
      payload.valorFixo = form.tipo === 'fixo' ? round2(form.valorFixo) : null;

      if (form.id) await updateShared('acordos', form.id, payload);
      else await createShared('acordos', payload);
      await refresh();
      setOpen(false);
      toast(form.id ? 'Acordo actualizado.' : 'Acordo criado.', { tone: 'ok' });
    } catch (e) {
      setErro((e && e.message) || 'Não foi possível guardar o acordo.');
    } finally {
      setSaving(false);
    }
  }

  function acordoValor(a) {
    if (a.tipo === 'hora') return `${formatEur(a.tarifaHora)}/h`;
    if (a.tipo === 'avenca') return `${formatEur(a.avencaMensal)}/mês`;
    return formatEur(a.valorFixo);
  }

  const semClientes = clientes.length === 0;

  return (
    <div data-testid="acordos-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Acordos de honorários</h1>
          <p className="page-subtitle">
            A tarifa acordada por cliente - ou por processo, quando há um acordo específico. O mais
            específico vence.
          </p>
        </div>
        <Button data-testid="novo-acordo" onClick={onNew} disabled={semClientes}>
          <IconPlus /> Novo acordo
        </Button>
      </div>

      <DisclaimerBanner />

      {loading ? (
        <div className="loading" style={{ marginTop: 'var(--sp-6, 1.5rem)' }}>
          <span className="spinner" aria-hidden="true" /><span>A carregar acordos.</span>
        </div>
      ) : (
        <div style={{ marginTop: 'var(--sp-6, 1.5rem)' }}>
          <DataTable
            data-testid="hon-acordos-tabela"
            columns={[
              { key: 'cliente', label: 'Cliente', render: (a) => (
                <span className="text-strong">{clienteNome(a.clienteId)}</span>
              ) },
              { key: 'ambito', label: 'Âmbito', render: (a) => (
                a.processoId
                  ? <Badge tone="info">Processo {processoNumero(a.processoId)}</Badge>
                  : <span className="text-subtle">Todos os processos</span>
              ) },
              { key: 'tipo', label: 'Tipo', render: (a) => TIPO_LABEL[a.tipo] || a.tipo || '—' },
              { key: 'valor', label: 'Valor', align: 'right', render: (a) => (
                <span className="text-strong">{acordoValor(a)}</span>
              ) },
              { key: 'notas', label: 'Notas', render: (a) => a.notas || '—' },
              { key: 'acoes', label: '', align: 'right', render: (a) => (
                <Button variant="ghost" size="sm" data-testid="editar-acordo" onClick={() => onEdit(a)}>
                  <IconEdit /> Editar
                </Button>
              ) },
            ]}
            rows={rows}
            rowKey="id"
            empty={
              <EmptyState
                icon={<IconCoins />}
                title="Sem acordos"
                hint={semClientes ? 'Registe primeiro um cliente no Núcleo.' : 'Crie o primeiro acordo de honorários.'}
              />
            }
          />
        </div>
      )}

      <Modal
        open={open}
        title={form.id ? 'Editar acordo' : 'Novo acordo'}
        onClose={() => setOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button data-testid="guardar-acordo" onClick={onSave} disabled={saveDisabled}>
              {saving ? 'A guardar.' : 'Guardar acordo'}
            </Button>
          </>
        }
      >
        <div className="form">
          <Field label="Cliente" required>
            <Select
              data-testid="acordo-cliente"
              value={form.clienteId}
              onChange={(e) => setForm((p) => ({ ...p, clienteId: e.target.value, processoId: '' }))}
            >
              <option value="">Seleccione o cliente.</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}{c.tipo === 'empresa' ? ' (empresa)' : ''}</option>
              ))}
            </Select>
          </Field>

          <Field
            label="Processo (opcional)"
            hint="Este acordo aplica-se a todos os processos do cliente, salvo acordo específico do processo."
          >
            <Select
              data-testid="acordo-processo"
              value={form.processoId}
              onChange={(e) => setForm((p) => ({ ...p, processoId: e.target.value }))}
              disabled={!form.clienteId}
            >
              <option value="">Todos os processos do cliente</option>
              {processosDoCliente.map((p) => (
                <option key={p.id} value={p.id}>{p.numeroProcesso || '(sem número)'}</option>
              ))}
            </Select>
          </Field>

          <Field label="Tipo de acordo">
            <Select data-testid="acordo-tipo" value={form.tipo} onChange={(e) => setForm((p) => ({ ...p, tipo: e.target.value }))}>
              <option value="hora">À hora</option>
              <option value="avenca">Avença mensal</option>
              <option value="fixo">Valor fixo</option>
            </Select>
          </Field>

          {form.tipo === 'hora' ? (
            <Field label="Tarifa/hora (€)" required>
              <Input
                type="number" min="0" step="0.01" inputMode="decimal"
                data-testid="acordo-tarifa"
                placeholder="120.00"
                value={form.tarifaHora}
                onChange={(e) => setForm((p) => ({ ...p, tarifaHora: e.target.value }))}
              />
            </Field>
          ) : form.tipo === 'avenca' ? (
            <Field label="Avença mensal (€)" required>
              <Input
                type="number" min="0" step="0.01" inputMode="decimal"
                data-testid="acordo-avenca"
                placeholder="500.00"
                value={form.avencaMensal}
                onChange={(e) => setForm((p) => ({ ...p, avencaMensal: e.target.value }))}
              />
            </Field>
          ) : (
            <Field label="Valor fixo (€)" required>
              <Input
                type="number" min="0" step="0.01" inputMode="decimal"
                data-testid="acordo-fixo"
                placeholder="1500.00"
                value={form.valorFixo}
                onChange={(e) => setForm((p) => ({ ...p, valorFixo: e.target.value }))}
              />
            </Field>
          )}

          <Field label="Notas">
            <Textarea
              rows={2}
              data-testid="acordo-notas"
              placeholder="Ex.: Tarifa revista anualmente."
              value={form.notas}
              onChange={(e) => setForm((p) => ({ ...p, notas: e.target.value }))}
            />
          </Field>

          {erro ? <p className="resultado-erro" data-testid="acordo-erro">{erro}</p> : null}
        </div>
      </Modal>
    </div>
  );
}
