import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useSharedCollection,
  createShared,
  updateShared,
  formatDate,
} from '../shared.js';
import {
  Button,
  Badge,
  Field,
  Input,
  Select,
  Textarea,
  toast,
} from '../components/ui.jsx';
import { IconCheck, IconExternalLink } from '../components/Icons.jsx';
import {
  TIPO_LABEL,
  estadoLabel,
  estadoTone,
  custoBase,
  hojeISO,
  gerarRegistoRef,
} from './correio-logic.js';

const TIPOS = ['registado', 'registado_ar', 'simples'];

/* Sem classe utilitária de monospace na suite - fonte inline (como no Citius). */
const MONO = { fontFamily: 'var(--font-mono, ui-monospace, Menlo, Consolas, monospace)' };

export default function NovaCartaPage() {
  const { items: clientes } = useSharedCollection('clientes');
  const { items: processos } = useSharedCollection('processos');

  const [tipo, setTipo] = useState('registado');
  const [clienteId, setClienteId] = useState('');
  const [nome, setNome] = useState('');
  const [morada, setMorada] = useState('');
  const [processoId, setProcessoId] = useState('');
  const [conteudo, setConteudo] = useState('');
  const [custo, setCusto] = useState(custoBase('registado'));
  const [custoTouched, setCustoTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(null);

  const clientesOrdenados = useMemo(
    () => clientes.slice().sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt')),
    [clientes],
  );

  function onSelectTipo(t) {
    setTipo(t);
    if (!custoTouched) setCusto(custoBase(t));
  }

  function onSelectCliente(id) {
    setClienteId(id);
    const c = clientes.find((x) => x.id === id);
    if (c) {
      setNome(c.nome || '');
      if (c.morada) setMorada(c.morada);
    }
  }

  const podeRegistar = nome.trim().length > 0 && conteudo.trim().length > 0 && !saving;

  async function registar() {
    if (!podeRegistar) return;
    setSaving(true);
    try {
      const registoRef = gerarRegistoRef();
      const custoNum = Number(custo);
      const row = {
        tipo,
        destinatario: { nome: nome.trim(), ...(morada.trim() ? { morada: morada.trim() } : {}) },
        conteudoDescricao: conteudo.trim(),
        estado: 'rascunho',
        registoRef,
        custoEstimado: Number.isFinite(custoNum) ? custoNum : 0,
        datas: {},
        ...(clienteId ? { clienteId } : {}),
        ...(processoId ? { processoId } : {}),
      };
      const saved = await createShared('correio', row);
      setCreated({ ...row, id: saved && saved.id });
      toast('Carta registada como rascunho.', { tone: 'ok' });
    } catch {
      toast('Não foi possível registar a carta.', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function marcarExpedido() {
    if (!created || !created.id) return;
    setSaving(true);
    try {
      const datas = { ...(created.datas || {}), expedido: hojeISO() };
      await updateShared('correio', created.id, { estado: 'expedido', datas });
      setCreated((prev) => ({ ...prev, estado: 'expedido', datas }));
      toast('Carta marcada como expedida.', { tone: 'ok' });
    } catch {
      toast('Não foi possível marcar como expedida.', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  function novaOutra() {
    setCreated(null);
    setClienteId('');
    setNome('');
    setMorada('');
    setProcessoId('');
    setConteudo('');
    setTipo('registado');
    setCusto(custoBase('registado'));
    setCustoTouched(false);
  }

  return (
    <div data-testid="correio-nova-page" data-demo-page="correio/nova">
      <div className="page-header">
        <div>
          <h1 className="page-title">Nova carta</h1>
          <p className="page-subtitle">
            Registe uma carta de correio registado. A referência gerada é uma referência de
            registo manual - a referência real dos CTT é a que consta do comprovativo do balcão.
          </p>
        </div>
      </div>

      {created ? (
        <section className="resultado-panel" data-testid="correio-ref" data-demo-target="correio-ref" style={{ maxWidth: 640 }}>
          <div className="row row-space-between" style={{ alignItems: 'flex-start', gap: 'var(--sp-3)' }}>
            <div className="stack stack-1">
              <span className="stat-label">Referência de registo</span>
              <span data-testid="correio-ref-valor" style={{ ...MONO, fontSize: 'var(--text-lg, 1.125rem)', fontWeight: 700 }}>
                {created.registoRef}
              </span>
            </div>
            <Badge tone={estadoTone(created.estado)} data-testid="correio-ref-estado">{estadoLabel(created.estado)}</Badge>
          </div>

          <p className="text-subtle text-xs" style={{ margin: 0 }}>
            Referência de registo manual - substituída pela referência real dos CTT no balcão.
          </p>

          <div className="stack stack-1 text-small">
            <span><span className="text-subtle">Destinatário:</span> <span className="text-strong">{created.destinatario.nome}</span></span>
            {created.destinatario.morada ? (
              <span className="text-subtle text-xs">{created.destinatario.morada}</span>
            ) : null}
            <span className="text-subtle text-xs">{TIPO_LABEL[created.tipo] || created.tipo}</span>
            {created.datas && created.datas.expedido ? (
              <span className="text-subtle text-xs">Expedido: {formatDate(created.datas.expedido)}</span>
            ) : null}
          </div>

          <div className="row row-2" style={{ flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
            {created.estado === 'rascunho' ? (
              <Button variant="primary" disabled={saving} data-testid="correio-marcar-expedido" onClick={marcarExpedido}>
                Marcar expedido
              </Button>
            ) : (
              <span className="resultado-ok row" style={{ marginTop: 0, alignItems: 'center', gap: 6 }}>
                <IconCheck size={14} /> Expedido em {formatDate(created.datas.expedido)}
              </span>
            )}
            <Link className="btn btn-secondary" to="/" data-testid="correio-ver-expediente">
              Ver no expediente <IconExternalLink size={14} />
            </Link>
            <Button variant="ghost" onClick={novaOutra} data-testid="correio-nova-outra">Registar outra</Button>
          </div>
        </section>
      ) : (
        <div className="form" style={{ maxWidth: 640 }}>
          <div className="form-grid">
            <Field label="Tipo de objeto">
              <Select data-testid="correio-nova-tipo" value={tipo} onChange={(e) => onSelectTipo(e.target.value)}>
                {TIPOS.map((t) => (
                  <option key={t} value={t}>{TIPO_LABEL[t]}</option>
                ))}
              </Select>
            </Field>
            <Field label="Custo estimado (€)" hint="Sugestão editável; o valor real é o do balcão.">
              <Input
                type="number" min="0" step="0.01" inputMode="decimal"
                data-testid="correio-nova-custo"
                value={custo}
                onChange={(e) => { setCustoTouched(true); setCusto(e.target.value); }}
              />
            </Field>
          </div>

          <Field label="Cliente" hint="Opcional - preenche o destinatário a partir da ficha.">
            <Select data-testid="correio-nova-cliente" value={clienteId} onChange={(e) => onSelectCliente(e.target.value)}>
              <option value="">Sem cliente / destinatário manual</option>
              {clientesOrdenados.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </Select>
          </Field>

          <Field label="Destinatário" required>
            <Input
              type="text"
              data-testid="correio-nova-nome"
              data-demo-target="correio-destinatario"
              placeholder="Nome do destinatário"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
            />
          </Field>

          <Field label="Morada">
            <Input
              type="text"
              data-testid="correio-nova-morada"
              placeholder="Morada de expedição"
              value={morada}
              onChange={(e) => setMorada(e.target.value)}
            />
          </Field>

          <Field label="Processo" hint="Opcional - liga a carta ao dossiê do processo.">
            <Select data-testid="correio-nova-processo" value={processoId} onChange={(e) => setProcessoId(e.target.value)}>
              <option value="">Sem processo associado</option>
              {processos.map((p) => (
                <option key={p.id} value={p.id}>{p.numeroProcesso || '(sem número)'}</option>
              ))}
            </Select>
          </Field>

          <Field label="Conteúdo / assunto" required>
            <Textarea
              data-testid="correio-nova-conteudo"
              data-demo-target="correio-conteudo"
              placeholder="Descrição do conteúdo expedido (ex.: notificação extrajudicial para pagamento)"
              rows={3}
              value={conteudo}
              onChange={(e) => setConteudo(e.target.value)}
            />
          </Field>

          <div className="row row-2">
            <Button
              variant="primary"
              disabled={!podeRegistar}
              data-testid="correio-registar"
              data-demo-target="correio-registar"
              onClick={registar}
            >
              {saving ? 'A registar.' : 'Registar'}
            </Button>
            <Link className="btn btn-ghost" to="/" data-testid="correio-cancelar">Cancelar</Link>
          </div>
        </div>
      )}
    </div>
  );
}
