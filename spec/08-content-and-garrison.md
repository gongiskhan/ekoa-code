# 08. Content and the Garrison boundary

This chapter fixes what "content" is in the rebuilt system, what it is allowed to do, how the `content/` module loads it into agent contexts, and where the line sits between this service and Garrison. The one-sentence version: content is prose for agents, never code for the platform (FIXED-6, FIXED-4); the loader that assembles it is one small module, not a framework; and Garrison material crosses into this repo only as content or as a reference spec for a TypeScript reimplementation, never as code or a service dependency (FIXED-7). The visual companion is diagram `spec/diagrams/07-content-composition` (FIXED-12: structural changes to this design must update that diagram in the same unit of work).

## 8.1 The content model: agent-facing only (FIXED-6)

**Definition.** Agent-context content is markdown (plus inert assets such as images and plain-text data samples) whose only consumer is a model: it is assembled into the contexts of the three agents (coding, chat, automation) and read by them. Nothing in the platform executes it, branches on it, or derives runtime structure from it (FIXED-4, FIXED-6).

**Unit: the content package.** A package is a directory containing:

| File | Required | Purpose |
|---|---|---|
| `content.json` | yes | Package manifest: `name`, `version`, `description`, `agents` (which of `coding`/`chat`/`automation` may receive it), `mode` (`eager` or `on-demand`), `files` (explicit list) |
| one or more skill files (`*.md` with YAML frontmatter carrying `description`) | yes | The agent-facing prose. "Skill file" is used in this chapter only, in its agent-context sense: a markdown behavior or knowledge file with a frontmatter description that enables on-demand loading (see 8.4) |
| assets (images, `.txt`/`.csv` samples) | no | Inert supporting material referenced by the markdown |

The loader validates every package on import: manifest parses, every listed file exists, no file outside the list, and **no executable content** - `.js`, `.mjs`, `.cjs`, `.ts`, `.sh`, `.py` and any file with an executable bit are rejected at import time. This is the mechanical enforcement of the cannot-list in 8.2; today's `ekoa-data/legal-engines/*.mjs` (runtime-imported JavaScript living in a content directory - reference/data-inventory.md §8) is exactly the pattern this rule exists to kill.

Worked example - the chat agent's base behavior package:

```
api/content/chat-agent/
  content.json
  SKILL.md
```

```json
{
  "name": "chat-agent",
  "version": "1.0.0",
  "description": "Base behavior for the chat agent: identity, tone, grounding discipline",
  "agents": ["chat"],
  "mode": "eager",
  "files": ["SKILL.md"]
}
```

```markdown
---
description: Identidade e regras de conduta do assistente
---
# Assistente

És o assistente da empresa. Responde em português de Portugal, com rigor e sem
inventar factos jurídicos: cita a fonte da base de conhecimento ou fica em silêncio.
...
```

The prose is the product surface; the manifest is the only structure the platform reads, and the only thing it does with it is decide *whether and how to load the prose* - never what the prose means.

**Authorship.** Three author paths, all design-time from the platform's point of view (FIXED-4):

1. **Repo-bundled baseline** - packages checked into the new repository (`ekoa-code`) at `api/content/` (read-only at runtime; shipped in the image). This is where today's surviving agent content lands (8.6).
2. **Runtime-authored** - the integration builder writes integration definition prose during its sessions (the one runtime author that exists today - reference/carryover-audit.md A4, `services/integration-storage.ts` row). These packages are written to the durable runtime store (8.3), never into the repo tree or the container's writable layer - closing the durability hole recorded against today's `ekoa-data/integrations/` (reference/data-inventory.md §8: production saves land in the container layer and die on redeploy).
3. **Garrison fittings** - imported through the same package import path, subject to the same validation (8.5).

## 8.2 What content can and cannot do

**FIXED (FIXED-4, FIXED-6).** This table is the contract. Every "cannot" row names where that capability lives instead.

