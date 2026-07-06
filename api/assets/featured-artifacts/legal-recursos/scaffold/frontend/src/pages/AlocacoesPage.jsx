import { useMemo, useState } from 'react';
import {
  useSharedCollection, createShared, updateShared, formatDate,
} from '../shared.js';
import {
  Badge, Button, Field, Input, Select, Modal, DataTable, Skeleton, useToast,
} from '../components/ui.jsx';
import { IconPlus, IconEdit, IconCheck, IconFolder } from '../components/Icons.jsx';
import { papelLabel } from './recursos-logic.js';

const EMPTY = { pessoaId: '', processoId: '', percentagem: '', dataInicio: '', dataFim: '' };

/*
 * Alocação da equipa aos processos: quem trabalha em quê e com que percentagem
 * de dedicação. Adicionar, editar e TERMINAR (definir a data de fim) uma
 * alocação. Lê `alocacoes`, `pessoas` e `processos` da espinha partilhada e
 * escreve em `alocacoes` (nunca semeia).
 */
export default function AlocacoesPage() {
  const { items: alocacoes, loading, refresh } = useSharedCollection('alocacoes');
  const { items: pessoas } = useSharedCollection('pessoas');
  const { items: processos } = useSharedCollection('processos');
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);

  const pessoaById = useMemo(() => {
    const map = new Map();
    pessoas.forEach((p) => map.set(p.id, p));
    return (id) => map.get(id) || null;
  }, [pessoas]);

  const processoLabel = useMemo(() => {
    const map = new Map();
    processos.forEach((p) => map.set(p.id, p.numeroProcesso || '(sem número)'));
    return (id) => map.get(id) || '—';
  }, [processos]);

  const linhas = useMemo(
    () => alocacoes.slice().sort((a, b) => {
      // Ativas primeiro (sem dataFim), depois por início descendente.
      const aAtiva = a.dataFim ? 1 : 0;
      const bAtiva = b.dataFim ? 1 : 0;
      if (aAtiva !== bAtiva) return aAtiva - bAtiva;
      return String(b.dataInicio || '').localeCompare(String(a.dataInicio || ''));
    }),
    [alocacoes],
  );

  function abrirNova() {
    setEditId(null);
    setForm({ ...EMPTY });
    setOpen(true);
  }

  function abrirEdicao(a) {
    setEditId(a.id);
    setForm({
      pessoaId: a.pessoaId || '',
      processoId: a.processoId || '',
      percentagem: a.percentagem != null ? String(a.percentagem) : '',
      dataInicio: a.dataInicio || '',
      dataFim: a.dataFim || '',
    });
    setOpen(true);
  }

  async function guardar(e) {
    e.preventDefault();
    if (!form.pessoaId || !form.processoId) {
      toast('Escolha a pessoa e o processo.', { tone: 'error' });
      return;
    }
    const pct = Number.parseInt(form.percentagem, 10);
    if (!Number.isInteger(pct) || pct <= 0 || pct > 100) {
      toast('A percentagem deve estar entre 1 e 100.', { tone: 'error' });
      return;
    }
    if (form.dataFim && form.dataInicio && form.dataFim < form.dataInicio) {
      toast('A data de fim não pode ser anterior à de início.', { tone: 'error' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        pessoaId: form.pessoaId,
        processoId: form.processoId,
        percentagem: pct,
        dataInicio: form.dataInicio || null,
        dataFim: form.dataFim || null,
      };
      if (editId) {
        await updateShared('alocacoes', editId, payload);
      } else {
        await createShared('alocacoes', payload);
      }
      await refresh();
      setOpen(false);
      toast(editId ? 'Alocação atualizada.' : 'Alocação criada.', { tone: 'ok' });
    } catch {
      toast('Não foi possível guardar a alocação.', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function terminar(a) {
    const hoje = new Date();
    const iso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
    try {
      await updateShared('alocacoes', a.id, { dataFim: iso });
      await refresh();
      toast('Alocação terminada.', { tone: 'ok' });
    } catch {
      toast('Não foi possível terminar a alocação.', { tone: 'error' });
    }
  }

  return (
    <div data-testid="alocacoes-page" data-demo-page="recursos/alocacoes">
      <div className="page-header">
        <div>
          <h1 className="page-title">Alocações</h1>
          <p className="page-subtitle">A dedicação de cada pessoa aos processos, em percentagem. Termine uma alocação definindo a data de fim.</p>
        </div>
        <div className="page-actions">
          <Button data-testid="nova-alocacao" onClick={abrirNova}><IconPlus /> Nova alocação</Button>
        </div>
      </div>

      {loading ? (
        <Skeleton lines={6} />
      ) : (
        <DataTable
          data-testid="alocacoes-tabela"
          columns={[
            {
              key: 'pessoa',
              label: 'Pessoa',
              render: (a) => {
                const p = pessoaById(a.pessoaId);
                return (
                  <div className="stack stack-1">
                    <span className="text-strong">{p ? p.nome : '—'}</span>
                    {p ? <span className="text-xs text-subtle">{papelLabel(p.papel)}</span> : null}
                  </div>
                );
              },
            },
            { key: 'processo', label: 'Processo', render: (a) => <span className="numeric">{processoLabel(a.processoId)}</span> },
            { key: 'percentagem', label: 'Dedicação', align: 'right', render: (a) => <span className="text-strong numeric">{a.percentagem != null ? `${a.percentagem}%` : '—'}</span> },
            { key: 'inicio', label: 'Início', render: (a) => <span className="numeric">{a.dataInicio ? formatDate(a.dataInicio) : '—'}</span> },
            {
              key: 'estado',
              label: 'Estado',
              render: (a) => (a.dataFim
                ? <Badge tone="neutral">Terminada {formatDate(a.dataFim)}</Badge>
                : <Badge tone="ok">Ativa</Badge>),
            },
            {
              key: 'acoes',
              label: '',
              align: 'right',
              render: (a) => (
                <span className="row row-2" style={{ gap: 'var(--sp-2, 0.5rem)', justifyContent: 'flex-end' }}>
                  <Button variant="ghost" size="sm" data-testid={`aloc-editar-${a.id}`} onClick={() => abrirEdicao(a)}><IconEdit /> Editar</Button>
                  {!a.dataFim ? (
                    <Button variant="secondary" size="sm" data-testid={`aloc-terminar-${a.id}`} onClick={() => terminar(a)}><IconCheck /> Terminar</Button>
                  ) : null}
                </span>
              ),
            },
          ]}
          rows={linhas}
          rowKey="id"
          empty="Sem alocações. Crie a primeira com “Nova alocação”."
        />
      )}

      <Modal
        open={open}
        title={editId ? 'Editar alocação' : 'Nova alocação'}
        onClose={() => setOpen(false)}
        actions={(
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button data-testid="aloc-guardar" onClick={guardar} disabled={saving}>{saving ? 'A guardar…' : 'Guardar'}</Button>
          </>
        )}
      >
        <form className="form stack stack-4" onSubmit={guardar}>
          <Field label="Pessoa" required>
            <Select data-testid="aloc-pessoa" value={form.pessoaId} onChange={(e) => setForm((f) => ({ ...f, pessoaId: e.target.value }))}>
              <option value="">Escolha a pessoa.</option>
              {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </Select>
          </Field>
          <Field label="Processo" required>
            <Select data-testid="aloc-processo" value={form.processoId} onChange={(e) => setForm((f) => ({ ...f, processoId: e.target.value }))}>
              <option value="">{processos.length === 0 ? 'Sem processos — abra um no Núcleo.' : 'Escolha o processo.'}</option>
              {processos.map((p) => <option key={p.id} value={p.id}>{p.numeroProcesso || '(sem número)'}</option>)}
            </Select>
          </Field>
          <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--sp-3, 0.75rem)' }}>
            <Field label="Dedicação (%)" required>
              <Input type="number" min="1" max="100" step="1" data-testid="aloc-percentagem" value={form.percentagem} onChange={(e) => setForm((f) => ({ ...f, percentagem: e.target.value }))} placeholder="50" />
            </Field>
            <Field label="Início">
              <Input type="date" data-testid="aloc-inicio" value={form.dataInicio} onChange={(e) => setForm((f) => ({ ...f, dataInicio: e.target.value }))} />
            </Field>
            <Field label="Fim (opcional)">
              <Input type="date" data-testid="aloc-fim" value={form.dataFim} onChange={(e) => setForm((f) => ({ ...f, dataFim: e.target.value }))} />
            </Field>
          </div>
          <button type="submit" style={{ display: 'none' }} aria-hidden="true" tabIndex={-1} />
        </form>
      </Modal>
    </div>
  );
}
