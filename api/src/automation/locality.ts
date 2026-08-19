/**
 * automation/locality.ts - WHERE a browser step runs, and WHERE its traffic leaves from.
 *
 * ================================ WHAT WAS WRONG ================================
 * Two modules already answered half of this question each, and neither was called.
 *
 *   - `egress-policy.ts` implements the route-out decision exactly (`resolveEgress` /
 *     `proxyOptionFor`) and shipped with ZERO callers, so a run's declared `offlinePolicy` and
 *     `StepTarget` were inert: nothing ever read them.
 *   - the browser-vs-bridge choice was made by ONE GLOBAL FLAG, `localBrowserEnabled`, defaulting
 *     to `!isProd`. So the question "may this step run in the hosted browser" was answered by the
 *     deployment environment rather than by the site being automated: outside production EVERY
 *     target silently ran hosted, including the portals that score datacenter IPs, and the only
 *     reason production looked correct was that the flag happened to be off there.
 *
 * This module is where the two halves meet, and it is where the environment stops being the
 * decision. The gate is the ORIGIN POSTURE (`origin-posture.ts`), in every environment: a
 * permissive origin may be carried by the hosted browser, an adversarial one never is. Because
 * posture defaults CLOSED, every automation authored before posture existed is bridge-only - which
 * is the direction a default must fail in when the cost of being wrong is an account lock.
 *
 * ================================ THE THREE ANSWERS ================================
 *   - `bridge`     - run it on the owner's paired machine. The default for a browser step.
 *   - `in-process` - run it in the hosted Chromium, optionally proxied out through a machine's
 *                    residential line (`egress`, fed to `proxyOptionFor` at the launch seam).
 *   - `blocked`    - neither is permissible. The run HALTS. It does not fall back to a datacenter
 *                    route, and it does not borrow another machine.
 *
 * `blocked` is a halt, never a failure: nothing about it is retryable by a machine, and the
 * schedule rail carries it as `blocked` rather than `failed`. Whether a given block is NEUTRAL
 * against the failure ceiling is decided HERE, in `CLEARING_ACTS`, and not by the rail: the rail
 * reads a CODE (`schedules/supervisor.ts` `NEUTRAL_BLOCKED_CODES`), and which code a refusal gets is
 * `engine.ts` `refusalRecordFor` reading this module's table. It used to be described as the rail's
 * own judgement, which is how three refusals ended up neutral without anyone deciding they should be.
 *
 * ================================ EVERY REFUSAL IS BUILT HERE ================================
 * The blocked member carries a BRAND (`REFUSAL_SITE`), a module-private symbol, so the only code in
 * the repository that can construct one is `refuse()` below. That is not decoration. Three times
 * running, the same defect arrived as A REFUSAL BUILT SOMEWHERE ELSE inheriting neutrality by
 * saying nothing, and the third one (`engine.ts`'s posture-drift halt) escaped a cross-product
 * census of this whole module for exactly one reason: the census can only enumerate what this module
 * returns, and that refusal was assembled next door. The brand makes "somewhere else" impossible to
 * compile, which is what turns the census into a census of THE PRODUCT rather than of one function.
 *
 * The corollary is that decisions which need the RUN's live facts - the page the hosted browser
 * actually drifted onto, the route its context is already open for - are made here too, as pure
 * functions over those facts (`narrowLocalityForRun`). The engine gathers, this module judges.
 *
 * ================================ PREFERENTIAL BRIDGE (P4.2) ================================
 * A captured session was established from a particular vantage point, and the pairing where its
 * ceremony happened is already recorded - `sessionMetadata.establishedBy.pairingId`, stamped by
 * `bridge/attended.ts`. For an ADVERSARIAL origin that pairing is a preference this module honours:
 * the run goes to that machine or it waits. A substitute machine is another household on another
 * ASN, which to the portal is as foreign as a datacenter and more confusing when it fails.
 *
 * Portable credentials - API keys, OAuth tokens, CLI logins, a permissive origin's storageState -
 * carry NO preference. Their posture is permissive, which resolves to `kind: 'any'`: any route out
 * is fine, because nothing about them is bound to where they were made.
 *
 * A preference is not a life sentence, and the refusal for a ceremony machine that no longer exists
 * is NOT made here. It cannot be: this module only ever LEARNS a preference from a session checkout
 * that succeeded, and a ceremony session is bound to its machine's residential line, so a checkout
 * that succeeded proves the machine is still in the fleet. The dead end is reached one step EARLIER,
 * at the checkout that refuses (`engine.ts` `credentialGateRecord` on a `needs-machine` verdict,
 * against `machineRetired` and `SESSION_MACHINE_RETIRED_REASON` in `egress-policy.ts`). This module
 * used to carry a second copy of that refusal; nothing in production could reach it, so it is gone.
 *
 * ================================ AN ACCOUNT WITH NO MACHINES ================================
 * Every refusal below that names a machine is, in effect, a promise that one can arrive: open the
 * laptop and the next fire works, with nobody touching the schedule. That is why those halts are
 * NEUTRAL against the failure ceiling.
 *
 * An account whose fleet listing is KNOWN AND EMPTY withdraws the promise. There is no laptop that
 * gets opened tomorrow morning, so nothing clears in the ordinary course, and carrying such a halt
 * as the neutral one is an UNBOUNDED retry against a state that never moves on its own - the exact
 * pathology this slice exists to remove, re-created for the tenant least able to spot it
 * (docs/findings.md `an-org-whose-only-machine-is-revoked-retried-forever`). So a known-empty fleet
 * refuses TERMINALLY and names pairing a machine as the act. Note the argument that carries this is
 * clause (ii) of `CLEARING_ACTS`, not "no act can clear it": pairing a machine plainly is an act the
 * owner can take, and the point is that nobody takes it unprompted.
 *
 * `candidates: null` is the OTHER thing an empty answer can mean - this process does not know what
 * the org has, an unbound seam - and it keeps the neutral wait. Not-knowing may never escalate.
 *
 * A PREFERENCE BELONGS TO ONE ORIGIN, NEVER TO A RUN. `preferredPairingId` is read off ONE session,
 * and a session is bound to ONE origin. A run that touches two portals therefore carries two
 * independent answers, and the caller must hand this module the one for the origin THIS step is
 * about (`engine.ts` keys them by origin for exactly that reason). Carrying a run-level preference
 * across origins aims every later refusal at the wrong portal - it told the owner to re-establish
 * portal B's session because portal A's ceremony machine was retired, and doing so changed nothing.
 *
 * KNOWN LIMITATION, named rather than hidden (docs/findings.md
 * `daemon-seam-cannot-ask-for-a-specific-machine...`): the daemon seam answers "the newest live
 * socket for this owner" and cannot be asked for a particular machine, so a two-machine user whose
 * arbitrary pick is the wrong one HALTS here even though the preferred machine is dialled in.
 * `bridge/registry.ts` `selectConnectionForStep` is the (currently inert) primitive that closes it.
 * The failure direction is the safe one: refuse and name the machine, never execute on another.
 *
 * ================================ ONE PORTAL, ONE DOOR (P4.1) ================================
 * A step resolves to a route out, and the LOGIN that step needs must leave by the same one. Two
 * doors onto one portal - the work from a home line, the password typed from a datacenter, or from
 * some other household's line entirely - is the substitution this module exists to stop, performed
 * by the one act that hands over a secret. `bridgeEgressFor` and `hostedTypistPermitFor` are the two
 * halves of that: the first says which door the WORK takes when it runs on a machine, the second
 * says whether the typist may use it, and withholds the permit rather than quietly taking another.
 *
 * ================================ PURE ON PURPOSE ================================
 * Nothing here reads a store, a seam or an env var. Every input is an argument, so the whole
 * decision table is drivable from a test - including the cross-tenant cases, which are the ones
 * that must never be reasoned about by inspection (`resolveEgress` filters candidates by org, and
 * `tests/security/locality-isolation.test.ts` proves it through this function).
 */
