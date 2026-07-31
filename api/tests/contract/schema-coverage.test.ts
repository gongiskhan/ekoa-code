import { describe, it, expect } from 'vitest';
import { ALL_ENDPOINTS, allEndpointsFlat } from '@ekoa/shared';

/**
 * Schema-coverage gate (ch13 §13.5 item 3, §14.2.5). Every endpoint descriptor in `shared/`
 * is accounted for exactly once: either COVERED or PENDING (a committed allowlist of
 * not-yet-landed endpoints). The gate fails if any descriptor is in NEITHER list — so adding
 * an endpoint/schema to `shared/` without accounting for it is an automatic build failure
 * (the ch13 §13.11 item-5 deliberate-red mechanism). PENDING must SHRINK at every domain gate
 * and be EMPTY at G9.
 *
 * KNOWN LIMIT — this gate does NOT verify that a test exercises a COVERED endpoint. It asserts
 * only (a) every COVERED string names a real descriptor and (b) the PENDING count is the pinned
 * constant. COVERED is a hand-maintained CLAIM: adding a key with zero tests passes. ch13 §13.5
 * specifies a run-wide registry of actually-exercised schemas; that mechanism is not implemented.
 * This has already shipped real bugs twice — F22 (`memoryView` omitted required fields, /memory
 * rendered zero cards) and the sessions family (`sessionView` omitted createdAt/updatedAt and
 * emitted `title` for `name`; message bodies emitted `_id`/`timestamp` for `id`/`createdAt`) —
 * both while their keys sat in COVERED and no test ever requested the path. An audit on
 * 2026-07-10 found 27 of 154 COVERED keys unexercised (RUN_LOG). Do not read a green gate here
 * as evidence that an endpoint's body matches its schema.
 */

