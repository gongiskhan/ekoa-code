/*
 * FILA DE TRABALHO - o coração da execução da cobrança.
 *
 * A plataforma não tem agendador em segundo plano: o cálculo dos lembretes
 * devidos corre ao abrir a app (quando a fila está vazia ou por intenção
 * pendente do assistente) e no botão "Processar lembretes". O motor puro
 * (engine/escalonamento.mjs) decide O QUE está devido; esta página materializa
 * essas decisões em rascunhos de email, tarefas e registos imutáveis na linha
 * do tempo - nada dispara sem ficar auditável.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { tr, useLang } from '../i18n.js';
import { useColecao, useClientes, useDefinicoes } from '../hooks.js';
import {
  criar, atualizar, registarEvento, enviarEmail, disponivel,
  criarRascunhoEmail, enviarRascunhoEmail, obterInboxWorkspace, listarIntegracoesEmail,
} from '../ekoa.js';
import {
  Button, Badge, DataTable, Field, Input, Select, Textarea, Modal, ConfirmDialog,
  toast, EmptyState, Skeleton, Tabs,
} from '../components/ui.jsx';
import {
  formatData, formatDataHora, resolverPerfil, indexarOverlay, indexarClientes,
} from '../components/dominio.jsx';
import {
  IconSincronizar, IconEmail, IconTelefone, IconCarta, IconCerto, IconOlho,
  IconImprimir, IconFila, IconRelogio, IconAviso,
} from '../components/Icons.jsx';
import { hojeISO } from '../engine/datas.mjs';
import {
  chavePasso, calcularAcoesDevidas, coalescerAcoes, renderTemplate, variaveisTemplate,
} from '../engine/escalonamento.mjs';
import { itensEmAberto } from '../engine/prestacoes.mjs';

const RESULTADOS = [
  { id: 'atendido', pt: 'Atendido', en: 'Answered' },
  { id: 'voicemail', pt: 'Caixa de voz', en: 'Voicemail' },
  { id: 'promessa', pt: 'Promessa de pagamento', en: 'Promise to pay' },
  { id: 'disputa', pt: 'Disputa', en: 'Dispute' },
  { id: 'sem-resposta', pt: 'Sem resposta', en: 'No answer' },
];

function rotuloResultado(id) {
  const r = RESULTADOS.find((x) => x.id === id);
  return r ? tr(r.pt, r.en) : id || '';
}

function rotuloTipoAcao(tipo) {
  if (tipo === 'email') return tr('Email', 'Email');
  if (tipo === 'telefone') return tr('Telefone', 'Phone');
  if (tipo === 'carta') return tr('Carta', 'Letter');
  return tipo || tr('Ação', 'Action');
}

function iconeTipoAcao(tipo) {
  if (tipo === 'email') return <IconEmail size={16} />;
  if (tipo === 'telefone') return <IconTelefone size={16} />;
  if (tipo === 'carta') return <IconCarta size={16} />;
  return <IconFila size={16} />;
}

/** Template do perfil por grupo + idioma do cliente, com recuo para PT. */
function encontrarTemplate(perfil, grupo, idioma, tipo) {
  const candidatos = (perfil && perfil.templates ? perfil.templates : [])
    .filter((t) => t && t.grupo === grupo && (!tipo || !t.tipo || t.tipo === tipo));
  return candidatos.find((t) => t.idioma === idioma)
    || candidatos.find((t) => t.idioma === 'pt')
    || candidatos[0]
    || null;
}

function msg(err) {
  return err instanceof Error ? err.message : String(err);
}