| Content CAN | Content CANNOT | That capability lives in |
|---|---|---|
| Shape agent behavior: identity, tone, conventions, guardrail phrasing in the system prompt | Define REST routes or any wire surface | `routes/` + `shared/` schemas (ch02, ch03) |
| Carry agent knowledge: domain facts, legal doctrine, product conventions, examples | Define data schemas, validation rules, or collection declarations | `shared/` zod schemas; per-app manifests in the collections engine (ch04) |
| Describe workflows *to an agent* as guidance it may follow in its own reasoning | Be executed as a workflow by the platform, or be translated into runnable form at runtime | Typed pipelines: plain TypeScript in the owning module (FIXED-4) |
| Declare its own loading metadata (frontmatter `description`, manifest `agents`/`mode`) | Perform data transformations, calculations, or any deterministic logic the platform depends on | The owning module (`legal/`, `memory/`, `billing/`, ...) as TypeScript |
| Reference platform capabilities by name so the agent knows they exist (e.g. the app data API, the knowledge search tools) | Register tools, define tool behavior, or grant permissions | `agents/` builds the tool allowlist in code (ch05) |
| Differ per user (per-user composition, 8.3) | Read or write anything at runtime; content is read BY the loader, it never acts | - |

Two consequences worth stating flatly:

- A model authors content at design time; code executes at runtime (FIXED-4). There is no code path in the new service that feeds a markdown file to a model in order to *decide what the platform does next*. Content only ever rides along inside an agent context whose surrounding behavior is fixed TypeScript.
- If a piece of prose turns out to encode something the platform must do deterministically (a fee table, a date calculation, a webhook field path), that is a defect in the content model: the deterministic part is extracted into typed code and the prose keeps only the agent-facing explanation. The integration definition split in 8.6 (row 3) is the worked example.

## 8.3 The context loader (`api/src/content/`)

One module (ch02 §2.6 `content/`; may import `config.ts` only). It is a loader, not a framework (FIXED-6): it validates packages, stores them by hash, composes per-user directories, and hands paths to `agents/`. Target size on the order of a few hundred lines; if it grows past roughly 800 lines of TypeScript or acquires any consumer other than `agents/` and the composition root, it is drifting into framework territory and the growth must be justified in review.

What the loader deliberately does NOT have (each item is something the old machinery had or a framework would grow, and its absence is the design):

- No plugin system, no hooks, no lifecycle events, no discovery-by-convention beyond the two fixed source directories.
- No inter-package dependencies: packages are flat and independent in v1; if two packages need each other, they are one package.
- No schema versioning or migrations: `content.json` is validated by one zod schema in the module; an incompatible manifest fails import with a clear error, it is never auto-upgraded.
- No runtime interpretation of any kind: the loader never reads markdown bodies except to verify they exist and hash them.
- No model calls (FIXED-3: this module has no path to `llm/` - ch02 import table).
- No per-request work: composition happens on boot, on import, and on explicit recompose; serving a context is a directory-path lookup.

### 8.3.1 On-disk layout

All runtime state lives under the data directory (filesystem by design - content is files consumed as files by the Agent SDK; a database adds nothing; this is a deliberate exception to the P-05 platform-store decision, alongside the knowledge vault - ch04):

| Location | Contents | Mutability |
|---|---|---|
| `api/content/<package>/` (repo) | Baseline packages, versioned with the repo | Read-only at runtime; changes ship by deploy |
| `<dataDir>/content/store/<sha256>/` | The shared content-addressed cache: one immutable directory per package version, keyed by the sha256 of the package's canonical archive (sorted file list + bytes) | Write-once; verified on read |
| `<dataDir>/content/runtime/<package>/` | Runtime-authored package sources (integration definitions, imported fittings) before hashing into the store | Written only through the loader's import API |
| `<dataDir>/content/compose/user-<id>/<agent>/<compositionHash>/` | Materialized composition directories, one per (user, agent, composition) | Immutable once built; superseded compositions swept at boot after 7 days |

