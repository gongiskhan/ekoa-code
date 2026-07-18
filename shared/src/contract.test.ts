import { describe, it, expect } from 'vitest';
import {
  ALL_ENDPOINTS,
  allEndpointsFlat,
  ErrorEnvelope,
  ERROR_STATUS,
  SSE_STREAMS,
} from './index.js';

/**
 * G0 contract skeleton (ch03 §3.12, ch13 §13.5). Asserts the shared/ contract is
 * well-formed and covers the ch03 map at the structural level. Deep per-endpoint
 * validation lands with the contract suite from G2 onward.
 */
describe('shared contract', () => {
  it('loads all 28 domain descriptor maps', () => {
    // 24 rc-1 domains + credentials (F2, batch1) + changeRequests (operator-run H4)
    // + gatewayKeys (cortex-gateway S4a - landed without bumping this count; reconciled here)
    // + sheets (mega-run B1, decision B.B).
    expect(Object.keys(ALL_ENDPOINTS).length).toBe(28);
  });

  it('every endpoint descriptor is well-formed', () => {
    for (const e of allEndpointsFlat()) {
      expect(e.method, `${e.domain}.${e.name} method`).toMatch(/^(GET|POST|PUT|PATCH|DELETE)$/);
      expect(e.path, `${e.domain}.${e.name} path`).toMatch(/^\//);
      expect(e.auth, `${e.domain}.${e.name} auth`).toBeTruthy();
    }
  });

  it('exactly four web-client SSE streams (CONV-4)', () => {
    // The four sanctioned SSE endpoints under /api/v1 for web clients. The P-18 TUI
    // compatibility channel (GET /api/v1/events) is excluded — it is TUI-only (ch03 §3.10).
    const sse = allEndpointsFlat().filter(
      (e) => e.kind === 'sse' && e.path.startsWith('/api/v1') && e.path !== '/api/v1/events',
    );
    const paths = sse.map((e) => e.path).sort();
    expect(paths).toEqual(
      [
        '/api/v1/automations/runs/:id/events',
        '/api/v1/chat/runs/:id/events',
        '/api/v1/jobs/:id/events',
        '/api/v1/notifications/events',
      ].sort(),
    );
    expect(SSE_STREAMS.length).toBe(4);
  });

  it('no retired transport endpoints except the P-18 TUI channel (ch03 acceptance 8)', () => {
    const retired = ['/api/v1/action', '/api/v1/request', '/api/v1/request/cancel'];
    const paths = allEndpointsFlat().map((e) => e.path);
    for (const r of retired) expect(paths).not.toContain(r);
  });

  it('no teams route (ch03 acceptance 9)', () => {
    const paths = allEndpointsFlat().map((e) => e.path);
    expect(paths.some((p) => p.includes('/teams'))).toBe(false);
  });

  it('the Amendment 2 org/registo/settings routes are present (ch03 acceptance 9)', () => {
    const paths = allEndpointsFlat().map((e) => e.path);
    for (const p of ['/api/v1/org', '/api/v1/orgs', '/api/v1/registo', '/api/v1/settings/me']) {
      expect(paths, p).toContain(p);
    }
  });

  it('error envelope validates and every code maps to a status (ch03 acceptance 10)', () => {
    const parsed = ErrorEnvelope.safeParse({
      error: { code: 'ACCOUNT_DISABLED', message: 'A sua conta está bloqueada.' },
    });
    expect(parsed.success).toBe(true);
    expect(ERROR_STATUS.ACCOUNT_DISABLED).toBe(403);
    expect(ERROR_STATUS.BILLING_LOCKED).toBe(402);
  });

  it('POST /jobs accepts only build kind, not brand-research (ch03 §3.8.8)', async () => {
    const { JobCreateRequest } = await import('./jobs.js');
    expect(JobCreateRequest.safeParse({ kind: 'build', description: 'x', sessionId: 's' }).success).toBe(true);
    expect(JobCreateRequest.safeParse({ kind: 'brand-research', description: 'x', sessionId: 's' }).success).toBe(false);
  });

  it('TriggerCreateRequest accepts both spec-shaped variants (ch03 §3.8.17, landmine 2)', async () => {
    const { TriggerCreateRequest } = await import('./triggers.js');
    // automation target — flat, no `kind`, no `target`
    expect(
      TriggerCreateRequest.safeParse({ automationId: 'a', integrationKey: 'k', eventName: 'e' }).success,
    ).toBe(true);
    // artifact-backend target — nested target.kind
    expect(
      TriggerCreateRequest.safeParse({
        integrationKey: 'k',
        eventName: 'e',
        target: { kind: 'artifact-backend', artifactId: 'x', entrypoint: 'main' },
      }).success,
    ).toBe(true);
  });

  it('language default applies when omitted (ch03 §3.4)', async () => {
    const { ChatRunCreateRequest } = await import('./chat.js');
    const parsed = ChatRunCreateRequest.parse({ sessionId: 's', message: 'olá' });
    expect(parsed.language).toBe('pt');
  });

  it('NotificationEvent can represent the ready stream-open ack (ch03 §3.6)', async () => {
    const { NotificationEvent } = await import('./events.js');
    expect(NotificationEvent.safeParse({ type: 'ready' }).success).toBe(true);
    expect(NotificationEvent.safeParse({ type: 'usage_updated' }).success).toBe(true);
  });

  it('NotificationEvent can represent the post-run reply_summary (mega-run B2, decision B.E)', async () => {
    const { NotificationEvent } = await import('./events.js');
    expect(
      NotificationEvent.safeParse({
        type: 'reply_summary',
        sessionId: 's1',
        sheetId: 'sheet-m1',
        revisionId: 'rev-m1',
        title: 'Minuta de contrato',
        summary: 'Estrutura de um contrato de arrendamento habitacional.',
      }).success,
    ).toBe(true);
    // The routing/linkage fields are required - a summary that cannot be routed to its
    // session/sheet/revision is not representable.
    expect(NotificationEvent.safeParse({ type: 'reply_summary', title: 't', summary: 's' }).success).toBe(false);
    // B5: revision turns carry the optional 1-based ordinal (fresh turns omit it; a
    // non-positive one is not representable).
    expect(
      NotificationEvent.safeParse({
        type: 'reply_summary',
        sessionId: 's1',
        sheetId: 'sheet-m1',
        revisionId: 'r2',
        title: 'Tom mais formal',
        summary: 'A despedida ficou formal.',
        revision: 2,
      }).success,
    ).toBe(true);
    expect(
      NotificationEvent.safeParse({
        type: 'reply_summary',
        sessionId: 's1',
        sheetId: 'sheet-m1',
        revisionId: 'r2',
        title: 't',
        summary: 's',
        revision: 0,
      }).success,
    ).toBe(false);
  });

  it('ChatRunEvent and JobEvent can represent the B7 text_reset retraction (payload-free)', async () => {
    const { ChatRunEvent, JobEvent } = await import('./events.js');
    // The retraction is the ONLY authorized deletion signal for already-streamed answer text:
    // both live-answer streams (chat run + build job) must be able to carry it.
    expect(ChatRunEvent.safeParse({ type: 'text_reset' }).success).toBe(true);
    expect(JobEvent.safeParse({ type: 'text_reset' }).success).toBe(true);
  });

  it('ChatRunCreateRequest accepts the B5 reviseSheetId (optional; empty string rejected)', async () => {
    const { ChatRunCreateRequest } = await import('./chat.js');
    expect(ChatRunCreateRequest.safeParse({ sessionId: 's', message: 'torna mais curto', reviseSheetId: 'sheet-m1' }).success).toBe(true);
    expect(ChatRunCreateRequest.safeParse({ sessionId: 's', message: 'olá' }).success).toBe(true);
    expect(ChatRunCreateRequest.safeParse({ sessionId: 's', message: 'x', reviseSheetId: '' }).success).toBe(false);
  });

  it('ChatRunCreateRequest accepts the C7 voice-source signal (optional literal "voice"; any other value rejected)', async () => {
    const { ChatRunCreateRequest } = await import('./chat.js');
    expect(ChatRunCreateRequest.safeParse({ sessionId: 's', message: 'qual é o prazo', source: 'voice' }).success).toBe(true);
    expect(ChatRunCreateRequest.safeParse({ sessionId: 's', message: 'olá' }).success).toBe(true); // absent = ordinary run
    expect(ChatRunCreateRequest.safeParse({ sessionId: 's', message: 'x', source: 'text' }).success).toBe(false);
    expect(ChatRunCreateRequest.safeParse({ sessionId: 's', message: 'x', source: '' }).success).toBe(false);
  });

  it('AutomationRunEvent step: parses both a thin legacy event and an enriched one (§3.6.3)', async () => {
    const { AutomationRunEvent } = await import('./events.js');
    // A pre-enrichment client emitted only the thin core — it must still validate (old clients stay valid).
    expect(
      AutomationRunEvent.safeParse({ type: 'step', runId: 'r', stepIndex: 0, status: 'running' }).success,
    ).toBe(true);
    // The enriched event carries every OPTIONAL field the run UI reads.
    expect(
      AutomationRunEvent.safeParse({
        type: 'step',
        runId: 'r',
        stepIndex: 2,
        status: 'failed',
        stepId: 's2',
        tier: 'vision',
        error: 'a página não corresponde ao resultado esperado',
        screenshotUrl: '/automation-screenshots/auto/run/step-2.png',
        output: { kind: 'local_command', stdout: '', stderr: '', exitCode: 1 },
        durationMs: 900,
      }).success,
    ).toBe(true);
  });

  it('RunRecord carries optional per-step outcomes with a served screenshotUrl (§3.6.3)', async () => {
    const { RunRecord } = await import('./automations.js');
    const parsed = RunRecord.safeParse({
      id: 'run-1',
      automationId: 'auto-1',
      status: 'completed',
      steps: [
        { stepId: 's1', index: 0, status: 'completed', tier: 'cache', durationMs: 12, screenshotUrl: '/automation-screenshots/auto-1/run-1/step-0.png' },
        { stepId: 's2', index: 1, status: 'failed', tier: 'vision', durationMs: 30, error: { message: 'falhou', recoverable: true } },
      ],
    });
    expect(parsed.success).toBe(true);
    // A legacy stepless record still validates (steps optional).
    expect(RunRecord.safeParse({ id: 'r', automationId: 'a', status: 'running' }).success).toBe(true);
  });

  it('no auth cell carries a bare "admin" class (ch03 acceptance 11)', () => {
    for (const e of allEndpointsFlat()) {
      expect(['public', 'user', 'org-admin', 'super-admin', 'token-query', 'hmac', 'header-scoped', 'optional-jwt', 'app-id-gated', 'bridge']).toContain(e.auth);
    }
  });
});

/**
 * G12 security phase - contract-level egress/injection guards (the shared/ Codex scope).
 * Each test pins a fix so the class is machine-caught forever (the determinism ratchet).
 */
describe('shared contract - security ratchet (G12)', () => {
  it('the error envelope details is bounded to plain JSON - non-JSON internal objects cannot validate', () => {
    // Accidental internal objects (a Date, a Buffer, a bigint) in details are exactly the
    // careless-`sendError` leak shapes; the JsonValue bound rejects them at the contract boundary
    // (ch09 §9.3 invariant 2 is the runtime control; this makes the contract test a guard too).
    const buf = { error: { code: 'INTERNAL', message: 'x', details: { blob: Buffer.from('secret') } } };
    expect(ErrorEnvelope.safeParse(buf).success).toBe(false);
    const date = { error: { code: 'INTERNAL', message: 'x', details: { at: new Date() } } };
    expect(ErrorEnvelope.safeParse(date).success).toBe(false);
    const big = { error: { code: 'INTERNAL', message: 'x', details: { n: 10n } } };
    expect(ErrorEnvelope.safeParse(big).success).toBe(false);
    // legitimate structured details (validation issues, a billingUrl) still pass
    const okDetails = { error: { code: 'VALIDATION_FAILED', message: 'x', details: { issues: [{ code: 'invalid_type', path: ['a'], message: 'req' }], billingUrl: 'https://x' } } };
    expect(ErrorEnvelope.safeParse(okDetails).success).toBe(true);
  });

  it('AuthUser is strict - a passwordHash-bearing object cannot validate as an AuthUser (no secret leak)', async () => {
    const { AuthUser } = await import('./auth.js');
    const base = { id: 'u1', username: 'a', role: 'user', orgId: 'o1', active: true };
    expect(AuthUser.safeParse(base).success).toBe(true);
    expect(AuthUser.safeParse({ ...base, passwordHash: '$2b$...' }).success).toBe(false);
    expect(AuthUser.safeParse({ ...base, resetToken: 'deadbeef' }).success).toBe(false);
  });

  it('session-capture responses carry status metadata only, never the captured storageState', async () => {
    const { SessionCaptureStatus, ConnectSessionResponse } = await import('./integrations.js');
    expect(SessionCaptureStatus.safeParse({ status: 'ok', session: { status: 'captured', capturedAt: '2026-07-08T00:00:00Z' } }).success).toBe(true);
    // a raw Playwright storageState (cookies) is not a legal session snapshot
    expect(
      SessionCaptureStatus.safeParse({ status: 'ok', session: { cookies: [{ name: 'sid', value: 'secret' }] } }).success,
    ).toBe(false);
    expect(ConnectSessionResponse.safeParse({ started: true, session: { status: 'waiting_login' } }).success).toBe(true);
    expect(ConnectSessionResponse.safeParse({ started: true, session: { storageState: { cookies: [] } } }).success).toBe(false);
  });

  it('DelegatedTask signing bytes are injective - a non-finite egress budget cannot be signed (§18.1)', async () => {
    const { DelegatedTask, canonicalTaskBinding } = await import('./ekoa-local.js');
    const base = {
      taskId: 't', org: 'o', user: 'u', session: 's', pairingId: 'p', grantRefs: ['g'],
      task: 'read', budget: { egressBytes: 1000, modelSpend: { userId: 'u' } }, expiry: '2026-07-08T00:00:00Z', nonce: 'n', sig: 'x',
    };
    expect(DelegatedTask.safeParse(base).success).toBe(true);
    // an Infinity egress cap is rejected at the schema boundary (would canonicalise to `null`)
    expect(DelegatedTask.safeParse({ ...base, budget: { egressBytes: Infinity, modelSpend: { userId: 'u' } } }).success).toBe(false);
    // and the canonicaliser refuses a non-finite number defensively
    expect(() => canonicalTaskBinding({ ...base, budget: { egressBytes: Infinity, modelSpend: { userId: 'u' } } } as never)).toThrow(/non-finite/);
    // two distinct finite budgets produce distinct signing bytes (injective)
    const a = canonicalTaskBinding({ ...base, budget: { egressBytes: 1000, modelSpend: { userId: 'u' } } });
    const b = canonicalTaskBinding({ ...base, budget: { egressBytes: 2000, modelSpend: { userId: 'u' } } });
    expect(a).not.toBe(b);
  });

  it('voice WS unions represent every relay message both directions (mega-run C1) and stay off the REST surface', async () => {
    const {
      VoiceSttClientMessage, VoiceSttServerMessage, VoiceTtsClientMessage, VoiceTtsServerMessage,
      VOICE_STT_WS_PATH, VOICE_TTS_WS_PATH,
    } = await import('./voice.js');
    // A WS carve-out like streaming/: schemas + path constants, NO descriptor-map domain.
    expect(VOICE_STT_WS_PATH).toBe('/api/voice/stream');
    expect(VOICE_TTS_WS_PATH).toBe('/api/voice/tts-stream');
    expect(allEndpointsFlat().some((e) => e.path.startsWith('/api/voice'))).toBe(false);

    // STT: every relay-emitted shape parses; audio is binary and deliberately NOT in the union.
    for (const msg of [
      { type: 'ready', sessionId: 's1', sampleRate: 16000, utteranceEndMs: 1200, sttProvider: 'stub' },
      { type: 'speech_started' },
      { type: 'transcript', text: 'Olá', isFinal: false, speechFinal: false },
      { type: 'transcript', text: 'Olá, bom dia.', isFinal: true, speechFinal: true },
      { type: 'utterance_end', transcript: 'Olá, bom dia.' },
      { type: 'error', code: 'VOICE_TIMEOUT', message: 'Sessão de voz terminada por inatividade.' },
    ]) expect(VoiceSttServerMessage.safeParse(msg).success, JSON.stringify(msg)).toBe(true);
    expect(VoiceSttClientMessage.safeParse({ type: 'close_stream' }).success).toBe(true);
    expect(VoiceSttServerMessage.safeParse({ type: 'audio', data: 'AAAA' }).success).toBe(false);

    // C2: turn_committed annotates the last finished turn with its chat-message REF (never
    // text); an empty ref is not a ref.
    expect(VoiceSttClientMessage.safeParse({ type: 'turn_committed', transcriptMessageId: 'm1', mode: 'talking' }).success).toBe(true);
    expect(VoiceSttClientMessage.safeParse({ type: 'turn_committed', transcriptMessageId: 'm1' }).success).toBe(true);
    expect(VoiceSttClientMessage.safeParse({ type: 'turn_committed', transcriptMessageId: '' }).success).toBe(false);
    expect(VoiceSttClientMessage.safeParse({ type: 'turn_committed', transcriptMessageId: 'm1', mode: 'shouting' }).success).toBe(false);

    // TTS: say/clear up; ready/speaking/audio_end/cleared/error down. Barge-in is {clear}.
    expect(VoiceTtsClientMessage.safeParse({ type: 'say', text: 'Olá.', lang: 'pt-PT', turnId: 't1' }).success).toBe(true);
    // C2: say may carry the spoken sheet's ref for the voice.tts audit row.
    expect(VoiceTtsClientMessage.safeParse({ type: 'say', text: 'Olá.', lang: 'pt-PT', sheetId: 'sh1' }).success).toBe(true);
    expect(VoiceTtsClientMessage.safeParse({ type: 'clear' }).success).toBe(true);
    expect(VoiceTtsClientMessage.safeParse({ type: 'say', text: '', lang: 'pt-PT' }).success).toBe(false);
    expect(VoiceTtsClientMessage.safeParse({ type: 'say', text: 'Hi', lang: 'fr' }).success).toBe(false);
    for (const msg of [
      { type: 'ready', sessionId: 's1' },
      { type: 'speaking', turnId: 't1', lang: 'en', ttsProvider: 'stub' },
      { type: 'audio_end', turnId: 't1' },
      { type: 'cleared', turnId: 't1' },
      { type: 'cleared' },
      { type: 'error', code: 'VOICE_PROVIDER_ERROR', message: 'Erro no serviço de voz. Tente novamente.' },
    ]) expect(VoiceTtsServerMessage.safeParse(msg).success, JSON.stringify(msg)).toBe(true);
  });

  it('RegistoEntry represents the voice vocabulary rows with their usageCounts (mega-run C2)', async () => {
    const { RegistoEntry, RegistoListResponse } = await import('./registo.js');
    // A5 vocabulary memo: voice.turn carries voice_stt_ms, voice.tts carries voice_tts_chars -
    // usageCounts keys reuse the metering counter names VERBATIM; metadata is refs only.
    const turn = {
      actor: 'u1', username: 'ana', actionType: 'voice.turn', timestamp: '2026-07-18T10:00:00.000Z',
      targetIds: ['sess-1', 'msg-42'],
      metadata: { source: 'voice', sessionId: 'sess-1', transcriptMessageId: 'msg-42', mode: 'talking', lang: 'pt-PT', turn: 1 },
      usageCounts: { voice_stt_ms: 61_500 },
      orgId: 'orgA',
    };
    const tts = {
      actor: 'u1', username: 'ana', actionType: 'voice.tts', timestamp: '2026-07-18T10:00:01.000Z',
      targetIds: ['sess-1'],
      metadata: { source: 'voice', sessionId: 'sess-1', provider: 'stub', lang: 'pt-PT', sheetId: 'sh1' },
      usageCounts: { voice_tts_chars: 87 },
      orgId: 'orgA',
    };
    for (const row of [turn, tts]) {
      expect(RegistoEntry.safeParse(row).success, JSON.stringify(row)).toBe(true);
    }
    expect(RegistoListResponse.safeParse({ items: [turn, tts], total: 2 }).success).toBe(true);
    // usageCounts is numeric amounts only - a stringly count is a shape defect, not data.
    expect(RegistoEntry.safeParse({ ...turn, usageCounts: { voice_stt_ms: '61500' } }).success).toBe(false);
  });

  it('PortalDocument/PortalEvent represent the E1 record shapes (mega-run E1, BRIEF §8)', async () => {
    const { PortalDocument, PortalEvent, PortalDossierRecordsResponse } = await import('./portal.js');
    const fileRef = { fileId: 'f1', appId: 'legal-dossie', url: '/api/app-files/legal-dossie/f1', mime: 'application/pdf', size: 12345 };
    const doc = {
      source: 'certidao-comercial',
      type: 'certidao-permanente',
      subjectIds: ['500000000'],
      retrievedAt: '2026-07-18T10:00:00.000Z',
      fileRef,
      parsed: { firma: 'Exemplo, Lda', nipc: '500000000' },
    };
    const watchHit = {
      source: 'citius-insolvencia',
      kind: 'watch.hit',
      subjectRef: 'Contraparte Lda',
      dossierRef: 'proc-1',
      observedAt: '2026-07-18T11:00:00.000Z',
      payload: { processo: '1234/26.0T8LSB', ato: 'Sentença' },
    };
    expect(PortalDocument.safeParse(doc).success).toBe(true);
    expect(PortalEvent.safeParse(watchHit).success).toBe(true);
    expect(PortalDossierRecordsResponse.safeParse({ documentos: [doc], eventos: [watchHit] }).success).toBe(true);

    // A closed enum (E1 pin: only the five open-data sources this run covers) - not free text.
    expect(PortalDocument.safeParse({ ...doc, source: 'portal-das-financas' }).success).toBe(false);
    // A document with no fileRef cannot represent an ATTACHED document.
    const { fileRef: _drop, ...docNoFile } = doc;
    expect(PortalDocument.safeParse(docNoFile).success).toBe(false);
  });

  it('signed-in connectors later EXTEND PortalDocument/PortalEvent (FLOW_PLAN structural decision) - an extended superset still parses', async () => {
    const { PortalDocument, PortalEvent } = await import('./portal.js');
    // A follow-up signed-in connector (Citius eTribunal, Portal das Finanças, ...) adds
    // fields the E1 shape never anticipated (a session ref, a listener id, ...); the
    // FLOW_PLAN decision is that this must never be a schema break - the shape is extended,
    // not redesigned.
    const extendedDoc = {
      source: 'certidao-comercial',
      type: 'certidao-permanente',
      subjectIds: ['500000000'],
      retrievedAt: '2026-07-18T10:00:00.000Z',
      fileRef: { fileId: 'f1', appId: 'legal-dossie', url: '/x', mime: 'application/pdf', size: 1 },
      sessionRef: 'browser-session-abc',
      submittedBy: 'oa-cert-123',
    };
    const extendedEvent = {
      source: 'citius-insolvencia',
      kind: 'watch.hit',
      subjectRef: 'Contraparte Lda',
      dossierRef: 'proc-1',
      observedAt: '2026-07-18T11:00:00.000Z',
      payload: {},
      pollRunId: 'run-9',
      listenerId: 'listener-1',
    };
    const parsedDoc = PortalDocument.safeParse(extendedDoc);
    const parsedEvent = PortalEvent.safeParse(extendedEvent);
    expect(parsedDoc.success).toBe(true);
    expect(parsedEvent.success).toBe(true);
    if (parsedDoc.success) expect((parsedDoc.data as typeof extendedDoc).sessionRef).toBe('browser-session-abc');
    if (parsedEvent.success) expect((parsedEvent.data as typeof extendedEvent).pollRunId).toBe('run-9');
  });

  it('PortalCertidaoRequest/Response represent POST /api/legal/portal/certidao (mega-run E2/E3, BRIEF §8 items 1-3)', async () => {
    const { PortalCertidaoRequest, PortalCertidaoResponse, PortalCertidaoSource } = await import('./portal.js');

    const req = { source: 'certidao-comercial', accessCode: 'CODE-1', processoId: 'proc-1', subjectIds: ['500000000'] };
    expect(PortalCertidaoRequest.safeParse(req).success).toBe(true);
    // subjectIds defaults to [] when omitted (a caller may retrieve before it knows the subject).
    const { subjectIds: _drop, ...reqNoSubjects } = req;
    const parsedNoSubjects = PortalCertidaoRequest.safeParse(reqNoSubjects);
    expect(parsedNoSubjects.success).toBe(true);
    if (parsedNoSubjects.success) expect(parsedNoSubjects.data.subjectIds).toEqual([]);

    // Only the three open-data sources this run's connectors cover - not the full PortalSource
    // enum (citius-insolvencia/dgsi/dre are not retrievable by this route).
    expect(PortalCertidaoSource.safeParse('certidao-predial').success).toBe(true);
    expect(PortalCertidaoSource.safeParse('citius-insolvencia').success).toBe(false);
    expect(PortalCertidaoRequest.safeParse({ ...req, source: 'citius-insolvencia' }).success).toBe(false);
    // accessCode/processoId are required, non-empty strings (VALIDATION_FAILED, never a
    // silent empty-string retrieval).
    expect(PortalCertidaoRequest.safeParse({ ...req, accessCode: '' }).success).toBe(false);
    expect(PortalCertidaoRequest.safeParse({ ...req, processoId: '' }).success).toBe(false);

    const res = {
      ok: true,
      source: 'certidao-comercial',
      record: { nome: 'Exemplo, Lda', nif: '500000000', formaJuridica: 'Sociedade por Quotas', capitalSocial: '5000', registos: [] },
      document: {
        source: 'certidao-comercial',
        type: 'Certidão permanente comercial',
        subjectIds: ['500000000'],
        retrievedAt: '2026-07-18T10:00:00.000Z',
        fileRef: { fileId: 'f1', appId: 'legal-dossie', url: '/api/app-files/legal-dossie/f1', mime: 'text/html', size: 1024 },
        parsed: { nif: '500000000' },
      },
    };
    expect(PortalCertidaoResponse.safeParse(res).success).toBe(true);
  });

  it('RegistoEntry represents the portal vocabulary rows (mega-run E1, A5 memo)', async () => {
    const { RegistoEntry } = await import('./registo.js');
    const retrieved = {
      actor: 'u1', username: 'ana', actionType: 'portal.document.retrieved', timestamp: '2026-07-18T10:00:00.000Z',
      targetIds: ['proc-1'],
      metadata: {
        dossierId: 'proc-1', source: 'certidao-comercial', type: 'certidao-permanente',
        subjectIds: ['500000000'],
        fileRef: { fileId: 'f1', appId: 'legal-dossie', url: '/x', mime: 'application/pdf', size: 1 },
      },
      orgId: 'org-a',
    };
    const watchHit = {
      actor: 'u1', username: 'ana', actionType: 'portal.watch.hit', timestamp: '2026-07-18T11:00:00.000Z',
      targetIds: ['proc-1'],
      metadata: { dossierId: 'proc-1', source: 'citius-insolvencia', kind: 'watch.hit', subjectRef: 'Contraparte Lda' },
      orgId: 'org-a',
    };
    for (const row of [retrieved, watchHit]) {
      expect(RegistoEntry.safeParse(row).success, JSON.stringify(row)).toBe(true);
    }
  });
});