import type { OfflinePolicy, StepTarget } from '@ekoa/shared';
import type { OriginClassification } from './origin-posture.js';
import { resolveTargetPosture } from './origin-posture.js';
import {
  resolveEgress,
  type EgressCandidate,
  type EgressRequirement,
  type EgressResolution,
} from './egress-policy.js';

/**
 * THE ACT THAT CLEARS A REFUSAL - and, the half everything downstream turns on, WHETHER REPEATING
 * THE RUN CAN EVER HELP.
 *
 *   - `start-a-machine`    - the ENVIRONMENT is what is missing: a laptop is shut, or the machine a
 *                            session was made on is not the one dialled in. The owner opening it
 *                            clears the block with nobody touching the schedule.
 *   - `pair-a-machine`     - the account has NO machine (`fleetIsKnownEmpty`). There is nothing to
 *                            start, so waiting can never clear it.
 *   - `edit-the-automation`- the cause is a property of the STEP LIST, so replaying the same steps
 *                            reproduces the same halt at the same index, forever. Only the author
 *                            changing what the automation declares can clear it.
 *
 * IT NAMES THE ACT AND NOT THE ACTOR (it was `'machine' | 'human'`) because "a person must do
 * something" is not enough to pick a halt with, and picking one is the only thing the consumer does
 * with this field.
 */
export type ClearingAct = 'start-a-machine' | 'pair-a-machine' | 'edit-the-automation';

