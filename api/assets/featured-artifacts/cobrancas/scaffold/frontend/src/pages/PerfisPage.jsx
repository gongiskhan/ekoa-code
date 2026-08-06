/*
 * PERFIS DE COBRANÇA - o "como cobramos" de cada segmento de clientes.
 *
 * Cada perfil junta: plano de escalonamento (lembretes por offset ao
 * vencimento), templates de comunicação (por tipo, grupo e idioma), regras de
 * automação (modo do email, coalescência, tetos, horas de silêncio) e política
 * de juros. Inclui ainda a gestão dos TIPOS DE AÇÃO (embutidos + próprios).
 *
 * Tudo o que aqui se altera é configuração de negócio - fica registado na
 * linha do tempo imutável (sem cliente associado: clienteId null).
 */
import { useMemo, useState } from 'react';
import { tr, useLang } from '../i18n.js';
import { useColecao, useClientes, useDefinicoes } from '../hooks.js';
import { criar, atualizar, apagar, registarEvento } from '../ekoa.js';
import {
  Button, Badge, DataTable, Field, Input, Select, Textarea, Modal,
  ConfirmDialog, toast, EmptyState, Skeleton, Tabs,
} from '../components/ui.jsx';
import { indexarClientes, eur, formatData } from '../components/dominio.jsx';
import {
  IconPerfis, IconMais, IconAviso, IconEmail, IconTelefone, IconCarta,
  IconBalanca, IconRelogio, IconFechar, IconOlho,
} from '../components/Icons.jsx';
import { renderTemplate, variaveisTemplate } from '../engine/escalonamento.mjs';
import { hojeISO } from '../engine/datas.mjs';
import { estadoDerivado, emAberto } from '../engine/prestacoes.mjs';
import { CUSTO_RECUPERACAO_BASE } from '../engine/taxas.mjs';

/* ------------------------------ utilitários ----------------------------- */

function uid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function deepClone(v) {
  if (typeof structuredClone === 'function') return structuredClone(v);
  return JSON.parse(JSON.stringify(v));
}

function cloneComNovosIds(lista) {
  return (lista || []).map((x) => ({ ...deepClone(x), id: uid() }));
}