Boot behavior: the loader ingests `api/content/` into the store (hash, skip if present), re-ingests the runtime area, then serves composition requests. Ingest is idempotent; a redeploy with changed baseline packages produces new hashes and therefore new compositions, with no migration step.

Materialization is by symlink from the store into the composition directory, falling back to file copy where symlinks are unavailable. Compositions are cheap to build and never edited in place.

### 8.3.2 Composition

`composeContext(userId, agent, taskPackages?)` is the whole public surface, plus `importPackage(dir | archive, source)`, `removePackage(name)`, and `listPackages()`. No REST surface exists for content in v1 - ch03's endpoint inventory contains no `/content` resource, and the current frontend performs no content-editing operation (the documented skill-editor page does not exist in the live client; the route map claiming it is recorded stale - reference/operations-inventory.md §C4), so FIXED-9 imposes none.

Composition rules, in order:

1. Select every package whose manifest `agents` list includes the requested agent.
2. Precedence by name: a runtime-store package shadows a baseline package of the same name (today's runtime-overrides-versioned rule, carried - reference/carryover-audit.md A4, `integration-storage.ts` row).
3. Append caller-supplied task packages (e.g. the design-base guidance for the selected base in a build - 8.6 row 6).
4. The ordered list of package hashes is the composition manifest; its hash names the composition directory. If the directory exists, reuse it; otherwise materialize it.
5. The result handed to `agents/` is `{ dir, hash, eagerFiles, onDemandFiles }`: the composition directory is passed to the Agent SDK as its plugin/context path, `eagerFiles` are concatenated into the system prompt (8.4), `onDemandFiles` are exposed via frontmatter descriptions for progressive disclosure.

The SDK continues to run with nothing inherited from any host profile (`settingSources: []` today - reference/invisible-behaviors.md §7.3); the composition directory is the *only* content the agent sees. Carried invariant.

Update and removal semantics:

- **Update** = import of a new version: new hash in the store, new composition hash for every affected (user, agent) pair on next `composeContext`. Running agent jobs keep the composition directory they started with (it is immutable and not deleted while referenced by a live job); new jobs get the new composition. No hot-swapping mid-job, ever.
- **Removal** (`removePackage`) deletes the runtime source and drops the package from future compositions; store entries and old composition directories are left for the boot sweep (8.3.1) so that in-flight jobs are never pulled out from under.
- **Corruption handling**: a store entry whose re-hash does not match its directory name is quarantined at boot (renamed aside, logged through the single audit write path - FIXED-8) and re-ingested from its source if the source still exists; otherwise the affected package is dropped from compositions and the boot log says so loudly.

### 8.3.3 Distribution scope in v1: store + composition only (RESOLVED (P-21))

v1 ships the store + composition mechanics but no remote registry client. Package sources in v1 are exactly the three author paths of 8.1: repo-bundled baseline, runtime-authored via the integration builder, and manual fitting import (an admin drops a validated package directory or archive; the loader ingests it). APM-style distribution - resolving named, versioned packages from a shared registry into the content-addressed store - is a post-launch addition that requires no redesign, because the store is already content-addressed and compositions are already hash-named; a registry only adds a fetch step in front of `importPackage`.

Rejected alternative: build the remote registry client in v1 - not taken, because there is no registry endpoint to verify from this repository (`ekoa-code`), the fittings inventory itself resolves to an empty launch set (Q-06 below), and shipping an unverifiable network dependency inside an unsupervised build run is needless risk. The loader's v1 contract is identical either way. Resolved: defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

## 8.4 What assembles into which agent context

`agents/` owns the runtime pipeline (ch05); this section fixes the composition order and which slots are content versus dynamically built blocks. Content appears in exactly two slots: the eager base behavior (slot 1) and task-scoped packages (slot 8). Everything else is code-built at request time from live platform state - content never carries live data.

System prompt composition order (top to bottom). Precedents cite today's verified behavior; the order itself is fixed here.

| # | Block | Built from | Coding agent (builds) | Chat agent | Automation agent (planning) |
|---|---|---|---|---|---|
| 1 | Base behavior (eager content: identity, conventions, product knowledge) | `content/` composition, `eagerFiles` | yes | yes | yes |
| 2 | Company identity and branding | company store (dynamic) | yes | yes | no |
| 3 | Guardrail rules (strict `RULE:` entries) | `memory/` core-tier guardrails (dynamic) | yes | yes | yes |
| 4 | Resolved memories | `memory/` term-overlap resolver (dynamic; no model call - reference/llm-usage-map.md §10) | yes | yes | yes, scoped by automation tags |
| 5 | Knowledge grounding block (cited-or-silent) | `knowledge/` grounding builder (dynamic) | only when the build is legal-context (reference/llm-usage-map.md §5, build row) | always (reference/llm-usage-map.md §5, chat row) | no |
| 6 | Workspace catalog (automations + integration actions) | `automation/` catalog builder (dynamic; context assembly only - reference/llm-usage-map.md §10) | yes | yes | yes |
| 7 | Live integration data pre-fetch | `integrations/` (dynamic, keyword-triggered, 60s cache - reference/invisible-behaviors.md §7.3) | no | yes | no |
| 8 | Task augmentation | task-scoped content + typed data: starting-point and design-base guidance, template configuration, and the `legal-shared`/`legal-spine` knowledge packages on legal builds (coding - reference/invisible-behaviors.md §7.2; §8.6 row 16, RESOLVED (Q-09)); onboarding catalog package for onboarding sessions (chat); goal and rehearsal context (automation) | yes | session-type dependent | yes |
| 9 | Language block | code constant, appended last for non-English sessions (carried - reference/invisible-behaviors.md §7.3) | yes | yes | yes |

Notes fixed here:

- **Eager versus on-demand.** Eager packages (manifest `mode: eager`) are concatenated into slot 1 and cost prompt tokens on every call - reserved for each agent's base behavior file. On-demand packages sit in the composition directory with only their frontmatter `description` visible; the agent loads the body when relevant. This carries today's two consumption modes with the manifest replacing the old plugin wiring.
- **Tool allowlists are not content.** Which tools each agent gets (coding: full toolset in the sandbox; chat: knowledge search/read only, never shell or write access; automation vision: none) is fixed TypeScript in `agents/` (ch05), carrying today's verified restrictions (reference/invisible-behaviors.md §7.3, mode options). A content package cannot widen an allowlist.
- **Automation contexts.** The planner receives the composition above. The per-step vision resolve/verify calls are single-purpose prompts owned by `automation/` code with closed-vocabulary output validation (reference/llm-usage-map.md §5, automation rows); they consume no content packages.
- **Observability.** When the SDK surfaces that an on-demand file was loaded, `agents/` emits the typed `context_event` stream event (`{name, action: loaded|used}`) defined in ch03 §events - package names are the `name` values, giving the founder a live view of which content actually gets used.

## 8.5 The Garrison boundary (FIXED-7)

Garrison is the founder's separate content ecosystem; its packaged units of agent guidance are called fittings. From this service's perspective Garrison is a *content supplier and nothing else*. These two sentences are the spec's canonical definitions of both terms (ch11's glossary maps only retired Cortex vocabulary, so Garrison and fitting are defined here, not there); the operative rules follow.