/** What the schedule rail is entitled to conclude from a clearing act. */
export interface ClearingActFacts {
  /**
   * NEUTRAL AGAINST THE FAILURE CEILING - the fire neither resets the counter nor increments it, so
   * the schedule waits indefinitely and never auto-pauses (`schedules/supervisor.ts`
   * `NEUTRAL_BLOCKED_CODES`, reached through the `awaiting_daemon` halt).
   *
   * WHAT NEUTRALITY REALLY BUYS, and therefore what it costs: a fire that leaves NO DURABLE TRACE.
   * The only signal is a `schedule_blocked` toast on a page the owner may never have open. So the
   * question is not "can a person fix this" - a person can fix all three of these - but "will this
   * clear WITHOUT ANYBODY BEING TOLD". Three clauses, and all three must hold:
   *
   *   1. THE CAUSE IS A FACT ABOUT THE WORLD, not about the automation's declarations. Otherwise the
   *      next fire resolves the same declarations, reaches the same index and halts identically:
   *      replay is provably useless, and neutrality is an unbounded retry by construction.
   *   2. IT IS EXPECTED TO CLEAR IN THE ORDINARY COURSE, unprompted. A laptop gets opened tomorrow
   *      morning whether or not anyone knew a schedule wanted it. A machine nobody has been told to
   *      pair is never paired; an automation nobody has been told is broken is never edited. This is
   *      the clause the first two defects failed, and the one that is easy to miss because "a human
   *      act clears it" is true of every refusal here.
   *   3. AND WHEN IT CLEARS, THE SAME STEPS SUCCEED UNCHANGED - so the wait was the right thing to
   *      have done.
   *
   * Fail any clause and the halt must be terminal, which is the loud direction: it drives the ceiling
   * and eventually auto-pauses the schedule, which is how the owner finds out at all.
   */
  neutral: boolean;
  /** Why that answer is the honest one for this act, against the three clauses above. Never parsed. */
  because: string;
}

/**
 * NEUTRALITY IS DECLARED HERE OR IT DOES NOT EXIST.
 *
 * WHAT THIS REPLACES, and why the shape is the fix. `clearedBy` used to be a two-value union whose
 * single consumer asked `=== 'pair-a-machine'` and treated EVERYTHING ELSE as the neutral halt. So
 * neutrality was the FALL-THROUGH: any refusal that failed to be the one terminal case inherited
 * "retry forever" by saying nothing, and three separate defects arrived that way -
 * `an-org-whose-only-machine-is-revoked-retried-forever`,
 * `route-switch-refusal-is-neutral-but-repeats-identically`, and the posture-drift halt this table
 * lands with. A `Record<ClearingAct, ...>` inverts it: a new act does not compile until its neutrality
 * is written down beside the reason it is true, and `refusalIsNeutral` is a table read rather than
 * an equality test, so the DEFAULT for anything unconsidered is now terminal - the direction whose
 * failure mode is a schedule that pauses loudly rather than one that repeats silently.
 */
export const CLEARING_ACTS: Readonly<Record<ClearingAct, ClearingActFacts>> = Object.freeze({
  'start-a-machine': {
    neutral: true,
    because:
      'a machine of this account exists and is merely not connected. The cause is a fact about the ' +
      'world, the laptop gets opened tomorrow morning whether or not anybody knew a schedule was ' +
      'waiting for it, and when it does the same steps succeed unchanged. All three clauses hold, ' +
      'and counting these would auto-pause a working schedule over a shut lid.',
  },
  'pair-a-machine': {
    neutral: false,
    because:
      'the registry says this account has NO machine. The cause is a fact about the world, but it ' +
      'fails the second clause: nobody pairs hardware they were never told was needed, so it will ' +
      'not clear in the ordinary course. Silence here is an unbounded retry against a state that ' +
      'cannot move on its own, aimed at the tenant least likely to spot it.',
  },
  'edit-the-automation': {
    neutral: false,
    because:
      'the cause is a property of the STEP LIST, not of the world, so it fails the first clause ' +
      'outright: the next fire resolves the same declarations, reaches the same index and halts ' +
      'identically. It fails the second too - nobody edits an automation they were never told was ' +
      'broken - and the only act that clears it is the author changing what it declares.',
  },
});

/** Whether a refusal cleared by `act` may be carried as the neutral halt. A TABLE READ, on purpose:
 *  see `CLEARING_ACTS` for why this is not an equality test against the one terminal case. */
export function refusalIsNeutral(act: ClearingAct): boolean {
  return CLEARING_ACTS[act].neutral;
}

/**
 * THE BRAND THAT MAKES THIS MODULE THE ONLY REFUSAL SITE.
 *
 * A module-private `unique symbol`. Nothing outside this file can name it, so nothing outside this
 * file can build a value assignable to the blocked member - the type system, rather than a review
 * convention, is what keeps every refusal inside the census. See the module docblock.
 */
const REFUSAL_SITE: unique symbol = Symbol('locality.refusal');

