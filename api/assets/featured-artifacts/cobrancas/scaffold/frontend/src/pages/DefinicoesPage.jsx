/*
 * Definições - configuração da app Cobranças.
 *
 * Secções: integração de email (envio de lembretes), parâmetros de cobrança
 * (IBAN, alocação de pagamentos, prazo Honorários, limiares do score),
 * idioma, exportações CSV e a nota honesta sobre o funcionamento da app.
 * Tudo persiste servidor-side na coleção `definicoes` (linha única).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { tr, useLang, useSetLang, LANGS } from '../i18n.js';
import { useDefinicoes } from '../hooks.js';
import { listar, listarPartilhada, listarIntegracoesEmail, descarregarCsv, disponivel } from '../ekoa.js';
import { Button, Badge, Field, Input, Select, toast, EmptyState, Skeleton } from '../components/ui.jsx';
import { eur, formatData, formatDataHora, rotuloEstado, indexarClientes } from '../components/dominio.jsx';
import { IconEmail, IconDescarregar, IconAviso, IconSincronizar } from '../components/Icons.jsx';
import { round2 } from '../engine/dinheiro.mjs';
import { hojeISO } from '../engine/datas.mjs';

const NOTA_STYLE = { fontSize: '0.8125rem', color: 'var(--color-text-subtle, #64748B)', lineHeight: 1.5, margin: 0 };

function chaveIntegracao(i) {
  return `${i.integrationKey}::${i.actionName}`;
}

function BadgeEstadoIntegracao({ integracao }) {
  if (integracao.needsReauth) {
    return <Badge tone="danger">{tr('Reautenticação necessária', 'Reauthentication required')}</Badge>;
  }
  if (integracao.connected) {
    return <Badge tone="ok">{tr('Ligada', 'Connected')}</Badge>;
  }
  return <Badge tone="neutral">{tr('Não ligada', 'Not connected')}</Badge>;
}

export default function DefinicoesPage() {
  useLang();
  const setLang = useSetLang();
  const { definicoes, atualizarDefinicoes } = useDefinicoes();

  /* ------------------------------ email --------------------------------- */
  const [integracoes, setIntegracoes] = useState([]);
  const [integracoesLoading, setIntegracoesLoading] = useState(true);
  const [integracoesErro, setIntegracoesErro] = useState(null);
  const [aGravarEmail, setAGravarEmail] = useState(false);
  const autoPreselecionadaRef = useRef(false);

  const carregarIntegracoes = useCallback(async () => {
    setIntegracoesLoading(true);
    setIntegracoesErro(null);
    const r = await listarIntegracoesEmail();
    if (!r.ok) {
      setIntegracoesErro(r.erro || tr('Falha ao listar as integrações de email.', 'Failed to list email integrations.'));
      setIntegracoes([]);
    } else {
      setIntegracoes(r.integracoes || []);
    }
    setIntegracoesLoading(false);
  }, []);

  useEffect(() => { carregarIntegracoes(); }, [carregarIntegracoes]);

  const selecionarIntegracao = useCallback(async (integracao, { automatica = false } = {}) => {
    setAGravarEmail(true);
    try {
      await atualizarDefinicoes({
        emailIntegrationKey: integracao.integrationKey,
        emailActionName: integracao.actionName,
      });
      toast(
        automatica
          ? tr('Única integração ligada pré-selecionada automaticamente.', 'Only connected integration was preselected automatically.')
          : tr('Integração de email guardada.', 'Email integration saved.'),
        { tone: 'ok' },
      );
    } catch (err) {
      toast(
        tr('Falha ao guardar a integração de email.', 'Failed to save the email integration.')
          + (err && err.message ? ` (${err.message})` : ''),
        { tone: 'error' },
      );
    } finally {
      setAGravarEmail(false);
    }
  }, [atualizarDefinicoes]);

  // Pré-seleção automática: sem escolha guardada e EXATAMENTE UMA integração
  // ligada (e sem reautenticação pendente) -> grava-a de imediato.
  useEffect(() => {
    if (autoPreselecionadaRef.current) return;
    if (!definicoes || definicoes.emailIntegrationKey) return;
    if (integracoesLoading || integracoesErro) return;
    const ligadas = integracoes.filter((i) => i.connected && !i.needsReauth);
    if (ligadas.length === 1) {
      autoPreselecionadaRef.current = true;
      selecionarIntegracao(ligadas[0], { automatica: true });
    }
  }, [definicoes, integracoes, integracoesLoading, integracoesErro, selecionarIntegracao]);

  /* ----------------------------- cobrança ------------------------------- */
  const [form, setForm] = useState(null);
  const [aGravarCobranca, setAGravarCobranca] = useState(false);

  useEffect(() => {
    if (definicoes && form === null) {
      setForm({
        iban: definicoes.iban || '',
        alocacao: definicoes.alocacao === 'recente-primeiro' ? 'recente-primeiro' : 'antiga-primeiro',
        prazo: String(definicoes.prazoPagamentoHonorarios ?? 30),
        sugerirSuave: String(definicoes.scoreLimiares?.sugerirSuave ?? 70),
        sugerirAssertivo: String(definicoes.scoreLimiares?.sugerirAssertivo ?? 40),
      });
    }
  }, [definicoes, form]);

  const setCampo = (campo) => (e) => {
    const valor = e.target.value;
    setForm((f) => ({ ...f, [campo]: valor }));
  };

  const guardarCobranca = async () => {
    if (!form) return;
    const prazo = parseInt(form.prazo, 10);
    if (!Number.isFinite(prazo) || prazo < 1) {
      toast(tr('O prazo de pagamento deve ser um número de dias igual ou superior a 1.', 'The payment term must be a number of days of 1 or more.'), { tone: 'error' });
      return;
    }
    const suave = parseInt(form.sugerirSuave, 10);
    const assertivo = parseInt(form.sugerirAssertivo, 10);
    if (!Number.isFinite(suave) || !Number.isFinite(assertivo) || suave < 0 || suave > 100 || assertivo < 0 || assertivo > 100) {
      toast(tr('Os limiares do score devem ser números entre 0 e 100.', 'Score thresholds must be numbers between 0 and 100.'), { tone: 'error' });
      return;
    }
    if (assertivo >= suave) {
      toast(tr('O limiar assertivo deve ser inferior ao limiar suave.', 'The assertive threshold must be lower than the gentle one.'), { tone: 'error' });
      return;
    }
    setAGravarCobranca(true);
    try {
      await atualizarDefinicoes({
        iban: form.iban.trim(),
        alocacao: form.alocacao,
        prazoPagamentoHonorarios: prazo,
        scoreLimiares: { sugerirSuave: suave, sugerirAssertivo: assertivo },
      });
      toast(tr('Definições de cobrança guardadas.', 'Collection settings saved.'), { tone: 'ok' });
    } catch (err) {
      toast(
        tr('Falha ao guardar as definições.', 'Failed to save the settings.')
          + (err && err.message ? ` (${err.message})` : ''),
        { tone: 'error' },
      );
    } finally {
      setAGravarCobranca(false);
    }
  };

  /* ---------------------------- exportações ----------------------------- */
  const [aExportar, setAExportar] = useState(null); // 'dividas' | 'tempo' | null

  const exportarDividasAbertas = async () => {
    setAExportar('dividas');
    try {
      const [dividas, pagamentos, clientes] = await Promise.all([
        listar('dividas'),
        listar('pagamentos'),
        listarPartilhada('clientes'),
      ]);
      const abertas = dividas.filter((d) => d.estado !== 'paga' && d.estado !== 'incobravel');
      if (!abertas.length) {
        toast(tr('Não existem dívidas em aberto para exportar.', 'There are no open debts to export.'), { tone: 'info' });
        return;
      }
      const porCliente = indexarClientes(clientes);
      const pagoPorDivida = new Map();
      for (const p of pagamentos) {
        pagoPorDivida.set(p.dividaId, (pagoPorDivida.get(p.dividaId) || 0) + (Number(p.valor) || 0));
      }
      const linhas = abertas.map((d) => [
        porCliente.get(d.clienteId)?.nome || tr('Cliente desconhecido', 'Unknown customer'),
        d.descricao || d.numeroFatura || '',
        eur(d.valor),
        eur(round2((Number(d.valor) || 0) - (pagoPorDivida.get(d.id) || 0))),
        formatData(d.dataVencimento),
        rotuloEstado(d.estado),
      ]);
      descarregarCsv(
        `dividas-em-aberto-${hojeISO()}.csv`,
        [
          tr('Cliente', 'Customer'),
          tr('Descrição', 'Description'),
          tr('Valor', 'Amount'),
          tr('Saldo', 'Balance'),
          tr('Vencimento', 'Due date'),
          tr('Estado', 'Status'),
        ],
        linhas,
      );
      toast(tr('Exportação concluída.', 'Export complete.'), { tone: 'ok' });
    } catch (err) {
      toast(
        tr('Falha na exportação.', 'Export failed.') + (err && err.message ? ` (${err.message})` : ''),
        { tone: 'error' },
      );
    } finally {
      setAExportar(null);
    }
  };

  const exportarLinhaTempo = async () => {
    setAExportar('tempo');
    try {
      const [eventos, clientes, dividas] = await Promise.all([
        listar('linha_tempo'),
        listarPartilhada('clientes'),
        listar('dividas'),
      ]);
      if (!eventos.length) {
        toast(tr('A linha do tempo ainda não tem registos.', 'The timeline has no entries yet.'), { tone: 'info' });
        return;
      }
      const porCliente = indexarClientes(clientes);
      const porDivida = new Map(dividas.map((d) => [d.id, d]));
      const ordenados = [...eventos].sort((a, b) => String(a.data || '').localeCompare(String(b.data || '')));
      const linhas = ordenados.map((ev) => {
        const divida = ev.dividaId ? porDivida.get(ev.dividaId) : null;
        return [
          formatDataHora(ev.data),
          porCliente.get(ev.clienteId)?.nome || '',
          divida ? (divida.descricao || divida.numeroFatura || ev.dividaId) : '',
          ev.tipo || '',
          ev.titulo || '',
          ev.detalhe || '',
        ];
      });
      descarregarCsv(
        `linha-do-tempo-${hojeISO()}.csv`,
        [
          tr('Data', 'Date'),
          tr('Cliente', 'Customer'),
          tr('Dívida', 'Debt'),
          tr('Tipo', 'Type'),
          tr('Título', 'Title'),
          tr('Detalhe', 'Detail'),
        ],
        linhas,
      );
      toast(tr('Exportação concluída.', 'Export complete.'), { tone: 'ok' });
    } catch (err) {
      toast(
        tr('Falha na exportação.', 'Export failed.') + (err && err.message ? ` (${err.message})` : ''),
        { tone: 'error' },
      );
    } finally {
      setAExportar(null);
    }
  };

  /* ------------------------------ render -------------------------------- */
  const emailSelecionado = definicoes
    ? `${definicoes.emailIntegrationKey || ''}::${definicoes.emailActionName || ''}`
    : '::';

  if (!definicoes || !form) {
    return (
      <>
        <section className="cartao"><Skeleton lines={4} /></section>
        <section className="cartao"><Skeleton lines={5} /></section>
        <section className="cartao"><Skeleton lines={2} /></section>
      </>
    );
  }

  return (
    <>
      {!disponivel() ? (
        <section className="cartao cartao--aviso" data-testid="aviso-plataforma-indisponivel">
          <div className="linha-acoes">
            <IconAviso size={18} />
            <p style={{ margin: 0, fontSize: '0.875rem' }}>
              {tr(
                'Plataforma Ekoa indisponível nesta pré-visualização: as alterações não ficam guardadas.',
                'Ekoa platform unavailable in this preview: changes will not be saved.',
              )}
            </p>
          </div>
        </section>
      ) : null}

      {/* ------------------------------ EMAIL ------------------------------ */}
      <section className="cartao" data-demo-target="definicoes-email" data-testid="cartao-email">
        <h2 className="cartao__titulo">{tr('Integração de email', 'Email integration')}</h2>

        {integracoesLoading ? (
          <Skeleton lines={3} />
        ) : integracoesErro ? (
          <div>
            <p style={NOTA_STYLE}>{integracoesErro}</p>
            <div className="linha-acoes" style={{ marginTop: '0.75rem' }}>
              <Button variant="secondary" size="sm" onClick={carregarIntegracoes} data-testid="recarregar-integracoes">
                <IconSincronizar size={14} /> {tr('Tentar novamente', 'Try again')}
              </Button>
            </div>
          </div>
        ) : integracoes.length === 0 ? (
          <EmptyState
            icon={<IconEmail size={28} />}
            title={tr('Nenhuma integração com capacidade de email', 'No email-capable integration')}
            hint={tr(
              'O espaço de trabalho ainda não tem nenhuma integração capaz de enviar email. Ligue uma (por exemplo Gmail ou Microsoft 365) nas Integrações do Ekoa e volte a esta página.',
              'The workspace has no integration capable of sending email yet. Connect one (for example Gmail or Microsoft 365) in Ekoa Integrations and come back to this page.',
            )}
            action={(
              <a href="/integrations" target="_blank" rel="noreferrer" data-testid="ligacao-integracoes-ekoa">
                {tr('Abrir as Integrações do Ekoa', 'Open Ekoa Integrations')}
              </a>
            )}
          />
        ) : (
          <div role="radiogroup" aria-label={tr('Integração de envio de email', 'Email sending integration')} style={{ display: 'grid', gap: '0.5rem' }}>
            {integracoes.map((i) => {
              const chave = chaveIntegracao(i);
              const selecionada = chave === emailSelecionado;
              return (
                <label
                  key={chave}
                  data-testid={`email-integracao-${i.integrationKey}-${i.actionName}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.625rem 0.75rem',
                    border: '1px solid var(--color-border, #E2E8F0)',
                    borderRadius: 'var(--radius-lg, 0.75rem)',
                    cursor: i.connected ? 'pointer' : 'not-allowed',
                    opacity: i.connected ? 1 : 0.6,
                    background: selecionada ? 'var(--color-surface-muted, #F1F5F9)' : 'transparent',
                  }}
                >
                  <Input
                    type="radio"
                    name="integracao-email"
                    value={chave}
                    checked={selecionada}
                    disabled={(!i.connected && !i.needsReauth) || aGravarEmail}
                    onChange={() => selecionarIntegracao(i)}
                    style={{ width: 'auto', flex: 'none' }}
                  />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{i.displayName || i.integrationKey}</span>
                    <span style={NOTA_STYLE}>{i.provider} · {i.actionName}</span>
                  </span>
                  <BadgeEstadoIntegracao integracao={i} />
                </label>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: '1rem', display: 'grid', gap: '0.375rem' }}>
          <p style={NOTA_STYLE}>
            {tr(
              'Enquanto nenhuma integração estiver selecionada, os lembretes por email degradam para rascunhos que copia e envia manualmente - nada se perde.',
              'Until an integration is selected, email reminders degrade to drafts you copy and send manually - nothing is dropped.',
            )}
          </p>
          {/* Esta nota descrevia a plataforma ANTERIOR, onde nada se interpunha entre a app e a
              caixa de correio. Aqui interpõe-se: um envio é uma ESCRITA e passa pelo consentimento
              do titular da conta (o pedido responde `awaiting_consent` até haver aprovação em
              Integrações). Manter o texto original seria dizer ao utilizador que uma porta não
              existe e deixá-lo bater com ela na cara. */}
          <p style={NOTA_STYLE}>
            {tr(
              'Há duas aprovações, não uma: a sua, na Fila de trabalho desta app, antes de o email entrar na fila; e a do titular da conta, dada uma vez em Integrações, que autoriza esta app a enviar em nome da conta. Sem a segunda, o envio fica retido e a plataforma diz-lhe porquê.',
              'There are two approvals, not one: yours, in this app\'s work queue, before the email is queued; and the account owner\'s, given once in Integrações, authorising this app to send on the account\'s behalf. Without the second, the send is held and the platform tells you why.',
            )}
          </p>
        </div>
      </section>

      {/* ---------------------------- COBRANÇA ---------------------------- */}
      <section className="cartao" data-testid="cartao-cobranca">
        <h2 className="cartao__titulo">{tr('Cobrança', 'Collections')}</h2>
        <div className="form-grelha">
          <Field
            label={tr('IBAN para pagamentos', 'IBAN for payments')}
            hint={tr('Usado pelo marcador {{iban}} nos modelos de email e carta.', 'Used by the {{iban}} placeholder in email and letter templates.')}
          >
            <Input
              value={form.iban}
              onChange={setCampo('iban')}
              placeholder="PT50 0000 0000 0000 0000 0000 0"
              data-testid="input-iban"
            />
          </Field>
          <Field
            label={tr('Alocação de pagamentos', 'Payment allocation')}
            hint={tr(
              'Como distribuir um pagamento por várias prestações em aberto: primeiro as mais antigas (recomendado) ou primeiro as mais recentes.',
              'How to spread a payment across several open instalments: oldest first (recommended) or most recent first.',
            )}
          >
            <Select value={form.alocacao} onChange={setCampo('alocacao')} data-testid="select-alocacao">
              <option value="antiga-primeiro">{tr('Mais antiga primeiro', 'Oldest first')}</option>
              <option value="recente-primeiro">{tr('Mais recente primeiro', 'Most recent first')}</option>
            </Select>
          </Field>
          <Field
            label={tr('Prazo de pagamento (Honorários)', 'Payment term (Fees)')}
            hint={tr(
              'Dias após a emissão para o vencimento das dívidas importadas do Honorários.',
              'Days after issue for the due date of debts imported from the Fees app.',
            )}
          >
            <Input
              type="number"
              min="1"
              step="1"
              value={form.prazo}
              onChange={setCampo('prazo')}
              data-testid="input-prazo-honorarios"
            />
          </Field>
          <Field
            label={tr('Score: sugerir tom suave a partir de', 'Score: suggest gentle tone from')}
            hint={tr('Clientes com score igual ou superior recebem sugestão de perfil suave.', 'Customers at or above this score get a gentle-profile suggestion.')}
          >
            <Input
              type="number"
              min="0"
              max="100"
              step="1"
              value={form.sugerirSuave}
              onChange={setCampo('sugerirSuave')}
              data-testid="input-limiar-suave"
            />
          </Field>
          <Field
            label={tr('Score: sugerir tom assertivo abaixo de', 'Score: suggest assertive tone below')}
            hint={tr('Clientes com score inferior recebem sugestão de perfil assertivo.', 'Customers below this score get an assertive-profile suggestion.')}
          >
            <Input
              type="number"
              min="0"
              max="100"
              step="1"
              value={form.sugerirAssertivo}
              onChange={setCampo('sugerirAssertivo')}
              data-testid="input-limiar-assertivo"
            />
          </Field>
        </div>
        <div className="linha-acoes" style={{ marginTop: '1rem' }}>
          <span className="espacador" />
          <Button
            onClick={guardarCobranca}
            disabled={aGravarCobranca}
            data-testid="guardar-cobranca"
            data-demo-target="definicoes-guardar"
          >
            {aGravarCobranca ? tr('A guardar…', 'Saving…') : tr('Guardar', 'Save')}
          </Button>
        </div>
      </section>

      {/* ----------------------------- IDIOMA ----------------------------- */}
      <section className="cartao" data-testid="cartao-idioma">
        <h2 className="cartao__titulo">{tr('Idioma', 'Language')}</h2>
        <div className="form-grelha">
          <Field
            label={tr('Idioma do ecrã', 'Screen language')}
            hint={tr('A escolha fica guardada no servidor e sobrevive a recarregamentos.', 'The choice is stored server-side and survives reloads.')}
          >
            <Select
              value={definicoes.idioma === 'en' ? 'en' : 'pt'}
              onChange={(e) => setLang(e.target.value)}
              data-testid="select-idioma"
            >
              {LANGS.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        <p style={{ ...NOTA_STYLE, marginTop: '0.5rem' }}>
          {tr(
            'O idioma de comunicação com cada cliente é independente e define-se na ficha do cliente.',
            'The communication language for each customer is independent and set on the customer record.',
          )}
        </p>
      </section>

      {/* --------------------------- EXPORTAÇÕES --------------------------- */}
      <section className="cartao" data-testid="cartao-exportacoes" data-demo-target="definicoes-exportacoes">
        <h2 className="cartao__titulo">{tr('Exportações', 'Exports')}</h2>
        <p style={{ ...NOTA_STYLE, marginBottom: '0.75rem' }}>
          {tr(
            'Ficheiros CSV (separador ponto e vírgula) gerados no momento, com os dados reais da app.',
            'CSV files (semicolon separator) generated on the spot from the app\'s real data.',
          )}
        </p>
        <div className="linha-acoes">
          <Button
            variant="secondary"
            onClick={exportarDividasAbertas}
            disabled={aExportar !== null}
            data-testid="exportar-dividas-csv"
          >
            <IconDescarregar size={16} />
            {aExportar === 'dividas' ? tr('A exportar…', 'Exporting…') : tr('CSV de dívidas em aberto', 'Open debts CSV')}
          </Button>
          <Button
            variant="secondary"
            onClick={exportarLinhaTempo}
            disabled={aExportar !== null}
            data-testid="exportar-linha-tempo-csv"
          >
            <IconDescarregar size={16} />
            {aExportar === 'tempo' ? tr('A exportar…', 'Exporting…') : tr('CSV da linha do tempo completa', 'Full timeline CSV')}
          </Button>
        </div>
      </section>

      {/* ------------------------------ SOBRE ------------------------------ */}
      <section className="cartao" data-testid="cartao-sobre">
        <h2 className="cartao__titulo">{tr('Sobre esta app', 'About this app')}</h2>
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          <p style={NOTA_STYLE}>
            {tr(
              'A Cobranças acompanha a recuperação de créditos do escritório: dívidas e planos de prestações, lembretes escalonados por perfil de cliente, reconciliação do extrato bancário, juros de mora e uma linha do tempo imutável por cliente, pronta para servir de prova.',
              'Cobranças tracks the firm\'s credit recovery: debts and instalment plans, reminders escalated per customer profile, bank statement reconciliation, late-payment interest and an immutable per-customer timeline, ready to serve as evidence.',
            )}
          </p>
          <p style={NOTA_STYLE}>
            {tr(
              'Nota honesta sobre agendamento: não existe qualquer processo em segundo plano. Os lembretes devidos são calculados quando abre a aplicação ou quando carrega no botão de processamento na Fila de trabalho - nada é enviado sem a app aberta.',
              'Honest note on scheduling: there is no background process. Due reminders are computed when you open the app or press the processing button in the work queue - nothing is sent without the app open.',
            )}
          </p>
        </div>
      </section>
    </>
  );
}
