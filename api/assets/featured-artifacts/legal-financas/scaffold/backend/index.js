// backend/index.js — Jurídico · Finanças (Layer 2).
//
// The certified-emission SEAM. REGRA REGULATÓRIA §3.2.1: a Ekoa NÃO emite
// faturas nativamente — a emissão certificada (número, código de validação
// ATCUD, código QR, comunicação à AT) passa EXCLUSIVAMENTE pela integração
// InvoiceXpress (ekoa-data/integrations/invoicexpress/ — actions create_invoice
// / finalize_invoice / get_invoice).
//
// This handler is invoked by core (event-sourcing / execute) with an action
// envelope. The served frontend records `faturacao_pedidos` intent rows directly
// via window.__ekoa.shared; this backend is where a future checkpoint picks a
// pedido up and drives the InvoiceXpress emission. It writes ONLY through the
// injected, capability-scoped `ekoa` handle (no credentials of its own) and
// reaches data via the owner-SHARED spine (`ekoa.appData.shared.*`).
//
//   input : { action: 'emitirFatura', pedidoId }
//   ekoa  : { appData:{...,shared:{list,get,create,update,delete}}, llm, notify:{inApp,email}, info/warn/error }
//
// HONEST v1 REALITY: artifact backends CANNOT call InvoiceXpress directly —
// handle-rpc's `integration.call` allows `pipedream:*` keys ONLY, and
// InvoiceXpress is a user/platform integration, not a Pipedream app. Until the
// checkpoint wires the dashboard-side integration executor, `emitirFatura`
// records that the pedido is waiting on the integration and notifies. It NEVER
// synthesizes an invoice number or any fiscal artifact locally.
export async function onMessage(input, ekoa) {
  const action = input && input.action;
  if (action !== 'emitirFatura') {
    ekoa.info('Finanças onMessage: acção desconhecida — ignorada', { action });
    return { skipped: 'unknown-action' };
  }

  const pedidoId = input && input.pedidoId;
  const data = ekoa.appData.shared;

  // Valida que o pedido existe antes de qualquer coisa.
  let pedido = null;
  if (pedidoId) {
    try {
      pedido = await data.get('faturacao_pedidos', pedidoId);
    } catch (e) {
      ekoa.warn('Falha ao ler o pedido de emissão', { pedidoId, error: String(e && e.message ? e.message : e) });
    }
  }
  if (!pedido) {
    ekoa.warn('Pedido de emissão inexistente', { pedidoId });
    return { error: 'pedido-not-found', pedidoId: pedidoId || null };
  }

  // ---- SEAM InvoiceXpress (§3.2.1) ------------------------------------------
  // TODO(checkpoint): quando a integração InvoiceXpress estiver ligada e o
  //   artefacto tiver um caminho para a executar:
  //     1. resolver as credenciais da integração 'invoicexpress';
  //     2. montar o payload a partir da pré-fatura (documentoId -> documentos);
  //     3. chamar a action 'create_invoice' e depois 'finalize_invoice';
  //     4. persistir o artefacto fiscal devolvido (número, ATCUD, QR) NO PEDIDO.
  //   O número/ATCUD/QR são SEMPRE os que a InvoiceXpress devolve — nunca
  //   sintetizados aqui. Enquanto isso não existe, marcamos e notificamos.
  try {
    await data.update('faturacao_pedidos', pedidoId, {
      estado: 'aguarda_configuracao',
      avaliadoEm: new Date().toISOString(),
    });
  } catch (e) {
    ekoa.warn('Falha ao marcar o pedido como a aguardar configuração', {
      pedidoId,
      error: String(e && e.message ? e.message : e),
    });
  }

  try {
    await ekoa.notify.inApp(
      'Emissão certificada pendente',
      'A emissão certificada requer a integração InvoiceXpress configurada (AT). A Ekoa não emite faturas nativamente.',
      { source: 'financas', pedidoId, href: '/apps/legal-financas/faturacao' },
    );
  } catch (e) {
    ekoa.warn('Falha ao notificar sobre a emissão pendente', {
      pedidoId,
      error: String(e && e.message ? e.message : e),
    });
  }

  return { estado: 'aguarda_configuracao', pedidoId };
}
