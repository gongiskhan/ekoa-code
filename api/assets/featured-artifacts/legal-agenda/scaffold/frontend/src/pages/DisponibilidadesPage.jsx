import { useMemo, useState } from 'react';
import { useSharedCollection, createShared, deleteShared } from '../shared.js';
import {
  Button, Skeleton, EmptyState, Field, Select, Input, toast, Badge,
} from '../components/ui.jsx';
import { IconClock, IconPlus, IconTrash } from '../components/Icons.jsx';

/*
 * Disponibilidades semanais: as janelas de atendimento de cada pessoa por dia da
 * semana. É a matéria-prima do motor de slots — um horário só é oferecido quando
 * a janela de TODOS os participantes de um tipo de sessão se sobrepõe.
 */
const DIAS = [
  { v: 1, l: 'Segunda' }, { v: 2, l: 'Terça' }, { v: 3, l: 'Quarta' },
  { v: 4, l: 'Quinta' }, { v: 5, l: 'Sexta' }, { v: 6, l: 'Sábado' }, { v: 0, l: 'Domingo' },
];
const DIA_LABEL = Object.fromEntries(DIAS.map((d) => [d.v, d.l]));

export default function DisponibilidadesPage() {
  const { items: pessoas, loading: lP } = useSharedCollection('pessoas');
  const { items: disponibilidades, loading: lD, refresh } = useSharedCollection('disponibilidades');
  const loading = lP || lD;

  const [pessoaId, setPessoaId] = useState('');
  const [diaSemana, setDiaSemana] = useState('1');
  const [horaInicio, setHoraInicio] = useState('09:00');
  const [horaFim, setHoraFim] = useState('13:00');
  const [saving, setSaving] = useState(false);

  const porPessoa = useMemo(() => {
    const map = new Map();
    for (const p of pessoas || []) map.set(p.id, { pessoa: p, janelas: [] });
    for (const d of disponibilidades || []) {
      const bucket = map.get(d.pessoaId);
      if (bucket) bucket.janelas.push(d);
    }
    for (const b of map.values()) {
      b.janelas.sort((a, z) => (Number(a.diaSemana) - Number(z.diaSemana)) || String(a.horaInicio).localeCompare(String(z.horaInicio)));
    }
    return Array.from(map.values());
  }, [pessoas, disponibilidades]);

  async function adicionar() {
    if (!pessoaId) { toast('Escolha a pessoa.', { tone: 'error' }); return; }
    if (!/^\d{2}:\d{2}$/.test(horaInicio) || !/^\d{2}:\d{2}$/.test(horaFim)) { toast('Horas em formato HH:MM.', { tone: 'error' }); return; }
    if (horaFim <= horaInicio) { toast('A hora de fim tem de ser depois do início.', { tone: 'error' }); return; }
    setSaving(true);
    try {
      await createShared('disponibilidades', { pessoaId, diaSemana: Number(diaSemana), horaInicio, horaFim });
      await refresh();
      toast('Janela adicionada.', { tone: 'ok' });
    } catch {
      toast('Não foi possível adicionar. Tente novamente.', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function remover(id) {
    try { await deleteShared('disponibilidades', id); await refresh(); toast('Janela removida.', { tone: 'ok' }); }
    catch { toast('Não foi possível remover.', { tone: 'error' }); }
  }

  return (
    <div data-testid="disponibilidades-page" data-demo-page="agenda/disponibilidades">
      <div className="page-header">
        <div>
          <h1 className="page-title">Disponibilidades</h1>
          <p className="page-subtitle">
            As janelas de atendimento de cada pessoa, por dia da semana. O motor cruza-as com os participantes de cada tipo de sessão para oferecer horários.
          </p>
        </div>
      </div>

      <section className="card" aria-label="Nova janela" data-testid="disp-form" style={{ marginBottom: 'var(--sp-5, 1.25rem)' }}>
        <div className="row" style={{ gap: 'var(--sp-3, 0.75rem)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Pessoa" htmlFor="disp-pessoa">
            <Select id="disp-pessoa" data-testid="disp-pessoa" value={pessoaId} onChange={(e) => setPessoaId(e.target.value)}>
              <option value="">Escolher…</option>
              {(pessoas || []).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </Select>
          </Field>
          <Field label="Dia" htmlFor="disp-dia">
            <Select id="disp-dia" data-testid="disp-dia" value={diaSemana} onChange={(e) => setDiaSemana(e.target.value)}>
              {DIAS.map((d) => <option key={d.v} value={d.v}>{d.l}</option>)}
            </Select>
          </Field>
          <Field label="Início" htmlFor="disp-inicio">
            <Input id="disp-inicio" data-testid="disp-inicio" type="time" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} />
          </Field>
          <Field label="Fim" htmlFor="disp-fim">
            <Input id="disp-fim" data-testid="disp-fim" type="time" value={horaFim} onChange={(e) => setHoraFim(e.target.value)} />
          </Field>
          <Button data-testid="disp-submit" onClick={adicionar} disabled={saving}><IconPlus /> {saving ? 'A adicionar…' : 'Adicionar'}</Button>
        </div>
      </section>

      {loading ? (
        <Skeleton lines={5} />
      ) : porPessoa.length === 0 ? (
        <EmptyState icon={<IconClock />} title="Sem pessoas" hint="As pessoas vêm do Núcleo partilhado." />
      ) : (
        <div className="stack stack-3" data-testid="disp-lista">
          {porPessoa.map(({ pessoa, janelas }) => (
            <section key={pessoa.id} className="card" data-testid="disp-pessoa-card" data-pessoa-id={pessoa.id} style={{ padding: 'var(--sp-4, 1rem)' }}>
              <div className="row row-space-between" style={{ marginBottom: 'var(--sp-3, 0.75rem)', alignItems: 'center' }}>
                <span className="text-strong">{pessoa.nome}</span>
                <Badge tone="neutral">{janelas.length} janela{janelas.length === 1 ? '' : 's'}</Badge>
              </div>
              {janelas.length === 0 ? (
                <span className="text-small text-subtle">Sem janelas definidas.</span>
              ) : (
                <div className="row" style={{ gap: 'var(--sp-2, 0.5rem)', flexWrap: 'wrap' }}>
                  {janelas.map((j) => (
                    <span
                      key={j.id}
                      data-testid="disp-row"
                      data-dia={j.diaSemana}
                      className="row row-2"
                      style={{ alignItems: 'center', gap: 'var(--sp-2, 0.5rem)', border: '1px solid var(--color-border)', borderRadius: 'var(--r-2, 0.5rem)', padding: '4px 8px', background: 'var(--color-surface-muted, #f1f5f9)' }}
                    >
                      <span className="text-xs text-strong">{DIA_LABEL[j.diaSemana] || j.diaSemana}</span>
                      <span className="text-xs numeric">{j.horaInicio}–{j.horaFim}</span>
                      <button type="button" aria-label="Remover janela" data-testid="disp-remover" onClick={() => remover(j.id)} className="btn btn-ghost btn-sm" style={{ padding: 2 }}>
                        <IconTrash />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