/** Where a step runs and how it leaves. */
export type LocalityVerdict =
  /**
   * The owner's paired machine.
   *
   * `egress` is THAT MACHINE's route out - see `bridgeEgressFor` - and not an independent pick from
   * the fleet. The work is going to leave by the connected machine's line whatever this field says,
   * so a field naming a different machine would describe a door nothing uses, and the one consumer
   * (`hostedTypistPermitFor`, which routes the login) would send a password through it.
   */
  | { kind: 'bridge'; egress: EgressResolution }
  /** The hosted Chromium. `egress` becomes the launch proxy option (`proxyOptionFor`). */
  | { kind: 'in-process'; egress: EgressResolution }
  /** Neither is permissible. HALT - never a datacenter fallback, never a substitute machine. */
  | {
      kind: 'blocked';
      reason: string;
      /**
       * THE ACT THAT CLEARS THIS BLOCK, and therefore whether REPEATING the run can ever help.
       * `CLEARING_ACTS` is where each act's neutrality is declared, with the reason it is true.
       *
       * REQUIRED, not optional, and that is the point. An optional field would let a new blocked
       * branch inherit "neutral, retry forever" by saying nothing - which is exactly how an account
       * with no machines in it inherited an unbounded wait for a machine that could never arrive.
       * Every refusal has to answer the question out loud.
       *
       * WHICH terminal halt a non-neutral act produces is the caller's judgement - `engine.ts`
       * `refusalRecordFor` asks for a ceremony only when the step actually declares a credential,
       * because a credential halt for a step that wants none sends a person to the Cofre to fix
       * something that is not broken.
       */
      clearedBy: ClearingAct;
      /** The module brand. See `REFUSAL_SITE`: it is why this member cannot be built elsewhere. */
      readonly [REFUSAL_SITE]: true;
    };

/** The blocked member on its own, for the consumers that have already narrowed to it. */
export type LocalityRefusal = Extract<LocalityVerdict, { kind: 'blocked' }>;

/**
 * THE ONE CONSTRUCTOR OF A REFUSAL. Every `blocked` verdict in this product comes from here.
 *
 * It takes the ACT first because the act is the decision: the sentence is what a person reads, and
 * the act is what the schedule rail does. Writing them in that order is a small thing that keeps the
 * important half from being an afterthought appended to a message.
 */
function refuse(clearedBy: ClearingAct, reason: string): LocalityRefusal {
  return { kind: 'blocked', clearedBy, reason, [REFUSAL_SITE]: true };
}

export interface LocalityInput {
  /** The posture of the origin this step is ABOUT (`classifyOrigin`, resolved at use). */
  classification: OriginClassification;
  /** The step's declared (or defaulted) target. `resolveStepDeclaration` defaults it to `cloud`. */
  declaredTarget: StepTarget;
  /** The step's declared (or defaulted) offline policy. Defaults to `fail`. */
  offlinePolicy: OfflinePolicy;
  /** The pairing id of the daemon connected for this owner, or undefined when none is. */
  daemonPairingId?: string;
  /** Whether a daemon is connected at all (a connection may predate `pairingId` on the seam). */
  daemonConnected: boolean;
  /**
   * The pairing where THIS SESSION's ceremony happened
   * (`sessionMetadata.establishedBy.pairingId`). A preference for adversarial origins only.
   *
   * IT MUST BE THE PREFERENCE FOR `classification`'s OWN ORIGIN. A session belongs to one portal;
   * handing this module another portal's ceremony machine makes every refusal below name the wrong
   * site (see the module docblock). The caller keys them by origin - `engine.ts`
   * `preferredPairingByOrigin` - and this module cannot check it, which is why it is said here.
   */
  preferredPairingId?: string;
  /**
   * The org's machines, as the registry sees them (advertised INTERSECT granted), or `null` when
   * this process HAS NO LISTING - an unbound seam (`seams.ts` `loadEgressCandidates`).
   *
   * `null` and `[]` are different facts and this module treats them differently: `[]` is the
   * registry saying THIS ORG HAS NO MACHINES, which is a dead end no laptop can clear, and `null` is
   * ignorance, which keeps the neutral wait. Selection is unaffected either way - both offer no
   * candidate, so a residential requirement cannot be met from either.
   */
  candidates: readonly EgressCandidate[] | null;
  /** The RUN's org. `resolveEgress` filters candidates by it - the tenancy boundary (Rule 5). */
  actorOrg: string;
  /** The env kill switch (`EKOA_AUTOMATION_LOCAL_BROWSER`). Never the posture gate. */
  inProcessFallbackEnabled: boolean;
}

/**
 * The route out this step needs, folding the declaration and the posture.
 *
 * PRECEDENCE, and why:
 *   1. An EXPLICITLY PINNED target names a machine. The author was specific; nothing here
 *      second-guesses that, and it outranks the ceremony preference (which is an inference).
 *   2. `any: egress.residential` asks for a residential line without naming one - so the ceremony
 *      pairing, when there is one, is the machine it means.
 *   3. Otherwise posture decides, via `resolveTargetPosture` (which is where "posture wins over a
 *      defaulted `target: cloud`" is already settled - plan trap T9, decided when posture landed).
 *      Cloud allowed => `any`: no preference at all, because a permissive origin's credential is
 *      portable by definition. Cloud denied => residential, preferring the ceremony pairing.
 */
