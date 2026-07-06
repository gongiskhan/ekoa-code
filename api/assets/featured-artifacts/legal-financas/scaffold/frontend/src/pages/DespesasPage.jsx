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
import { IconPlus, IconReceipt, IconCheck, IconUpload } from '../components/Icons.jsx';
import {
  round2,
  hojeISO,
  CATEGORIAS,
  categoriaLabel,
  DESPESA_ESTADO_LABEL,
  DESPESA_ESTADO_TONE,
} from './financas-logic.js';

const EMPTY_FORM = {
  processoId: '',
  clienteId: '',
  categoria: 'taxas',
  descricao: '',
  valor: '',
  data: '',
  reembolsavel: true,
};

export default function DespesasPage() {
  const { items: despesas, loading, refresh } = useSharedCollection('despesas');
  const { items: processos } = useSharedCollection('processos');
  const { items: clientes } = useSharedCollection('clientes');
  const { items: documentos, refresh: refreshDocumentos } = useSharedCollection('documentos');

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [fEstado, setFEstado] = useState('');

  const processoById = useMemo(() => {
    const map = new Map();
    processos.forEach((p) => map.set(p.id, p));
    return map;
  }, [processos]);

  const clienteNome = useMemo(() => {
    const map = new Map();
    clientes.forEach((c) => map.set(c.id, c.nome));
    return (id) => map.get(id) || '';
  }, [clientes]);

  const docsPorDespesa = useMemo(() => {
    const map = new Map();
    documentos.forEach((d) => {
      if (d.origem === 'despesa-comprovativo' && d.despesaId) {
        map.set(d.despesaId, (map.get(d.despesaId) || 0) + 1);
      }
    });
    return map;
  }, [documentos]);

  const rows = useMemo(() => {
    let list = despesas.slice();
    if (fEstado) list = list.filter((d) => (d.estado || 'registada') === fEstado);
    return list.sort((a, b) =>
      (String(b.data || '') + String(b.createdAt || '')).localeCompare(
        String(a.data || '') + String(a.createdAt || ''),
      ),
    );
  }, [despesas, fEstado]);

  function onOpen() {
    setForm({ ...EMPTY_FORM, data: hojeISO() });
    setErro(null);
    setOpen(true);
  }

  function onSelectProcesso(id) {
    const p = processoById.get(id);
    setForm((prev) => ({ ...prev, processoId: id, clienteId: p ? p.clienteId || '' : prev.clienteId }));
  }

  const valor = form.valor === '' ? null : round2(form.valor);
  const saveDisabled = saving || !form.descricao.trim() || valor == null || !Number.isFinite(valor) || valor <= 0;

  async function onSave() {
    setErro(null);
    if (!form.descricao.trim()) { setErro('Indique a descrição.'); return; }
    if (valor == null || !Number.isFinite(valor) || valor <= 0) {
      setErro('Indique um valor válido, maior do que zero.');
      return;
    }
    setSaving(true);
    try {
      await createShared('despesas', {
        // FK só quando resolve - nunca gravar um id que não aponta a nada.
        processoId: form.processoId || null,
        clienteId: form.clienteId || null,
        categoria: form.categoria,
        descricao: form.descricao.trim(),
        valor,
        data: form.data || hojeISO(),
        reembolsavel: !!form.reembolsavel,
        estado: 'registada',
      });
      await refresh();
      setOpen(false);
      toast('Despesa registada.', { tone: 'ok' });
    } catch (e) {
      setErro((e && e.message) || 'Não foi possível registar a despesa.');
    } finally {
      setSaving(false);
    }
  }

  /*
   * Aprovar uma despesa. Se for reembolsável, imputa-se ao cliente: escreve-se um
   * DÉBITO na conta corrente (origem 'despesa'). A guarda `contaLancada` evita a
   * dupla imputação se a aprovação for repetida.
   */
  async function onAprovar(despesa) {
    if (!despesa || despesa.estado !== 'registada') return;
    setBusyId(despesa.id);
    try {
      const patch = { estado: 'aprovada', aprovadaEm: new Date().toISOString() };
      if (despesa.reembolsavel && despesa.clienteId && !despesa.contaLancada) {
        await createShared('conta_corrente', {
          clienteId: despesa.clienteId,
          tipo: 'debito',
          origem: 'despesa',
          valor: round2(despesa.valor),
          data: hojeISO(),
          notas: `Despesa reembolsável: ${despesa.descricao || categoriaLabel(despesa.categoria)}`,
        });
        patch.contaLancada = true;
      }
      await updateShared('despesas', despesa.id, patch);
      await refresh();
      toast(
        despesa.reembolsavel && despesa.clienteId
          ? 'Despesa aprovada e debitada na conta corrente do cliente.'
          : 'Despesa aprovada.',
        { tone: 'ok' },
      );
    } catch (e) {
      toast((e && e.message) || 'Não foi possível aprovar a despesa.', { tone: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  /* Associar comprovativo: um documento-metadado no Dossiê (padrão dossiê). */
  async function onAssociarComprovativo(despesa) {
    if (!despesa) return;
    setBusyId(despesa.id);
    try {
      await createShared('documentos', {
        nome: `Comprovativo - ${despesa.descricao || categoriaLabel(despesa.categoria)}`,
        tipo: 'pdf',
        origem: 'despesa-comprovativo',
        despesaId: despesa.id,
        processoId: despesa.processoId || null,
        clienteId: despesa.clienteId || null,
        data: hojeISO(),
        versao: 1,
      });
      await refreshDocumentos();
      toast('Comprovativo associado ao Dossiê.', { tone: 'ok' });
    } catch (e) {
      toast((e && e.message) || 'Não foi possível associar o comprovativo.', { tone: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div data-testid="despesas-page" data-demo-page="financas/despesas">
      <div className="page-header">
        <div>
          <h1 className="page-title">Despesas</h1>
          <p className="page-subtitle">
            Taxas, certidões e deslocações por processo. Ao aprovar uma despesa reembolsável, ela é
            debitada na conta corrente do cliente.
          </p>
        </div>
        <Button data-testid="financas-despesa-nova" data-demo-target="financas-despesa-nova" onClick={onOpen}>
          <IconPlus /> Nova despesa
        </Button>
      </div>

      <div className="filters" style={{ marginTop: 'var(--sp-6, 1.5rem)' }}>
        <Select data-testid="despesas-filtro-estado" value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
          <option value="">Todos os estados</option>
          <option value="registada">Registadas</option>
          <option value="aprovada">Aprovadas</option>
          <option value="faturada">Faturadas</option>
        </Select>
      </div>

      {loading ? (
        <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar despesas.</span></div>
      ) : (
        <DataTable
          data-testid="despesas-tabela"
          columns={[
            { key: 'data', label: 'Data', render: (d) => formatDate(d.data) },
            { key: 'processo', label: 'Processo / Cliente', render: (d) => (
              <div className="stack stack-1">
                <span className="text-strong">{processoById.get(d.processoId)?.numeroProcesso || '—'}</span>
                <span className="text-subtle text-xs">{clienteNome(d.clienteId) || clienteNome(processoById.get(d.processoId)?.clienteId)}</span>
              </div>
            ) },
            { key: 'categoria', label: 'Categoria', render: (d) => categoriaLabel(d.categoria) },
            { key: 'descricao', label: 'Descrição', render: (d) => (
              <div className="stack stack-1">
                <span>{d.descricao || '—'}</span>
                {docsPorDespesa.get(d.id) ? (
                  <span className="text-subtle text-xs">{docsPorDespesa.get(d.id)} comprovativo(s)</span>
                ) : null}
              </div>
            ) },
            { key: 'reembolsavel', label: 'Reemb.', render: (d) => (
              d.reembolsavel ? <Badge tone="info">Reembolsável</Badge> : <Badge tone="neutral">Não</Badge>
            ) },
            { key: 'valor', label: 'Valor', align: 'right', render: (d) => (
              <span className="text-strong">{formatEur(d.valor)}</span>
            ) },
            { key: 'estado', label: 'Estado', render: (d) => (
              <Badge tone={DESPESA_ESTADO_TONE[d.estado] || 'neutral'} data-testid={`despesa-estado-${d.id}`}>
                {DESPESA_ESTADO_LABEL[d.estado] || d.estado || '—'}
              </Badge>
            ) },
            { key: 'acoes', label: '', render: (d) => (
              <span className="row" style={{ gap: 'var(--sp-2, 0.5rem)', justifyContent: 'flex-end' }}>
                <Button
                  variant="secondary"
                  size="sm"
                  data-testid={`despesa-comprovativo-${d.id}`}
                  disabled={busyId === d.id}
                  onClick={() => onAssociarComprovativo(d)}
                >
                  <IconUpload /> Comprovativo
                </Button>
                {d.estado === 'registada' ? (
                  <Button
                    size="sm"
                    data-testid={`despesa-aprovar-${d.id}`}
                    disabled={busyId === d.id}
                    onClick={() => onAprovar(d)}
                  >
                    <IconCheck /> Aprovar
                  </Button>
                ) : null}
              </span>
            ) },
          ]}
          rows={rows}
          rowKey="id"
          empty={<EmptyState icon={<IconReceipt />} title="Sem despesas" hint="Registe a primeira despesa deste filtro." />}
        />
      )}

      <Modal
        open={open}
        title="Nova despesa"
        onClose={() => setOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button data-testid="despesa-guardar" onClick={onSave} disabled={saveDisabled}>
              {saving ? 'A guardar.' : 'Guardar despesa'}
            </Button>
          </>
        }
      >
        <div className="form">
          <Field label="Processo">
            <Select data-testid="despesa-processo" value={form.processoId} onChange={(e) => onSelectProcesso(e.target.value)}>
              <option value="">Sem processo associado</option>
              {processos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.numeroProcesso || '(sem número)'}{clienteNome(p.clienteId) ? ` - ${clienteNome(p.clienteId)}` : ''}
                </option>
              ))}
            </Select>
          </Field>

          <div className="form-grid">
            <Field label="Cliente">
              <Select data-testid="despesa-cliente" value={form.clienteId} onChange={(e) => setForm((p) => ({ ...p, clienteId: e.target.value }))}>
                <option value="">Sem cliente</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </Select>
            </Field>
            <Field label="Categoria">
              <Select data-testid="despesa-categoria" value={form.categoria} onChange={(e) => setForm((p) => ({ ...p, categoria: e.target.value }))}>
                {CATEGORIAS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Descrição" required>
            <Input
              type="text"
              data-testid="despesa-descricao"
              placeholder="Ex.: Taxa de justiça - articulado superveniente"
              value={form.descricao}
              onChange={(e) => setForm((p) => ({ ...p, descricao: e.target.value }))}
            />
          </Field>

          <div className="form-grid">
            <Field label="Valor (€)" required>
              <Input
                type="number" min="0" step="0.01" inputMode="decimal"
                data-testid="despesa-valor"
                placeholder="102.00"
                value={form.valor}
                onChange={(e) => setForm((p) => ({ ...p, valor: e.target.value }))}
              />
            </Field>
            <Field label="Data">
              <Input
                type="date"
                data-testid="despesa-data"
                value={form.data}
                onChange={(e) => setForm((p) => ({ ...p, data: e.target.value }))}
              />
            </Field>
          </div>

          <label className="field field-checkbox" style={{ flexDirection: 'row', alignItems: 'center', gap: 'var(--sp-2, 0.5rem)' }}>
            <input
              type="checkbox"
              className="checkbox"
              data-testid="despesa-reembolsavel"
              checked={form.reembolsavel}
              onChange={(e) => setForm((p) => ({ ...p, reembolsavel: e.target.checked }))}
            />
            <span className="field-label" style={{ margin: 0 }}>Reembolsável pelo cliente</span>
          </label>

          {erro ? <p className="resultado-erro" data-testid="despesa-erro">{erro}</p> : null}
        </div>
      </Modal>
    </div>
  );
}
