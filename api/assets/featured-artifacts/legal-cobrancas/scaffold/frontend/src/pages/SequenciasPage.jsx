import { useMemo, useState } from 'react';
import {
  useSharedCollection, createShared, updateShared, deleteShared,
} from '../shared.js';
import {
  Badge, Button, Field, Input, Select, Textarea, EmptyState, Skeleton, useToast,
} from '../components/ui.jsx';
import {
  IconClock, IconPlus, IconTrash, IconWhatsApp, IconMail, IconAlertTriangle,
} from '../components/Icons.jsx';
import { previewTemplate, WHATSAPP_CONSENT_NOTICE, passoRespeitaOptout } from '../engine/cobrancas.mjs';
import { CANAL_LABEL } from './cobrancas-logic.js';

// Variáveis de exemplo para a pré-visualização (o template usa {{nome}} etc.).
const PREVIEW_VARS = { nome: 'Cliente', descricao: 'a fatura', valor: '100,00 €' };

const CANAIS = [
  { value: 'email', label: 'Email' },
  { value: 'whatsapp', label: 'WhatsApp' },
];

export default function SequenciasPage() {
  const toast = useToast();
  const { items: sequencias, loading, refresh } = useSharedCollection('sequencias_lembrete');
  const [nome, setNome] = useState('');
  const [saving, setSaving] = useState(false);

  const ordenadas = useMemo(
    () => [...sequencias].sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''))),
    [sequencias],
  );

  async function criarSequencia(e) {
    e.preventDefault();
    const limpo = nome.trim();
    if (!limpo) return;
    setSaving(true);
    try {
      await createShared('sequencias_lembrete', { nome: limpo, passos: [] });
      setNome('');
      await refresh();
      toast('Sequência criada.', { tone: 'ok' });
    } catch {
      toast('Não foi possível criar a sequência.', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-testid="sequencias-page" data-demo-page="cobrancas/sequencias">
      <div className="page-header">
        <div>
          <h1 className="page-title">Sequências de lembrete</h1>
          <p className="page-subtitle">
            Modelos de mensagens de cobrança, dignos e formais, escalonados por dias. Os lembretes por
            WhatsApp respeitam sempre a opção de saída do destinatário.
          </p>
        </div>
      </div>

      <section className="card" aria-label="Nova sequência">
        <h2 className="card-title">Nova sequência</h2>
        <form className="row row-2" style={{ alignItems: 'flex-end', gap: 'var(--sp-3, 0.75rem)' }} onSubmit={criarSequencia}>
          <Field label="Nome da sequência" htmlFor="seq-nome">
            <Input
              id="seq-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Sequência amigável"
              data-testid="seq-nome"
            />
          </Field>
          <Button type="submit" variant="primary" size="sm" disabled={saving || !nome.trim()} data-testid="seq-criar">
            <IconPlus size={16} /> Criar
          </Button>
        </form>
      </section>

      {loading ? (
        <Skeleton lines={6} />
      ) : ordenadas.length === 0 ? (
        <EmptyState icon={<IconClock />} title="Sem sequências" hint="Crie a primeira sequência de lembretes." />
      ) : (
        <div className="stack stack-4" style={{ marginTop: 'var(--sp-6, 1.5rem)' }}>
          {ordenadas.map((seq) => (
            <SequenciaCard key={seq.id} sequencia={seq} onChange={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}

const EMPTY_PASSO = { offsetDias: '', canal: 'email', template: '' };

function SequenciaCard({ sequencia, onChange }) {
  const toast = useToast();
  const [form, setForm] = useState({ ...EMPTY_PASSO });
  const [busy, setBusy] = useState(false);

  const passos = Array.isArray(sequencia.passos) ? sequencia.passos : [];

  // Pré-visualização VIVA do passo em edição: para WhatsApp acrescenta sempre a
  // linha de opção de saída (deontologia). É esta a garantia que impede guardar
  // um lembrete WhatsApp sem opção de saída.
  const previewNovo = useMemo(
    () => previewTemplate({ canal: form.canal, template: form.template }, PREVIEW_VARS),
    [form.canal, form.template],
  );

  async function adicionarPasso(e) {
    e.preventDefault();
    const offset = Number(form.offsetDias);
    if (!Number.isFinite(offset) || offset < 0) {
      toast('Indique um número de dias válido (0 ou mais).', { tone: 'error' });
      return;
    }
    const novoPasso = { offsetDias: offset, canal: form.canal, template: form.template.trim() };
    // Deontologia: um passo WhatsApp SÓ é aceite com opção de saída — que o motor
    // garante. Recusa explícita caso a garantia falhe (defesa em profundidade).
    if (!passoRespeitaOptout(novoPasso, PREVIEW_VARS)) {
      toast('Lembretes por WhatsApp têm de incluir a opção de saída.', { tone: 'error' });
      return;
    }
    setBusy(true);
    try {
      await updateShared('sequencias_lembrete', sequencia.id, { passos: [...passos, novoPasso] });
      setForm({ ...EMPTY_PASSO });
      await onChange();
      toast('Passo adicionado.', { tone: 'ok' });
    } catch {
      toast('Não foi possível adicionar o passo.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function removerSequencia() {
    setBusy(true);
    try {
      await deleteShared('sequencias_lembrete', sequencia.id);
      await onChange();
      toast('Sequência removida.', { tone: 'ok' });
    } catch {
      toast('Não foi possível remover a sequência.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" data-testid="sequencia-card" data-seq-nome={sequencia.nome || ''} aria-label={`Sequência ${sequencia.nome || ''}`}>
      <div className="row row-space-between" style={{ alignItems: 'baseline' }}>
        <h2 className="card-title">{sequencia.nome || '(sem nome)'}</h2>
        <Button variant="ghost" size="sm" onClick={removerSequencia} disabled={busy} data-testid="seq-remover" aria-label="Remover sequência">
          <IconTrash size={16} /> Remover
        </Button>
      </div>

      {passos.length === 0 ? (
        <p className="field-hint" style={{ marginTop: 0 }}>Sem passos. Adicione o primeiro abaixo.</p>
      ) : (
        <ul className="passos-list" style={{ listStyle: 'none', margin: '0 0 var(--sp-4, 1rem)', padding: 0 }}>
          {passos.map((p, i) => (
            <li
              key={i}
              className="passo-item"
              data-testid="passo-item"
              style={{ padding: 'var(--sp-3, 0.75rem)', border: '1px solid var(--color-border)', borderRadius: 'var(--r-2, 0.5rem)', marginBottom: 'var(--sp-2, 0.5rem)' }}
            >
              <div className="row row-2" style={{ alignItems: 'center', gap: 'var(--sp-2, 0.5rem)' }}>
                <Badge tone="neutral">Dia +{p.offsetDias}</Badge>
                <Badge tone={p.canal === 'whatsapp' ? 'info' : 'neutral'}>
                  {p.canal === 'whatsapp' ? <IconWhatsApp size={12} /> : <IconMail size={12} />} {CANAL_LABEL[p.canal] || p.canal}
                </Badge>
              </div>
              <p
                className="text-xs"
                data-testid="passo-preview"
                style={{ margin: 'var(--sp-2, 0.5rem) 0 0', whiteSpace: 'pre-wrap' }}
              >
                {previewTemplate(p, PREVIEW_VARS)}
              </p>
            </li>
          ))}
        </ul>
      )}

      <form className="stack stack-3" onSubmit={adicionarPasso} style={{ paddingTop: 'var(--sp-3, 0.75rem)', borderTop: '1px dashed var(--color-border)' }}>
        <div className="row row-2" style={{ gap: 'var(--sp-3, 0.75rem)' }}>
          <Field label="Dias após o vencimento" htmlFor={`offset-${sequencia.id}`}>
            <Input
              id={`offset-${sequencia.id}`}
              type="number"
              min="0"
              value={form.offsetDias}
              onChange={(e) => setForm((f) => ({ ...f, offsetDias: e.target.value }))}
              placeholder="0"
              data-testid="passo-offset"
            />
          </Field>
          <Field label="Canal" htmlFor={`canal-${sequencia.id}`}>
            <Select
              id={`canal-${sequencia.id}`}
              value={form.canal}
              onChange={(e) => setForm((f) => ({ ...f, canal: e.target.value }))}
              data-testid="passo-canal"
            >
              {CANAIS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
          </Field>
        </div>

        <Field label="Mensagem" htmlFor={`tpl-${sequencia.id}`} hint="Use {{nome}}, {{descricao}} e {{valor}} para personalizar.">
          <Textarea
            id={`tpl-${sequencia.id}`}
            rows={3}
            value={form.template}
            onChange={(e) => setForm((f) => ({ ...f, template: e.target.value }))}
            placeholder="Exmo.(a) Sr.(a) {{nome}}, a fatura {{descricao}} no valor de {{valor}} aguarda regularização."
            data-testid="passo-template"
          />
        </Field>

        {/* Aviso deontológico fixo — sempre presente no editor. */}
        <div className="citius-resultado is-review" data-testid="whatsapp-consent-notice" role="note">
          <span className="citius-resultado-icon" aria-hidden="true"><IconAlertTriangle /></span>
          <span className="citius-resultado-text">
            <span className="citius-resultado-strong">{WHATSAPP_CONSENT_NOTICE}</span>
          </span>
        </div>

        <div className="stack stack-1">
          <span className="field-label">Pré-visualização</span>
          <p
            className="text-xs"
            data-testid="passo-preview-novo"
            style={{ margin: 0, padding: 'var(--sp-3, 0.75rem)', border: '1px solid var(--color-border)', borderRadius: 'var(--r-2, 0.5rem)', whiteSpace: 'pre-wrap', background: 'var(--surface-1, transparent)' }}
          >
            {previewNovo || 'A pré-visualização aparece aqui à medida que escreve.'}
          </p>
        </div>

        <div className="row">
          <Button type="submit" variant="primary" size="sm" disabled={busy} data-testid="passo-adicionar">
            <IconPlus size={16} /> Adicionar passo
          </Button>
        </div>
      </form>
    </section>
  );
}