export function egressRequirementFor(input: {
  declaredTarget: StepTarget;
  classification: OriginClassification;
  preferredPairingId?: string;
}): EgressRequirement {
  const { declaredTarget, classification, preferredPairingId } = input;
  if (declaredTarget.kind === 'pinned') {
    return { kind: 'residential', pairingId: declaredTarget.pairingId };
  }
  const preferred = preferredPairingId ? { pairingId: preferredPairingId } : {};
  if (declaredTarget.kind === 'any' && declaredTarget.capability === 'egress.residential') {
    return { kind: 'residential', ...preferred };
  }
  if (resolveTargetPosture(declaredTarget, classification).cloudAllowed) {
    return { kind: 'any' };
  }
  return { kind: 'residential', ...preferred };
}

/**
 * DOES THIS ACCOUNT HAVE ANY MACHINE AT ALL - asked of the LISTING, which is the only thing that can
 * answer it, and answered only when the listing exists.
 *
 * `egressCandidatesForOrg` returns every NON-REVOKED pairing in the org, live or not, so an empty
 * array is not "everyone is asleep": it is "there is nothing to wake". `null` is the other empty
 * answer - no listing was obtained - and it is not an answer to this question at all.
 */
function fleetIsKnownEmpty(input: LocalityInput): boolean {
  return input.candidates !== null && input.candidates.length === 0;
}

/**
 * WHAT A PERSON IS TOLD WHEN THEIR ACCOUNT HAS NO MACHINE IN IT.
 *
 * Every other refusal in this module says a machine is not CONNECTED, which is an instruction: go
 * and start it. That instruction is a lie to an owner who has none, and the halt carrying it was the
 * neutral one, so a schedule repeated the lie nightly and forever. This names the act that actually
 * exists - pair a machine - and the halt carrying it is terminal.
 *
 * It names BOTH acts because the case that produces it most often is a solo tenant who revoked their
 * only laptop AFTER establishing a session on it: pairing a replacement is necessary and not
 * sufficient, since the session is still bound to hardware that is gone.
 *
 * NOT EXPORTED, unlike `SESSION_MACHINE_RETIRED_REASON` next door: that one has a second producer in
 * `engine.ts` and must be one string; this one is emitted here and nowhere else. The census in
 * `tests/automation/locality.test.ts` compares it as a LITERAL on purpose, so re-wording what the
 * product tells people is a deliberate edit there rather than a silent drift.
 */
const NO_MACHINE_IN_ACCOUNT_REASON =
  'no machine is paired to your account, and this step runs only on one - ' +
  'pair a machine, then establish this session from it';

/**
 * Decide where this step runs.
 *
 * The order is the argument. The bridge is tried FIRST because a browser step's home is the owner's
 * machine - it has the real profile, the real IP and the real fingerprint, and every reason the
 * hosted browser exists is a fallback reason. Only when no usable bridge is available does posture
 * get asked whether the hosted browser may carry this origin at all, and the answer for anything
 * undeclared is no.
 */