function slugDe(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Andaime de um perfil novo com os valores por omissão do brief. */
function novoPerfilScaffold() {
  return {
    nome: '',
    tom: 'suave',
    descricao: '',
    lembretes: [],
    templates: [],
    acoesAuto: { email: 'rascunho' },
    coalescerEmails: true,
    limites: { maxEmailsPorSemana: 2, horasSilencio: { inicio: '20:00', fim: '08:00' } },
    juros: { ativo: false, tipo: 'comercial', custoFixoRecuperacao: 40 },
  };
}

/** Normaliza o rascunho antes de gravar (números coeridos, defaults). */
function normalizarDraft(d) {
  const cf = Number(d.juros && d.juros.custoFixoRecuperacao);
  return {
    ...d,
    nome: String(d.nome || '').trim(),
    tom: d.tom === 'assertivo' ? 'assertivo' : 'suave',
    descricao: String(d.descricao || ''),
    lembretes: (d.lembretes || []).map((l) => {
      const off = Number(l.offsetDias);
      return { ...l, offsetDias: Number.isFinite(off) ? off : 0, ativo: l.ativo !== false };
    }),
    templates: (d.templates || []).map((t) => ({ ...t, idioma: t.idioma === 'en' ? 'en' : 'pt' })),
    acoesAuto: { email: ['tarefa', 'rascunho', 'auto'].includes(d.acoesAuto && d.acoesAuto.email) ? d.acoesAuto.email : 'rascunho' },
    coalescerEmails: d.coalescerEmails !== false,
    limites: {
      maxEmailsPorSemana: Math.max(0, Number((d.limites && d.limites.maxEmailsPorSemana)) || 0),
      horasSilencio: {
        inicio: (d.limites && d.limites.horasSilencio && d.limites.horasSilencio.inicio) || '20:00',
        fim: (d.limites && d.limites.horasSilencio && d.limites.horasSilencio.fim) || '08:00',
      },
    },
    juros: {
      ativo: !!(d.juros && d.juros.ativo),
      tipo: (d.juros && d.juros.tipo) === 'civil' ? 'civil' : 'comercial',
      custoFixoRecuperacao: Number.isFinite(cf) && cf >= 0 ? cf : 40,
    },
  };
}

const ICONES = {
  email: IconEmail,
  telefone: IconTelefone,
  carta: IconCarta,
  balanca: IconBalanca,
  relogio: IconRelogio,
  aviso: IconAviso,
};

const NOMES_EMBUTIDOS = {
  email: { pt: 'Email', en: 'Email' },
  telefone: { pt: 'Telefone', en: 'Phone' },
  carta: { pt: 'Carta', en: 'Letter' },
};

function nomeDoTipo(tipos, chave, lang) {
  const t = (tipos || []).find((x) => x.chave === chave);
  if (t) return lang === 'en' ? (t.nomeEn || t.nomePt || chave) : (t.nomePt || t.nomeEn || chave);
  const b = NOMES_EMBUTIDOS[chave];
  if (b) return lang === 'en' ? b.en : b.pt;
  return chave || '';
}

function rotuloOffset(off) {
  const n = Number(off);
  if (!Number.isFinite(n) || n === 0) return tr('No dia do vencimento', 'On the due date');
  const abs = Math.abs(n);
  return n < 0
    ? tr(`${abs} dia(s) antes do vencimento`, `${abs} day(s) before due date`)
    : tr(`${abs} dia(s) depois do vencimento`, `${abs} day(s) after due date`);
}

function rotuloModoEmail(modo) {
  if (modo === 'tarefa') return tr('Emails criam tarefas', 'Emails create tasks');
  if (modo === 'auto') return tr('Envio automático', 'Automatic send');
  return tr('Rascunhos para aprovação', 'Drafts for approval');
}

/** Registo de configuração na linha do tempo (sem cliente associado). */
function registarConfig(titulo, detalhe) {
  registarEvento({ clienteId: null, tipo: 'perfil', titulo, detalhe: detalhe || '' });
}

/* ------------------------- editor de um perfil --------------------------- */

function EditorPerfil({ draft, novo, tipos, previewDividas, clientesById, iban, aGuardar, onGuardar, onFechar }) {
  const lang = useLang();
  const [d, setD] = useState(() => deepClone(draft));
  const [tab, setTab] = useState('plano');
  const [tplEdit, setTplEdit] = useState(null);
  const [previewDividaId, setPreviewDividaId] = useState('');

  const patch = (p) => setD((prev) => ({ ...prev, ...p }));
  const updateLembrete = (id, p) => setD((prev) => ({
    ...prev,
    lembretes: (prev.lembretes || []).map((l) => (l.id === id ? { ...l, ...p } : l)),
  }));
  const removerLembrete = (id) => setD((prev) => ({
    ...prev,
    lembretes: (prev.lembretes || []).filter((l) => l.id !== id),
  }));
  const updateTemplate = (id, p) => setD((prev) => ({
    ...prev,
    templates: (prev.templates || []).map((t) => (t.id === id ? { ...t, ...p } : t)),
  }));
  const removerTemplate = (id) => {
    setD((prev) => ({ ...prev, templates: (prev.templates || []).filter((t) => t.id !== id) }));
    if (tplEdit === id) setTplEdit(null);
  };

  const chavesTipos = (tipos && tipos.length ? tipos.map((t) => t.chave) : ['email', 'telefone', 'carta']);

  const lembretesOrdenados = [...(d.lembretes || [])]
    .sort((a, b) => (Number(a.offsetDias) || 0) - (Number(b.offsetDias) || 0));

  const gruposParaTipo = (tipoAcao) => {
    const set = new Set();
    (d.templates || []).forEach((t) => { if (t.tipo === tipoAcao && t.grupo) set.add(t.grupo); });
    return [...set].sort();
  };

  const adicionarLembrete = () => {
    const grupos = gruposParaTipo('email');
    setD((prev) => ({
      ...prev,
      lembretes: [...(prev.lembretes || []), {
        id: uid(), offsetDias: 7, tipoAcao: chavesTipos.includes('email') ? 'email' : chavesTipos[0], templateGrupo: grupos[0] || '', ativo: true,
      }],
    }));
  };

  const adicionarTemplate = () => {
    const id = uid();
    setD((prev) => ({
      ...prev,
      templates: [...(prev.templates || []), {
        id, grupo: 'geral', idioma: 'pt', tipo: 'email', nome: tr('Novo template', 'New template'), assunto: '', corpo: '',
      }],
    }));
    setTplEdit(id);
  };

  // Agrupamento dos templates por tipo (embutidos primeiro, depois próprios).
  const tiposComTemplates = useMemo(() => {
    const presentes = new Set((d.templates || []).map((t) => t.tipo));
    const embutidos = ['email', 'telefone', 'carta'].filter((k) => presentes.has(k));
    const outros = [...presentes].filter((k) => !['email', 'telefone', 'carta'].includes(k)).sort();
    return [...embutidos, ...outros];
  }, [d.templates]);

  const tplAtual = (d.templates || []).find((t) => t.id === tplEdit) || null;
  const previewDivida = previewDividas.find((dv) => dv.id === previewDividaId) || null;

  let previewAssunto = '';
  let previewCorpo = '';
  if (tplAtual && previewDivida) {
    const cliente = clientesById.get(previewDivida.clienteId) || null;
    const vars = variaveisTemplate({
      cliente,
      itens: [{
        descricao: previewDivida.descricao || '',
        valorEmDivida: Number(previewDivida.valor) || 0,
        dataVencimento: previewDivida.dataVencimento || '',
        numeroFatura: previewDivida.numeroFatura || '',
      }],
      hoje: hojeISO(),
      lang: tplAtual.idioma === 'en' ? 'en' : 'pt',
      iban: iban || '',
    });
    previewAssunto = tplAtual.tipo === 'email' ? renderTemplate(tplAtual.assunto, vars) : '';
    previewCorpo = renderTemplate(tplAtual.corpo, vars);
  }

  const guardar = () => {
    const norm = normalizarDraft(d);
    if (!norm.nome) {
      toast(tr('Dê um nome ao perfil antes de guardar.', 'Give the profile a name before saving.'), { tone: 'error' });
      return;
    }
    onGuardar(norm);
  };

  return (
    <Modal
      open
      wide
      title={novo ? tr('Novo perfil de cobrança', 'New collection profile') : tr(`Editar perfil: ${draft.nome}`, `Edit profile: ${draft.nome}`)}
      onClose={onFechar}
      actions={(
        <>
          <Button variant="ghost" onClick={onFechar} data-testid="cancelar-perfil">{tr('Cancelar', 'Cancel')}</Button>
          <Button variant="primary" onClick={guardar} disabled={aGuardar} data-testid="guardar-perfil" data-demo-target="guardar-perfil">
            {aGuardar ? tr('A guardar…', 'Saving…') : tr('Guardar', 'Save')}
          </Button>
        </>
      )}
    >
      <div className="form-grelha">
        <Field label={tr('Nome do perfil', 'Profile name')} required>
          <Input
            value={d.nome || ''}
            onChange={(e) => patch({ nome: e.target.value })}
            placeholder={tr('Ex.: Clientes empresariais', 'E.g.: Business customers')}
            data-testid="perfil-nome"
          />
        </Field>
        <Field label={tr('Tom', 'Tone')}>
          <Select value={d.tom || 'suave'} onChange={(e) => patch({ tom: e.target.value })} data-testid="perfil-tom">
            <option value="suave">{tr('Suave', 'Gentle')}</option>
            <option value="assertivo">{tr('Assertivo', 'Assertive')}</option>
          </Select>
        </Field>
      </div>
      <Field label={tr('Descrição', 'Description')}>
        <Textarea
          rows={2}
          value={d.descricao || ''}
          onChange={(e) => patch({ descricao: e.target.value })}
          placeholder={tr('Para que clientes serve este perfil?', 'Which customers is this profile for?')}
          data-testid="perfil-descricao"
        />
      </Field>

      <Tabs
        tabs={[
          { id: 'plano', label: tr('Plano de escalonamento', 'Escalation plan'), badge: (d.lembretes || []).length },
          { id: 'templates', label: tr('Templates', 'Templates'), badge: (d.templates || []).length },
          { id: 'regras', label: tr('Regras', 'Rules') },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'plano' ? (
        <div>
          {lembretesOrdenados.length === 0 ? (
            <p className="campo__dica">
              {tr('Ainda sem lembretes. Adicione o primeiro passo do plano - por exemplo, um email amigável 3 dias antes do vencimento.', 'No reminders yet. Add the first step of the plan - for example a friendly email 3 days before the due date.')}
            </p>
          ) : null}
          {lembretesOrdenados.map((l) => {
            const grupos = gruposParaTipo(l.tipoAcao);
            const opcoesGrupo = grupos.includes(l.templateGrupo) || !l.templateGrupo ? grupos : [l.templateGrupo, ...grupos];
            return (
              <div
                key={l.id}
                style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 160px) minmax(140px, 1fr) minmax(140px, 1fr) auto auto', gap: '0.5rem', alignItems: 'start', padding: '0.5rem 0', borderBottom: '1px solid color-mix(in srgb, currentColor 10%, transparent)' }}
                data-testid={`lembrete-${l.id}`}
              >
                <div>
                  <Input
                    type="number"
                    value={l.offsetDias === '' ? '' : l.offsetDias}
                    onChange={(e) => updateLembrete(l.id, { offsetDias: e.target.value === '' ? '' : Number(e.target.value) })}
                    aria-label={tr('Dias face ao vencimento', 'Days relative to due date')}
                    data-testid="lembrete-offset"
                  />
                  <p className="campo__dica">{rotuloOffset(l.offsetDias)}</p>
                </div>
                <Select
                  value={l.tipoAcao || ''}
                  onChange={(e) => updateLembrete(l.id, { tipoAcao: e.target.value, templateGrupo: '' })}
                  aria-label={tr('Tipo de ação', 'Action type')}
                  data-testid="lembrete-tipo"
                >
                  {chavesTipos.map((k) => <option key={k} value={k}>{nomeDoTipo(tipos, k, lang)}</option>)}
                </Select>
                <Select
                  value={l.templateGrupo || ''}
                  onChange={(e) => updateLembrete(l.id, { templateGrupo: e.target.value })}
                  aria-label={tr('Grupo de templates', 'Template group')}
                  data-testid="lembrete-grupo"
                >
                  <option value="">{tr('- escolher grupo -', '- choose group -')}</option>
                  {opcoesGrupo.map((g) => <option key={g} value={g}>{g}</option>)}
                </Select>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', paddingTop: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={l.ativo !== false}
                    onChange={(e) => updateLembrete(l.id, { ativo: e.target.checked })}
                    data-testid="lembrete-ativo"
                  />
                  {tr('Ativo', 'Active')}
                </label>
                <Button variant="ghost" size="sm" onClick={() => removerLembrete(l.id)} aria-label={tr('Remover lembrete', 'Remove reminder')} data-testid="remover-lembrete">
                  <IconFechar size={14} />
                </Button>
              </div>
            );
          })}
          <div className="linha-acoes" style={{ marginTop: '0.75rem' }}>
            <Button variant="secondary" size="sm" onClick={adicionarLembrete} data-testid="adicionar-lembrete">
              <IconMais size={14} /> {tr('Adicionar passo', 'Add step')}
            </Button>
          </div>
        </div>
      ) : null}

      {tab === 'templates' ? (
        <div>
          {(d.templates || []).length === 0 ? (
            <p className="campo__dica">
              {tr('Ainda sem templates. Cada lembrete usa o grupo de templates com o idioma do cliente (recuo para PT).', 'No templates yet. Each reminder uses the template group in the customer language (falling back to PT).')}
            </p>
          ) : null}
          {tiposComTemplates.map((tipoChave) => {
            const doTipo = (d.templates || []).filter((t) => t.tipo === tipoChave);
            const tipoRow = (tipos || []).find((x) => x.chave === tipoChave);
            const Icone = ICONES[(tipoRow && tipoRow.icone) || tipoChave] || IconCarta;
            return (
              <div key={tipoChave} style={{ marginBottom: '0.75rem' }}>
                <p style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, margin: '0.5rem 0 0.25rem' }}>
                  <Icone size={15} /> {nomeDoTipo(tipos, tipoChave, lang)}
                </p>
                {doTipo.map((t) => (
                  <div key={t.id} className="linha-acoes" style={{ padding: '0.3rem 0' }} data-testid={`template-${t.id}`}>
                    <span>{t.nome || tr('(sem nome)', '(unnamed)')}</span>
                    <Badge tone="neutral">{t.idioma === 'en' ? 'EN' : 'PT'}</Badge>
                    {t.grupo ? <Badge tone="info">{t.grupo}</Badge> : null}
                    <span className="espacador" />
                    <Button variant="ghost" size="sm" onClick={() => setTplEdit(t.id === tplEdit ? null : t.id)} data-testid="editar-template">
                      {t.id === tplEdit ? tr('Fechar', 'Close') : tr('Editar', 'Edit')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => removerTemplate(t.id)} aria-label={tr('Remover template', 'Remove template')} data-testid="remover-template">
                      <IconFechar size={14} />
                    </Button>
                  </div>
                ))}
              </div>
            );
          })}
          <div className="linha-acoes">
            <Button variant="secondary" size="sm" onClick={adicionarTemplate} data-testid="adicionar-template">
              <IconMais size={14} /> {tr('Adicionar template', 'Add template')}
            </Button>
          </div>

          {tplAtual ? (
            <div className="cartao" style={{ marginTop: '0.75rem' }}>
              <h3 className="cartao__titulo">{tr('Editar template', 'Edit template')}</h3>
              <div className="form-grelha">
                <Field label={tr('Nome', 'Name')}>
                  <Input value={tplAtual.nome || ''} onChange={(e) => updateTemplate(tplAtual.id, { nome: e.target.value })} data-testid="template-nome" />
                </Field>
                <Field label={tr('Tipo', 'Type')}>
                  <Select value={tplAtual.tipo || 'email'} onChange={(e) => updateTemplate(tplAtual.id, { tipo: e.target.value })} data-testid="template-tipo">
                    {chavesTipos.map((k) => <option key={k} value={k}>{nomeDoTipo(tipos, k, lang)}</option>)}
                  </Select>
                </Field>
                <Field label={tr('Grupo', 'Group')} hint={tr('Os lembretes escolhem o template pelo grupo + idioma do cliente.', 'Reminders pick the template by group + customer language.')}>
                  <Input value={tplAtual.grupo || ''} onChange={(e) => updateTemplate(tplAtual.id, { grupo: e.target.value })} data-testid="template-grupo" />
                </Field>
                <Field label={tr('Idioma', 'Language')}>
                  <Select value={tplAtual.idioma || 'pt'} onChange={(e) => updateTemplate(tplAtual.id, { idioma: e.target.value })} data-testid="template-idioma">
                    <option value="pt">{tr('Português', 'Portuguese')}</option>
                    <option value="en">{tr('Inglês', 'English')}</option>
                  </Select>
                </Field>
              </div>
              {tplAtual.tipo === 'email' ? (
                <Field label={tr('Assunto', 'Subject')}>
                  <Input value={tplAtual.assunto || ''} onChange={(e) => updateTemplate(tplAtual.id, { assunto: e.target.value })} data-testid="template-assunto" />
                </Field>
              ) : null}
              <Field
                label={tr('Corpo', 'Body')}
                hint={tr('Variáveis: {{nome}} {{valor}} {{descricao}} {{dataVencimento}} {{diasAtraso}} {{numeroFatura}} {{iban}} {{listaDividas}} {{saldoTotal}}', 'Variables: {{nome}} {{valor}} {{descricao}} {{dataVencimento}} {{diasAtraso}} {{numeroFatura}} {{iban}} {{listaDividas}} {{saldoTotal}}')}
              >
                <Textarea rows={8} value={tplAtual.corpo || ''} onChange={(e) => updateTemplate(tplAtual.id, { corpo: e.target.value })} data-testid="template-corpo" />
              </Field>

              <Field
                label={(
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                    <IconOlho size={14} /> {tr('Pré-visualizar com uma dívida real', 'Preview with a real debt')}
                  </span>
                )}
              >
                {previewDividas.length === 0 ? (
                  <p className="campo__dica">{tr('Sem dívidas registadas para pré-visualizar. Crie primeiro uma dívida.', 'No debts recorded to preview. Create a debt first.')}</p>
                ) : (
                  <Select value={previewDividaId} onChange={(e) => setPreviewDividaId(e.target.value)} data-testid="preview-divida">
                    <option value="">{tr('- escolher dívida -', '- choose debt -')}</option>
                    {previewDividas.map((dv) => {
                      const c = clientesById.get(dv.clienteId);
                      return (
                        <option key={dv.id} value={dv.id}>
                          {`${(c && c.nome) || tr('Cliente desconhecido', 'Unknown customer')} - ${dv.descricao || ''} (${eur(dv.valor)}, ${formatData(dv.dataVencimento)})`}
                        </option>
                      );
                    })}
                  </Select>
                )}
              </Field>
              {previewDivida ? (
                <div className="documento" data-demo-target="preview-template" data-testid="preview-template">
                  {tplAtual.tipo === 'email' ? (
                    <p style={{ marginTop: 0 }}><strong>{tr('Assunto', 'Subject')}:</strong> {previewAssunto || tr('(vazio)', '(empty)')}</p>
                  ) : null}
                  <div style={{ whiteSpace: 'pre-wrap' }}>{previewCorpo || tr('(corpo vazio)', '(empty body)')}</div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'regras' ? (
        <div>
          <div className="form-grelha">
            <Field label={tr('Ao gerar emails de cobrança', 'When collection emails are generated')}>
              <Select
                value={(d.acoesAuto && d.acoesAuto.email) || 'rascunho'}
                onChange={(e) => patch({ acoesAuto: { ...(d.acoesAuto || {}), email: e.target.value } })}
                data-testid="modo-email"
              >
                <option value="tarefa">{tr('Criar apenas tarefa', 'Create a task only')}</option>
                <option value="rascunho">{tr('Rascunho para aprovação (por omissão)', 'Draft for approval (default)')}</option>
                <option value="auto">{tr('Enviar automaticamente', 'Send automatically')}</option>
              </Select>
            </Field>
            <Field label={tr('Coalescência de emails', 'Email coalescing')}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingTop: '0.4rem' }}>
                <input
                  type="checkbox"
                  checked={d.coalescerEmails !== false}
                  onChange={(e) => patch({ coalescerEmails: e.target.checked })}
                  data-testid="coalescer-emails"
                />
                {tr('Fundir vários lembretes do mesmo cliente num único email (digest)', 'Merge multiple reminders for the same customer into one digest email')}
              </label>
            </Field>
          </div>
          {((d.acoesAuto && d.acoesAuto.email) === 'auto') ? (
            <p style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start', color: 'var(--color-warning, #B45309)' }} data-testid="aviso-auto">
              <IconAviso size={16} />
              <span>{tr('Envio automático sem aprovação - opção explícita deste perfil. Por omissão os emails ficam em rascunho para aprovação.', 'Automatic sending without approval - an explicit opt-in for this profile. By default emails are queued as drafts for approval.')}</span>
            </p>
          ) : null}

          <div className="form-grelha" style={{ marginTop: '0.5rem' }}>
            <Field label={tr('Máximo de emails por semana (por cliente)', 'Maximum emails per week (per customer)')}>
              <Input
                type="number"
                min={0}
                value={(d.limites && d.limites.maxEmailsPorSemana) ?? 2}
                onChange={(e) => patch({ limites: { ...(d.limites || {}), maxEmailsPorSemana: e.target.value === '' ? '' : Number(e.target.value) } })}
                data-testid="limite-emails"
              />
            </Field>
            <Field label={tr('Horas de silêncio - início', 'Quiet hours - start')}>
              <Input
                type="time"
                value={(d.limites && d.limites.horasSilencio && d.limites.horasSilencio.inicio) || '20:00'}
                onChange={(e) => patch({ limites: { ...(d.limites || {}), horasSilencio: { ...((d.limites && d.limites.horasSilencio) || {}), inicio: e.target.value } } })}
                data-testid="silencio-inicio"
              />
            </Field>
            <Field label={tr('Horas de silêncio - fim', 'Quiet hours - end')}>
              <Input
                type="time"
                value={(d.limites && d.limites.horasSilencio && d.limites.horasSilencio.fim) || '08:00'}
                onChange={(e) => patch({ limites: { ...(d.limites || {}), horasSilencio: { ...((d.limites && d.limites.horasSilencio) || {}), fim: e.target.value } } })}
                data-testid="silencio-fim"
              />
            </Field>
          </div>

          <h3 className="cartao__titulo" style={{ marginTop: '1rem' }}>{tr('Juros de mora', 'Late-payment interest')}</h3>
          <div className="form-grelha">
            <Field label={tr('Aplicar juros', 'Apply interest')}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingTop: '0.4rem' }}>
                <input
                  type="checkbox"
                  checked={!!(d.juros && d.juros.ativo)}
                  onChange={(e) => patch({ juros: { ...(d.juros || {}), ativo: e.target.checked } })}
                  data-testid="juros-ativo"
                />
                {tr('Este perfil propõe juros de mora nas dívidas vencidas', 'This profile proposes late-payment interest on overdue debts')}
              </label>
            </Field>
            <Field label={tr('Tipo de juros', 'Interest type')}>
              <Select
                value={(d.juros && d.juros.tipo) || 'comercial'}
                onChange={(e) => patch({ juros: { ...(d.juros || {}), tipo: e.target.value } })}
                data-testid="juros-tipo"
              >
                <option value="civil">{tr('Civis (art. 559.º CC)', 'Civil (art. 559 Civil Code)')}</option>
                <option value="comercial">{tr('Comerciais (DL 62/2013)', 'Commercial (DL 62/2013)')}</option>
              </Select>
            </Field>
            <Field
              label={tr('Custo fixo de recuperação (EUR)', 'Fixed recovery cost (EUR)')}
              hint={CUSTO_RECUPERACAO_BASE}
            >
              <Input
                type="number"
                min={0}
                step="0.01"
                value={(d.juros && d.juros.custoFixoRecuperacao) ?? 40}
                onChange={(e) => patch({ juros: { ...(d.juros || {}), custoFixoRecuperacao: e.target.value === '' ? '' : Number(e.target.value) } })}
                data-testid="juros-custo-fixo"
              />
            </Field>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

/* ------------------------- diálogo "Copiar de…" -------------------------- */

function CopiarDeDialog({ alvo, perfis, tipos, aAplicar, onAplicar, onFechar }) {
  const lang = useLang();
  const outros = perfis.filter((p) => p.id !== alvo.id);
  const [fonteId, setFonteId] = useState(outros.length ? outros[0].id : '');
  const [copiarLembretes, setCopiarLembretes] = useState(false);
  const [copiarPorTipo, setCopiarPorTipo] = useState(false);
  const [tipoSel, setTipoSel] = useState('email');
  const [selIds, setSelIds] = useState(() => new Set());

  const fonte = outros.find((p) => p.id === fonteId) || null;
  const tiposDaFonte = useMemo(() => {
    const set = new Set(((fonte && fonte.templates) || []).map((t) => t.tipo));
    return [...set].sort();
  }, [fonte]);

  const alternarSel = (id) => setSelIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const aplicar = () => {
    if (!fonte) {
      toast(tr('Escolha o perfil de origem.', 'Choose the source profile.'), { tone: 'error' });
      return;
    }
    const escolhidos = new Map();
    if (copiarPorTipo) {
      ((fonte.templates) || []).filter((t) => t.tipo === tipoSel).forEach((t) => escolhidos.set(t.id, t));
    }
    ((fonte.templates) || []).filter((t) => selIds.has(t.id)).forEach((t) => escolhidos.set(t.id, t));
    const templates = [...escolhidos.values()];
    if (!copiarLembretes && templates.length === 0) {
      toast(tr('Escolha pelo menos uma secção a copiar.', 'Choose at least one section to copy.'), { tone: 'info' });
      return;
    }
    onAplicar({ fonte, lembretes: copiarLembretes, templates });
  };

  return (
    <Modal
      open
      title={tr(`Copiar para "${alvo.nome}"`, `Copy into "${alvo.nome}"`)}
      onClose={onFechar}
      actions={(
        <>
          <Button variant="ghost" onClick={onFechar}>{tr('Cancelar', 'Cancel')}</Button>
          <Button variant="primary" onClick={aplicar} disabled={aAplicar} data-testid="aplicar-copia">
            {aAplicar ? tr('A copiar…', 'Copying…') : tr('Copiar', 'Copy')}
          </Button>
        </>
      )}
    >
      {outros.length === 0 ? (
        <p>{tr('Não existe outro perfil de onde copiar.', 'There is no other profile to copy from.')}</p>
      ) : (
        <>
          <Field label={tr('Perfil de origem', 'Source profile')}>
            <Select value={fonteId} onChange={(e) => { setFonteId(e.target.value); setSelIds(new Set()); }} data-testid="copia-fonte">
              {outros.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </Select>
          </Field>
          <p className="campo__dica">
            {tr('As cópias são independentes: alterações futuras no perfil de origem não se propagam.', 'Copies are independent: future changes to the source profile do not propagate.')}
          </p>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0' }}>
            <input type="checkbox" checked={copiarLembretes} onChange={(e) => setCopiarLembretes(e.target.checked)} data-testid="copia-lembretes" />
            {tr(`Todos os lembretes (${((fonte && fonte.lembretes) || []).length}) - substitui o plano atual`, `All reminders (${((fonte && fonte.lembretes) || []).length}) - replaces the current plan`)}
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0' }}>
            <input type="checkbox" checked={copiarPorTipo} onChange={(e) => setCopiarPorTipo(e.target.checked)} data-testid="copia-por-tipo" />
            {tr('Todos os templates de um tipo:', 'All templates of one type:')}
          </label>
          {copiarPorTipo ? (
            <Select value={tipoSel} onChange={(e) => setTipoSel(e.target.value)} data-testid="copia-tipo" style={{ marginBottom: '0.5rem' }}>
              {(tiposDaFonte.length ? tiposDaFonte : ['email', 'telefone', 'carta']).map((k) => (
                <option key={k} value={k}>{nomeDoTipo(tipos, k, lang)}</option>
              ))}
            </Select>
          ) : null}

          <p style={{ fontWeight: 600, margin: '0.5rem 0 0.25rem' }}>{tr('Templates individuais', 'Individual templates')}</p>
          {((fonte && fonte.templates) || []).length === 0 ? (
            <p className="campo__dica">{tr('O perfil de origem não tem templates.', 'The source profile has no templates.')}</p>
          ) : (
            ((fonte && fonte.templates) || []).map((t) => (
              <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.2rem 0' }}>
                <input type="checkbox" checked={selIds.has(t.id)} onChange={() => alternarSel(t.id)} data-testid={`copia-template-${t.id}`} />
                <span>{t.nome || tr('(sem nome)', '(unnamed)')}</span>
                <Badge tone="neutral">{t.idioma === 'en' ? 'EN' : 'PT'}</Badge>
                <Badge tone="info">{nomeDoTipo(tipos, t.tipo, lang)}</Badge>
                {t.grupo ? <span className="campo__dica" style={{ margin: 0 }}>{t.grupo}</span> : null}
              </label>
            ))
          )}
        </>
      )}
    </Modal>
  );
}

/* --------------------------- modal "Novo tipo" --------------------------- */

function NovoTipoModal({ tipos, aCriar, onCriar, onFechar }) {
  useLang();
  const [nomePt, setNomePt] = useState('');
  const [nomeEn, setNomeEn] = useState('');
  const [chave, setChave] = useState('');
  const [chaveTocada, setChaveTocada] = useState(false);
  const [icone, setIcone] = useState('aviso');

  const mudarNomePt = (v) => {
    setNomePt(v);
    if (!chaveTocada) setChave(slugDe(v));
  };

  const criarTipo = () => {
    const nome = nomePt.trim();
    const ch = slugDe(chave);
    if (!nome) {
      toast(tr('Indique o nome em português.', 'Provide the Portuguese name.'), { tone: 'error' });
      return;
    }
    if (!ch) {
      toast(tr('A chave do tipo é obrigatória.', 'The type key is required.'), { tone: 'error' });
      return;
    }
    if ((tipos || []).some((t) => String(t.chave).toLowerCase() === ch)) {
      toast(tr(`Já existe um tipo com a chave "${ch}".`, `A type with key "${ch}" already exists.`), { tone: 'error' });
      return;
    }
    onCriar({ chave: ch, nomePt: nome, nomeEn: nomeEn.trim() || nome, icone, autoExecutavel: false, embutido: false });
  };

  return (
    <Modal
      open
      title={tr('Novo tipo de ação', 'New action type')}
      onClose={onFechar}
      actions={(
        <>
          <Button variant="ghost" onClick={onFechar}>{tr('Cancelar', 'Cancel')}</Button>
          <Button variant="primary" onClick={criarTipo} disabled={aCriar} data-testid="criar-tipo">
            {aCriar ? tr('A criar…', 'Creating…') : tr('Criar tipo', 'Create type')}
          </Button>
        </>
      )}
    >
      <div className="form-grelha">
        <Field label={tr('Nome (PT)', 'Name (PT)')} required>
          <Input value={nomePt} onChange={(e) => mudarNomePt(e.target.value)} placeholder={tr('Ex.: Visita presencial', 'E.g.: In-person visit')} data-testid="tipo-nome-pt" />
        </Field>
        <Field label={tr('Nome (EN)', 'Name (EN)')}>
          <Input value={nomeEn} onChange={(e) => setNomeEn(e.target.value)} data-testid="tipo-nome-en" />
        </Field>
        <Field label={tr('Chave', 'Key')} hint={tr('Identificador técnico (gerado do nome; pode ajustar).', 'Technical identifier (generated from the name; adjustable).')}>
          <Input value={chave} onChange={(e) => { setChave(e.target.value); setChaveTocada(true); }} data-testid="tipo-chave" />
        </Field>
        <Field label={tr('Ícone', 'Icon')}>
          <Select value={icone} onChange={(e) => setIcone(e.target.value)} data-testid="tipo-icone">
            <option value="email">{tr('Email', 'Email')}</option>
            <option value="telefone">{tr('Telefone', 'Phone')}</option>
            <option value="carta">{tr('Carta', 'Letter')}</option>
            <option value="balanca">{tr('Balança', 'Scales')}</option>
            <option value="relogio">{tr('Relógio', 'Clock')}</option>
            <option value="aviso">{tr('Aviso', 'Warning')}</option>
          </Select>
        </Field>
      </div>
      <Field
        label={tr('Execução automática', 'Automatic execution')}
        hint={tr('Só o email tem transporte automático; os tipos personalizados criam sempre tarefas.', 'Only email has an automatic transport; custom types always create tasks.')}
      >
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', opacity: 0.6 }}>
          <input type="checkbox" checked={false} disabled data-testid="tipo-auto" />
          {tr('Executar automaticamente', 'Execute automatically')}
        </label>
      </Field>
    </Modal>
  );
}

/* -------------------------------- página --------------------------------- */

export default function PerfisPage() {
  const lang = useLang();
  const { items: perfis, loading: loadingPerfis, error: perfisErro, refresh: refreshPerfis } = useColecao('perfis');
  const { items: tipos, loading: loadingTipos, refresh: refreshTipos } = useColecao('tipos_acao');
  const { items: dividas } = useColecao('dividas');
  const { items: pagamentos } = useColecao('pagamentos');
  const { items: overlays } = useColecao('clientes_cobranca');
  const { items: clientes } = useClientes();
  const { definicoes } = useDefinicoes();

  const [editor, setEditor] = useState(null); // { draft, novo }
  const [aGuardar, setAGuardar] = useState(false);
  const [perfilApagar, setPerfilApagar] = useState(null);
  const [copiaAlvo, setCopiaAlvo] = useState(null);
  const [aAplicarCopia, setAAplicarCopia] = useState(false);
  const [tipoModal, setTipoModal] = useState(false);
  const [aCriarTipo, setACriarTipo] = useState(false);
  const [tipoApagar, setTipoApagar] = useState(null);

  const clientesById = useMemo(() => indexarClientes(clientes), [clientes]);

  /** Nº de clientes (overlay) que usam cada perfil - bloqueia o apagar. */
  const usoPorPerfil = useMemo(() => {
    const m = new Map();
    (overlays || []).forEach((o) => {
      if (o.perfilId) m.set(o.perfilId, (m.get(o.perfilId) || 0) + 1);
    });
    return m;
  }, [overlays]);

  /** Chaves de tipos de ação referenciadas por algum lembrete de algum perfil. */
  const tiposUsados = useMemo(() => {
    const s = new Set();
    (perfis || []).forEach((p) => (p.lembretes || []).forEach((l) => { if (l.tipoAcao) s.add(l.tipoAcao); }));
    return s;
  }, [perfis]);

  /** Dívidas reais com cliente conhecido, abertas primeiro - para a pré-visualização. */
  const previewDividas = useMemo(() => {
    return (dividas || [])
      .filter((dv) => clientesById.get(dv.clienteId))
      .sort((a, b) => {
        const abertaA = emAberto(estadoDerivado(a, pagamentos)) ? 0 : 1;
        const abertaB = emAberto(estadoDerivado(b, pagamentos)) ? 0 : 1;
        if (abertaA !== abertaB) return abertaA - abertaB;
        return String(b.dataVencimento || '').localeCompare(String(a.dataVencimento || ''));
      });
  }, [dividas, pagamentos, clientesById]);

  /* ------------------------------ ações CRUD ----------------------------- */

  const guardarPerfil = async (norm) => {
    setAGuardar(true);
    try {
      if (editor && editor.novo) {
        const { id: _id, ...dados } = norm;
        await criar('perfis', dados);
        registarConfig(
          tr(`Perfil de cobrança criado: ${norm.nome}`, `Collection profile created: ${norm.nome}`),
          tr(`${(norm.lembretes || []).length} lembretes, ${(norm.templates || []).length} templates.`, `${(norm.lembretes || []).length} reminders, ${(norm.templates || []).length} templates.`),
        );
        toast(tr(`Perfil "${norm.nome}" criado.`, `Profile "${norm.nome}" created.`), { tone: 'ok' });
      } else {
        const { id, createdAt: _c, updatedAt: _u, ...patchDados } = norm;
        await atualizar('perfis', id, patchDados);
        registarConfig(tr(`Perfil de cobrança atualizado: ${norm.nome}`, `Collection profile updated: ${norm.nome}`));
        toast(tr(`Perfil "${norm.nome}" guardado.`, `Profile "${norm.nome}" saved.`), { tone: 'ok' });
      }
      setEditor(null);
      await refreshPerfis();
    } catch (err) {
      toast(tr('Falha ao guardar o perfil.', 'Failed to save the profile.'), { tone: 'error' });
      console.error('[cobrancas] guardar perfil:', err);
    } finally {
      setAGuardar(false);
    }
  };

  const duplicarPerfil = async (p) => {
    try {
      const clone = deepClone(p);
      delete clone.id;
      delete clone.createdAt;
      delete clone.updatedAt;
      clone.nome = `${p.nome}${tr(' (cópia)', ' (copy)')}`;
      clone.lembretes = cloneComNovosIds(p.lembretes);
      clone.templates = cloneComNovosIds(p.templates);
      await criar('perfis', clone);
      registarConfig(
        tr(`Perfil duplicado: ${clone.nome}`, `Profile duplicated: ${clone.nome}`),
        tr(`Origem: "${p.nome}".`, `Source: "${p.nome}".`),
      );
      toast(tr(`Perfil duplicado como "${clone.nome}".`, `Profile duplicated as "${clone.nome}".`), { tone: 'ok' });
      await refreshPerfis();
    } catch (err) {
      toast(tr('Falha ao duplicar o perfil.', 'Failed to duplicate the profile.'), { tone: 'error' });
      console.error('[cobrancas] duplicar perfil:', err);
    }
  };

  const pedirApagarPerfil = (p) => {
    const uso = usoPorPerfil.get(p.id) || 0;
    if (uso > 0) {
      toast(
        tr(`Não é possível apagar: o perfil "${p.nome}" está atribuído a ${uso} cliente(s).`, `Cannot delete: profile "${p.nome}" is assigned to ${uso} customer(s).`),
        { tone: 'error' },
      );
      return;
    }
    setPerfilApagar(p);
  };

  const confirmarApagarPerfil = async () => {
    const p = perfilApagar;
    setPerfilApagar(null);
    if (!p) return;
    try {
      await apagar('perfis', p.id);
      registarConfig(tr(`Perfil de cobrança apagado: ${p.nome}`, `Collection profile deleted: ${p.nome}`));
      toast(tr(`Perfil "${p.nome}" apagado.`, `Profile "${p.nome}" deleted.`), { tone: 'ok' });
      await refreshPerfis();
    } catch (err) {
      toast(tr('Falha ao apagar o perfil.', 'Failed to delete the profile.'), { tone: 'error' });
      console.error('[cobrancas] apagar perfil:', err);
    }
  };

  const aplicarCopia = async ({ fonte, lembretes, templates }) => {
    const alvo = copiaAlvo;
    if (!alvo) return;
    setAAplicarCopia(true);
    try {
      const patchDados = {};
      if (lembretes) patchDados.lembretes = cloneComNovosIds(fonte.lembretes);
      if (templates.length) patchDados.templates = [...(alvo.templates || []), ...cloneComNovosIds(templates)];
      await atualizar('perfis', alvo.id, patchDados);
      const partes = [];
      if (lembretes) partes.push(tr(`${(fonte.lembretes || []).length} lembretes (plano substituído)`, `${(fonte.lembretes || []).length} reminders (plan replaced)`));
      if (templates.length) partes.push(tr(`${templates.length} templates`, `${templates.length} templates`));
      registarConfig(
        tr(`Configuração copiada entre perfis: "${fonte.nome}" para "${alvo.nome}"`, `Configuration copied between profiles: "${fonte.nome}" into "${alvo.nome}"`),
        partes.join('; '),
      );
      toast(tr(`Copiado de "${fonte.nome}": ${partes.join(' + ')}.`, `Copied from "${fonte.nome}": ${partes.join(' + ')}.`), { tone: 'ok' });
      setCopiaAlvo(null);
      await refreshPerfis();
    } catch (err) {
      toast(tr('Falha ao copiar entre perfis.', 'Failed to copy between profiles.'), { tone: 'error' });
      console.error('[cobrancas] copiar entre perfis:', err);
    } finally {
      setAAplicarCopia(false);
    }
  };

  const criarTipo = async (dados) => {
    setACriarTipo(true);
    try {
      await criar('tipos_acao', dados);
      registarConfig(tr(`Tipo de ação criado: ${dados.nomePt} (${dados.chave})`, `Action type created: ${dados.nomeEn} (${dados.chave})`));
      toast(tr(`Tipo "${dados.nomePt}" criado.`, `Type "${dados.nomeEn}" created.`), { tone: 'ok' });
      setTipoModal(false);
      await refreshTipos();
    } catch (err) {
      toast(tr('Falha ao criar o tipo de ação.', 'Failed to create the action type.'), { tone: 'error' });
      console.error('[cobrancas] criar tipo:', err);
    } finally {
      setACriarTipo(false);
    }
  };

  const confirmarApagarTipo = async () => {
    const t = tipoApagar;
    setTipoApagar(null);
    if (!t) return;
    try {
      await apagar('tipos_acao', t.id);
      registarConfig(tr(`Tipo de ação apagado: ${t.nomePt} (${t.chave})`, `Action type deleted: ${t.nomeEn || t.nomePt} (${t.chave})`));
      toast(tr(`Tipo "${t.nomePt}" apagado.`, `Type "${t.nomeEn || t.nomePt}" deleted.`), { tone: 'ok' });
      await refreshTipos();
    } catch (err) {
      toast(tr('Falha ao apagar o tipo de ação.', 'Failed to delete the action type.'), { tone: 'error' });
      console.error('[cobrancas] apagar tipo:', err);
    }
  };

  /* ------------------------------ renderizar ----------------------------- */

  const colunasTipos = [
    {
      key: 'nome',
      label: tr('Nome', 'Name'),
      render: (t) => {
        const Icone = ICONES[t.icone] || IconAviso;
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
            <Icone size={15} /> {lang === 'en' ? (t.nomeEn || t.nomePt) : t.nomePt}
          </span>
        );
      },
    },
    { key: 'chave', label: tr('Chave', 'Key'), render: (t) => <code>{t.chave}</code> },
    {
      key: 'transporte',
      label: tr('Execução', 'Execution'),
      render: (t) => (t.autoExecutavel
        ? <Badge tone="ok">{tr('Automática', 'Automatic')}</Badge>
        : <Badge tone="neutral">{tr('Tarefa', 'Task')}</Badge>),
    },
    {
      key: 'origem',
      label: tr('Origem', 'Origin'),
      render: (t) => (t.embutido
        ? <Badge tone="neutral">{tr('Embutido', 'Built-in')}</Badge>
        : <Badge tone="info">{tr('Personalizado', 'Custom')}</Badge>),
    },
    {
      key: 'acoes',
      label: '',
      alinhar: 'direita',
      render: (t) => {
        if (t.embutido) return null;
        if (tiposUsados.has(t.chave)) {
          return <span className="campo__dica" style={{ margin: 0 }}>{tr('Em uso num perfil', 'In use by a profile')}</span>;
        }
        return (
          <Button variant="danger" size="sm" onClick={() => setTipoApagar(t)} data-testid={`apagar-tipo-${t.chave}`}>
            {tr('Apagar', 'Delete')}
          </Button>
        );
      },
    },
  ];

  return (
    <div>
      <div className="linha-acoes" style={{ marginBottom: '1rem' }}>
        <p style={{ margin: 0 }}>
          {tr('Os perfis definem como cada segmento de clientes é cobrado: plano de lembretes, templates, regras e juros.', 'Profiles define how each customer segment is chased: reminder plan, templates, rules and interest.')}
        </p>
        <span className="espacador" />
        <Button
          variant="primary"
          onClick={() => setEditor({ draft: novoPerfilScaffold(), novo: true })}
          data-testid="novo-perfil"
          data-demo-target="novo-perfil"
        >
          <IconMais size={15} /> {tr('Novo perfil', 'New profile')}
        </Button>
      </div>

      {perfisErro ? (
        <div className="cartao cartao--aviso" style={{ marginBottom: '1rem' }}>
          <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <IconAviso size={16} /> {tr('Falha ao carregar os perfis. Tente recarregar a página.', 'Failed to load profiles. Try reloading the page.')}
          </p>
        </div>
      ) : null}

      {loadingPerfis && !perfis.length ? (
        <div className="cartao"><Skeleton lines={4} /></div>
      ) : perfis.length === 0 ? (
        <EmptyState
          icon={<IconPerfis size={28} />}
          title={tr('Ainda sem perfis de cobrança', 'No collection profiles yet')}
          hint={tr('Crie o primeiro perfil para definir lembretes, templates e regras de cobrança.', 'Create the first profile to define reminders, templates and collection rules.')}
          action={(
            <Button variant="primary" onClick={() => setEditor({ draft: novoPerfilScaffold(), novo: true })} data-testid="novo-perfil-vazio">
              <IconMais size={15} /> {tr('Criar perfil', 'Create profile')}
            </Button>
          )}
        />
      ) : (
        <div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '1rem' }}
          data-demo-target="lista-perfis"
          data-testid="lista-perfis"
        >
          {perfis.map((p) => {
            const uso = usoPorPerfil.get(p.id) || 0;
            const modo = (p.acoesAuto && p.acoesAuto.email) || 'rascunho';
            const teto = Number((p.limites && p.limites.maxEmailsPorSemana)) || 0;
            return (
              <article key={p.id} className="cartao" data-testid={`perfil-${p.id}`}>
                <div className="linha-acoes">
                  <h3 className="cartao__titulo" style={{ margin: 0 }}>{p.nome}</h3>
                  <Badge tone={p.tom === 'assertivo' ? 'warn' : 'info'}>
                    {p.tom === 'assertivo' ? tr('Assertivo', 'Assertive') : tr('Suave', 'Gentle')}
                  </Badge>
                  <span className="espacador" />
                  {uso > 0 ? (
                    <Badge tone="accent">{tr(`Em uso: ${uso} cliente(s)`, `In use: ${uso} customer(s)`)}</Badge>
                  ) : null}
                </div>
                {p.descricao ? <p style={{ marginTop: '0.4rem' }}>{p.descricao}</p> : null}
                <div className="linha-acoes" style={{ marginTop: '0.5rem' }}>
                  <Badge tone="neutral">{tr(`${(p.lembretes || []).length} lembretes`, `${(p.lembretes || []).length} reminders`)}</Badge>
                  <Badge tone={modo === 'auto' ? 'warn' : 'neutral'}>{rotuloModoEmail(modo)}</Badge>
                  <Badge tone="neutral">{tr(`Teto: ${teto}/semana`, `Cap: ${teto}/week`)}</Badge>
                  <Badge tone="neutral">{p.coalescerEmails !== false ? tr('Digest', 'Digest') : tr('Emails individuais', 'Individual emails')}</Badge>
                  <Badge tone={(p.juros && p.juros.ativo) ? 'accent' : 'neutral'}>
                    {(p.juros && p.juros.ativo) ? tr('Juros ativos', 'Interest on') : tr('Sem juros', 'No interest')}
                  </Badge>
                </div>
                <div className="linha-acoes" style={{ marginTop: '0.75rem' }}>
                  <Button variant="secondary" size="sm" onClick={() => setEditor({ draft: deepClone(p), novo: false })} data-testid={`editar-perfil-${p.id}`}>
                    {tr('Editar', 'Edit')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => duplicarPerfil(p)} data-testid={`duplicar-perfil-${p.id}`}>
                    {tr('Duplicar', 'Duplicate')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setCopiaAlvo(p)} disabled={perfis.length < 2} data-testid={`copiar-perfil-${p.id}`}>
                    {tr('Copiar de…', 'Copy from…')}
                  </Button>
                  <span className="espacador" />
                  <Button variant="danger" size="sm" onClick={() => pedirApagarPerfil(p)} data-testid={`apagar-perfil-${p.id}`}>
                    {tr('Apagar', 'Delete')}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="cartao" style={{ marginTop: '1.25rem' }} data-demo-target="tipos-acao" data-testid="tipos-acao">
        <div className="linha-acoes" style={{ marginBottom: '0.5rem' }}>
          <h3 className="cartao__titulo" style={{ margin: 0 }}>{tr('Tipos de ação', 'Action types')}</h3>
          <span className="espacador" />
          <Button variant="secondary" size="sm" onClick={() => setTipoModal(true)} data-testid="novo-tipo">
            <IconMais size={14} /> {tr('Novo tipo', 'New type')}
          </Button>
        </div>
        {loadingTipos && !tipos.length ? (
          <Skeleton lines={3} />
        ) : (
          <DataTable
            columns={colunasTipos}
            rows={tipos}
            rowKey={(t) => t.id || t.chave}
            empty={(
              <EmptyState
                icon={<IconAviso size={24} />}
                title={tr('Sem tipos de ação', 'No action types')}
                hint={tr('Os tipos embutidos (email, telefone, carta) são criados pela app no primeiro arranque.', 'The built-in types (email, phone, letter) are created by the app on first start.')}
              />
            )}
          />
        )}
      </div>

      {editor ? (
        <EditorPerfil
          key={editor.draft.id || 'novo'}
          draft={editor.draft}
          novo={editor.novo}
          tipos={tipos}
          previewDividas={previewDividas}
          clientesById={clientesById}
          iban={(definicoes && definicoes.iban) || ''}
          aGuardar={aGuardar}
          onGuardar={guardarPerfil}
          onFechar={() => setEditor(null)}
        />
      ) : null}

      {copiaAlvo ? (
        <CopiarDeDialog
          alvo={copiaAlvo}
          perfis={perfis}
          tipos={tipos}
          aAplicar={aAplicarCopia}
          onAplicar={aplicarCopia}
          onFechar={() => setCopiaAlvo(null)}
        />
      ) : null}

      {tipoModal ? (
        <NovoTipoModal
          tipos={tipos}
          aCriar={aCriarTipo}
          onCriar={criarTipo}
          onFechar={() => setTipoModal(false)}
        />
      ) : null}

      <ConfirmDialog
        open={!!perfilApagar}
        title={tr('Apagar perfil', 'Delete profile')}
        message={perfilApagar ? tr(`Apagar o perfil "${perfilApagar.nome}"? Esta ação não pode ser anulada.`, `Delete profile "${perfilApagar.nome}"? This action cannot be undone.`) : ''}
        confirmLabel={tr('Apagar', 'Delete')}
        cancelLabel={tr('Cancelar', 'Cancel')}
        danger
        onConfirm={confirmarApagarPerfil}
        onCancel={() => setPerfilApagar(null)}
      />

      <ConfirmDialog
        open={!!tipoApagar}
        title={tr('Apagar tipo de ação', 'Delete action type')}
        message={tipoApagar ? tr(`Apagar o tipo "${tipoApagar.nomePt}" (${tipoApagar.chave})?`, `Delete type "${tipoApagar.nomeEn || tipoApagar.nomePt}" (${tipoApagar.chave})?`) : ''}
        confirmLabel={tr('Apagar', 'Delete')}
        cancelLabel={tr('Cancelar', 'Cancel')}
        danger
        onConfirm={confirmarApagarTipo}
        onCancel={() => setTipoApagar(null)}
      />
    </div>
  );
}
