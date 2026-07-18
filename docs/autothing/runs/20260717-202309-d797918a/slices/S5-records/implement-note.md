# S5-records - implement note

Run `20260717-202309-d797918a`, slice S5 (legal records: dossie, assinatura, transcricao, correio).
Implementer note - written before the lead's rebuild, so all UI-level claims below are
"verified in source + node + targeted tsc", not "seen in the served app".

## Scope and posture

Four featured-artifact legal apps enhanced, additive-only. The frozen shared layer (shared.js,
styles.css, demo-spine.js, demo.js, components/{Layout,ui,Icons}.jsx) was NOT touched in any app.
The 37 byte-frozen `legal-*.spec.ts` were not edited; new coverage is 4 NEW `legal-x-*.spec.ts`
files. No `api/src/**`, no `web/**` app code, no ledger, no findings.md edits.

All app paths below are under `api/assets/featured-artifacts/<app>/scaffold/frontend/src/`.

## legal-dossie - one-click full-dossier PDF (new export path, print path untouched)

- NEW `pages/dossie-pdf.js` - pure `dossiePdfHtml({ processo, cliente, eventos, prazos, documentos,
  comunicacoes })` -> `{ html, filename }`. Autonomous HTML (inline styles, no external resources),
  XSS-safe via `esc()`. Structure: CAPA (numero, tribunal, cliente/NIF, area, estado, advogado,
  compilado-em, count tiles) + CRONOLOGIA sorted ASCENDING (oldest first, via `cronologiaAscendente`,
  same tie-break as the Dossie tab) + INDICE DE DOCUMENTOS (numbered table) + prazos + comunicacoes.
  Filename `dossie-<safeNumero>`. No now()-derived body content beyond the "compilado em" date line.
- EDITED `pages/tabs/DossieTab.jsx` - added a SEPARATE primary button `data-testid="dossie-pdf"`
  ("Dossie completo (PDF)") that builds the HTML and calls `window.__ekoa.exportPdf({ html,
  format:'A4', landscape:false, filename })` inside try/catch, with an HONEST failure toast when
  `typeof api.exportPdf !== 'function'` (never fakes success). The FROZEN `guardar-pdf` button
  (window.print) is preserved verbatim except its variant went primary -> secondary; its
  `onImprimir` handler is unchanged. The frozen `legal-dossie.spec.ts` pins `guardar-pdf` ->
  window.print; that path is intact.
- uploadFile-with-preview was already present in the documentos tab (frozen spec pins
  `doc-download` + `doc-preview-toggle`); the new spec re-exercises it and then proves the uploaded
  doc appears in the one-click export index.

## legal-assinatura - deterministic hash manifest per envelope + timeline polish

- EDITED `engine/assinatura.mjs` - two ADDITIVE pure exports (engine stays pure; hashing happens in
  the app via Web Crypto, the engine only receives/validates the already-computed hash):
  - `gerarManifesto(envelope, opts={})` - builds `{ versao:1, tipo:'manifesto-impressoes-digitais',
    envelopeId, titulo, totalDocumentos, documentosComHash, documentos, manifestoHash,
    algoritmoManifesto }`. `documentos` sorted by nome (pt collate) then hash - STABLE and
    order-independent. When `opts.manifestoHash` is given it must be 64-hex or it throws; when
    omitted, manifestoHash/algoritmoManifesto are null.
  - `serializarManifesto(manifesto)` - canonical JSON, keys alphabetically sorted at every level,
    EXCLUDING manifestoHash + algoritmoManifesto (the hash covers content, not itself). Same input
    -> same string -> same SHA-256 in any runtime.
- EDITED `pages/EnvelopeDetailPage.jsx` - imports the two engine fns + `sha256Hex` (model.js).
  Computes `sha256Hex(serializarManifesto(gerarManifesto(env)))` in an effect and renders the
  manifest section `assinatura-manifesto` with `assinatura-manifesto-hash` ("sha-256: <hash>" or
  "a calcular..."), inside the certificate view (concluded envelopes). On archive, the manifest is
  RECOMPUTED deterministically (`gerarManifesto(env, { manifestoHash: await
  sha256Hex(serializarManifesto(gerarManifesto(env))) })`) and persisted onto BOTH the archived
  `assinaturas` and `documentos` rows, so the probative archive carries the fingerprint manifest.
  Also polished `ProvenanceTimeline` (human PT-PT ACAO_LABEL map, PROV_TONE, empty-state, badges).