export function resolveLocality(input: LocalityInput): LocalityVerdict {
  const requirement = egressRequirementFor({
    declaredTarget: input.declaredTarget,
    classification: input.classification,
    ...(input.preferredPairingId ? { preferredPairingId: input.preferredPairingId } : {}),
  });
  const resolution = resolveEgress(
    { requirement, offlinePolicy: input.offlinePolicy },
    input.candidates ?? [],
    input.actorOrg,
  );
  // WHO NAMED THE MACHINE decides how the refusal is worded. An `authorPin` is a literal the author
  // typed into the automation, so echoing it back is the most useful thing a message can do. The
  // ceremony PREFERENCE is an inference this module made from a stored session, and its pairing id
  // is an opaque UUID nothing in the product ever shows a user - printing it names nothing and
  // reads as a fault code, so those messages describe the machine and the way out instead.
  const authorPin = input.declaredTarget.kind === 'pinned' ? input.declaredTarget.pairingId : undefined;

  // ---- 1. The bridge ------------------------------------------------------------------------
  if (input.daemonConnected) {
    const pinned = requirement.kind === 'residential' ? requirement.pairingId : undefined;
    // A NAMED machine and a connected daemon that is not it: this is the P4.2 refusal. Running the
    // step here would be silently substituting a foreign machine for the one the session was made
    // on, which is precisely the swap the preference exists to prevent. A connection with no
    // `pairingId` cannot PROVE it is the right machine, and unprovable reads as no.
    if (!pinned || input.daemonPairingId === pinned) {
      return { kind: 'bridge', egress: bridgeEgressFor(input, requirement, resolution) };
    }
    // A machine IS dialled in, just not this one. Starting the right one clears this with nobody
    // touching the schedule, so it is neutral - and it stays neutral whatever the listing says,
    // because a connected daemon is itself proof that this account has hardware.
    return refuse(
      'start-a-machine',
      authorPin
        ? `this step is pinned to machine ${authorPin}; the machine currently connected is a different one`
        : 'this step must run on the machine where its session was established, and a different ' +
          'machine of yours is connected - start that machine, or establish this session again ' +
          'from the one you want to use',
    );
  }

  // ---- 2. AN ACCOUNT WITH NO MACHINE IN IT ---------------------------------------------------
  //
  // Placed HERE, after the bridge and before every "not connected" refusal below, because those
  // refusals are instructions to go and start something and this is the case where there is nothing
  // to start. `egressCandidatesForOrg` lists every non-revoked pairing in the org, live or not, so
  // an empty listing is not "all asleep" - it is "none exists".
  //
  // The listing does NOT decide whether the step needed a machine at all, so this cannot short
  // circuit the permissive/hosted path: it fires only when one of the refusals below would have.
  // That is why it is expressed as an adjustment to those branches rather than as a return of its
  // own - see `noMachineToStart`.
  const noMachineToStart = fleetIsKnownEmpty(input);
  /** The refusal to use when a "start your machine" halt is about to be issued to an empty fleet.
   *  NOT `establish-the-session`: nothing here knows that a session is even involved, and a
   *  credential halt for a step that declared no credential sends a person to the Cofre to fix
   *  something that is not broken. The act is pairing hardware, and the halt says so. */
  const noMachineInAccount = refuse('pair-a-machine', NO_MACHINE_IN_ACCOUNT_REASON);

  // ---- 3. The hosted browser, gated by POSTURE and not by the environment --------------------
  if (!input.classification.cloudEgressAllowed) {
    if (noMachineToStart) return noMachineInAccount;
    // No machine is connected, and this origin may not be carried by the hosted browser. The
    // OFFLINE POLICY has nothing to add here: `queue` and `fail` produce the same halt, because
    // there is no queue to join — the run stops and re-fires once a machine is back — and
    // `datacenter` cannot be honoured at all, since posture is what denied the datacenter in the
    // first place. Naming the machine when there is one is the difference between an instruction
    // and a shrug.
    const pinned = requirement.kind === 'residential' ? requirement.pairingId : undefined;
    // Every branch here is "no machine of yours is connected" - the environment, which the owner
    // fixes by opening a laptop rather than by establishing anything. (The owner who HAS no laptop
    // was answered above; reaching this line means the account has hardware.)
    return refuse(
      'start-a-machine',
      authorPin
        ? `this origin is ${input.classification.posture}: the step is pinned to machine ${authorPin}, ` +
          'and that machine is not connected'
        : pinned
          ? `this origin is ${input.classification.posture}: the step runs only on the machine where its ` +
            'session was established, and that machine is not connected'
          : `this origin is ${input.classification.posture}, so its browser steps run only on one of your ` +
            'machines, and none is connected',
    );
  }
  if (!input.inProcessFallbackEnabled) {
    if (noMachineToStart) return noMachineInAccount;
    return refuse('start-a-machine', 'no machine is connected and the in-process browser fallback is disabled');
  }

  // ---- 4. ...and the route out it gets -------------------------------------------------------
  switch (resolution.outcome) {
    case 'datacenter':
    case 'machine':
      return { kind: 'in-process', egress: resolution };
    case 'datacenter-fallback':
      // The RUN explicitly accepted the datacenter (`offlinePolicy: 'datacenter'`), and the origin
      // is permissive, so this is a declared choice rather than a silent substitution.
      return { kind: 'in-process', egress: resolution };
    case 'queue':
      // Literally "waiting for a machine": the run stops and re-fires once one is back. An account
      // with none has nothing to wait for, so the queue is not a queue.
      if (noMachineToStart) return noMachineInAccount;
      return refuse('start-a-machine', `waiting for a machine: ${resolution.reason}`);
    case 'refused':
    default:
      // The fleet cannot meet the declared requirement RIGHT NOW - a machine advertising
      // residential egress is missing, not retired. Registering or waking one clears it.
      if (noMachineToStart) return noMachineInAccount;
      return refuse('start-a-machine', resolution.reason);
  }
}

/**
 * ================================ WHAT THE RUN ITSELF HAS ALREADY DONE ================================
 *
 * `resolveLocality` judges the STEP LIST: a declaration, a posture, a fleet. Two facts it cannot see
 * belong to the RUN IN FLIGHT, and both can make a verdict that was correct when resolved wrong by
 * the time the step executes:
 *
 *   - the hosted browser has NAVIGATED. Posture is declared on an action and applies to the origin
 *     that action is about (`classifyOrigin`'s whole contract). A `browser` step acts, an act can
 *     navigate, and the next step inherits the same permissive label while the hosted Chromium now
 *     sits somewhere else - a bank portal reached by a click, an OAuth hop, a 302. The label was
 *     never about that host, so it does not license it.
 *   - the hosted context is already OPEN, for one route out. The proxy is a LAUNCH option, so a
 *     context cannot be re-pointed; reusing it for a step that resolved to a different door sends
 *     that step's traffic out of a door it did not resolve to.
 *
 * BOTH REFUSALS USED TO BE BUILT IN `engine.ts`, and both were wrong in the same way: they were
 * assembled outside this module, so the cross-product census in `tests/automation/locality.test.ts`
 * could not see them, and both carried `clearedBy: 'start-a-machine'` - the neutral halt - for
 * conditions that ARE PROPERTIES OF THE STEP LIST. Replaying produces the identical halt at the
 * identical index, so the schedule re-fired forever, uncounted, printing a remediation ("start a
 * machine") that named nothing wrong with any machine. They live here now, they are pure, and they
 * name `edit-the-automation`.
 */