export default function FilaPage() {
  const lang = useLang();
  const { definicoes } = useDefinicoes();
  const dividasCol = useColecao('dividas');
  const pagamentosCol = useColecao('pagamentos');
  const overlayCol = useColecao('clientes_cobranca');
  const perfisCol = useColecao('perfis');
  const filaCol = useColecao('fila_envios');
  const tarefasCol = useColecao('tarefas_cobranca');
  const linhaCol = useColecao('linha_tempo');
  const clientesCol = useClientes();

  const [tab, setTab] = useState('rascunhos');
  const [aProcessar, setAProcessar] = useState(false);
  const [resumo, setResumo] = useState(null);
  const [enviandoId, setEnviandoId] = useState(null);
  const [ver, setVer] = useState(null);
  const [editar, setEditar] = useState(null);
  const [concluir, setConcluir] = useState(null);
  const [ocupadoTarefa, setOcupadoTarefa] = useState(false);
  const [ignorar, setIgnorar] = useState(null);
  const [impressao, setImpressao] = useState(null);
  const autoRef = useRef(false);
  const processandoRef = useRef(false);

  const carregando = dividasCol.loading || pagamentosCol.loading || overlayCol.loading
    || perfisCol.loading || filaCol.loading || tarefasCol.loading || linhaCol.loading
    || clientesCol.loading || !definicoes;

  const clientesById = useMemo(() => indexarClientes(clientesCol.items), [clientesCol.items]);
  const overlayMap = useMemo(() => indexarOverlay(overlayCol.items), [overlayCol.items]);
  const temIntegracao = !!(definicoes && definicoes.emailIntegrationKey && definicoes.emailActionName);

  const nomeCliente = (clienteId) => {
    const c = clientesById.get(clienteId);
    return (c && c.nome) || tr('Cliente desconhecido', 'Unknown customer');
  };

  const descricaoItem = (it) => {
    const d = dividasCol.items.find((x) => x.id === it.dividaId);
    let s = (d && (d.descricao || d.numeroFatura)) || it.dividaId;
    if (it.prestacaoId) {
      s += ' - ' + tr('prestação', 'instalment') + ' ' + String(it.prestacaoId).replace(/^p/, '');
    }
    return s;
  };

  const rascunhos = useMemo(
    () => filaCol.items
      .filter((e) => e.estado === 'rascunho' || e.estado === 'erro')
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))),
    [filaCol.items],
  );

  const tarefasPendentes = useMemo(
    () => tarefasCol.items
      .filter((t) => t.estado === 'pendente')
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))),
    [tarefasCol.items],
  );

  const historico = useMemo(() => {
    const rows = [];
    for (const e of filaCol.items) {
      if (e.estado === 'enviado' || e.estado === 'ignorada') {
        rows.push({
          chave: 'e-' + e.id,
          data: e.enviadoEm || e.updatedAt || e.createdAt,
          tipoAcao: 'email',
          quem: e.destinatario || nomeCliente(e.clienteId),
          detalhe: e.assunto || '',
          estado: e.estado,
        });
      }
    }
    for (const t of tarefasCol.items) {
      if (t.estado === 'concluida' || t.estado === 'ignorada') {
        rows.push({
          chave: 't-' + t.id,
          data: t.updatedAt || t.createdAt,
          tipoAcao: t.tipoAcao || 'tarefa',
          quem: nomeCliente(t.clienteId),
          detalhe: (t.titulo || '') + (t.resultado ? ' - ' + rotuloResultado(t.resultado) : ''),
          estado: t.estado,
        });
      }
    }
    return rows.sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filaCol.items, tarefasCol.items, clientesById, lang]);

  /* -------------------------- rotina de ENVIO ---------------------------- */

  const enviarEnvioCore = async (envio, { silencioso = false } = {}) => {
    const integrationKey = definicoes && definicoes.emailIntegrationKey;
    const actionName = definicoes && definicoes.emailActionName;
    if (!integrationKey || !actionName) {
      if (!silencioso) {
        toast(tr('Sem integração de email - configure nas Definições.', 'No email integration - configure it in Settings.'), { tone: 'error' });
      }
      return false;
    }
    // Rascunho criado na caixa do fornecedor: envia-se O PRÓPRIO rascunho
    // (incluindo edições feitas no Outlook/Gmail); sem rascunho, envio direto.
    const r = envio.draftId && envio.draftIntegrationKey
      ? await enviarRascunhoEmail({ integrationKey: envio.draftIntegrationKey, draftId: envio.draftId })
      : await enviarEmail({
        integrationKey,
        actionName,
        to: [envio.destinatario],
        subject: envio.assunto || '',
        body: envio.corpo || '',
      });
    if (r.success) {
      await atualizar('fila_envios', envio.id, {
        estado: 'enviado', enviadoEm: new Date().toISOString(), integrationKey, actionName, erro: null,
      });
      for (const it of envio.itens || []) {
        await registarEvento({
          clienteId: envio.clienteId,
          dividaId: it.dividaId,
          prestacaoId: it.prestacaoId || null,
          tipo: 'email-enviado',
          titulo: tr('Email enviado', 'Email sent'),
          detalhe: envio.assunto || '',
          conteudo: envio.corpo || '',
        });
      }
      if (!silencioso) toast(tr('Email enviado.', 'Email sent.'), { tone: 'ok' });
      return true;
    }
    const erroTxt = r.error || tr('Falha desconhecida no envio.', 'Unknown send failure.');
    await atualizar('fila_envios', envio.id, { estado: 'erro', erro: erroTxt });
    for (const it of envio.itens || []) {
      await registarEvento({
        clienteId: envio.clienteId,
        dividaId: it.dividaId,
        prestacaoId: it.prestacaoId || null,
        tipo: 'erro-envio',
        titulo: tr('Falha no envio', 'Send failure'),
        detalhe: erroTxt,
      });
    }
    if (!silencioso) toast(tr('Falha no envio: ', 'Send failure: ') + erroTxt, { tone: 'error' });
    return false;
  };

  const aprovarEnvio = async (envio) => {
    if (enviandoId) return;
    setEnviandoId(envio.id);
    try {
      await enviarEnvioCore(envio);
    } catch (err) {
      toast(tr('Falha no envio: ', 'Send failure: ') + msg(err), { tone: 'error' });
    } finally {
      setEnviandoId(null);
    }
    await Promise.all([filaCol.refresh(), linhaCol.refresh()]);
  };

  const copiarEnvio = async (envio) => {
    try {
      await navigator.clipboard.writeText((envio.assunto || '') + '\n\n' + (envio.corpo || ''));
      toast(tr('Assunto e corpo copiados para a área de transferência.', 'Subject and body copied to the clipboard.'), { tone: 'ok' });
    } catch {
      toast(tr('Não foi possível copiar para a área de transferência.', 'Could not copy to the clipboard.'), { tone: 'error' });
    }
  };

  const marcarEnviadoManual = async (envio) => {
    try {
      await atualizar('fila_envios', envio.id, { estado: 'enviado', enviadoEm: new Date().toISOString() });
      for (const it of envio.itens || []) {
        await registarEvento({
          clienteId: envio.clienteId,
          dividaId: it.dividaId,
          prestacaoId: it.prestacaoId || null,
          tipo: 'email-enviado',
          titulo: tr('Email enviado', 'Email sent'),
          detalhe: tr('Envio manual, fora da plataforma.', 'Manual send, outside the platform.'),
          conteudo: envio.corpo || '',
        });
      }
      toast(tr('Marcado como enviado.', 'Marked as sent.'), { tone: 'ok' });
      await Promise.all([filaCol.refresh(), linhaCol.refresh()]);
    } catch (err) {
      toast(tr('Falha ao marcar como enviado: ', 'Failed to mark as sent: ') + msg(err), { tone: 'error' });
    }
  };

  /* ---------------------- PROCESSAR lembretes devidos --------------------- */

  const processar = async ({ automatico = false } = {}) => {
    // Guarda SÍNCRONA de reentrância: o estado React é assíncrono, pelo que a
    // execução automática ao montar e um clique quase simultâneo no botão
    // passariam ambos pelo check de estado e duplicariam passos (chaves de
    // lembrete lidas antes de qualquer escrita). O ref fecha essa corrida.
    if (processandoRef.current) return;
    processandoRef.current = true;
    try {
      await processarCore({ automatico });
    } finally {
      processandoRef.current = false;
    }
  };

  const processarCore = async ({ automatico = false } = {}) => {
    if (!disponivel()) {
      if (!automatico) toast(tr('Plataforma indisponível nesta pré-visualização.', 'Platform unavailable in this preview.'), { tone: 'error' });
      return;
    }
    if (perfisCol.items.length === 0) {
      if (!automatico) toast(tr('Crie primeiro um perfil de cobrança para calcular lembretes.', 'Create a collection profile first to compute reminders.'), { tone: 'error' });
      return;
    }
    setAProcessar(true);
    try {
      const hoje = hojeISO();
      const perfilDoCliente = (cid) => resolverPerfil(overlayMap, perfisCol.items, cid);
      const flagsDoCliente = (cid) => overlayMap.get(cid) || null;
      const itens = itensEmAberto(dividasCol.items, pagamentosCol.items, clientesById);

      const executados = new Set();
      for (const e of filaCol.items) {
        for (const c of e.lembreteChaves || []) executados.add(c);
      }
      for (const t of tarefasCol.items) {
        if (t.lembreteChave) executados.add(t.lembreteChave);
      }
      for (const ev of linhaCol.items) {
        if (ev.tipo === 'ignorado') {
          for (const c of (ev.meta && ev.meta.chaves) || []) executados.add(c);
        }
      }

      const limite7d = Date.now() - 7 * 86400000;
      const emailsRecentesPorCliente = new Map();
      for (const e of filaCol.items) {
        if (e.estado === 'enviado' && e.enviadoEm && new Date(e.enviadoEm).getTime() >= limite7d) {
          emailsRecentesPorCliente.set(e.clienteId, (emailsRecentesPorCliente.get(e.clienteId) || 0) + 1);
        }
      }

      const acoes = calcularAcoesDevidas({
        hoje, itens, perfilDoCliente, flagsDoCliente, executados, emailsRecentesPorCliente,
      });
      const bloqueados = acoes.filter((a) => a.bloqueadoPorTeto).length;

      // 1) Promessas quebradas PRIMEIRO: limpa a promessa e regista o evento
      //    que alimenta o score de comportamento (tipo 'promessa-quebrada').
      const quebras = acoes.filter((a) => a.quebraPromessa);
      const patchPorDivida = new Map();
      for (const a of quebras) {
        const d = dividasCol.items.find((x) => x.id === a.item.dividaId);
        if (!d) continue;
        const atual = patchPorDivida.get(d.id) || {};
        if (a.item.prestacaoId) {
          const base = atual.prestacoes || d.prestacoes || [];
          atual.prestacoes = base.map((p) => (
            p.id === a.item.prestacaoId ? { ...p, promessaData: null, estado: 'aberta' } : p
          ));
        } else {
          atual.promessaData = null;
          atual.estado = 'aberta';
        }
        patchPorDivida.set(d.id, atual);
      }
      for (const [dividaId, patch] of patchPorDivida) {
        await atualizar('dividas', dividaId, patch);
      }
      for (const a of quebras) {
        await registarEvento({
          clienteId: a.item.clienteId,
          dividaId: a.item.dividaId,
          prestacaoId: a.item.prestacaoId || null,
          tipo: 'promessa-quebrada',
          titulo: tr('Promessa de pagamento não cumprida', 'Promise to pay broken'),
          detalhe: a.item.promessaData ? tr('Prometido até ', 'Promised by ') + formatData(a.item.promessaData) : '',
        });
        a.item.promessaData = null;
        a.item.estado = 'aberta';
      }

      // 2) Coalescência: emails (com digest por cliente) + tarefas.
      const { emails, tarefas: tarefasAcoes } = coalescerAcoes(acoes, perfilDoCliente);

      let nRascunhos = 0;
      let nTarefas = 0;
      let nEnviados = 0;
      const rascunhosCriados = [];
      const iban = (definicoes && definicoes.iban) || '';

      for (const grupo of emails) {
        const cliente = clientesById.get(grupo.clienteId) || null;
        const perfil = perfilDoCliente(grupo.clienteId);
        const ov = overlayMap.get(grupo.clienteId);
        const idiomaCliente = (ov && ov.idioma) || 'pt';
        const principal = grupo.acoes.reduce(
          (m, a) => (Number(a.lembrete.offsetDias || 0) > Number(m.lembrete.offsetDias || 0) ? a : m),
          grupo.acoes[0],
        );
        const template = encontrarTemplate(perfil, principal.lembrete.templateGrupo, idiomaCliente, 'email');
        const langTpl = (template && template.idioma) || idiomaCliente;
        const vars = variaveisTemplate({
          cliente, itens: grupo.acoes.map((a) => a.item), hoje, lang: langTpl, iban,
        });
        const assunto = template ? renderTemplate(template.assunto, vars) : '';
        // Digest (vários itens): um template pensado para um só item não lista
        // tudo — acrescenta-se o bloco de valores em aberto para que a
        // comunicação única cubra TODOS os itens (nunca um email por dívida).
        let corpoTpl = template ? template.corpo : '';
        if (grupo.digest && corpoTpl && !corpoTpl.includes('{{listaDividas}}')) {
          corpoTpl += `\n\n${langTpl === 'en' ? 'Outstanding items:' : 'Valores em aberto:'}\n{{listaDividas}}\n${langTpl === 'en' ? 'Total outstanding:' : 'Total em dívida:'} {{saldoTotal}}`;
        }
        const corpo = template ? renderTemplate(corpoTpl, vars) : '';
        const nome = (cliente && cliente.nome) || tr('cliente', 'customer');

        // Nada cai silenciosamente: sem email ou sem template vira TAREFA.
        const criarTarefaEmail = async (titulo, conteudo) => {
          for (const a of grupo.acoes) {
            await criar('tarefas_cobranca', {
              dividaId: a.item.dividaId,
              prestacaoId: a.item.prestacaoId || null,
              clienteId: grupo.clienteId,
              tipoAcao: 'email',
              titulo,
              conteudo,
              estado: 'pendente',
              lembreteChave: chavePasso(a.item, a.lembrete.id),
            });
            await registarEvento({
              clienteId: grupo.clienteId,
              dividaId: a.item.dividaId,
              prestacaoId: a.item.prestacaoId || null,
              tipo: 'tarefa-criada',
              titulo: tr('Tarefa criada', 'Task created'),
              detalhe: titulo,
            });
            nTarefas += 1;
          }
        };

        if (!cliente || !cliente.email) {
          await criarTarefaEmail(
            tr('Contactar ', 'Contact ') + nome + tr(' - sem endereço de email', ' - no email address'),
            tr('O cliente não tem endereço de email registado. Contacte por outra via ou complete a ficha do cliente.', 'The customer has no email address on file. Reach out by another channel or complete the customer record.')
            + (corpo ? '\n\n' + tr('Conteúdo preparado:', 'Prepared content:') + '\n' + corpo : ''),
          );
          continue;
        }
        if (!template) {
          await criarTarefaEmail(
            tr('Enviar email a ', 'Email ') + nome,
            tr('Sem template de email para o grupo "', 'No email template for group "')
            + String(principal.lembrete.templateGrupo || '')
            + tr('" no perfil. Configure-o no perfil de cobrança e volte a processar.', '" in the profile. Configure it in the collection profile and process again.'),
          );
          continue;
        }

        const modo = (perfil && perfil.acoesAuto && perfil.acoesAuto.email) || 'rascunho';
        if (modo === 'tarefa') {
          await criarTarefaEmail(
            tr('Enviar email a ', 'Email ') + nome,
            tr('Para: ', 'To: ') + cliente.email + '\n' + tr('Assunto: ', 'Subject: ') + assunto + '\n\n' + corpo,
          );
          continue;
        }

        const registo = await criar('fila_envios', {
          clienteId: grupo.clienteId,
          destinatario: cliente.email,
          assunto,
          corpo,
          estado: 'rascunho',
          itens: grupo.acoes.map((a) => ({ dividaId: a.item.dividaId, prestacaoId: a.item.prestacaoId || null })),
          lembreteChaves: grupo.acoes.map((a) => chavePasso(a.item, a.lembrete.id)),
        });
        nRascunhos += 1;
        for (const a of grupo.acoes) {
          await registarEvento({
            clienteId: grupo.clienteId,
            dividaId: a.item.dividaId,
            prestacaoId: a.item.prestacaoId || null,
            tipo: 'email-rascunho',
            titulo: tr('Email em rascunho', 'Email drafted'),
            detalhe: assunto,
          });
        }
        // Envio imediato APENAS por opt-in explícito do perfil.
        if (modo === 'auto' && temIntegracao) {
          const ok = await enviarEnvioCore(registo, { silencioso: true });
          if (ok) {
            nEnviados += 1;
            nRascunhos -= 1;
          } else {
            rascunhosCriados.push(registo);
          }
        } else {
          rascunhosCriados.push(registo);
        }
      }

      for (const a of tarefasAcoes) {
        const cliente = clientesById.get(a.item.clienteId) || null;
        const perfil = perfilDoCliente(a.item.clienteId);
        const ov = overlayMap.get(a.item.clienteId);
        const idiomaCliente = (ov && ov.idioma) || 'pt';
        const tipoAcao = a.lembrete.tipoAcao || 'telefone';
        const template = encontrarTemplate(perfil, a.lembrete.templateGrupo, idiomaCliente, tipoAcao);
        const langTpl = (template && template.idioma) || idiomaCliente;
        const vars = variaveisTemplate({ cliente, itens: [a.item], hoje, lang: langTpl, iban });
        const conteudo = template
          ? renderTemplate(template.corpo, vars)
          : tr('Sem guião definido para este passo no perfil.', 'No script defined for this step in the profile.');
        const nome = (cliente && cliente.nome) || a.item.clienteNome || tr('cliente', 'customer');
        const titulo = tipoAcao === 'telefone'
          ? tr('Chamada a ', 'Call ') + nome
          : tipoAcao === 'carta'
            ? tr('Carta a ', 'Letter to ') + nome
            : tr('Ação para ', 'Action for ') + nome;
        await criar('tarefas_cobranca', {
          dividaId: a.item.dividaId,
          prestacaoId: a.item.prestacaoId || null,
          clienteId: a.item.clienteId,
          tipoAcao,
          titulo,
          conteudo,
          estado: 'pendente',
          lembreteChave: chavePasso(a.item, a.lembrete.id),
        });
        await registarEvento({
          clienteId: a.item.clienteId,
          dividaId: a.item.dividaId,
          prestacaoId: a.item.prestacaoId || null,
          tipo: 'tarefa-criada',
          titulo: tr('Tarefa criada', 'Task created'),
          detalhe: titulo,
        });
        nTarefas += 1;
      }

      /* --- Rascunhos na caixa de correio + aviso ao utilizador ------------
       * Com integração selecionada: (1) cada email fica também como RASCUNHO
       * na caixa do fornecedor (destinatário já preenchido) com ligação
       * direta quando o fornecedor a devolve; (2) envia-se UM email de aviso
       * à própria caixa do espaço de trabalho a lembrar que há lembretes por
       * aprovar/enviar. Falhas ficam visíveis (toast + campo draftErro),
       * nunca silenciosas — e os rascunhos na app continuam utilizáveis. */
      if (temIntegracao && (rascunhosCriados.length > 0 || nTarefas > 0)) {
        const integrationKey = definicoes.emailIntegrationKey;
        let suportaRascunhos = false;
        try {
          const li = await listarIntegracoesEmail();
          const sel = li.ok ? li.integracoes.find((i) => i.integrationKey === integrationKey) : null;
          suportaRascunhos = !!(sel && sel.supportsDrafts);
        } catch { suportaRascunhos = false; }

        let nDraftsOk = 0;
        let nDraftsErro = 0;
        if (suportaRascunhos) {
          for (const registo of rascunhosCriados) {
            const d = await criarRascunhoEmail({
              integrationKey,
              to: [registo.destinatario],
              subject: registo.assunto || '',
              body: registo.corpo || '',
            });
            if (d.success) {
              await atualizar('fila_envios', registo.id, {
                draftId: d.draftId, draftWebLink: d.webLink || null, draftIntegrationKey: integrationKey, draftErro: null,
              });
              nDraftsOk += 1;
            } else {
              await atualizar('fila_envios', registo.id, { draftErro: d.error || tr('Falha ao criar o rascunho.', 'Failed to create the draft.') });
              nDraftsErro += 1;
            }
          }
          if (nDraftsOk > 0) {
            toast(nDraftsOk + ' ' + tr('rascunho(s) criados na sua caixa de correio.', 'draft(s) created in your mailbox.'), { tone: 'ok' });
          }
          if (nDraftsErro > 0) {
            toast(nDraftsErro + ' ' + tr('rascunho(s) não puderam ser criados na caixa de correio — continuam disponíveis aqui.', 'draft(s) could not be created in the mailbox — they remain available here.'), { tone: 'error' });
          }
        }

        // Aviso à própria caixa do espaço de trabalho.
        try {
          const inbox = await obterInboxWorkspace(integrationKey);
          if (inbox.success && inbox.address) {
            const filaAtual = rascunhosCriados;
            const linhas = filaAtual.map((rg) => '- ' + (rg.destinatario || '') + ' — ' + (rg.assunto || ''));
            const corpoAviso = [
              tr('Tem lembretes de cobrança à espera de si:', 'You have collection reminders waiting for you:'),
              '',
              filaAtual.length + ' ' + tr('email(s) por aprovar', 'email(s) awaiting approval') + (nTarefas ? ', ' + nTarefas + ' ' + tr('tarefa(s) pendentes', 'pending task(s)') : ''),
              ...linhas,
              '',
              nDraftsOk > 0
                ? tr('Os emails já estão como RASCUNHO na sua caixa de correio, com o destinatário preenchido — pode enviá-los daí ou aprová-los na aplicação Cobranças (ecrã Fila de trabalho).', 'The emails are already sitting as DRAFTS in your mailbox, recipients filled in — send them from there or approve them in the Cobranças app (Work queue screen).')
                : tr('Aprove-os na aplicação Cobranças (ecrã Fila de trabalho).', 'Approve them in the Cobranças app (Work queue screen).'),
            ].join('\n');
            const aviso = await enviarEmail({
              integrationKey,
              actionName: definicoes.emailActionName,
              to: [inbox.address],
              subject: tr('Cobranças: ', 'Collections: ') + filaAtual.length + tr(' lembrete(s) aguardam aprovação', ' reminder(s) awaiting approval'),
              body: corpoAviso,
            });
            if (aviso.success) {
              toast(tr('Aviso enviado para ', 'Notice sent to ') + inbox.address, { tone: 'ok' });
            } else {
              toast(tr('Não foi possível enviar o aviso para a sua caixa: ', 'Could not send the notice to your mailbox: ') + (aviso.error || ''), { tone: 'error' });
            }
          }
        } catch (err) {
          toast(tr('Não foi possível avisar a sua caixa de correio: ', 'Could not notify your mailbox: ') + msg(err), { tone: 'error' });
        }
      }

      setResumo({ rascunhos: nRascunhos, tarefas: nTarefas, enviados: nEnviados, bloqueados });
      const algo = nRascunhos + nTarefas + nEnviados > 0;
      if (algo || !automatico) {
        if (!algo && bloqueados === 0) {
          toast(tr('Sem lembretes devidos hoje.', 'No reminders due today.'), { tone: 'info' });
        } else {
          toast(
            nRascunhos + ' ' + tr('rascunhos', 'drafts') + ', '
            + nTarefas + ' ' + tr('tarefas', 'tasks')
            + (nEnviados ? ', ' + nEnviados + ' ' + tr('enviados automaticamente', 'sent automatically') : '')
            + ', ' + bloqueados + ' ' + tr('bloqueados por teto', 'blocked by cap'),
            { tone: 'ok' },
          );
        }
      }
      await Promise.all([filaCol.refresh(), tarefasCol.refresh(), linhaCol.refresh(), dividasCol.refresh()]);
    } catch (err) {
      toast(tr('Falha ao processar lembretes: ', 'Failed to process reminders: ') + msg(err), { tone: 'error' });
    } finally {
      setAProcessar(false);
    }
  };

  // Execução automática ao montar: intenção pendente do assistente OU fila
  // vazia (conveniência de primeira visita). Decide UMA vez por montagem.
  useEffect(() => {
    if (autoRef.current || carregando) return;
    autoRef.current = true;
    const pendente = typeof window !== 'undefined' && window.__cobrancasAcaoPendente === 'processar';
    if (pendente) window.__cobrancasAcaoPendente = null;
    if (pendente || (rascunhos.length === 0 && tarefasPendentes.length === 0)) {
      processar({ automatico: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregando]);

  /* ------------------------------- tarefas -------------------------------- */

  const confirmarConclusao = async () => {
    if (!concluir || ocupadoTarefa) return;
    const { tarefa, resultado, promessaData } = concluir;
    if (!resultado) {
      toast(tr('Escolha o resultado do contacto.', 'Choose the contact outcome.'), { tone: 'error' });
      return;
    }
    if (resultado === 'promessa' && !promessaData) {
      toast(tr('Indique a data prometida para o pagamento.', 'Provide the promised payment date.'), { tone: 'error' });
      return;
    }
    setOcupadoTarefa(true);
    try {
      const divida = dividasCol.items.find((x) => x.id === tarefa.dividaId) || null;
      if (resultado === 'promessa') {
        if (divida) {
          if (tarefa.prestacaoId) {
            await atualizar('dividas', divida.id, {
              prestacoes: (divida.prestacoes || []).map((p) => (
                p.id === tarefa.prestacaoId ? { ...p, promessaData, estado: 'promessa' } : p
              )),
            });
          } else {
            await atualizar('dividas', divida.id, { promessaData, estado: 'promessa' });
          }
        }
        await registarEvento({
          clienteId: tarefa.clienteId,
          dividaId: tarefa.dividaId,
          prestacaoId: tarefa.prestacaoId || null,
          tipo: 'promessa',
          titulo: tr('Promessa de pagamento registada', 'Promise to pay recorded'),
          detalhe: tr('Pagamento prometido até ', 'Payment promised by ') + formatData(promessaData),
        });
      }
      if (resultado === 'disputa') {
        if (divida) await atualizar('dividas', divida.id, { estado: 'disputada' });
        await registarEvento({
          clienteId: tarefa.clienteId,
          dividaId: tarefa.dividaId,
          prestacaoId: tarefa.prestacaoId || null,
          tipo: 'estado',
          titulo: tr('Dívida marcada como disputada', 'Debt marked as disputed'),
          detalhe: tr('Resultado do contacto: disputa.', 'Contact outcome: dispute.'),
        });
      }
      await atualizar('tarefas_cobranca', tarefa.id, {
        estado: 'concluida',
        resultado,
        ...(resultado === 'promessa' ? { promessaData } : {}),
      });
      await registarEvento({
        clienteId: tarefa.clienteId,
        dividaId: tarefa.dividaId,
        prestacaoId: tarefa.prestacaoId || null,
        tipo: 'tarefa-concluida',
        titulo: tr('Tarefa concluída', 'Task completed'),
        detalhe: rotuloResultado(resultado),
      });
      toast(tr('Tarefa concluída.', 'Task completed.'), { tone: 'ok' });
      setConcluir(null);
      await Promise.all([tarefasCol.refresh(), dividasCol.refresh(), linhaCol.refresh()]);
    } catch (err) {
      toast(tr('Falha ao concluir a tarefa: ', 'Failed to complete the task: ') + msg(err), { tone: 'error' });
    } finally {
      setOcupadoTarefa(false);
    }
  };

  const confirmarIgnorar = async () => {
    const alvo = ignorar;
    setIgnorar(null);
    if (!alvo) return;
    try {
      if (alvo.tipo === 'envio') {
        const e = alvo.alvo;
        await atualizar('fila_envios', e.id, { estado: 'ignorada' });
        await registarEvento({
          clienteId: e.clienteId,
          dividaId: (e.itens && e.itens[0] && e.itens[0].dividaId) || null,
          tipo: 'ignorado',
          titulo: tr('Lembrete ignorado', 'Reminder skipped'),
          detalhe: e.assunto || '',
          meta: { chaves: e.lembreteChaves || [] },
        });
        await Promise.all([filaCol.refresh(), linhaCol.refresh()]);
      } else {
        const t = alvo.alvo;
        await atualizar('tarefas_cobranca', t.id, { estado: 'ignorada' });
        await registarEvento({
          clienteId: t.clienteId,
          dividaId: t.dividaId || null,
          prestacaoId: t.prestacaoId || null,
          tipo: 'ignorado',
          titulo: tr('Tarefa ignorada', 'Task skipped'),
          detalhe: t.titulo || '',
          meta: { chaves: t.lembreteChave ? [t.lembreteChave] : [] },
        });
        await Promise.all([tarefasCol.refresh(), linhaCol.refresh()]);
      }
      toast(tr('Passo ignorado. Não volta a disparar para estes itens.', 'Step skipped. It will not fire again for these items.'), { tone: 'info' });
    } catch (err) {
      toast(tr('Falha ao ignorar: ', 'Failed to skip: ') + msg(err), { tone: 'error' });
    }
  };

  const guardarEdicao = async () => {
    if (!editar) return;
    try {
      await atualizar('fila_envios', editar.envio.id, { assunto: editar.assunto, corpo: editar.corpo });
      toast(tr('Rascunho atualizado.', 'Draft updated.'), { tone: 'ok' });
      setEditar(null);
      await filaCol.refresh();
    } catch (err) {
      toast(tr('Falha ao guardar o rascunho: ', 'Failed to save the draft: ') + msg(err), { tone: 'error' });
    }
  };

  /* ----------------------- impressão de cartas ---------------------------- */

  useEffect(() => {
    if (!impressao) return undefined;
    const limpar = () => setImpressao(null);
    window.addEventListener('afterprint', limpar);
    const h = setTimeout(() => window.print(), 120);
    return () => {
      window.removeEventListener('afterprint', limpar);
      clearTimeout(h);
    };
  }, [impressao]);

  /* -------------------------------- render -------------------------------- */

  if (carregando) {
    return (
      <div className="cartao">
        <Skeleton lines={5} />
      </div>
    );
  }

  const tabs = [
    { id: 'rascunhos', label: tr('Rascunhos', 'Drafts'), badge: rascunhos.length, demoTarget: 'fila-tab-rascunhos' },
    { id: 'tarefas', label: tr('Tarefas', 'Tasks'), badge: tarefasPendentes.length, demoTarget: 'fila-tab-tarefas' },
    { id: 'historico', label: tr('Histórico', 'History'), demoTarget: 'fila-tab-historico' },
  ];

  return (
    <>
      {impressao ? <div className="documento">{impressao.conteudo}</div> : null}
      <div className={impressao ? 'no-print' : ''} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {!disponivel() ? (
          <div className="cartao cartao--aviso">
            <div className="linha-acoes">
              <IconAviso size={16} />
              <span>{tr('Plataforma indisponível - esta pré-visualização não grava dados.', 'Platform unavailable - this preview does not save data.')}</span>
            </div>
          </div>
        ) : null}

        <div className="cartao">
          <div className="linha-acoes">
            <Button
              variant="primary"
              onClick={() => processar()}
              disabled={aProcessar}
              data-testid="btn-processar"
              data-demo-target="fila-processar"
            >
              <IconSincronizar size={16} />
              {aProcessar ? tr('A processar...', 'Processing...') : tr('Processar lembretes', 'Process reminders')}
            </Button>
            {resumo ? (
              <span className="campo__dica" data-demo-target="fila-resumo">
                {tr('Última execução: ', 'Last run: ')}
                {resumo.rascunhos} {tr('rascunhos', 'drafts')}, {resumo.tarefas} {tr('tarefas', 'tasks')}
                {resumo.enviados ? ', ' + resumo.enviados + ' ' + tr('enviados automaticamente', 'sent automatically') : ''}
              </span>
            ) : null}
            {resumo && resumo.bloqueados > 0 ? (
              <Badge tone="warn">
                {resumo.bloqueados} {tr('bloqueados por teto de emails', 'blocked by email cap')}
              </Badge>
            ) : null}
          </div>
          <p className="campo__dica" style={{ marginTop: 8 }}>
            {tr(
              'Calcula os lembretes devidos hoje segundo o perfil de cada cliente. A plataforma não tem agendador em segundo plano - o cálculo corre ao abrir a app e neste botão.',
              'Computes the reminders due today according to each customer profile. The platform has no background scheduler - computation runs when the app opens and on this button.',
            )}
          </p>
        </div>

        <Tabs tabs={tabs} active={tab} onChange={setTab} />

        {tab === 'rascunhos' ? (
          <div data-demo-target="fila-rascunhos" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rascunhos.length === 0 ? (
              <EmptyState
                icon={<IconEmail size={28} />}
                title={tr('Sem rascunhos pendentes', 'No pending drafts')}
                hint={tr('Os emails preparados pelo processamento de lembretes aparecem aqui para aprovação antes do envio.', 'Emails prepared by reminder processing appear here for approval before sending.')}
              />
            ) : rascunhos.map((e) => (
              <div key={e.id} className="cartao" data-testid={'rascunho-' + e.id}>
                <div className="linha-acoes">
                  <strong>{e.destinatario}</strong>
                  {(e.itens || []).length > 1 ? (
                    <Badge tone="accent">{(e.itens || []).length} {tr('itens', 'items')}</Badge>
                  ) : null}
                  {e.estado === 'erro' ? (
                    <Badge tone="danger">{tr('Erro: ', 'Error: ')}{e.erro || tr('falha no envio', 'send failure')}</Badge>
                  ) : (
                    <Badge tone="neutral">{tr('Rascunho', 'Draft')}</Badge>
                  )}
                  {e.draftId ? (
                    <Badge tone="accent" title={tr('Também está como rascunho na sua caixa de correio.', 'Also sitting as a draft in your mailbox.')}>
                      {tr('Na sua caixa de correio', 'In your mailbox')}
                    </Badge>
                  ) : null}
                  {e.draftErro ? (
                    <Badge tone="warn" title={e.draftErro}>{tr('Sem rascunho no email', 'No mailbox draft')}</Badge>
                  ) : null}
                  <span className="espacador" />
                  {e.draftWebLink ? (
                    <a
                      href={e.draftWebLink}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: 'var(--text-xs, 0.75rem)', color: 'var(--color-primary, #0F766E)', fontWeight: 600 }}
                      data-testid="link-abrir-rascunho"
                    >
                      {tr('Abrir rascunho no email', 'Open draft in mailbox')}
                    </a>
                  ) : null}
                  <span className="campo__dica">{formatDataHora(e.createdAt)}</span>
                </div>
                <p style={{ margin: '10px 0', fontWeight: 600 }}>{e.assunto || tr('(sem assunto)', '(no subject)')}</p>
                <div className="linha-acoes">
                  <Button variant="ghost" size="sm" onClick={() => setVer(e)} data-testid="btn-ver-rascunho">
                    <IconOlho size={14} /> {tr('Ver', 'View')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setEditar({ envio: e, assunto: e.assunto || '', corpo: e.corpo || '' })}
                    data-testid="btn-editar-rascunho"
                  >
                    {tr('Editar', 'Edit')}
                  </Button>
                  {temIntegracao ? (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => aprovarEnvio(e)}
                      disabled={!!enviandoId}
                      data-testid="btn-aprovar"
                      data-demo-target="fila-aprovar"
                    >
                      <IconEmail size={14} />
                      {enviandoId === e.id
                        ? tr('A enviar...', 'Sending...')
                        : e.estado === 'erro'
                          ? tr('Tentar novamente', 'Try again')
                          : tr('Aprovar e enviar', 'Approve and send')}
                    </Button>
                  ) : (
                    <>
                      <Badge tone="warn">
                        {tr('Sem integração de email - configure nas Definições', 'No email integration - configure in Settings')}
                      </Badge>
                      <Button variant="secondary" size="sm" onClick={() => copiarEnvio(e)} data-testid="btn-copiar-email">
                        {tr('Copiar', 'Copy')}
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => marcarEnviadoManual(e)} data-testid="btn-marcar-enviado">
                        {tr('Marcar como enviado manualmente', 'Mark as sent manually')}
                      </Button>
                    </>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setIgnorar({ tipo: 'envio', alvo: e })} data-testid="btn-ignorar-rascunho">
                    {tr('Ignorar', 'Skip')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {tab === 'tarefas' ? (
          <div data-demo-target="fila-tarefas" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {tarefasPendentes.length === 0 ? (
              <EmptyState
                icon={<IconFila size={28} />}
                title={tr('Sem tarefas pendentes', 'No pending tasks')}
                hint={tr('Chamadas, cartas e outras ações manuais devidas pelo plano de cada perfil aparecem aqui.', 'Calls, letters and other manual actions due under each profile plan appear here.')}
              />
            ) : tarefasPendentes.map((t) => (
              <div key={t.id} className="cartao" data-testid={'tarefa-' + t.id}>
                <div className="linha-acoes">
                  {iconeTipoAcao(t.tipoAcao)}
                  <strong>{t.titulo}</strong>
                  <Badge tone="info">{rotuloTipoAcao(t.tipoAcao)}</Badge>
                  <span className="espacador" />
                  <span className="campo__dica">{nomeCliente(t.clienteId)} · {formatDataHora(t.createdAt)}</span>
                </div>
                {t.conteudo ? (
                  <details style={{ marginTop: 10 }}>
                    <summary style={{ cursor: 'pointer' }} className="campo__dica">
                      {tr('Ver guião', 'View script')}
                    </summary>
                    <div className="documento" style={{ marginTop: 8 }}>{t.conteudo}</div>
                  </details>
                ) : null}
                <div className="linha-acoes" style={{ marginTop: 10 }}>
                  {t.tipoAcao === 'carta' && t.conteudo ? (
                    <Button variant="secondary" size="sm" onClick={() => setImpressao(t)} data-testid="btn-imprimir-carta">
                      <IconImprimir size={14} /> {tr('Imprimir', 'Print')}
                    </Button>
                  ) : null}
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setConcluir({ tarefa: t, resultado: 'atendido', promessaData: '' })}
                    data-testid="btn-concluir-tarefa"
                  >
                    <IconCerto size={14} /> {tr('Concluir', 'Complete')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setIgnorar({ tipo: 'tarefa', alvo: t })} data-testid="btn-ignorar-tarefa">
                    {tr('Ignorar', 'Skip')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {tab === 'historico' ? (
          <div className="cartao" data-demo-target="fila-historico">
            <DataTable
              columns={[
                { key: 'data', label: tr('Data', 'Date'), render: (r) => formatDataHora(r.data) },
                { key: 'tipoAcao', label: tr('Tipo', 'Type'), render: (r) => rotuloTipoAcao(r.tipoAcao) },
                { key: 'quem', label: tr('Cliente / destinatário', 'Customer / recipient') },
                { key: 'detalhe', label: tr('Detalhe', 'Detail') },
                {
                  key: 'estado',
                  label: tr('Estado', 'Status'),
                  render: (r) => (
                    r.estado === 'enviado' ? <Badge tone="ok">{tr('Enviado', 'Sent')}</Badge>
                      : r.estado === 'concluida' ? <Badge tone="ok">{tr('Concluída', 'Completed')}</Badge>
                        : <Badge tone="neutral">{tr('Ignorada', 'Skipped')}</Badge>
                  ),
                },
              ]}
              rows={historico}
              rowKey={(r) => r.chave}
              empty={(
                <EmptyState
                  icon={<IconRelogio size={28} />}
                  title={tr('Ainda sem histórico', 'No history yet')}
                  hint={tr('Envios e tarefas concluídas ou ignoradas ficam registados aqui.', 'Sent emails and completed or skipped tasks are recorded here.')}
                />
              )}
            />
          </div>
        ) : null}
      </div>

      <Modal
        open={!!ver}
        title={ver ? (ver.assunto || tr('Pré-visualização', 'Preview')) : ''}
        onClose={() => setVer(null)}
        wide
        actions={<Button variant="secondary" onClick={() => setVer(null)}>{tr('Fechar', 'Close')}</Button>}
      >
        {ver ? (
          <>
            <p className="campo__dica">{tr('Para: ', 'To: ')}{ver.destinatario}</p>
            <div className="documento" style={{ marginTop: 8 }}>{ver.corpo}</div>
            {(ver.itens || []).length > 0 ? (
              <div style={{ marginTop: 12 }}>
                <p className="campo__rotulo">{tr('Itens abrangidos', 'Covered items')}</p>
                <ul style={{ paddingLeft: 18, marginTop: 6 }}>
                  {(ver.itens || []).map((it, i) => (
                    <li key={i}>{descricaoItem(it)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : null}
      </Modal>

      <Modal
        open={!!editar}
        title={tr('Editar rascunho', 'Edit draft')}
        onClose={() => setEditar(null)}
        wide
        actions={(
          <>
            <Button variant="ghost" onClick={() => setEditar(null)}>{tr('Cancelar', 'Cancel')}</Button>
            <Button variant="primary" onClick={guardarEdicao} data-testid="btn-guardar-rascunho">
              {tr('Guardar', 'Save')}
            </Button>
          </>
        )}
      >
        {editar ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label={tr('Assunto', 'Subject')} required>
              <Input
                value={editar.assunto}
                onChange={(e) => setEditar({ ...editar, assunto: e.target.value })}
                data-testid="input-assunto"
              />
            </Field>
            <Field label={tr('Corpo', 'Body')} required>
              <Textarea
                rows={12}
                value={editar.corpo}
                onChange={(e) => setEditar({ ...editar, corpo: e.target.value })}
                data-testid="input-corpo"
              />
            </Field>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={!!concluir}
        title={tr('Concluir tarefa', 'Complete task')}
        onClose={() => setConcluir(null)}
        actions={(
          <>
            <Button variant="ghost" onClick={() => setConcluir(null)}>{tr('Cancelar', 'Cancel')}</Button>
            <Button variant="primary" onClick={confirmarConclusao} disabled={ocupadoTarefa} data-testid="btn-confirmar-conclusao">
              {ocupadoTarefa ? tr('A guardar...', 'Saving...') : tr('Concluir', 'Complete')}
            </Button>
          </>
        )}
      >
        {concluir ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p className="campo__dica">{concluir.tarefa.titulo}</p>
            <Field label={tr('Resultado do contacto', 'Contact outcome')} required>
              <Select
                value={concluir.resultado}
                onChange={(e) => setConcluir({ ...concluir, resultado: e.target.value })}
                data-testid="select-resultado"
              >
                {RESULTADOS.map((r) => (
                  <option key={r.id} value={r.id}>{tr(r.pt, r.en)}</option>
                ))}
              </Select>
            </Field>
            {concluir.resultado === 'promessa' ? (
              <Field
                label={tr('Data prometida', 'Promised date')}
                required
                hint={tr('A cobrança fica suspensa até esta data; se falhar, o plano retoma com escalada.', 'Chasing pauses until this date; if it fails, the plan resumes with escalation.')}
              >
                <Input
                  type="date"
                  value={concluir.promessaData}
                  onChange={(e) => setConcluir({ ...concluir, promessaData: e.target.value })}
                  data-testid="input-promessa-data"
                />
              </Field>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={!!ignorar}
        title={tr('Ignorar passo', 'Skip step')}
        message={tr(
          'O passo fica marcado como ignorado e não volta a disparar para estes itens. A decisão fica registada na linha do tempo.',
          'The step is marked as skipped and will not fire again for these items. The decision is recorded in the timeline.',
        )}
        confirmLabel={tr('Ignorar', 'Skip')}
        cancelLabel={tr('Cancelar', 'Cancel')}
        onConfirm={confirmarIgnorar}
        onCancel={() => setIgnorar(null)}
      />
    </>
  );
}