**The four rules (FIXED-7):**

1. **Fittings that are agent content are consumed as content.** A fitting enters the system only through `importPackage` (8.3.2), becoming a normal content package: validated (no executables), hashed into the store, composed per its manifest. No special code path, no fitting-specific behavior anywhere in `api/src/`.
2. **Anything the platform must do deterministically is reimplemented in TypeScript inside this service, with the fitting as reference spec.** The fitting text is kept under the new repo's `docs/reference/` for traceability, and is *not* loaded into agent contexts as a stand-in for the missing code. A fitting is never "executed by prompt".
3. **Never import Garrison code.** No Garrison package in any `package.json`, no git submodule, no vendored source. Enforced in CI (same belt-and-braces style as the Anthropic chokepoint gate, ch02 §2.9): the build fails if a case-insensitive `garrison` match appears in any `package.json`, lockfile, or `.gitmodules` under `api/`, `web/`, or `shared/`.
4. **Never call Garrison as a service.** No Garrison URL in `config.ts`, no network call to Garrison endpoints anywhere in `api/src/`. Same CI gate, second pattern: case-insensitive `garrison` in any `api/src/**` or `shared/**` source file fails the build. Legitimate mentions belong only in `spec/`, `docs/`, and content packages - all outside the gated paths. (The gate is deliberately blunt; the word has no other reason to appear in source.)

