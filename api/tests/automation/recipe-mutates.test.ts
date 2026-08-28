import { describe, it, expect } from 'vitest';
import { recipeMutates, type PlatformPrimitive } from '../../src/automation/platform-primitives.js';

/**
 * RECIPE-DERIVED MUTATION (Codex checkpoint fix, K5). `call_ekoa_action` must judge a capability by
 * what its recipe DOES, not by the manifest's self-declared `mutates` flag - which the parser
 * normalises to false for any absent or non-literal-true value, so a capability with a
 * `store.delete` recipe and no `mutates` would otherwise slip the chat door's write gate. This is
 * the "prove it is a read" discipline `action-consent.ts` applies to integration actions.
 */
describe('recipeMutates', () => {
  const read: PlatformPrimitive[] = [
    { op: 'store.list', collection: 'pedidos', returnAs: 'r' },
    { op: 'store.get', collection: 'pedidos', id: '{{input.id}}', returnAs: 'p' },
    { op: 'store.query', collection: 'pedidos', where: { field: 'estado', op: 'eq', value: 'x' } as never, returnAs: 'q' },
    { op: 'data.format', pattern: '{a}', inputs: { a: '{{r}}' }, returnAs: 'out' },
    { op: 'file.read', path: '/x', returnAs: 'f' },
  ];

  it('a pure-read recipe does not mutate', () => {
    expect(recipeMutates(read)).toBe(false);
    expect(recipeMutates([])).toBe(false);
  });

  it('each store/file WRITE primitive mutates', () => {
    expect(recipeMutates([{ op: 'store.create', collection: 'c', data: {} }])).toBe(true);
    expect(recipeMutates([{ op: 'store.update', collection: 'c', id: '{{x}}', patch: {} }])).toBe(true);
    expect(recipeMutates([{ op: 'store.delete', collection: 'c', id: '{{x}}' }])).toBe(true);
    expect(recipeMutates([{ op: 'file.write', path: '/x', content: '{{y}}' }])).toBe(true);
  });

  it('a reach OUTSIDE (integration.call, artifact.invoke) is conservatively mutating', () => {
    expect(recipeMutates([{ op: 'integration.call', integrationKey: 'k', actionName: 'a', args: {} }])).toBe(true);
    expect(recipeMutates([{ op: 'artifact.invoke', artifactSlug: 's', capabilityName: 'c', inputs: {} }])).toBe(true);
  });

  it('a WRITE hidden in a flow.if branch is still found (the bypass Codex named)', () => {
    const hidden: PlatformPrimitive[] = [
      { op: 'store.get', collection: 'c', id: '{{x}}', returnAs: 'p' },
      {
        op: 'flow.if',
        condition: { op: 'truthy', ref: '{{p}}' } as never,
        then: [{ op: 'store.delete', collection: 'c', id: '{{x}}' }],
      },
    ];
    expect(recipeMutates(hidden)).toBe(true);

    const hiddenElse: PlatformPrimitive[] = [
      {
        op: 'flow.if',
        condition: { op: 'falsy', ref: '{{p}}' } as never,
        then: [{ op: 'store.list', collection: 'c', returnAs: 'r' }],
        else: [{ op: 'file.write', path: '/x', content: '{{y}}' }],
      },
    ];
    expect(recipeMutates(hiddenElse)).toBe(true);
  });
});