export interface RunSoFar {
  /**
   * The URL the hosted browser is on, or null when it has not observed one. RAW, not a host: the
   * parse belongs beside the comparison, so a URL this module cannot read answers "nothing to
   * compare" rather than reading as a mismatch somewhere else.
   */
  liveUrl: string | null;
  /** The bare host this step's declaration is ABOUT (`resolveStepOrigin`), or null when none resolved. */
  declaredOrigin: string | null;
  /** The route the hosted context was LAUNCHED for, or null when this run has not opened one. */
  openedRoute: EgressResolution | null;
}

/**
 * Narrow a step-list verdict against what THIS RUN has already done. Returns the verdict unchanged
 * when neither fact bites, which is the overwhelmingly common case.
 *
 * DRIFT IS CHECKED FIRST, preserving the order the engine had: a session sitting on an undeclared
 * host is the more specific complaint, and the route it would have taken is beside the point once
 * the destination is wrong.
 *
 * BOTH ARE CHECKED ONLY FOR THE HOSTED ROUTE. On a machine of the owner's there is no substitution
 * to make - the work leaves by that machine's line wherever it navigates - and no launch option to
 * be stuck with. NAMED LIMITATION, not a claim of completeness: the drift check stops the steps
 * AFTER the drift, never the act that drifts (docs/findings.md).
 */
export function narrowLocalityForRun(verdict: LocalityVerdict, run: RunSoFar): LocalityVerdict {
  if (verdict.kind !== 'in-process') return verdict;

  // A step whose origin never resolved got `classifyOrigin('')`, which is CLOSED, so it is not
  // `in-process` and cannot reach here in production. Answered explicitly anyway: there is nothing
  // to have drifted FROM, and a live host compared against nothing is not a mismatch.
  const declared = run.declaredOrigin;
  const live = declared ? hostOf(run.liveUrl) : null;
  if (declared && live && live !== declared) {
    return refuse(
      // NOT `start-a-machine`, which is what this said for six rounds. Nothing about a machine is
      // wrong; the automation navigates somewhere its declarations never spoke about, and it will do
      // so again on the next fire. (A machine happening to be connected next time WOULD sidestep it,
      // by making the verdict `bridge` before this check runs - but that is an accident of the
      // route, not the remediation, and it is unavailable to the owner who has no machine at all.)
      'edit-the-automation',
      `this run's hosted browser is on ${live}, which is not the origin this step's posture was ` +
        `declared for (${declared}) - it will not carry a step onto an undeclared site. ` +
        'Declare the origin this automation actually reaches, or keep the run on the declared one.',
    );
  }

  if (run.openedRoute && !sameRoute(run.openedRoute, verdict.egress)) {
    return refuse(
      'edit-the-automation',
      'this step needs a different route out of the network than the one this run already opened, ' +
        'and the proxy is a launch option that cannot be re-pointed - declare one route for the ' +
        'whole run, or split these steps into separate automations',
    );
  }
  return verdict;
}

/**
 * The bare host of a live page URL. Unparseable (or absent) answers null, which the caller reads as
 * "nothing to compare" rather than as a mismatch: a browser that has not navigated anywhere yet
 * (`about:blank`, an empty string) has not drifted off anything.
 */
