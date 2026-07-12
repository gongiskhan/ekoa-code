---
name: declaring-ui-actions
description: How to declare the app's operable UI actions (ui_actions) so the operator assistant can drive them
---

# Declaring UI Actions

The operator assistant drives your app by executing a typed vocabulary of UI
commands you DECLARE - the `ui_actions` section of your `MANIFEST.md` frontmatter.
Each action runs through your app's OWN state layer (the same events a human
click/keystroke produces), so your validation and business logic always apply.
Declaring actions is what makes an app operable by the assistant; an app with no
`ui_actions` simply has no assistant surface.

## Where it goes

A bare list under `ui_actions:` in the frontmatter, beside `name`/`purpose`:

```yaml
---
name: Gestor de Clientes
purpose: gerir clientes e faturas
ui_actions:
  - id: novo-cliente
    kind: navigate
    labelPt: Novo cliente
    description: Abre o ecrã de criação de cliente
    route: /clientes/novo
  - id: guardar-nome
    kind: setField
    labelPt: Preencher nome
    description: Escreve o nome no formulário de cliente
    target: cliente-nome
    params:
      - name: valor
        type: string
        required: true
  - id: apagar-cliente
    kind: custom
    labelPt: Apagar cliente
    description: Remove o cliente selecionado
    destructive: true
---
```

## The shape of one action

- `id` - kebab-case, unique in the app. This id SHARES the `data-demo-target`
  namespace: for element-scoped kinds it names the landmark the action drives.
- `kind` - one of `navigate` `setField` `toggle` `select` `highlight` `startTour` `custom`.
- `labelPt` / `description` - PT-PT. `labelPt` is shown to the lawyer (and in the
  destructive-confirmation card); `description` is the assistant's tool description.
- `target` - required for `setField` `toggle` `select` `highlight`; it is a
  `data-demo-target` value on the element to drive.
- `route` - required for `navigate` (app-relative, e.g. `/clientes`).
- `tourId` - required for `startTour`.
- `params` - list of `{ name, type: string|number|boolean|option, required, options?, labelPt? }`.
- `destructive: true` - submit/delete/send actions; the runtime shows a PT-PT
  confirmation before dispatch (a UX affordance only - real authorisation is
  server-side, never here).

## Make every interactive landmark addressable

Put a `data-demo-target="<kebab-id>"` on each interactive element an action
targets - inputs, toggles, selects, and the containers you want highlighted -
reusing the shipped shell landmarks and adding your own. The ids stay stable
across rebuilds, which is what keeps declared actions (and generated tours)
pointing at the right element.

## Optional runtime hooks

- `navigate` prefers `window.__ekoaApp.navigate(route)` if your app registers it
  (the shipped shell uses local-state pages, so expose this to route by state);
  otherwise it falls back to History/hash navigation.
- `custom` calls `window.__ekoaApp.actions[<id>](params)` - register a function
  under that id for any behaviour the declarative kinds cannot express. An
  unregistered custom id reports an error instead of running.

## What NOT to do

- Do not invent kinds outside the seven above - the manifest fails validation.
- Do not declare an action whose `target` has no matching `data-demo-target`.
- Do not treat `destructive` confirmation as security - gate real authority on
  the server.
