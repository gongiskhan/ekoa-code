/**
 * Sync outcome presentation (slice CS7) - the PURE mapping from `SyncStateView` to the words and
 * the visual weight the panel renders. No React, no transport: everything here is a function of
 * the shared contract, so the copy and the mapping are unit-testable without a DOM.
 *
 * WHY THIS FILE EXISTS AT ALL. The whole Citius workstream is built around one distinction:
 * "your inbox is fully synced" is not the same claim as "we could not prove we saw everything".
 * The API keeps those apart all the way down (`SyncOutcome` = complete | incomplete | failed, and
 * `verified-sync.ts` refuses to advance the watermark on anything but `complete`). If the UI
 * collapsed them - a soft amber "atenção" for both, or an INCOMPLETA that reads like a transient
 * warning - the entire two-pass machinery would have been built for nothing, because the lawyer
 * would act on a partial inbox as if it were whole. So the three outcomes get three different
 * SENTENCES, three different tones, and (in the panel) three different visual weights:
 *
 *   complete   - quiet. Good news should be boring; a green banner every day trains people to
 *                ignore banners.
 *   incomplete - LOUD. Notifications may be missing. This is the one state where a person has to
 *                do something with the information (wait for the re-sweep, or investigate).
 *   failed     - loud, but a DIFFERENT claim: the sync never ran, so nothing at all is known about
 *                completeness. Folding it into INCOMPLETA would tell the user "you may be missing
 *                notifications" when the honest statement is "we have no idea yet".
 *
 * Copy is PT-PT and inline, matching the Cofre page (the sibling operational surface, WS-D) rather
 * than the i18n locale files: these strings are load-bearing product copy for one flag-gated
 * surface, and a translation indirection would put the sentence a lawyer reads two files away from
 * the rule that chooses it.
 */
import type { SyncOutcome, SyncRunReport, SyncStateView } from '@ekoa/shared';

/** The four things the panel can be showing. `never` is "no run has been recorded yet". */
export type SyncOutcomeKind = SyncOutcome | 'never';

/** Visual weight, resolved into concrete classes by the panel. */
export type SyncOutcomeTone = 'success' | 'warning' | 'danger' | 'neutral';

export interface SyncOutcomePresentation {
  kind: SyncOutcomeKind;
  tone: SyncOutcomeTone;
  /** The state's name, exactly as the workstream names it. */
  label: string;
  /** One sentence: what this state MEANS for the user's inbox. */
  headline: string;
  /** What was and was not done to the data. */
  body: string;
  /** What happens next, so the state is actionable rather than merely alarming. */
  next: string;
  /** The evidence for a non-complete state (null for complete / never). */
  reason: string | null;
  /** Heading for the reason block. */
  reasonLabel: string | null;
  /** A repeated-failure signal, or null when this is the first one. */
  streakNote: string | null;
}

/**
 * Which outcome the panel shows, given a state row and its last report.
 *
 * THE RULE: `complete` is only ever shown when NOTHING disagrees with it. The state row's
 * `lastOutcome` and the embedded `latest.outcome` are written together by the api, so they should
 * always match - but "should always match" is exactly the assumption that turns a stale row into a
 * false all-clear. If either says something other than `complete`, that is what the user sees
 * (preferring the report, which is the more detailed record). Over-claiming completeness is the
 * one failure this whole surface exists to prevent; under-claiming it costs a re-sweep.
 */
export function resolveOutcomeKind(state: SyncStateView): SyncOutcomeKind {
  const fromReport = state.latest?.outcome;
  const fromRow = state.lastOutcome;
  if (!fromReport && !fromRow) return 'never';
  const disagreeing = [fromReport, fromRow].find((o) => o !== undefined && o !== 'complete');
  return disagreeing ?? 'complete';
}

/**
 * WHY the run came back incomplete, in the user's language, from the verification evidence.
 *
 * The order is the strength order of the proof, not a stylistic choice:
 *   1. a reference the second pass saw and the first did not - a PROVED miss, item by item;
 *   2. a count disagreement with what the portal itself advertised;
 *   3. a pass that stopped at the page bound, so the end of the inbox was never reached.
 * Anything else falls back to an honest "the check did not pass" rather than inventing a cause.
 */