// Endpoints with a committed contract/e2e test now (G2 auth + G3 CRUD domains).
const COVERED = new Set<string>([
  'auth.login', 'auth.me',
  // Cofre (WS-B B-3) — exercised end-to-end by tests/contract/cofre.test.ts: every wire shape
  // validated through the REAL app, the VALUE proven write-only across the whole surface, and the
  // I6/I7 refusals asserted as proper 4xx envelopes rather than 500s.
  'cofre.cofreItemsList', 'cofre.cofreItemsCreate', 'cofre.cofreItemsDelete',
  'cofre.cofreItemGrant', 'cofre.cofreItemLock', 'cofre.cofreLockAll',

  // batch1 F1 — auth lifecycle (auth.test.ts)
  'auth.refresh', 'auth.logout', 'auth.changePassword', 'auth.deviceStart', 'auth.devicePoll', 'auth.deviceApprove',
  'users.list', 'users.create', 'users.update', 'users.remove', 'users.resetPassword',
  'org.getOrg', 'org.updateOrg', 'org.saveBranding', 'org.createOrg', 'org.listOrgs', 'org.patchOrg',
  // batch1 F4 — brand research at the contract path (branding.test.ts)
  'org.researchBranding',
  // F10 deny-list CRUD (batch-final s1) — exercised by tests/contract/denylist.test.ts
  'org.listDenyList', 'org.addDenyListEntry', 'org.removeDenyListEntry',
  'settings.get', 'settings.update', 'settings.updateMe',
  'sessions.create', 'sessions.list', 'sessions.get', 'sessions.update', 'sessions.delete', 'sessions.getMessages', 'sessions.addMessage',
  'memories.list', 'memories.get', 'memories.create', 'memories.update', 'memories.delete',
  'registo.listRegisto',
  'billing.getUsage', 'billing.getHistory',
  // G7 — billing metering write + admin surfaces (billing.test.ts)
  'billing.getBreakdown', 'billing.purchaseCredits', 'billing.toggleOverage', 'billing.adminGlobalOverage',
  'billing.adminListUsage', 'billing.adminResetUsage', 'billing.adminSetLimit',
  // G4 — integrations + knowledge (partial: configs CRUD + sources CRUD + uploads list)
  'integrations.listConfigs', 'integrations.createConfig', 'integrations.updateConfig', 'integrations.deleteSkill',
  'knowledge.listSources', 'knowledge.createSource', 'knowledge.deleteSource', 'knowledge.listUploads',
  // G7B — knowledge vault + lexical index (knowledge.test.ts)
  'knowledge.listCollections', 'knowledge.listDocuments', 'knowledge.createDocument', 'knowledge.deleteDocument',
  'knowledge.createUpload', 'knowledge.deleteUpload', 'knowledge.reindex', 'knowledge.indexStatus',
  // G5 — triggers + webhook ingress + notifications SSE
  'triggers.list', 'triggers.create', 'triggers.delete', 'triggers.webhookIngressPost', 'triggers.webhookIngressGet',
  'notifications.events',
  // G6 (data-plane core) — artifacts CRUD + the byte-compatible served-app data plane
  'artifacts.list', 'artifacts.get', 'artifacts.patch', 'artifacts.remove',
  'servedApp.appDataList', 'servedApp.appDataGet', 'servedApp.appDataCreate', 'servedApp.appDataUpsert', 'servedApp.appDataDelete',
  'servedApp.appSharedList', 'servedApp.appSharedGet', 'servedApp.appSharedCreate', 'servedApp.appSharedUpsert', 'servedApp.appSharedDelete',
  // G6 (full) — artifact family, backups, backend runtime, company-space (artifact-family.test.ts)
  'artifacts.fork', 'artifacts.export', 'artifacts.import', 'artifacts.bundleUpdate', 'artifacts.setFeatured',
  'artifacts.featuredUpdateApply', 'artifacts.featuredUpdateIgnore', 'artifacts.versionsList', 'artifacts.versionsRestore',
  'artifacts.filesList', 'artifacts.readFile', 'artifacts.writeFile', 'artifacts.download', 'artifacts.pdf',
  'artifacts.backupStatus', 'artifacts.backupSnapshot', 'artifacts.backupExport', 'artifacts.backupPreview', 'artifacts.backupRestore',
  'artifacts.backendStatus', 'artifacts.backendLogs', 'artifacts.backendInvocations', 'artifacts.backendSetEnabled', 'artifacts.backendSampleRun',
  'companySpace.list', 'companySpace.get', 'companySpace.start', 'companySpace.stop',
  // G6 — served-app files/sso/cloud/m365 (app-files.test.ts, app-sso.test.ts)
  'servedApp.appFileUpload', 'servedApp.appFileGet', 'servedApp.appFileDelete',
  'servedApp.appSsoLogin', 'servedApp.appSsoSetPassword', 'servedApp.appSsoLogout', 'servedApp.appSsoMe',
  'servedApp.appSsoSession',
  'servedApp.appSsoMicrosoftStart', 'servedApp.appSsoM365', 'servedApp.appCloudFilesStatus', 'servedApp.m365Proxy',
  // G6 — legal vertical services + e-sign (legal-plane.test.ts)
  'servedApp.legalCalculos', 'servedApp.legalTranscricao', 'servedApp.legalResearch', 'servedApp.trackingConsulta',
  'servedApp.citiusConsulta', 'servedApp.signatureSend', 'servedApp.adobeSignWebhookGet', 'servedApp.adobeSignWebhookPost',
  // 2B-S2 (Zoho Sign served-app proxy) - the deliberately public webhook GET/POST + the
  // /return bounce (zoho-sign.test.ts contract: router gate + webhook echo + return guard +
  // schema representability). Additive endpoints on the existing servedApp domain: covering
  // all three keeps EXPECTED_PENDING_COUNT unchanged (send/status/sign-url/document stay
  // router-internal like Adobe's status/send/agreements).
  'servedApp.zohoSignWebhookGet', 'servedApp.zohoSignWebhookPost', 'servedApp.zohoSignReturn',
  // 2C-S4 (App DOCX served-app plane) - status/projection/current/clean/edits, the served
  // document-base app's window onto its linked Word doc (contract: tests/contract/app-docx.test.ts
  // validates every 2xx body vs these schemas + the flat/envelope non-2xx precedent). Additive
  // endpoints on the existing servedApp domain: covering all five keeps EXPECTED_PENDING_COUNT
  // unchanged (they are outside /api/v1, so the mount-coverage walker auto-excludes them).
  'servedApp.appDocxStatus', 'servedApp.appDocxProjection', 'servedApp.appDocxCurrent',
  'servedApp.appDocxClean', 'servedApp.appDocxEdits',
  // 2C-S6 (ux-qa uxqa-1): the restore route - the recourse behind accept/reject, which
  // rewrite the working .docx in place with no Word-level undo.
  'servedApp.appDocxRestore',
  // G6 — serving plane + health + demos (served-app.test.ts)
  'servedApp.appHealth', 'servedApp.serveApp', 'servedApp.demoBridge', 'servedApp.demoAvailability',
  // G6 — integration definitions registry (integration-definitions.test.ts)
  'integrations.list', 'integrations.listActive', 'integrations.refresh',
  // G7B — agent execution: chat runs + build jobs (chat.test.ts, jobs.test.ts)
  'chat.createRun', 'chat.getRun', 'chat.runEvents', 'chat.cancelRun',
  'jobs.create', 'jobs.get', 'jobs.cancel', 'jobs.events',
  // batch1 F2 — model-credential provisioning (credentials.test.ts)
  'credentials.set',
  // batch1 F5 subset — the UI-called endpoints (memories.test.ts, f5-ui-endpoints.test.ts)
  'memories.bulkDelete', 'memories.submitSignal', 'memories.listTags', 'memories.stats',
  'knowledge.updateSource', 'knowledge.crawlSource', 'knowledge.crawlStatus', 'knowledge.refreshSchedule',
  'integrations.sessionStatus', 'integrations.connectSession', 'integrations.provisionAutomations',
  // PR4 — the AI integration builder (integration-builder.test.ts): chat/load/save/test.
  'integrationBuilder.chat', 'integrationBuilder.load', 'integrationBuilder.save', 'integrationBuilder.test',
  // Local-bridge consumer run s1 — hosted presence (bridge-status.test.ts)
  'ekoaLocal.bridgeStatus',
  // cortex-gateway S3 (run 20260717) — count_tokens forwarding, both paths
  // (llm-count-tokens.test.ts contract, real buildApp + stub transport). Additive endpoints:
  // covering both keeps EXPECTED_PENDING_COUNT unchanged.
  'ekoaLocal.llmCountTokens', 'ekoaLocal.llmCountTokensAlias',
  // cortex-gateway S4a (run 20260717) — per-user gateway keys, a NEW domain
  // (gateway-keys.test.ts contract: mint show-once / list no-secret / revoke + cross-user 404).
  'gatewayKeys.gatewayKeysMint', 'gatewayKeys.gatewayKeysList', 'gatewayKeys.gatewayKeysRevoke',
  // Local-bridge consumer run s5 — FC-408 masking summary (masking-summary.test.ts)
  'registo.maskingSummary',
  // operator-run H2 — served-app assistant admin detection (app-assistant.contract.test.ts +
  // the whoami route matrix in tests/apps/app-assistant.test.ts). Additive endpoint: covering it
  // keeps EXPECTED_PENDING_COUNT unchanged (assistantChat stays PENDING as before).
  'appAssistant.whoami',
  // operator-run H4 — the request-changes queue (change-requests.test.ts contract +
  // tests/routes/change-requests.test.ts integration). A NEW domain: covering all four keeps
  // EXPECTED_PENDING_COUNT unchanged.
  'changeRequests.file', 'changeRequests.list', 'changeRequests.convert', 'changeRequests.dismiss',
  // mega-run B1 (decision B.B) - session sheets, a NEW domain (sheets.test.ts contract:
  // derived list / rename / user revision + envelope + cross-user 404). Covering all three
  // keeps EXPECTED_PENDING_COUNT unchanged.
  'sheets.list', 'sheets.rename', 'sheets.createRevision',
  // mega-run E1 (Part E, portal connectors) - the dossiê portal-records read route
  // (legal-plane.test.ts contract: happy path + org-scoping + PT-PT refusals). Additive
  // endpoint on the existing servedApp domain: covering it keeps EXPECTED_PENDING_COUNT
  // unchanged.
  'servedApp.legalPortalDossier',
  // mega-run E2/E3 (Part E, certidão-by-access-code connectors) - the retrieval+attach
  // write route (legal-plane.test.ts contract: happy path + validation + bad-code 503 +
  // gate reuse; api/tests/legal/portal-connectors.test.ts: fetch/parse + attach unit
  // coverage). Additive endpoint on the existing servedApp domain: covering it keeps
  // EXPECTED_PENDING_COUNT unchanged.
  'servedApp.legalPortalCertidao',
  // mega-run E4 (Part E, insolvência watcher) - the manual poll route (legal-plane.test.ts
  // contract: happy path + idempotent re-poll + validation + gate reuse; api/tests/legal/
  // insolvencia-watch.test.ts: fetch/parse + poll unit coverage). Additive endpoint on the
  // existing servedApp domain: covering it keeps EXPECTED_PENDING_COUNT unchanged.
  'servedApp.legalPortalInsolvencyPoll',
  // slice E2 - memvault ("cortex memory"), a NEW domain (memvault.test.ts contract: JWT +
  // real-minted-gateway-key round trips, safeParse on every body, 404 uniformity;
  // tests/security/memvault-isolation.test.ts: traversal/symlink/cross-tenant). Covering all
  // four keeps EXPECTED_PENDING_COUNT unchanged.
  'memvault.writeNote', 'memvault.readNote', 'memvault.listNotes', 'memvault.deleteNote',
  // slice E3 - memvault search + export on the SAME domain (memvault.test.ts contract: the
  // search round trip safeParsed against NoteSearchResponse, plus a tar whose entries are
  // decoded by a hand-rolled ustar reader and matched byte-for-byte against the files on disk;
  // tests/security/memvault-isolation.test.ts: per-tenant index files, cross-tenant search
  // blindness, export tenancy, and rebuild-from-markdown after a deleted/corrupt index).
  // exportVault is kind:'binary' - the tar body has no JSON schema, so the contract test
  // asserts the media type + the decoded entries instead of a safeParse. Covering both keeps
  // EXPECTED_PENDING_COUNT unchanged.
  'memvault.searchNotes', 'memvault.exportVault',
  // slice E4 - the automations run-lifecycle endpoint this slice ADDS (automations.test.ts:
  // "run logs: schema-valid, bounded per step AND per run, cross-owner is the uniform 404", plus
  // tests/automation/run-logs.test.ts for the engine-side capture through a real run).
  //
  // WHY ONLY THIS ONE. The gate is an exact-count ledger: `pending = allDescriptors - COVERED`,
  // pinned at EXPECTED_PENDING_COUNT. Adding a descriptor raises the count by one, so covering
  // exactly the new descriptor restores the pin. The automations domain was ALREADY entirely
  // PENDING before this slice, and E4 additionally lands real coverage for `automations.createRun`
  // (idempotency, the header, the race, the key-admitted audit) and `automations.getRun` — but
  // claiming them here would drop `pending` to 47 and fail the pin, which this slice may not
  // re-pin. The honest reading: PENDING now UNDERSTATES automations coverage; the domain's keys
  // move to COVERED with the re-pin they need, not silently.
  'automations.getRunLogs',
  // slice E5 - the two knowledge READ capabilities this slice ADDS (knowledge.test.ts: the
  // search + read round trips safeParsed against KnowledgeSearchResponse /
  // KnowledgeDocumentResponse under BOTH admissions, the `_shared` corpus round trip, the
  // collection filter and the 400/404 envelopes; tests/security/knowledge-scoping.test.ts:
  // cross-org blindness through search AND read, the shared-partition invariant, and the
  // "no request field names an org" matrix).
  //
  // The two endpoints this slice FLIPPED to `user-or-key` (knowledge.listCollections,
  // knowledge.listDocuments) were already COVERED under G7B and stay where they are — flipping
  // an auth class adds no descriptor, so the pinned count is untouched by them. Covering exactly
  // the two NEW descriptors restores EXPECTED_PENDING_COUNT to its pin.
  'knowledge.searchKnowledge', 'knowledge.readKnowledgeDoc',
]);

