1. **[High] `artifact.data.tours` is client-writable, then publicly served after only shape validation.** `shared/src/artifacts.ts:39`, `api/src/routes/artifacts.ts:101`, `api/src/apps/artifacts-service.ts:35`, `api/src/apps/serving.ts:467`  
   `ArtifactPatch` allows arbitrary `data`, the patch route strips only reserved keys, and `RESERVED_ARTIFACT_DATA_KEYS` does not include `tours` / `toursError`. The fallback then reads `art.data.tours`, runs `parseStoredTours`, and serves the first overview. That validates schema shape, but not provenance or `appId === resolved artifactId`. A poisoned valid tour can be served as generated output. At minimum, make `tours`/`toursError` server-owned reserved keys and filter parsed tours by the resolved artifact id before responding.

2. **[Medium] Sibling `tours/*.json` reading is unbounded and follows symlinks.** `api/src/apps/tour-writer.ts:108`, `api/src/apps/tour-writer.ts:112`, `api/src/apps/tour-writer.ts:120`  
   The writer reads every sorted `*.json` entry with no count cap, byte cap, or `lstat`/realpath confinement. `..` names are not available through `readdir`, but a symlink named `x.json` can point outside `tours/`, and many/large JSON files can make activation spend unbounded I/O/parse time. Add max file count, max bytes per file / total bytes, and reject non-regular files or realpaths outside the `tours` directory.

3. **[Medium] The new `/api/demos/:appId` fallback has no tests for the actual risky behavior.** `api/src/apps/serving.ts:451`, `api/tests/apps/tour-writer.test.ts:128`, `api/tests/apps/tour-writer.test.ts:239`  
   The 19 tests cover schema, writer channels, dedup, warnings, and activation persistence, but not the serving route. Missing pins: catalog-first behavior, slug-vs-id resolution, invalid stored entries being dropped, mismatched `appId` not being served, overview selection, and 404 when only poisoned/invalid data exists.

4. **[Low] Duplicate strict JSON schema still rejects `tourId`/`kind`.** `ekoa-data/demos/_schema.json:6`, `ekoa-data/demos/_schema.json:9`, `api/assets/demos/_schema.json:16`  
   The authoritative zod schema and `api/assets/demos/_schema.json` were extended, but `ekoa-data/demos/_schema.json` still has `additionalProperties: false` without `tourId`/`kind`. I did not find a current runtime AJV consumer, and the Playwright validator is permissive, but this duplicate remains a drift trap for any schema-based authoring/test path.

Checks that passed: the frontmatter regex is byte-identical across `tour-writer.ts:68`, `action-manifest.ts:35`, and `manifest-parser.ts:165`; the real shipped demo files are iterated by `tour-writer.test.ts:109`; duplicate `tourId` across manifest/files is covered; `24bffeb` preserves earliest-match-position semantics for earlier-position app/document phrases.

CODEX VERDICT: needs-work
