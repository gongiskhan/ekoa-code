---
name: authoring-tours
description: How to declare the app's guided tours (overview + per-journey) so a lawyer can be taught the app with zero tokens
---

# Authoring Guided Tours

A guided tour walks a lawyer through the app step by step - it highlights a
landmark, waits for a real click, annotates the result. Tours you DECLARE are
captured at build time and replayed 100% client-side, so teaching costs ZERO
model tokens. Declare an OVERVIEW tour (the 60-second "what is this app") plus
ONE tour per main journey. An app with no tours simply has no teach path.

Selectors are `data-demo-target` names - the SAME namespace as your `ui_actions`
targets and the shell landmarks - so a tour keeps pointing at the right element
across rebuilds. See `declaring-ui-actions` for the target convention.

## Where tours go

Either channel (or both) - pick whichever keeps the file readable:

1. A `tours:` list in `MANIFEST.md` frontmatter, beside `ui_actions:`.
2. Sibling `tours/<name>.json` files, one tour each - the same shape as the
   shipped platform demos you can read as templates.

Do NOT set `appId` - the pipeline stamps it with the artifact id at build.

```yaml
---
name: Gestor de Clientes
purpose: gerir clientes e faturas
tours:
  - tourId: visao-geral
    kind: overview
    card:
      titlePt: Conheça o Gestor de Clientes
      descriptionPt: Veja como registar um cliente e emitir a primeira fatura.
      durationSec: 60
    steps:
      - id: abrir-clientes
        type: navigate
        to: /clientes
        copy:
          titlePt: A sua lista de clientes
          bodyPt: Aqui vê todos os clientes. Vamos criar o primeiro.
      - id: destacar-novo
        type: spotlight
        target: novo-cliente
        copy:
          titlePt: Comece por aqui
          bodyPt: Use este botão para abrir o formulário de novo cliente.
      - id: gravar
        type: await-action
        target: cliente-guardar
        event: click
        simulate:
          actions:
            - kind: fill
              target: cliente-nome
              value: Maria Santos
            - kind: click
              target: cliente-guardar
      - id: ver-resultado
        type: annotate-result
        target: cliente-cartao
        copy:
          titlePt: Cliente registado
          bodyPt: O cliente fica disponível para faturação e acompanhamento.
---
```

## The shape of one tour

- `tourId` - kebab-case, unique within the app (e.g. `visao-geral`, `emitir-fatura`).
- `kind` - `overview` (exactly one, the app tour) or `journey` (one per main flow).
- `card` - `{ titlePt, descriptionPt, durationSec }`: the gallery entry.
- `steps` - the ordered walk. Step types:
  - `navigate` `{ id, type, to, copy? }` - go to an app route; `copy` pauses to explain.
  - `spotlight` `{ id, type, target, copy }` - highlight a landmark and explain it.
  - `await-action` `{ id, type, target, event, simulate }` - wait for a real click
    (`event: click`) or a result (`event: result-ready`). `simulate.actions` is
    MANDATORY (the test harness performs it); a `click` await MUST include a
    `click` on its own `target`.
  - `annotate-result` `{ id, type, target, copy }` - annotate an on-screen result.
  - `inject-prompt` `{ id, type, surface: chat, prompt, copy? }` - SUGGEST an
    assistant prompt in the composer. It is never auto-sent.

## Copy rules (PT-PT)

- Write formal European Portuguese. No emoji. No em-dashes (use "-").
- `titlePt` is a short heading; `bodyPt` one or two plain sentences.
- Address the lawyer directly and describe what they see and do next.

## What NOT to do

- Do not set `appId` - the pipeline stamps it.
- Do not reuse a `tourId` within the app - duplicates fail validation.
- Do not invent step types beyond the six above - the tour fails validation.
- Prefer targets that are shell landmarks or your declared `ui_actions` ids;
  a target the registry does not know still works but is flagged as a warning,
  so keep every targeted element addressable with a stable `data-demo-target`.
