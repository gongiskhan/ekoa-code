---
name: declaring-capabilities
description: The EXACT recipe DSL for MANIFEST.md `capabilities:` - the platform executes these; an invented shape breaks the whole frontmatter and disables the app's operator surfaces
---

# Declaring Capabilities (the recipe DSL)

A capability is a named, platform-EXECUTED action over the app's data
(`capabilities:` in `MANIFEST.md` frontmatter). The platform validates the whole
frontmatter as YAML at activation: **one malformed recipe line invalidates the
ENTIRE manifest**, which disables the app's `ui_actions` AND its guided tours
(the assistant can then neither operate nor teach this app). Copy the shapes
below exactly - do NOT invent fields.

## Shape

```yaml
capabilities:
  - name: adicionar_tarefa            # snake_case
    description: Adiciona uma nova tarefa à lista.
    inputs:
      titulo: { type: string, required: true }
    recipe:
      - op: data.generate_id
        returnAs: novoId
      - op: store.create
        collection: tarefas
        data: { id: "{{captured.novoId}}", titulo: "{{inputs.titulo}}", concluida: false }
        returnAs: tarefa
    result_template: "Tarefa '{{captured.tarefa.titulo}}' adicionada."
    mutates: true
```

## The recipe ops (EXACT fields - nothing else parses)

| op | fields |
|---|---|
| `store.list` | `collection`, `returnAs?` |
| `store.get` | `collection`, `id`, `returnAs?` |
| `store.create` | `collection`, `data: {...}`, `returnAs?` |
| `store.update` | `collection`, `id`, `patch: {...}`, `returnAs?` |
| `store.delete` | `collection`, `id`, `returnAs?` |
| `store.query` | `collection`, `where: { field, op, value }`, `returnAs?` |
| `integration.call` | `integrationKey`, `actionName`, `args: {...}`, `returnAs?` |
| `artifact.invoke` | `artifactSlug`, `capabilityName`, `inputs: {...}`, `returnAs?` |
| `data.validate` | `rule` (email/url/uuid/iso_date/non_empty), `input`, `failMessage` |
| `data.generate_id` | `returnAs` |
| `data.now` | `returnAs` |
| `data.format` | `pattern`, `inputs: {...}`, `returnAs` |
| `data.assign` | `path`, `value` |
| `file.read` | `path`, `returnAs` |
| `file.write` | `path`, `content` |
| `flow.fail` | `message` |
| `flow.if` | `condition: { left, op, right? }`, `then: [...]`, `else?: [...]` |

## The classic mistake - `store.query` filters live under `where:`

The comparison is a NESTED object. Flattening it duplicates the `op` key and the
whole frontmatter fails YAML parsing (`duplicated mapping key`):

```yaml
# WRONG - two `op` keys in one map; this breaks the ENTIRE manifest:
- { op: store.query, collection: tarefas, field: concluida, op: eq, value: false, returnAs: tarefas }

# RIGHT - the filter nests under where:
- { op: store.query, collection: tarefas, where: { field: concluida, op: eq, value: false }, returnAs: tarefas }
```

`where.op` is one of: `eq`, `neq`, `lt`, `lte`, `gt`, `gte`, `contains`,
`starts_with`, `ends_with`.

## Template refs

`"{{inputs.<name>}}"` (declared inputs), `"{{captured.<returnAs>}}"` (earlier
step results, `.field` paths allowed). `result_template` interpolates the same
refs into the PT-PT sentence the assistant speaks when the capability runs.

## Checklist before you finish

- The frontmatter parses as YAML (no duplicated keys, consistent indentation).
- Every `store.query` uses `where: { field, op, value }`.
- Every capability has `name`, `description`, `inputs` (or `{}`), `recipe`,
  `result_template`, `mutates`.
