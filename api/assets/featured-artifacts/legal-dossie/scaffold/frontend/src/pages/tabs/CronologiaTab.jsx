import { useMemo, useState } from 'react';
import { createShared, formatDate } from '../../shared.js';
import { Button, Badge, Field, Input, Select, EmptyState, toast } from '../../components/ui.jsx';
import {
  IconCalendar,
  IconFileText,
  IconClock,
  IconMail,
  IconWhatsApp,
  IconPlus,
  IconGavel,
} from '../../components/Icons.jsx';

const TIPOS_EVENTO = [
  { value: 'juntada', label: 'Juntada' },
  { value: 'despacho', label: 'Despacho' },
  { value: 'audiencia', label: 'Audiência' },
  { value: 'sentenca', label: 'Sentença' },
  { value: 'reuniao', label: 'Reunião' },
  { value: 'outro', label: 'Outro' },
];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function KindIcon({ kind, canal }) {
  if (kind === 'documento') return <IconFileText size={16} />;
  if (kind === 'prazo') return <IconClock size={16} />;
  if (kind === 'comunicacao') return canal === 'whatsapp' ? <IconWhatsApp size={16} /> : <IconMail size={16} />;
  return <IconGavel size={16} />;
}

/*
 * Separador Cronologia: funde os eventos MANUAIS (persistidos) com marcos
 * DERIVADOS de outras coleções (carregamento de documentos, prazos, mensagens).
 * Os marcos derivados são calculados no render e NUNCA são persistidos - só os
 * eventos criados aqui vão para a espinha. "Novo evento" acrescenta um evento
 * manual ao processo.
 */
export default function CronologiaTab({ processo, eventos, documentos, prazos, comunicacoes, refresh }) {
  const [showForm, setShowForm] = useState(false);
  const [titulo, setTitulo] = useState('');
  const [data, setData] = useState(todayStr());
  const [tipo, setTipo] = useState('juntada');
  const [saving, setSaving] = useState(false);

  const itens = useMemo(() => {
    const out = [];
    for (const e of eventos) {
      out.push({
        key: `ev-${e.id}`,
        date: e.data || e.createdAt,
        titulo: e.titulo || '(sem título)',
        descricao: e.descricao || '',
        tipo: e.tipo || '',
        kind: 'evento',
        derived: false,
      });
    }
    for (const d of documentos) {
      out.push({
        key: `doc-${d.id}`,
        date: d.data || d.createdAt,
        titulo: `Documento: ${d.nome || 'sem nome'}`,
        descricao: '',
        tipo: d.tipo === 'nota' ? 'nota' : 'documento',
        kind: 'documento',
        derived: true,
      });
    }
    for (const p of prazos) {
      out.push({
        key: `prz-${p.id}`,
        date: p.dataLimite,
        titulo: `Prazo: ${p.titulo || p.descricao || 'prazo'}`,
        descricao: p.regraAplicada || '',
        tipo: p.estado || '',
        kind: 'prazo',
        derived: true,
      });
    }
    for (const c of comunicacoes) {
      out.push({
        key: `com-${c.id}`,
        date: c.receivedAt || c.createdAt,
        titulo: `Mensagem ${c.canal === 'whatsapp' ? 'WhatsApp' : 'email'}: ${c.fromName || c.fromAddr || 'remetente'}`,
        descricao: c.subject || '',
        tipo: c.canal,
        canal: c.canal,
        kind: 'comunicacao',
        derived: true,
      });
    }
    return out.sort((a, b) => {
      const ta = Date.parse(a.date);
      const tb = Date.parse(b.date);
      const va = !Number.isNaN(ta);
      const vb = !Number.isNaN(tb);
      if (va && vb) return tb - ta; // mais recente primeiro
      if (va) return -1;
      if (vb) return 1;
      return 0;
    });
  }, [eventos, documentos, prazos, comunicacoes]);

  async function guardarEvento() {
    if (!titulo.trim()) {
      toast('Indique um título para o evento.', { tone: 'error' });
      return;
    }
    setSaving(true);
    try {
      await createShared('eventos', {
        processoId: processo.id,
        titulo: titulo.trim(),
        data: data || todayStr(),
        tipo,
        origem: 'manual',
      });
      await refresh();
      toast('Evento registado.', { tone: 'ok' });
      setTitulo('');
      setData(todayStr());
      setTipo('juntada');
      setShowForm(false);
    } catch {
      toast('Não foi possível registar o evento.', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack stack-6" data-testid="cronologia-tab">
      <div className="row row-space-between" style={{ flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
        <p className="text-muted text-small" style={{ margin: 0 }}>
          Eventos do processo e marcos automáticos (documentos, prazos e mensagens). Os marcos automáticos
          não são gravados.
        </p>
        <Button variant="secondary" data-testid="novo-evento" onClick={() => setShowForm((v) => !v)}>
          <IconPlus size={14} /> Novo evento
        </Button>
      </div>

      {showForm ? (
        <div className="card stack stack-4" data-testid="novo-evento-form">
          <div className="form-grid">
            <Field label="Título" required>
              <Input
                data-testid="evento-titulo"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Ex.: Audiência de julgamento"
              />
            </Field>
            <Field label="Data">
              <Input data-testid="evento-data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </Field>
            <Field label="Tipo">
              <Select data-testid="evento-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                {TIPOS_EVENTO.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="row row-2" style={{ justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setShowForm(false)}>
              Cancelar
            </Button>
            <Button variant="primary" data-testid="guardar-evento" disabled={saving} onClick={guardarEvento}>
              Guardar evento
            </Button>
          </div>
        </div>
      ) : null}

      {itens.length === 0 ? (
        <EmptyState
          icon={<IconCalendar />}
          title="Cronologia vazia"
          hint="Registe um evento ou carregue documentos e prazos - a cronologia constrói-se a partir de todo o dossiê."
        />
      ) : (
        <ul className="dossie-timeline" data-testid="cronologia-timeline">
          {itens.map((it) => (
            <li key={it.key} className="dossie-timeline-item" data-testid={it.derived ? 'crono-derived' : 'crono-evento'}>
              <span className="dossie-timeline-date">{formatDate(it.date)}</span>
              <div className="dossie-timeline-body">
                <span className="row row-2" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
                  <span className="row-icon" aria-hidden="true">
                    <KindIcon kind={it.kind} canal={it.canal} />
                  </span>
                  <span className="dossie-timeline-titulo">{it.titulo}</span>
                  {it.derived ? <Badge tone="neutral">Automático</Badge> : null}
                </span>
                {it.tipo && !it.derived ? <span className="dossie-timeline-tipo">{it.tipo}</span> : null}
                {it.descricao ? <span className="dossie-timeline-desc">{it.descricao}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
