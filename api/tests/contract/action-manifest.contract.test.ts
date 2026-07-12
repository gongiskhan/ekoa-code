import { describe, it, expect } from 'vitest';
import { AppActionManifest, AppAction, APP_ACTION_KINDS } from '@ekoa/shared';

/**
 * operator-run C2 — contract suite for the shared AppActionManifest schema
 * (the operate contract every emitted per-app ui_actions section must
 * validate against). No endpoint descriptor is introduced (the manifest
 * travels inside MANIFEST.md and the artifact record, not a new route), so
 * this exercises the SCHEMA surface directly: every kind constructible, the
 * cross-field invariants enforced, and the stub fixtures used by other tests
 * remain valid instances of the real contract.
 */

const base = { labelPt: 'Etiqueta', description: 'Descricao da acao', params: [] };

describe('AppActionManifest contract (C2)', () => {
  it('every declared kind is constructible with its required fields', () => {
    const perKind: Record<(typeof APP_ACTION_KINDS)[number], object> = {
      navigate: { id: 'ir-clientes', kind: 'navigate', route: '/clientes', ...base },
      setField: { id: 'set-nome', kind: 'setField', target: 'campo-nome', ...base },
      toggle: { id: 'alternar-iva', kind: 'toggle', target: 'iva-switch', ...base },
      select: { id: 'escolher-escalao', kind: 'select', target: 'escalao', ...base },
      highlight: { id: 'destacar-total', kind: 'highlight', target: 'total', ...base },
      startTour: { id: 'tour-geral', kind: 'startTour', tourId: 'overview', ...base },
      custom: { id: 'exportar-csv', kind: 'custom', ...base },
    };
    for (const action of Object.values(perKind)) {
      const r = AppAction.safeParse(action);
      expect(r.success, JSON.stringify(action)).toBe(true);
    }
    const manifest = AppActionManifest.safeParse({ version: 1, actions: Object.values(perKind) });
    expect(manifest.success).toBe(true);
  });

  it('enforces the cross-field invariants (route/tourId/target/options/dup ids)', () => {
    expect(AppAction.safeParse({ id: 'x', kind: 'navigate', ...base }).success).toBe(false);
    expect(AppAction.safeParse({ id: 'x', kind: 'startTour', ...base }).success).toBe(false);
    expect(AppAction.safeParse({ id: 'x', kind: 'toggle', ...base }).success).toBe(false);
    expect(AppAction.safeParse({
      id: 'x', kind: 'custom', ...base,
      params: [{ name: 'p', type: 'option', required: true }],
    }).success).toBe(false); // option without options
    expect(AppActionManifest.safeParse({
      version: 1,
      actions: [
        { id: 'a', kind: 'custom', ...base },
        { id: 'a', kind: 'custom', ...base },
      ],
    }).success).toBe(false); // duplicate ids
  });

  it('defaults are applied (destructive=false, params=[], required=false)', () => {
    const r = AppAction.parse({ id: 'a', kind: 'custom', labelPt: 'X', description: 'Y' });
    expect(r.destructive).toBe(false);
    expect(r.params).toEqual([]);
  });
});
