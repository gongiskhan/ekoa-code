import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readUiActions } from '../../src/apps/action-manifest.js';

/**
 * operator-run C2 — the ui_actions reader over MANIFEST.md frontmatter.
 * Absent = no operator surface; bare-list and explicit-object shapes both
 * validate against the shared contract; invalid = structured error (fail-loud
 * without failing the build).
 */

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ekoa-uiactions-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function withManifest(text: string): Promise<string> {
  const d = await mkdtemp(join(dir, 'p-'));
  await writeFile(join(d, 'MANIFEST.md'), text, 'utf-8');
  return d;
}

const HEADER = (uiActions: string) => `---
name: Test App
purpose: testing
${uiActions}
---

# Test App
`;

describe('readUiActions (C2)', () => {
  it('no MANIFEST.md / no frontmatter / no ui_actions -> absent', async () => {
    const empty = await mkdtemp(join(dir, 'p-'));
    expect((await readUiActions(empty)).status).toBe('absent');
    const noFm = await withManifest('# sem frontmatter\n');
    expect((await readUiActions(noFm)).status).toBe('absent');
    const noSection = await withManifest(HEADER(''));
    expect((await readUiActions(noSection)).status).toBe('absent');
  });

  it('bare-list shape validates and wraps as version 1', async () => {
    const d = await withManifest(HEADER(`ui_actions:
  - id: novo-cliente
    kind: navigate
    labelPt: Novo cliente
    description: Abre o formulario de novo cliente
    route: /clientes/novo
  - id: guardar-cliente
    kind: setField
    labelPt: Guardar cliente
    description: Preenche o campo nome do cliente
    target: cliente-nome
    params:
      - name: valor
        type: string
        required: true`));
    const res = await readUiActions(d);
    expect(res.status).toBe('valid');
    if (res.status === 'valid') {
      expect(res.manifest.version).toBe(1);
      expect(res.manifest.actions.map((a) => a.id)).toEqual(['novo-cliente', 'guardar-cliente']);
      expect(res.manifest.actions[1]?.params[0]?.required).toBe(true);
      expect(res.manifest.actions[0]?.destructive).toBe(false); // default
    }
  });

  it('explicit object shape with a destructive action validates', async () => {
    const d = await withManifest(HEADER(`ui_actions:
  version: 1
  actions:
    - id: apagar-cliente
      kind: custom
      labelPt: Apagar cliente
      description: Remove o cliente selecionado
      destructive: true`));
    const res = await readUiActions(d);
    expect(res.status).toBe('valid');
    if (res.status === 'valid') expect(res.manifest.actions[0]?.destructive).toBe(true);
  });

  it('invalid declarations return a structured error naming the violation', async () => {
    const cases: Array<[string, RegExp]> = [
      [`ui_actions:
  - id: BadId
    kind: navigate
    labelPt: X
    description: X
    route: /x`, /kebab-case/],
      [`ui_actions:
  - id: sem-rota
    kind: navigate
    labelPt: X
    description: X`, /requires route/],
      [`ui_actions:
  - id: sem-alvo
    kind: setField
    labelPt: X
    description: X`, /requires target/],
      [`ui_actions:
  - id: dup
    kind: navigate
    labelPt: X
    description: X
    route: /a
  - id: dup
    kind: navigate
    labelPt: X
    description: X
    route: /b`, /duplicate action id/],
    ];
    for (const [section, rx] of cases) {
      const d = await withManifest(HEADER(section));
      const res = await readUiActions(d);
      expect(res.status).toBe('invalid');
      if (res.status === 'invalid') expect(res.error).toMatch(rx);
    }
  });
});
