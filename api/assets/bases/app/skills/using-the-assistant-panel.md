---
name: using-the-assistant-panel
description: The operator assistant panel is platform-shipped and mounts automatically; make it useful by declaring good ui_actions
---

# Using the Assistant Panel

This base ships an operator assistant PANEL and mounts it automatically into the
shell's `#ekoa-assistant-root`. The app bundle carries only a tiny launcher (wired in
`frontend/src/index.jsx` via `frontend/src/lib/assistant/mount.js`); the panel itself is
a PLATFORM-SERVED runtime asset the launcher lazy-loads on first use, so panel
improvements reach every app without a rebuild. You do NOT build a chat UI, a floating
button, or a message list - the platform owns all of it, and you must never render into
`#ekoa-assistant-root` yourself.

## What it does (for free)

- Renders a collapsible side panel with an "Assistente" launcher, a message list,
  and a composer - brand-neutral, PT-PT, no work from you.
- Talks to the served-app assistant (`POST /api/app-assistant`): it answers in the
  visitor's language, cites the org's knowledge ("Fontes"), and works in three
  modes - **Operar** (does tasks for the visitor), **Mostrar** (overview), and
  **Ensinar** (step-by-step tutorial).
- OPERATES your app by running the actions you declare (see below) through the
  in-page runtime, which draws the driving indicator, confirms destructive actions,
  and stops the moment the visitor touches the app.

## What makes it useful: declare good `ui_actions`

The panel can only OPERATE your app through the actions you DECLARE in
`MANIFEST.md`. An app with no `ui_actions` can still be presented and taught, but
the assistant cannot do anything for the visitor. So:

- Declare a `ui_actions` entry for every task worth automating - creating a record,
  filling a field, navigating, toggling, submitting. See `declaring-ui-actions.md`
  for the shape and the `data-demo-target` namespace it drives.
- Put a stable `data-demo-target` on each interactive landmark an action targets,
  and expose `window.__ekoaApp.navigate(route)` so navigate actions route by state.
- Mark submit/delete/send actions `destructive: true` - the runtime confirms them
  with the visitor before dispatch.

Good, well-labelled actions are what turn the panel from a help chat into a real
operator for your app.

## What NOT to do

- Do not build your own assistant, chat widget, or help button - the platform
  ships one. Do not remove the `mountAssistant()` call or the
  `#ekoa-assistant-root` node, and never render into that node yourself.
- Do not edit or restyle `frontend/src/lib/assistant/mount.js` - it is the platform
  launcher that lazy-loads the platform-served panel; your changes would be lost and
  break the operate loop.
- Do not treat the destructive-confirmation card as authorization - it is a UX
  affordance; real authority is enforced server-side.