export function incompleteReason(report: SyncRunReport | undefined): string {
  if (!report) return 'A verificação de completude não passou nesta leitura.';
  const { pass1, pass2, maxPages, countCheck } = report.verification;
  const missed = pass2.refsOnlyInPass2.length;
  if (missed > 0) {
    return missed === 1
      ? 'A segunda leitura encontrou 1 notificação que a primeira não tinha visto.'
      : `A segunda leitura encontrou ${missed} notificações que a primeira não tinha visto.`;
  }
  if (countCheck && !countCheck.match) {
    return `O portal indicava ${countCheck.pageTotal} notificações e só foram lidas ${countCheck.enumerated}.`;
  }
  if (!pass1.reachedEnd || !pass2.reachedEnd) {
    return `A leitura parou no limite de ${maxPages} ${maxPages === 1 ? 'página' : 'páginas'} e não chegou ao fim da caixa.`;
  }
  return 'A verificação de completude não passou nesta leitura.';
}

/** The failure's own words, when the transport left any. Never invented. */
export function failureReason(report: SyncRunReport | undefined): string {
  const error = report?.error?.trim();
  return error && error.length > 0 ? error : 'A leitura não chegou a terminar.';
}

function streakNote(kind: SyncOutcomeKind, state: SyncStateView): string | null {
  if (kind === 'incomplete' && state.consecutiveIncomplete >= 2) {
    return `É a ${state.consecutiveIncomplete}ª leitura incompleta seguida.`;
  }
  if (kind === 'failed' && state.consecutiveFailures >= 2) {
    return `É a ${state.consecutiveFailures}ª falha seguida.`;
  }
  return null;
}

export function presentSyncOutcome(state: SyncStateView): SyncOutcomePresentation {
  const kind = resolveOutcomeKind(state);
  const streak = streakNote(kind, state);

  if (kind === 'complete') {
    return {
      kind,
      tone: 'success',
      label: 'Completa',
      headline: 'A caixa está sincronizada.',
      body: 'Duas leituras seguidas viram exatamente as mesmas notificações, por isso não ficou nada por trazer.',
      next: 'A próxima sincronização continua a partir deste ponto.',
      reason: null,
      reasonLabel: null,
      streakNote: null,
    };
  }

  if (kind === 'incomplete') {
    return {
      kind,
      tone: 'warning',
      label: 'INCOMPLETA',
      headline: 'Podem faltar notificações nesta caixa.',
      body: 'As notificações que chegaram foram guardadas. O que não foi possível confirmar é que não tenha ficado alguma por trazer.',
      next: 'O ponto de leitura não avançou, de propósito: a próxima sincronização volta a varrer a partir do mesmo ponto, até haver uma leitura completa.',
      reason: incompleteReason(state.latest),
      reasonLabel: 'Porquê',
      streakNote: streak,
    };
  }

  if (kind === 'failed') {
    return {
      kind,
      tone: 'danger',
      label: 'Falhou',
      headline: 'A sincronização não chegou a correr.',
      body: 'Isto não quer dizer que faltem notificações: quer dizer que não houve leitura nenhuma. Nada foi guardado nem alterado.',
      next: 'O ponto de leitura ficou onde estava. Volte a tentar; se continuar a falhar, verifique a credencial do Citius no Cofre.',
      reason: failureReason(state.latest),
      reasonLabel: 'Detalhe',
      streakNote: streak,
    };
  }

  return {
    kind: 'never',
    tone: 'neutral',
    label: 'Sem sincronizações',
    headline: 'Esta caixa ainda não foi sincronizada.',
    body: 'Ainda não há nenhuma leitura registada, por isso não há nada a dizer sobre o que está ou não está na caixa.',
    next: 'A primeira sincronização vai buscar as notificações disponíveis no portal.',
    reason: null,
    reasonLabel: null,
    streakNote: null,
  };
}

/** `2026-08-03T11:42:00.000Z` -> `03/08/2026, 11:42`. Falls back to the raw value if unparseable. */
export function formatSyncMoment(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** `1` -> `1 notificação`, `0`/`2+` -> `N notificações`. */
export function notificationCount(n: number): string {
  return n === 1 ? '1 notificação' : `${n} notificações`;
}