**Decision procedure** for any inbound fitting (this is the same triage the content model imposes in 8.2, applied at the boundary):

| The fitting is... | Fate |
|---|---|
| Agent behavior or knowledge (prose an agent should read) | Import as a content package (rule 1) |
| Deterministic platform behavior (calculation, transformation, protocol handling, schema) | Reimplement in TypeScript in the owning module; fitting filed as reference spec (rule 2) |
| Both mixed together | Split: extract the deterministic part into typed code, import the prose remainder as a package; record the split in the new repo's decision log |

**Worked example added by the amendment - the anonymisation layer's core/composition split.** The anonymisation layer specified in chapter 17 is this same core-versus-composition discipline (FIXED-7), applied to a new mechanism. The anonymisation mechanism itself - the egress chokepoint, the detection pipeline, the per-session vault, the audit path, the `anonymize`/`deanonymize` interface - is Ekoa core (chapter 17 section 17.7). The Portugal-legal specifics that ride it - the PT structured-ID ruleset and the per-tenant deny-lists of the firm's own client and party names - load as tenant configuration and composition, exactly as a fitting's prose loads as a content package here; Portugal-legal specifics never bend the core (the Ekoa Local v2 brief, docs/, A3.6, A6-D3). The amendment records this as a second worked example of the Garrison line, alongside the integration-definition split of 8.2 and 8.6.

**Q-06 - RESOLVED (founder input; register of record chapter 16).** The fittings inventory - which fittings exist and which are wanted - is not enumerable from this repository. The launch run consumes **zero** fittings: the launch composition is the repo-bundled baseline plus runtime-authored integration definitions only. The founder supplies the inventory later; importing it is a content operation the shipped loader already supports, so it requires no code change. This is the resolved default and it blocks nothing. Resolved: defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

## 8.6 Fate of today's content directories

Ground truth is the repo-versioned-content table in reference/data-inventory.md §8 (13 read paths plus the dead-path row), and the machinery disposition in reference/carryover-audit.md Tier C. Every row is fated below; "carries as content" means it becomes baseline packages under `api/content/` at migration (ch10 owns the import step). The loaders and translation layers that consume these paths today are all Tier C machinery and none of them carries (reference/carryover-audit.md Tier C: `skills/loader.ts`, `agents/plugin-loader.ts`, `adapters/external.ts`, the `apps/loader.ts`-family runtime-translation layer).

