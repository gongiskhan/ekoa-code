import { useEffect, useMemo, useState } from 'react';
import {
  useSharedCollection,
  createShared,
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
import { IconPlus, IconCoins } from '../components/Icons.jsx';
import { DisclaimerBanner } from './DashboardPage.jsx';
import {
  round2,
  hojeISO,
  resolveAcordo,
  tarifaDoAcordo,
  avencaDoAcordo,
  valorFixoDoAcordo,
} from './honorarios-logic.js';

const MODO_LABEL = { hora: 'Horas × tarifa', avenca: 'Avença', fixo: 'Valor fixo' };

const EMPTY_FORM = {
  processoId: '',
  clienteId: '',
  tipo: 'honorario',
  modo: 'hora',
  descricao: '',
  horas: '',
  tarifa: '',
  valorManual: '',
  data: '',
};

export default function LancamentosPage() {
  const { items: lancamentos, loading, refresh } = useSharedCollection('lancamentos');
  const { items: processos } = useSharedCollection('processos');
  const { items: clientes } = useSharedCollection('clientes');
  const { items: acordos } = useSharedCollection('acordos');

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  // Once the user edits tarifa / valor by hand, the acordo prefill stops
  // overwriting it - but a new processo or modo re-arms the suggestion.
  const [tarifaTouched, setTarifaTouched] = useState(false);
  const [valorTouched, setValorTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState(null);

  const [fProcesso, setFProcesso] = useState('');
  const [fTipo, setFTipo] = useState('');
  const [fFaturado, setFFaturado] = useState('por-faturar');

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

  const processoLabel = (id) => {
    const p = processoById.get(id);
    if (!p) return '—';
    const nome = clienteNome(p.clienteId);
    return `${p.numeroProcesso || '(sem número)'}${nome ? ` - ${nome}` : ''}`;
  };

  // Acordo resolvido para (cliente, processo) - o mais específico vence.
  const acordoResolvido = useMemo(
    () => resolveAcordo(acordos, { clienteId: form.clienteId, processoId: form.processoId }),
    [acordos, form.clienteId, form.processoId],
  );

  /*
   * PREFILL a partir do acordo, robusto ao carregamento assíncrono das colecções:
   * corre sempre que o acordo resolvido, o modo ou o estado "tocado" mudam - por
   * isso, se os acordos só chegarem DEPOIS de o processo ser escolhido, a tarifa
   * sugerida entra na mesma. O guard de igualdade evita o ciclo de render.
   */
  useEffect(() => {
    if (!open) return;
    if (form.modo === 'hora' && !tarifaTouched) {
      const t = tarifaDoAcordo(acordoResolvido);
      const next = t != null ? String(t) : '';
      setForm((prev) => (prev.tarifa === next ? prev : { ...prev, tarifa: next }));
    }
  }, [open, form.modo, tarifaTouched, acordoResolvido]);

  useEffect(() => {
    if (!open) return;
    if (valorTouched) return;
    if (form.modo === 'avenca') {
      const v = avencaDoAcordo(acordoResolvido);
      const next = v != null ? String(v) : '';
      setForm((prev) => (prev.valorManual === next ? prev : { ...prev, valorManual: next }));
    } else if (form.modo === 'fixo') {
      const v = valorFixoDoAcordo(acordoResolvido);
      const next = v != null ? String(v) : '';
      setForm((prev) => (prev.valorManual === next ? prev : { ...prev, valorManual: next }));
    }
  }, [open, form.modo, valorTouched, acordoResolvido]);

  const rows = useMemo(() => {
    let list = lancamentos.slice();
    if (fProcesso) list = list.filter((l) => l.processoId === fProcesso);
    if (fTipo) list = list.filter((l) => (l.tipo || 'honorario') === fTipo);
    if (fFaturado === 'por-faturar') list = list.filter((l) => l.faturado !== true);
    else if (fFaturado === 'faturado') list = list.filter((l) => l.faturado === true);
    return list.sort((a, b) =>
      (String(b.data || '') + String(b.createdAt || '')).localeCompare(
        String(a.data || '') + String(a.createdAt || ''),
      ),
    );
  }, [lancamentos, fProcesso, fTipo, fFaturado]);

  function onOpen() {
    setForm({ ...EMPTY_FORM, data: hojeISO() });
    setTarifaTouched(false);
    setValorTouched(false);
    setErro(null);
    setOpen(true);
  }

  function onSelectProcesso(id) {
    const p = processoById.get(id);
    // Novo processo re-arma as sugestões do acordo.
    setTarifaTouched(false);
    setValorTouched(false);
    setForm((prev) => ({ ...prev, processoId: id, clienteId: p ? p.clienteId || '' : '' }));
  }

  function onSelectModo(modo) {
    setTarifaTouched(false);
    setValorTouched(false);
    setForm((prev) => ({ ...prev, modo }));
  }

  // Valor efectivo do lançamento a partir do formulário.
  const valorHora = useMemo(() => {
    if (form.horas === '' || form.tarifa === '') return null;
    const h = Number(form.horas);
    const t = Number(form.tarifa);
    if (!Number.isFinite(h) || !Number.isFinite(t)) return null;
    return round2(h * t);
  }, [form.horas, form.tarifa]);

  const valor = form.modo === 'hora'
    ? valorHora
    : (form.valorManual === '' ? null : round2(form.valorManual));

  const saveDisabled =
    saving || !form.processoId || !form.descricao.trim() || valor == null || !Number.isFinite(valor) || valor < 0;

  async function onSave() {
    setErro(null);
    if (!form.processoId) { setErro('Seleccione o processo.'); return; }
    if (!form.descricao.trim()) { setErro('Indique a descrição.'); return; }
    if (valor == null || !Number.isFinite(valor) || valor < 0) {
      setErro('Indique um valor válido (horas × tarifa, ou valor directo).');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        processoId: form.processoId,
        clienteId: form.clienteId || null,
        tipo: form.tipo,
        modo: form.modo,
        descricao: form.descricao.trim(),
        valor,
        data: form.data || hojeISO(),
        faturado: false,
      };
      if (form.modo === 'hora') {
        payload.horas = round2(form.horas);
        payload.tarifaHora = round2(form.tarifa);
      }
      await createShared('lancamentos', payload);
      await refresh();
      setOpen(false);
      toast('Lançamento registado.', { tone: 'ok' });
    } catch (e) {
      setErro((e && e.message) || 'Não foi possível registar o lançamento.');
    } finally {
      setSaving(false);
    }
  }

  const semProcessos = processos.length === 0;

  return (
    <div data-testid="lancamentos-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Lançamentos</h1>
          <p className="page-subtitle">
            Honorários e despesas por processo. A tarifa/hora é sugerida a partir do acordo do
            processo (ou do cliente).
          </p>
        </div>
        <Button data-testid="novo-lancamento" onClick={onOpen} disabled={semProcessos}>
          <IconPlus /> Novo lançamento
        </Button>
      </div>

      <DisclaimerBanner />

      <div className="filters" style={{ marginTop: 'var(--sp-6, 1.5rem)' }}>
        <Select data-testid="filtro-processo" value={fProcesso} onChange={(e) => setFProcesso(e.target.value)}>
          <option value="">Todos os processos</option>
          {processos.map((p) => (
            <option key={p.id} value={p.id}>{p.numeroProcesso || '(sem número)'}</option>
          ))}
        </Select>
        <Select data-testid="filtro-tipo" value={fTipo} onChange={(e) => setFTipo(e.target.value)}>
          <option value="">Honorários e despesas</option>
          <option value="honorario">Só honorários</option>
          <option value="despesa">Só despesas</option>
        </Select>
        <Select data-testid="filtro-faturado" value={fFaturado} onChange={(e) => setFFaturado(e.target.value)}>
          <option value="por-faturar">Por faturar</option>
          <option value="faturado">Faturados</option>
          <option value="">Todos</option>
        </Select>
      </div>

      {loading ? (
        <div className="loading"><span className="spinner" aria-hidden="true" /><span>A carregar lançamentos.</span></div>
      ) : (
        <DataTable
          data-testid="hon-lancamentos-tabela"
          columns={[
            { key: 'data', label: 'Data', render: (l) => formatDate(l.data) },
            { key: 'processo', label: 'Processo', render: (l) => (
              <div className="stack stack-1">
                <span className="text-strong">{processoById.get(l.processoId)?.numeroProcesso || '—'}</span>
                <span className="text-subtle text-xs">{clienteNome(l.clienteId) || clienteNome(processoById.get(l.processoId)?.clienteId)}</span>
              </div>
            ) },
            { key: 'descricao', label: 'Descrição', render: (l) => l.descricao || '(sem descrição)' },
            { key: 'tipo', label: 'Tipo', render: (l) => (
              <Badge tone={l.tipo === 'despesa' ? 'neutral' : 'info'}>
                {l.tipo === 'despesa' ? 'Despesa' : 'Honorário'}
              </Badge>
            ) },
            { key: 'modo', label: 'Modo', render: (l) => MODO_LABEL[l.modo] || l.modo || '—' },
            { key: 'valor', label: 'Valor', align: 'right', render: (l) => (
              <span className="text-strong">{formatEur(l.valor)}</span>
            ) },
            { key: 'estado', label: 'Estado', render: (l) => (
              l.faturado ? <Badge tone="ok">Faturado</Badge> : <Badge tone="media">Por faturar</Badge>
            ) },
          ]}
          rows={rows}
          rowKey="id"
          empty={
            <EmptyState
              icon={<IconCoins />}
              title="Sem lançamentos"
              hint={semProcessos ? 'Abra primeiro um processo no Núcleo.' : 'Registe o primeiro lançamento deste filtro.'}
            />
          }
        />
      )}

      <Modal
        open={open}
        title="Novo lançamento"
        onClose={() => setOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button data-testid="guardar-lancamento" onClick={onSave} disabled={saveDisabled}>
              {saving ? 'A guardar.' : 'Guardar lançamento'}
            </Button>
          </>
        }
      >
        <div className="form">
          <Field label="Processo" required>
            <Select data-testid="lanc-processo" value={form.processoId} onChange={(e) => onSelectProcesso(e.target.value)}>
              <option value="">{semProcessos ? 'Sem processos.' : 'Seleccione o processo.'}</option>
              {processos.map((p) => (
                <option key={p.id} value={p.id}>{processoLabel(p.id)}</option>
              ))}
            </Select>
          </Field>

          <div className="form-grid">
            <Field label="Tipo">
              <Select data-testid="lanc-tipo" value={form.tipo} onChange={(e) => setForm((p) => ({ ...p, tipo: e.target.value }))}>
                <option value="honorario">Honorário</option>
                <option value="despesa">Despesa</option>
              </Select>
            </Field>
            <Field label="Modo">
              <Select data-testid="lanc-modo" value={form.modo} onChange={(e) => onSelectModo(e.target.value)}>
                <option value="hora">Horas × tarifa</option>
                <option value="avenca">Avença</option>
                <option value="fixo">Valor fixo</option>
              </Select>
            </Field>
          </div>

          {form.modo === 'hora' ? (
            <div className="form-grid">
              <Field label="Horas">
                <Input
                  type="number" min="0" step="0.25" inputMode="decimal"
                  data-testid="lanc-horas"
                  placeholder="2.5"
                  value={form.horas}
                  onChange={(e) => setForm((p) => ({ ...p, horas: e.target.value }))}
                />
              </Field>
              <Field label="Tarifa/hora (€)" hint={acordoResolvido && acordoResolvido.tipo === 'hora' ? 'Sugerida pelo acordo aplicável.' : undefined}>
                <Input
                  type="number" min="0" step="0.01" inputMode="decimal"
                  data-testid="lanc-tarifa"
                  placeholder="120.00"
                  value={form.tarifa}
                  onChange={(e) => { setTarifaTouched(true); setForm((p) => ({ ...p, tarifa: e.target.value })); }}
                />
              </Field>
            </div>
          ) : null}

          <Field label="Valor (€)" hint={form.modo === 'hora' ? 'Calculado: horas × tarifa/hora.' : undefined}>
            <Input
              type="number" min="0" step="0.01" inputMode="decimal"
              data-testid="lanc-valor"
              placeholder="250.00"
              readOnly={form.modo === 'hora'}
              value={form.modo === 'hora' ? (valor == null ? '' : String(valor)) : form.valorManual}
              onChange={(e) => { setValorTouched(true); setForm((p) => ({ ...p, valorManual: e.target.value })); }}
            />
          </Field>

          <div className="form-grid">
            <Field label="Data">
              <Input
                type="date"
                data-testid="lanc-data"
                value={form.data}
                onChange={(e) => setForm((p) => ({ ...p, data: e.target.value }))}
              />
            </Field>
            <Field label="Descrição" required>
              <Input
                type="text"
                data-testid="lanc-descricao"
                placeholder="Ex.: Reunião de preparação"
                value={form.descricao}
                onChange={(e) => setForm((p) => ({ ...p, descricao: e.target.value }))}
              />
            </Field>
          </div>

          {erro ? <p className="resultado-erro" data-testid="lanc-erro">{erro}</p> : null}
        </div>
      </Modal>
    </div>
  );
}
