---
name: base-conventions
description: Conventions for app-integration-heavy base — integration-central apps
---

# Base Conventions — app-integration-heavy

This base is a variant of `app-auth-persistent` for apps whose core flow runs through connected integrations (email triage, calendar workflows, file processing, etc.). Same auth + persistence foundation, but the integration UX is more prominent and the integration-needed boundary is treated as a first-class UI state, not an edge case.

## Visual styling — runtime tokens only

Every app's `index.html` already links to `/api/design-tokens.css`. Use the variable contract in `ekoa-data/bases/CSS_VARS_CONTRACT.md`. Every CSS value uses a variable with a fallback. Never inline a hex literal; never override the variables on `:root` yourself.

## What's already done

- Everything in `app-auth-persistent` (left-nav shell, auth wiring, persistence, runtime tokens).
- The `callIntegration<T>()` helper is the primary way to do work.
- The `IntegrationNeededBoundary` is part of the main flow, not a fallback.

## Rules

1. **Integration-first UI.** When a user opens the app, surface the connected integration's status prominently. Show what's connected (e.g. "Gmail connected — 47 unread") and a "Connect more" affordance.
2. **Always handle `needs_integration`.** Every primary user action should branch on the result.
3. **Two-pane patterns work well.** Left: integration data (list of emails / events / files). Right: action panel (compose reply / mark done / move).
4. **Persistence for app state only.** Use the JsonStore for app-local concepts like rules, filters, saved searches, processed-item history — NOT for caching integration data (the integration is the source of truth).
5. **Prefer streaming reads.** Long lists from integrations should paginate or stream, not load all at once.
6. **Idempotency.** Mutating integration actions (send, delete, move) should record a local "done" marker so retries don't double-send.