| # | Today's path | What it is | Fate |
|---|---|---|---|
| 1 | `ekoa-data/plugins/skills/` | Agent behavior/knowledge, one skill file per directory | **Carries as content**: imported as baseline packages for the three agents. The two discovery loaders that read it die (Tier C) |
| 2 | `ekoa-data/plugins/instructions/` | Platform workflow texts consumed by the retired runtime-translation layer (reference/data-inventory.md §8, `apps/compiler.ts` reader) | **Dies as runtime input** (FIXED-4). Each file becomes a reference spec for the typed reimplementation in its owning module - the memory workflows per P-12 and the platform call-site fates (reference/llm-usage-map.md §7). None carries as agent content: these are platform procedures, not agent guidance |
| 3 | `ekoa-data/integrations/<key>/` | Integration definitions: prose + `config.json` (webhook/listener field paths, actions) + history + provisioned automations | **Splits** (8.2): the structured config becomes validated typed data owned by `integrations/` (ch02); the prose carries as content packages surfaced to agent contexts via the loader. Runtime saves move to the durable runtime store, closing the container-layer durability hole flagged in the §8 row |
| 4 | `~/.ekoa/data/integration-skills/` (runtime twin of row 3) | Runtime-authored integration definitions; runtime overrides versioned | **Folds into the runtime content store + integrations store** per the row-3 split; the runtime-shadows-baseline precedence is carried as the loader's rule 8.3.2(2) (reference/carryover-audit.md A4) |
| 5 | `ekoa-data/featured-artifacts/<id>/` | Curated starting-point scaffolds and seed data | **Not content.** Carries as versioned seed data owned by `apps/` (ch07 featured prebuild; reference/carryover-audit.md Services sweep, `featured-artifacts-seeder` row) |
| 6 | `ekoa-data/bases/<baseId>/` | Design bases: tokens, layout, scaffold, plus prose design guidance (closed enum of five - reference/data-inventory.md §8) | **Splits**: tokens/layout/scaffold are typed build inputs owned by `apps/` (`base-loader` ports as-is - reference/carryover-audit.md Services sweep); the prose guidance carries as task-scoped content packages appended to the coding agent's slot 8 when that base is selected |
| 7 | `ekoa-data/memories/seed.json` | Idempotent memory seed | **Not content.** Carries as seed data owned by `memory/` (reference/carryover-audit.md A9, `memory/seed.ts`) |
| 8 | `ekoa-data/knowledge/sources.seed.json` | Default crawl sources, seed-idempotent | **Not content.** Carries as seed data owned by `knowledge/` (reference/carryover-audit.md Services sweep, `knowledge-seed` row; ch04 sources store) |
| 9 | `ekoa-data/demos/*.json` + `demos/assets/` | Public demo tour specs served at `/api/demos*` | **Not content.** Carries as versioned data owned by the demo registry service (`demo-registry` ports as-is - reference/carryover-audit.md Services sweep); wire surface preserved verbatim (ch03 §3.8.23) |
| 10 | `ekoa-data/onboarding/catalogs/<vertical>.md` | Vertical onboarding catalog prose | **Carries as content**: on-demand packages for the chat agent's onboarding slot 8; the one non-agent consumer of the old skill loader (`onboarding-prompt`) re-points at the content loader (reference/carryover-audit.md Services sweep, `onboarding-prompt` row) |
| 11 | `ekoa-data/legal-engines/` (`juros.mjs`, `custas.mjs`, `tabelas-taxas.json`) | Executable JavaScript dynamically imported at runtime from a content directory | **Dies as content** - the exact pattern the 8.1 no-executables rule forbids. The calculators are reimplemented as TypeScript in `legal/` (ch02; reference/carryover-audit.md B21, A11 `tabelas-taxas.ts` row); the rate table ships as a typed data file inside `legal/` |
| 12 | `.ekoa/plugins/<name>/` (`plugin.json`, `system-prompt.md`, `profiles/`) + `.ekoa/skills/` | The old SDK composition wiring | **Machinery dies** (`plugin-loader` is Tier C). The `system-prompt.md` texts carry as the eager base behavior packages (slot 1); the composition manifest replaces `plugin.json` |
| 13 | `cortex/apps/{ekoa.company, ekoa.deployments, ekoa.projects}` | The retired layer's three bundled definition directories, including their runtime write-back into the repo tree | **Dies with the machinery** (Tier C). Company data migrates as the singleton document per ch04's store map; the write-back durability hole (same class as row 3 - reference/data-inventory.md §8) disappears with the layer |
| 14 | `cortex/src/data/scaffold-templates/` | Generic new-app starter files | **Not content.** Carries as versioned scaffold data owned by `apps/` (reference/carryover-audit.md A3) |
| 15 | Dead rows - `ekoa-data/apps/`, `ekoa-data/settings/{company,settings,templates}.json`, `ekoa-data/brand-assets/`, `ekoa-data/knowledge/content.md` (no reader in `cortex/src` - reference/data-inventory.md §8 and conflicts C13/C14) | Orphaned directories the docs claim are live | **Dropped.** Nothing to carry; the runtime brand-asset cache at `~/.ekoa/brand-assets/` is unaffected (it is a blob store, ch04 P-07, per C13) |
| 16 | `ekoa-data/legal-shared/`, `ekoa-data/legal-spine/` | No code reader, but agent-consumed content per the same C14 sweep note | **Carries as content (RESOLVED (Q-09))**: imported as on-demand knowledge packages for the coding agent, task-scoped to legal builds (slot 8 of 8.4). See below |