function hostOf(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * THE ROUTE THE BRIDGE ITSELF LEAVES BY - which is a different question from the one `resolveEgress`
 * answered above, and the one this module used to get wrong.
 *
 * WHAT WAS WRONG. `resolveEgress` chooses a machine to PROXY THROUGH: given `{ kind: 'residential' }`
 * with no pairing it takes `usable[0]`, the first live candidate advertising residential egress. For
 * the hosted browser that is exactly right - nothing else names a machine. For the BRIDGE it is a
 * fiction: the work is going to run on the machine that is dialled in, on that machine's line, and
 * no arbitrary pick from the fleet changes it. With `pair_office` listed first and `pair_home`
 * connected, the verdict claimed a route through `pair_office` while every byte of work left from
 * `pair_home` - and the one consumer of this field routes a LOGIN through it, so the password went
 * out of one household's line and the session was then used from another's.
 *
 * SO THE REQUIREMENT NAMES THE CONNECTED MACHINE, and the answer is about that machine only:
 * `machine` when it advertises a usable residential endpoint, `refused` when it does not.
 *
 * `offlinePolicy` IS DELIBERATELY NOT CONSULTED - it is hard-coded to `fail`. The offline policy
 * answers "what should the RUN do when it cannot get the route it wants", and that question is
 * already settled here: the run is going to proceed, on the bridge, because a machine is connected.
 * The only thing left to decide is whether a route can be NAMED, and `queue` (there is nothing to
 * wait for) and `datacenter` (which would hand the typist a door the work is not using - the exact
 * hazard) are both wrong answers to it.
 *
 * A `refused` outcome here is NOT a halt. The verdict stays `bridge` and the work runs; what it
 * costs is the hosted typist's permit (`hostedTypistPermitFor`), because a login has nowhere to go
 * that matches.
 */
function bridgeEgressFor(
  input: LocalityInput,
  requirement: EgressRequirement,
  resolution: EgressResolution,
): EgressResolution {
  // Nothing was asked of the route out (a permissive origin's default `any`). There is no door to
  // match, so the resolution stands as it is - `datacenter`, meaning "no requirement".
  if (requirement.kind !== 'residential') return resolution;
  if (!input.daemonPairingId) {
    // The seam handed back a connection that cannot say which machine it is (`pairingId` is
    // optional on `DaemonConnection`). Unprovable reads as no, here as everywhere else in this
    // module: an unnamed machine's line cannot be named either.
    return {
      outcome: 'refused',
      reason: 'the connected machine does not identify itself, so the line it leaves by cannot be named',
    };
  }
  return resolveEgress(
    { requirement: { kind: 'residential', pairingId: input.daemonPairingId }, offlinePolicy: 'fail' },
    input.candidates ?? [],
    input.actorOrg,
  );
}

/**
 * MAY THE HOSTED TYPIST TYPE THIS STEP'S PASSWORD, AND THROUGH WHICH DOOR?
 *
 * `undefined` means NO HOSTED BROWSER AT ALL for this step: `credential-gate.ts` reads an absent
 * `hostedBrowser` as "the typist is unreachable" and halts asking for a person. `{}` means the
 * hosted browser with no proxy - the datacenter. `{ egress }` means through that route.
 *
 * ONE RULE, AND IT IS THE WHOLE FUNCTION: THE LOGIN LEAVES BY THE SAME DOOR AS THE WORK. A portal
 * that sees a password submitted from a datacenter and the resulting session used from a home line
 * (or from two different homes) is being shown two identities for one account, which is the
 * detection event this slice exists to prevent - and it is worse than the ordinary substitution,
 * because the act that diverges is the one that hands over the secret.
 *
 * WITHHOLDING IS THE CLOSED ANSWER, and it is available: a step whose login cannot be typed through
 * the right door halts asking for a person, which is a state the product already has, already
 * surfaces, and a person can already act on. Typing it through the wrong door is not.
 */
export function hostedTypistPermitFor(verdict: LocalityVerdict | null): { egress?: EgressResolution } | undefined {
  // No browser-needing step in flight - an `integration` or `api_call` step, which resolves no
  // locality at all. Nothing decided a door for the work, so there is none to diverge from and the
  // typist behaves exactly as it did before locality existed.
  if (!verdict) return {};
  switch (verdict.kind) {
    case 'in-process':
      // Work and login are both hosted, and this IS the work's route. Same door by construction.
      return { egress: verdict.egress };
    case 'bridge':
      switch (verdict.egress.outcome) {
        case 'machine':
          // The work runs ON that machine; proxying the login through its line is the same door.
          return { egress: verdict.egress };
        case 'datacenter':
          // Nothing was required of the route out, so nothing is diverged from. The origin is
          // permissive (posture is what let the typist be considered at all), which is precisely
          // the declaration that a datacenter IP is acceptable here.
          return {};
        default:
          // A residential line WAS required - an author's pin, a declared `egress.residential`, or
          // an adversarial origin's ceremony machine - and the connected machine cannot provide
          // one. Every route left is a different door from the work's, so there is no permit.
          return undefined;
      }
    case 'blocked':
    default:
      // Not reachable from the run loop (a refused step never reaches the gate at all), and the
      // closed answer regardless: a step that is not going to run gets no password typed for it.
      return undefined;
  }
}

/**
 * Do two resolutions put traffic on the SAME route out?
 *
 * A browser session is created once per run and then reused across steps, so a later step can
 * inherit a context that was launched for an earlier step's route. Two steps that resolve
 * differently must not share one: the proxy is a launch option, and a context launched for the
 * datacenter cannot be re-pointed at a machine afterwards.
 *
 * PRIVATE. It used to be exported, and its only external caller was a suite asserting the predicate
 * on four hand-built resolutions - which proved the comparison and not the refusal. The decision it
 * serves is `narrowLocalityForRun`, one screen up, and that is what the suite drives now.
 */
function sameRoute(a: EgressResolution, b: EgressResolution): boolean {
  if (a.outcome === 'machine' || b.outcome === 'machine') {
    return a.outcome === 'machine' && b.outcome === 'machine' && a.proxyUrl === b.proxyUrl;
  }
  // Every other outcome leaves by the datacenter (or does not leave at all), so they interchange.
  return true;
}