// Not-yet-landed endpoints (committed allowlist; SHRINKS each gate, EMPTY at G9). Computed as
// "every descriptor endpoint not in COVERED" here, but pinned by an expected-count assertion so
// a NEW endpoint added to shared/ without being COVERED bumps the count and fails the gate.
// G5->G6: 148->95; G6->G7: 95->88 (7 billing write/admin endpoints) as the full served-app plane, artifact family, legal vertical, and
// integration-definitions surfaces landed with their contract tests (53 endpoints newly covered).
// G7->G7B: 88->80 as the knowledge vault + lexical index surface landed (8 endpoints: collections,
// documents list/ingest/delete, uploads create/delete, reindex, index-status). Knowledge crawl
// endpoints (updateSource, crawlSource, crawlStatus, refreshSchedule) remain PENDING for the crawl gate.
// G7B agent-execution: 80->72 as chat runs (4) + build jobs (4) landed with their contract tests.
const EXPECTED_PENDING_COUNT = 49; // F1 -7 (72->65); F4 -1 (->64); F5 subset -11 (->53); PR4 integration-builder -4 (->49)

describe('schema-coverage gate (ch13 §13.5 item 3)', () => {
  it('every descriptor endpoint is COVERED or PENDING (no unaccounted schema)', () => {
    const all = allEndpointsFlat().map((e) => `${e.domain}.${e.name}`);
    // Every COVERED name must be a real descriptor (no drift / stale coverage claim).
    for (const c of COVERED) {
      expect(all, `COVERED names a real descriptor: ${c}`).toContain(c);
    }
    const pending = all.filter((k) => !COVERED.has(k));
    // The deliberate-red bite: a new endpoint added to shared/ that is neither COVERED nor
    // expected in PENDING changes this count, failing the gate. (Verified by a temporary
    // shared/ addition during the build — logged in RUN_LOG per ch13 §13.11 item 5.)
    expect(pending.length, 'PENDING allowlist count (shrinks each gate, 0 at G9)').toBe(EXPECTED_PENDING_COUNT);
  });

  it('landed domains at G3 are present and covered', () => {
    for (const d of ['auth', 'users', 'org', 'settings', 'sessions', 'memories', 'registo', 'billing']) {
      expect(ALL_ENDPOINTS[d as keyof typeof ALL_ENDPOINTS]).toBeTruthy();
    }
    // A representative endpoint from each landed domain is covered.
    for (const c of ['users.list', 'memories.get', 'registo.listRegisto', 'org.getOrg']) {
      expect(COVERED.has(c)).toBe(true);
    }
  });
});