**Q-09 - RESOLVED (founder review).** `ekoa-data/legal-shared/` and `ekoa-data/legal-spine/` have no code reader (reference/data-inventory.md conflict C14) yet are agent-consumed content - material the coding agent reads from disk during legal builds rather than through any loader. Both import as on-demand knowledge packages for the coding agent, task-scoped to legal builds (slot 8 of section 8.4), making today's implicit consumption explicit and durable; slot 8's task-scoped loading of these packages is normative. Rejected alternative: drop them with the other dead rows and rely on the knowledge base for legal grounding. The loader supports this without code change, and the two packages are part of the final baseline set fixed before the migration import (ch10). Resolved: ACCEPT (recommendation final), founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

## 8.7 Acceptance criteria

1. Every path in reference/data-inventory.md §8 - including the dead rows - appears in the 8.6 table with an explicit fate (checkable: 16 rows covering all §8 read paths plus the runtime twin).
2. `api/src/content/` exposes no REST surface, imports only `config.ts` (matching ch02 §2.6), and its public API is exactly the four functions of 8.3.2.
3. The package validator rejects executable files; a test package containing a `.mjs` file fails import (the row-11 regression test).
4. The composition-order table covers all three agents, and content appears only in slots 1 and 8 of the assembled prompts (verifiable by inspecting the `agents/` prompt builder).
5. CI contains the two Garrison grep gates (rules 3 and 4 of 8.5) and they fail on a seeded violation.
6. Runtime-authored packages persist across a container redeploy (the row-3 durability fix, checkable in the ch10 cutover environment).
7. P-21 is folded as RESOLVED (store + composition only, no remote registry client in v1); Q-06 (zero fittings at launch) and Q-09 (`legal-shared`/`legal-spine` import as on-demand legal-build packages, slot 8) are folded as resolved, with their register of record in ch16.

Cross-references: ch02 (`content/` module placement and import limits), ch03 (`context_event`, `/api/demos*`, absence of a `/content` resource), ch04 (filesystem exception, seed stores, P-07 blobs), ch05 (runtime prompt pipeline and tool allowlists), ch07 (scaffolds, bases, featured seed data), ch10 (migration import of baseline packages), ch11 (old-vocabulary glossary; its skill-machinery row defers the term "skill file" to this chapter - Garrison and fitting are defined in 8.5, not in ch11), ch17 (the anonymisation layer as the core/composition worked example of the Garrison line - 8.5, 17.7), ch16 (Q-06, Q-09 resolutions).

*Amendment record: amended 2026-07-06 per founder resolutions and the anonymisation/local-file-access amendment (docs/ekoa-code-spec-amendment-brief.md).*

*End of chapter 08.*
