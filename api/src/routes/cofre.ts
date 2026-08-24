/**
 * routes/cofre.ts — the Cofre's REST surface (Cofre WS-B B-3).
 *
 * Thin by design: validate -> call the domain module -> shape. Every authorization decision lives
 * in `api/src/cofre/`, not here, so there is exactly one place to audit and one place for WS-K and
 * the parked passkey-PRF lock to install behind.
 *
 * OWNERSHIP SCOPING IS THE AUTHORIZATION, exactly as it is for gateway keys: the owner is stamped
 * server-side from the verified JWT and never read from the body, and an item belonging to anyone
 * else answers a uniform 404 rather than a 403 — a 403 would confirm the item exists.
 *
 * The VALUE is write-only across this whole surface. It is accepted on create and returned by
 * nothing; the response to a create is the item VIEW, which has no value field at the contract
 * layer. Unlike a gateway key there is no show-once secret, because the user already HAS this
 * credential — the Cofre is storing it, not generating it.
 */
import { Router, type Response } from 'express';
import { CofreItemCreateRequest, CofreSessionEstablishRequest, GrantRequest } from '@ekoa/shared';
import { requireAuth, type AuthedRequest } from '../auth/middleware.js';
import {
  mintCofreItem,
  issueGrant,
  listCofreItems,
  lockItem,
  lockAll,
  deleteCofreItem,
  recordCofreEvent,
} from '../cofre/index.js';
import { ADHOC_SESSION_GRANT } from '../cofre/sessions.js';
import { requestAttendedCeremony } from '../bridge/attended.js';
import { advertisesCapability, getConnectionByOwner } from '../bridge/registry.js';
import { notFound, parseBody, sendError } from './helpers.js';
import type { Actor } from '@ekoa/shared';

function actorOf(req: AuthedRequest): Actor {
  const u = req.user!;
  return { userId: u.sub, orgId: u.orgId ?? '', role: u.role } as Actor;
}

function auditActorOf(req: AuthedRequest): { userId: string; username: string; orgId: string } {
  const u = req.user!;
  return { userId: u.sub, username: u.username ?? u.sub, orgId: u.orgId ?? '' };
}

