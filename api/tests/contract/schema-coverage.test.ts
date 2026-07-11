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
  'servedApp.appSsoMicrosoftStart', 'servedApp.appSsoM365', 'servedApp.appCloudFilesStatus', 'servedApp.m365Proxy',
  // G6 — legal vertical services + e-sign (legal-plane.test.ts)
  'servedApp.legalCalculos', 'servedApp.legalTranscricao', 'servedApp.legalResearch', 'servedApp.trackingConsulta',
  'servedApp.citiusConsulta', 'servedApp.signatureSend', 'servedApp.adobeSignWebhookGet', 'servedApp.adobeSignWebhookPost',
  // G6 — serving plane + health + demos (served-app.test.ts)
  'servedApp.appHealth', 'servedApp.serveApp', 'servedApp.demoBridge',
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
  // Local-bridge consumer run s1 — hosted presence (bridge-status.test.ts)
  'ekoaLocal.bridgeStatus',
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
const EXPECTED_PENDING_COUNT = 53; // F1 -7 (72->65); F4 -1 (->64); F5 subset -11 (->53)

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
