# ekoa-design — Agent SDK plugin for build-run design craft

Two vendored skills (sources: the operator's `~/.claude/skills/` installs, 2026-08-07):

| Skill | Scope | License |
|---|---|---|
| `frontend-design` | Distinctive, production-grade UI for any web surface (apps, dashboards, components); anti-generic-design guidance | Apache 2.0 (`skills/frontend-design/LICENSE.txt`) — commercial use permitted |
| `design-taste-frontend` | Anti-slop craft for landing pages, portfolios, and redesigns (audit-first, real design systems, strict pre-flight) | MIT (`skills/design-taste-frontend/LICENSE`) — commercial use permitted |

Both licenses permit commercial/product integration — no authorization gate. (v1 of this plugin
shipped huashu-design, replaced 2026-08-07 because its personal-use license required paid
authorization for product integration; see `docs/decisions.md`.)

Mounted into every build run by `agents/build.ts` as an Agent SDK **local plugin**
(`plugins: [{ type: 'local', path }]`, path from `AgentsConfig.designPluginDir`,
env-overridable via `EKOA_DESIGN_PLUGIN_DIR`, empty string disables). The spawn keeps
`settingSources: []` (FIXED-6): this plugin is the one sanctioned skill-loading path, a
platform-owned mount — never inherited developer/user settings.

Skills load by progressive disclosure: only each frontmatter description rides in context;
bodies are read when the task is design-shaped. The build system prompt
(`agents/build.ts` BUILD_SYSTEM_PROMPT) pins their craft to the compiled React entrypoint
(`frontend/src/`) — any standalone-HTML deliverable framing in skill text never overrides
the F16 entrypoint rule.

This directory is invisible to the content loader (`api/src/content/loader.ts` only ingests
directories directly under `api/content/` that carry a `content.json`).

To refresh from upstream: re-copy each skill's `SKILL.md` + license file and keep this README.
