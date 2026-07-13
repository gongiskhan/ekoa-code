/*
 * Operator Assistant Panel - CHANGE-REQUEST controller (operator-run H4; NON-admins).
 *
 * The network side of the "Pedir alteração" affordance shown to a viewer who CANNOT edit this
 * app (admin === false from H2). It files a change request into the app OWNER's org-admin queue
 * so a user is never a dead end. Factored out of AssistantPanel.jsx so it is unit-provable
 * against a fake fetch (tests/apps/change-request.test.ts).
 *
 * It targets ONE thin platform endpoint - `POST /api/v1/change-requests` - scoped by the served
 * app's `X-Ekoa-App-Id` header (the server resolves the app + OWNER org) and REQUIRING a
 * logged-in platform user (an OPTIONAL Bearer read best-effort, same as H2/H3). This is a
 * SEPARATE plane from the visitor-blind served-app assistant plane, which stays byte-for-byte
 * untouched (it never reads the caller JWT). Nothing here grounds, bills, or issues a model turn.
 *
 * Filing REQUIRES a session: no readable token (not logged in / cross-origin / sandboxed iframe)
 * or a 401 both resolve to the calm `needs-login` outcome the panel renders as
 * "Inicie sessão no Ekoa para pedir alterações." - never a throw, never a crash. PT-PT
 * throughout, no emoji, no em/en-dash.
 */

/** The thin platform endpoint that files a change request (X-Ekoa-App-Id scoped, auth 'user'). */
export const CHANGE_REQUESTS_ENDPOINT = '/api/v1/change-requests';

/** The shared PT-PT copy for the request affordance (kept here so the flow's wording is one place). */
export const REQUEST_COPY = {
  open: 'Pedir alteração',
  intro: 'Não pode editar esta aplicação, mas pode pedir uma alteração ao administrador.',
  placeholder: 'Descreva a alteração que gostaria de ver nesta aplicação.',
  submit: 'Enviar pedido',
  cancel: 'Cancelar',
  close: 'Fechar',
  filed: 'Pedido enviado ao administrador. Obrigado.',
  needsLogin: 'Inicie sessão no Ekoa para pedir alterações.',
  failed: 'Não foi possível enviar o pedido. Tente novamente.',
};

/**
 * File a change request for `appId`. POSTs the platform endpoint with the served-app header + the
 * OPTIONAL admin/user Bearer. Returns a discriminated outcome the panel maps to a calm PT-PT note:
 *   - `{ outcome:'filed', request }`      the queue accepted it (2xx).
 *   - `{ outcome:'needs-login' }`         no readable token OR a 401 - "inicie sessão" message.
 *   - `{ outcome:'failed', status }`      any other non-2xx / missing app id / network error.
 * Fail-soft: a missing app id / unreadable token / network throw never rejects; it degrades.
 */
export async function fileChangeRequest({ fetchImpl, appId, token, text, route, screenState }) {
  const body = (text || '').trim();
  if (!body) return { outcome: 'failed', status: 0 };
  // No session token (not logged in / cross-origin) -> the calm login message BEFORE a doomed call.
  if (!token) return { outcome: 'needs-login' };
  // No served-app id (a standalone preview) -> nothing to scope the request to.
  if (!appId) return { outcome: 'failed', status: 0 };

  let res;
  try {
    res = await fetchImpl(CHANGE_REQUESTS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ekoa-App-Id': appId,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        text: body,
        ...(route ? { route: String(route).slice(0, 1000) } : {}),
        ...(screenState ? { screenState: String(screenState).slice(0, 8000) } : {}),
      }),
    });
  } catch {
    return { outcome: 'failed', status: 0 };
  }

  if (res && res.status === 401) return { outcome: 'needs-login' }; // session expired -> inicie sessão
  if (!res || !res.ok) return { outcome: 'failed', status: res ? res.status : 0 };

  let request = null;
  try {
    request = await res.json();
  } catch {
    request = null; // a filed request with an unreadable body is still filed
  }
  return { outcome: 'filed', request };
}