- Honest demo/manual boundaries were already correct (frozen SV-ASS pins the "nao constitui
  atestacao de validade juridica" notice + the CMD OA gate); this slice left them untouched.

## legal-transcricao - keyboard-first review + timestamped export

- EDITED `pages/TranscricaoDetailPage.jsx` - additive keyboard-first transport on the review card:
  - `alternarReproducao()` (play/pause), `saltar(deltaSec)` (relative seek), `inserirMarcaTempo()`
    (append `{ ts, rotulo }` at the current playhead, formatted via `fmtTs`), `removerMarca(idx)`.
  - `onKeyEditor(ev)` bound to the review `<section ref={editorRef} tabIndex={0}>`; shortcuts fire
    ONLY when focus is NOT in an input/textarea/select/contentEditable, so the correction field
    keeps the space bar: Space/K play-pause, J/L seek -/+2s, I insert marker.
  - Visible controls (discoverable + keyboard-triggerable): `transcricao-transporte`,
    `transcricao-play-pause`, `transcricao-recuar`, `transcricao-avancar`,
    `transcricao-inserir-marca`, a legend `transcricao-atalhos`, and a marker list
    `transcricao-marcadores` with `marca-<i>` / `marca-ts-<i>` / `marca-rotulo-<i>` /
    `marca-ir-<i>` (clickable timestamp -> `tocarDesde`) / `marca-remover-<i>`.
  - Speaker rename propagation (`rotulo()` -> `gerarExcerto`) and the art. 640.º export WITH
    timestamps (`fmtTs` in the excerpt) were already present (frozen A-TRANS pins them); untouched.
    All frozen testids (`primeira-palavra`, `segmento-row`, `seg-check-{si}`, `gerar-excerto`,
    `marcar-revisto`, `correcao-input`, `excerto-bloco`, `orador-*`) are undisturbed; the editor
    card kept its `editor-card` testid and gained tabIndex + onKeyDown only.

## legal-correio - dossie round-trip deep-link (URL-param contract, receiving end)

- EDITED `pages/ExpedientePage.jsx` - the Expediente is now the RECEIVING end of the round-trip:
  reads `?ref=<registoRef>` (seeds the text filter + marks the matching row "Em foco" via
  `correio-foco-<id>` + `correio-foco-badge`, scrollIntoView) and `?processo=<processoId>` (seeds
  the filter with that processo's number). Implemented purely with `useSearchParams`; requires NO
  edit to the dossie app - only the URL parameter changes. The outbound leg (comprovativo upload ->
  `documentos` origem 'legal-correio' + `notify` href `appHref('legal-dossie', 'processo/<id>')`,
  and the processo column deep-link into the dossie) was already present and is unchanged.
- The manual-first CTT tracking (three honest outcomes incl. `correio-tracking-indisponivel`) and
  the "no fake tracking states" posture were already correct; untouched.

## New specs (4 - ledger registration is the lead's job at landing)

All under `web/e2e/`, idiom matching the sibling `legal-x-*.spec.ts` (legalAppUrl, waitForSpine,
per-run nonce, self-cleaning afterEach, zero-pageerror assertion, screenshots under
`.playwright-cli/x-<app>/`).

- `legal-x-dossie.spec.ts` - 2 tests. (1) One-click export: stubs `window.__ekoa.exportPdf` to
  capture the payload, clicks `dossie-pdf` on the print tab, asserts the HTML carries the cover
  (numero + cliente), a CRONOLOGIA section and an INDICE DE DOCUMENTOS, and that the cronologia is
  ASCENDING (older "Citacao" appears before newer "Sentenca" - seed inserts them out of order on
  purpose). (2) Upload -> ficheiro block + preview toggle + spine ficheiro persisted, then the
  uploaded doc appears in the exported index. Seeds a dedicated processo per run, cleans up.
- `legal-x-assinatura.spec.ts` - 1 test (serial describe with its own bootstrap). Drives the
  SIMULADO happy path to Concluido, asserts `assinatura-manifesto-hash` matches
  `/^sha-256: [0-9a-f]{64}$/`, then reloads and asserts the hash is IDENTICAL (determinism), then
  archives and asserts the persisted `assinaturas` + `documentos` rows carry `manifesto.manifestoHash`
  equal to the displayed hash with `algoritmoManifesto: 'sha-256'`.
- `legal-x-transcricao.spec.ts` - 2 tests over a SEEDED transcricao (2-speaker fixture + data-URL
  audio; no STT run). (1) Transport bar + legend present; button AND `i` key insert markers
  (`marca-0`/`marca-1` with `marca-ts-0` formatted HH:MM:SS.s); the `i` key is IGNORED while the
  correction input has focus (no `marca-2`); marker removal works. (2) Speaker rename propagates
  into the art. 640.º excerpt ("testemunha - Antonio Silva") which carries timestamps.
- `legal-x-correio.spec.ts` - 3 tests. (1) `?ref=` deep-link focuses the matching carta
  (`correio-foco-<id>` + badge, filter seeded). (2) `?processo=` filters by the processo number and
  the processo cell deep-links into the dossie. (3) Comprovativo upload writes a `documentos`
  (origem legal-correio) row + a `notificacoes` row whose href deep-links into the dossie
  (round-trip closed on the spine, via `expect.toPass`). Seeds a processo + carta per run; cleans
  up correio/documentos/notificacoes/processos by nonce.

## Verification already done (pre-rebuild)

- `npm run typecheck` - PASSED (shared/api/web).
- `npm run lint` - 0 errors; 220 pre-existing warnings, none from S5 files (scaffold .jsx is not
  linted; e2e specs are eslint-ignored by design).
- Targeted `tsc --noEmit --skipLibCheck` over the 4 new specs (with @playwright/test + node types)
  - CLEAN, no type errors.
- Node check of the assinatura manifest engine - ALL GREEN: order-independent canonical
  serialization (docs reversed -> identical string), hash fields excluded from the canonical form,
  docs sorted by nome, rejects a non-64-hex manifestoHash, null hash when omitted, accepts a valid
  64-hex hash with algoritmoManifesto 'sha-256'.

## What the lead must verify after rebuild

1. Rebuild picks up the seed edits (mtime), then run the 4 new specs: `legal-x-dossie`,
   `legal-x-assinatura`, `legal-x-transcricao`, `legal-x-correio`.
2. Confirm the frozen specs stay green: `legal-dossie` (esp. the print tab pinning `guardar-pdf`
   -> window.print), `legal-assinatura` (SV-ASS state machine + certificate + provenance),
   `legal-transcricao` (A-TRANS gate + word correction + excerpt), `legal-correio` (register flow,
   transitions, comprovativo, tracking indisponivel).
3. Register the 4 new specs in the suite ledger (lead-owned file).

## Risks / known limits (honest)

- The dossie export spec asserts on the HTML STRING handed to `exportPdf` (via a stub), not on a
  rendered PDF byte stream - it proves the document content + ascending order deterministically
  without depending on the server-side Chromium pool. The real `exportPdf` bridge is exercised by
  other slices' PDF specs; here it is intentionally stubbed to keep the assertion about content.
- `legal-x-transcricao` seeds the transcricao row directly (bypassing the STT engine) with a
  data-URL silent WAV. The `<audio>` element mounts but does not decode; `inserirMarcaTempo` reads
  `currentTime` (0 on an unloaded element) so the FIRST marker is 00:00:00.0 - the assertion checks
  the timestamp FORMAT, not a specific non-zero value. This is deliberate: it keeps the keyboard/UI
  behavior deterministic without a real STT run. The frozen A-TRANS already covers real audio +
  real timestamps end-to-end.
- The correio `?processo=` filter maps a processoId to the processo NUMBER for the text filter
  (there is no dedicated processo filter field); if two processos shared a number the filter would
  show both. Numbers are unique in practice and the spec seeds a unique one.
- The "Em foco" badge uses Badge tone="info"; `badge-info` may have no dedicated CSS class in the
  frozen styles.css (cosmetic only, non-breaking - Badge renders the class regardless).
- Seed edits are invisible at :4111 until the lead's rebuild; nothing in this slice was verified
  against the served apps post-edit (by design - runtime is lead-serialized).
