/**
 * Processamento de uma notificação Citius: parse -> emparelhar o processo (na
 * espinha PARTILHADA) -> calcular o prazo (motor de prazos) -> escrever
 * prazo + evento + a notificação na caixa. DETERMINÍSTICO e CONSERVADOR: o que
 * não for inequivocamente identificável vai para REVISÃO ("needs-review") e
 * NUNCA gera um prazo adivinhado.
 *
 * O acesso a dados é INJECTADO (`dataApi = { list, create }`), pelo que a mesma
 * lógica corre no frontend (caixa de teste, via window.__ekoa.shared) e no
 * backend do artefacto (onEmail, via ekoa.appData.shared) — uma só fonte.
 *
 * Idempotência: `opts.sourceRef` (o id da mensagem, no backend; ou um hash do
 * texto, no frontend) — se já existe uma notificação com esse sourceRef, devolve
 * a existente e não reprocessa (re-entregas não duplicam).
 *
 * Segurança: `opts.forceReview` (bool) — quando true, mesmo uma correspondência
 * total é encaminhada para revisão (motivo "Origem não autenticada …") e NUNCA
 * cria prazo/evento. Usado quando a origem do email não é autenticada (deteção
 * só por texto), que é falsificável.
 */
import { parseCitiusNotification } from './citius-parser.mjs';
import { computePrazo } from './prazo.mjs';

const NOTIFS = 'citius_notificacoes';

/** Hash determinístico simples (djb2) — para o sourceRef por omissão (sem deps). */
function djb2(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

export async function processarNotificacao(raw, dataApi, opts = {}) {
  const parsed = parseCitiusNotification(raw);
  // Impressão digital do CONTEÚDO COMPLETO (não truncado) — duas notificações
  // diferentes nunca colidem; a MESMA reentregue colide sempre.
  const contentRef = `c_${djb2(parsed.textoCompleto)}`;
  const sourceRef = opts.sourceRef ? String(opts.sourceRef) : contentRef;

  const existentes = await dataApi.list(NOTIFS);
  const mesma = (n) => n && (n.sourceRef === sourceRef || n.contentRef === contentRef);

  // Idempotência: só uma notificação que JÁ produziu um prazo (matched) bloqueia
  // o reprocessamento — re-entregas (mesmo id OU mesmo conteúdo) não duplicam.
  const jaMatched = existentes.find((n) => mesma(n) && n.estado === 'matched' && n.prazoId);
  if (jaMatched) {
    return { status: 'matched', notificacaoId: jaMatched.id, duplicate: true, prazoId: jaMatched.prazoId };
  }

  // Uma entrada anterior em REVISÃO para o mesmo conteúdo NÃO suprime: o processo
  // pode ter sido registado depois. Reaproveita-se essa linha (update) para não
  // acumular duplicados — e desta vez pode emparelhar e criar o prazo.
  const previa = existentes.find((n) => mesma(n) && n.estado === 'needs-review');

  const base = {
    sourceRef,
    contentRef,
    texto: parsed.texto,
    numeroProcesso: parsed.numeroProcesso,
    ato: parsed.ato,
    dataActo: parsed.dataExplicita,
  };

  // Escreve a notificação: actualiza a linha de revisão anterior se existir,
  // senão cria uma nova.
  const escreve = async (fields) => {
    if (previa) {
      await dataApi.update(NOTIFS, previa.id, { ...base, ...fields });
      return { id: previa.id };
    }
    return dataApi.create(NOTIFS, { ...base, ...fields });
  };

  const revisao = async (motivo, extra = {}) => {
    // `reused` = reaproveitámos uma linha de revisão anterior (mesma reentrega,
    // ainda por rever) em vez de criar uma nova. O chamador usa-o para NÃO voltar
    // a notificar (campainha/toast) uma notificação que o utilizador já viu.
    const reused = !!previa;
    const notif = await escreve({ ...extra, motivo, estado: 'needs-review' });
    return { status: 'needs-review', motivo, notificacaoId: notif.id, reused, ...extra };
  };

  // 1) Sem processo OU sem ato reconhecido -> revisão.
  if (!parsed.ok) return revisao(parsed.motivo);

  // 2) Processo não encontrado na espinha -> revisão (nunca cria prazo solto).
  const processos = await dataApi.list('processos');
  const processo = processos.find((p) => p && (p.numeroProcesso || '').trim() === parsed.numeroProcesso);
  if (!processo) return revisao(`processo ${parsed.numeroProcesso} não encontrado`);

  // 3a) Datas do acto em CONFLITO (mais do que uma rotulada) -> revisão.
  if (parsed.dataConflito) return revisao('datas do acto em conflito', { processoId: processo.id });

  // 3b) Sem data do acto EXPLÍCITA -> não há por onde contar -> revisão.
  if (!parsed.dataExplicita) return revisao('data do acto não explícita', { processoId: processo.id });

  // 4) Ato sem prazo automático bem estabelecido -> revisão.
  if (!parsed.regra || parsed.regra.dias == null) {
    return revisao('ato sem prazo automático', { processoId: processo.id });
  }

  // 4b) ORIGEM NÃO AUTENTICADA (`opts.forceReview`): mesmo com correspondência
  //     total, NUNCA cria o prazo automaticamente — o email foi identificado só
  //     pelo conteúdo (proveniência 'text'), que qualquer terceiro pode forjar.
  //     Vai para revisão com o processo já emparelhado, para o advogado confirmar
  //     antes de o prazo existir. O fluxo "colar" (humano já no circuito) não
  //     passa forceReview, pelo que mantém a criação automática.
  if (opts.forceReview) {
    return revisao('Origem não autenticada - confirme antes de criar o prazo', { processoId: processo.id });
  }

  // 5) Tudo inequívoco -> calcula o prazo e escreve prazo + evento + notificação.
  const r = computePrazo({
    dataNotificacao: parsed.dataExplicita,
    dias: parsed.regra.dias,
    contagem: parsed.regra.contagem,
  });

  const prazo = await dataApi.create('prazos', {
    processoId: processo.id,
    titulo: parsed.ato,
    dataNotificacao: parsed.dataExplicita,
    regraAplicada: `${parsed.ato} - ${parsed.regra.dias} dias ${parsed.regra.contagem}`,
    dataLimite: r.dataLimite,
    multaAte: r.multaAte,
    tipoContagem: parsed.regra.contagem,
    estado: 'pendente',
    origem: 'citius',
    showWork: { passos: r.passos, multaDias: r.multaDias },
  });

  await dataApi.create('eventos', {
    processoId: processo.id,
    tipo: 'citius-notificacao',
    titulo: `Citius: ${parsed.ato}`,
    descricao: `Prazo criado automaticamente (data-limite ${r.dataLimite}).`,
    data: parsed.dataExplicita,
    origem: 'citius',
    metadata: { prazoId: prazo.id, sourceRef },
  });

  const notif = await escreve({
    processoId: processo.id,
    estado: 'matched',
    prazoId: prazo.id,
    dataLimite: r.dataLimite,
    motivo: null,
  });

  return {
    status: 'matched',
    notificacaoId: notif.id,
    prazoId: prazo.id,
    dataLimite: r.dataLimite,
    processoId: processo.id,
  };
}