export function cofreRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();
  r.use(requireAuth);

  r.get('/items', async (req: AuthedRequest, res: Response) => {
    res.json({ items: await listCofreItems(actorOf(req), deps.now()) });
  });

  r.post('/items', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, CofreItemCreateRequest, req.body);
    if (!body) return;
    try {
      const item = await mintCofreItem(actorOf(req), body, deps);
      const [view] = await listCofreItems(actorOf(req), deps.now());
      res.status(201).json(view ?? { id: item._id });
    } catch (err) {
      // A missing origin binding is a 422, not a 500: it is a well-formed request the policy
      // refuses, and the message names the reason so the UI can render it.
      return sendError(res, 'VALIDATION_FAILED', err instanceof Error ? err.message : 'invalid item');
    }
  });

  r.delete('/items/:id', async (req: AuthedRequest, res: Response) => {
    const ok = await deleteCofreItem(actorOf(req), req.params.id as string);
    if (!ok) return notFound(res);
    res.json({ ok: true });
  });

  r.post('/items/:id/grants', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, GrantRequest, req.body);
    if (!body) return;
    const itemId = req.params.id as string;
    try {
      const grant = await issueGrant(actorOf(req), itemId, body.duration, {}, deps);
      await recordCofreEvent(auditActorOf(req), 'cofre_grant_issued', { itemId, scope: grant.scope, duration: body.duration }, deps);
      res.json({ ok: true, scope: grant.scope, ...(grant.expiresAt ? { expiresAt: grant.expiresAt } : {}) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'grant refused';
      if (message.includes('not found')) return notFound(res);
      // I7 refusals land here: a TTL on a signature identity is a 422 the UI must surface, never a
      // silent downgrade to `this_run`.
      return sendError(res, 'VALIDATION_FAILED', message);
    }
  });

  r.post('/items/:id/lock', async (req: AuthedRequest, res: Response) => {
    const itemId = req.params.id as string;
    const revoked = await lockItem(actorOf(req), itemId, deps.now());
    await recordCofreEvent(auditActorOf(req), 'cofre_lock_now', { itemId }, deps);
    res.json({ ok: true, revoked });
  });

  r.post('/lock-all', async (req: AuthedRequest, res: Response) => {
    const revoked = await lockAll(actorOf(req), deps.now());
    await recordCofreEvent(auditActorOf(req), 'cofre_lock_all', { itemCount: revoked }, deps);
    res.json({ ok: true, revoked });
  });

  /**
   * THE HUMAN'S ENTRY POINT for the ad-hoc adversarial ceremony (docs/decisions.md 2026-08-24,
   * D-ADHOC-1). A run halted `needs_credentials(ceremony)` on an undeclared origin and sent the
   * person here through `portalDeepLink` (`/cofre?origin=...`); this is the button at the other end.
   *
   * IT IS THE SAME RAIL THE DECLARED PATH USES, with two differences and no third. The origin comes
   * from the CALLER rather than from an integration package - because an ad-hoc origin has no
   * package, and the halt the run wrote is the only statement of where the human must log in - and
   * the capture is armed with a bounded grant rather than a standing one (D-ADHOC-2). Everything
   * else, including which machine is asked and the origin check on the way back, is
   * `bridge/attended.ts` unchanged.
   *
   * THE MACHINE IS RESOLVED FROM THE ACTOR AND NEVER FROM THE BODY, exactly as
   * `POST /integrations/:key/session` resolves it: a caller-supplied pairing would let one user open
   * a login window on another user's screen and bank the result against their own org.
   *
   * NOTHING HERE IS AN AUTHORIZATION DECISION ABOUT THE ORIGIN, and that is deliberate rather than
   * an omission. The ceremony captures a session into the CALLER'S OWN Cofre, under their own actor,
   * on their own machine, from a browser they are sitting in front of - which is a thing they could
   * do with or without this endpoint. D-ADHOC-5 governs when a RUN may open one of these unasked;
   * a person asking for one about their own account needs no gate, and adding a posture check here
   * would refuse the case the feature exists for (an origin nobody has classified).
   */
  r.post('/sessions/establish', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, CofreSessionEstablishRequest, req.body);
    if (!body) return;
    const actor = actorOf(req);

    const machine = getConnectionByOwner(actor.userId, actor.orgId);
    if (!machine) {
      return res.json({
        started: false,
        message: 'Nenhuma máquina ligada. Abra a Ponte Ekoa na máquina onde quer iniciar sessão.',
      });
    }
    // The advertisement check the declared rail makes, for the reason it makes it: `sendToPairing`
    // answers true for any live socket, so without this the endpoint would promise "a window is
    // opening on your machine" to a daemon whose wire contract cannot parse the frame it was sent.
    // `attended.card_login` is the capability for BOTH kinds: the daemon runs one ceremony and does
    // not branch on the kind, so a second capability would only make every existing daemon look
    // incapable of something it can already do.
    if (!(await advertisesCapability(machine.pairingId, 'attended.card_login'))) {
      return res.json({
        started: false,
        message: 'A Ponte Ekoa ligada é demasiado antiga para capturar sessões. Atualize-a nessa máquina e volte a ligá-la.',
      });
    }

    try {
      await requestAttendedCeremony(actor, {
        pairingId: machine.pairingId,
        kind: 'login',
        origin: body.origin,
        reason: `Iniciar sessão em ${body.origin} para continuar a automação`,
        label: `${body.origin} session`,
        // D-ADHOC-2. The one field that differs from the declared ceremony, and it is set HERE - by
        // the code that knows this is the ad-hoc errand - rather than defaulted inside the rail.
        grant: ADHOC_SESSION_GRANT,
      });
    } catch (error) {
      // Offline is a REFUSAL, never a queued promise (bridge/attended.ts): a ceremony needs a human
      // there now, so "we will ask when it comes back" would ask when nobody is standing there.
      return res.json({
        started: false,
        message: error instanceof Error ? error.message : 'A cerimónia não pôde ser iniciada.',
      });
    }

    // NO requestId on the wire, and no run id echoed back. The client learns the outcome by watching
    // the run it was blocking: the capture wakes it through the ordinary credential-waiter path, so
    // a ceremony handle here would be a second thing to correlate that nothing reads.
    return res.json({
      started: true,
      message: 'Abriu-se uma janela na sua máquina. Inicie sessão e feche a janela quando terminar.',
    });
  });

  return r;
}
