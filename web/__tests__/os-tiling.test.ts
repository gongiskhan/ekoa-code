import { describe, it, expect } from 'vitest';
import {
  computeLayout,
  containsLeaf,
  insertEdge,
  isLeaf,
  leaves,
  removeLeaf,
  setRatio,
  splitAt,
  splitLeaf,
  RATIO_MAX,
  RATIO_MIN,
} from '@/lib/os/tiling';
import type { Rect, TileNode } from '@/lib/os/types';

const BOUNDS: Rect = { x: 0, y: 0, w: 1206, h: 800 };
const DIVIDER = 6;

describe('lib/os/tiling', () => {
  it('insertEdge into an empty region takes the whole region', () => {
    const root = insertEdge(null, 'w1', 'left');
    expect(isLeaf(root)).toBe(true);
    expect(leaves(root)).toEqual(['w1']);
    const layout = computeLayout(root, BOUNDS, DIVIDER);
    expect(layout.rects.w1).toEqual(BOUNDS);
    expect(layout.dividers).toHaveLength(0);
  });

  it('edge-snapping a second window makes a half/half row (scenario 2 geometry)', () => {
    let root = insertEdge(null, 'w1', 'left');
    root = insertEdge(root, 'w2', 'right');
    const layout = computeLayout(root, BOUNDS, DIVIDER);
    // 1206 - 6 divider = 1200 usable, half each.
    expect(layout.rects.w1).toEqual({ x: 0, y: 0, w: 600, h: 800 });
    expect(layout.rects.w2).toEqual({ x: 606, y: 0, w: 600, h: 800 });
    expect(layout.dividers).toHaveLength(1);
    expect(layout.dividers[0].rect).toEqual({ x: 600, y: 0, w: DIVIDER, h: 800 });
  });

  it('insertEdge left places the new window on the left half', () => {
    let root = insertEdge(null, 'w1', 'left');
    root = insertEdge(root, 'w2', 'left');
    const layout = computeLayout(root, BOUNDS, DIVIDER);
    expect(layout.rects.w2.x).toBe(0);
    expect(layout.rects.w1.x).toBeGreaterThan(0);
  });

  it('splitLeaf per quadrant picks direction and order', () => {
    const base: TileNode = { leaf: 'w1' };
    const right = splitLeaf(base, 'w1', 'w2', 'right');
    expect(right).toEqual({ dir: 'row', ratio: 0.5, a: { leaf: 'w1' }, b: { leaf: 'w2' } });
    const left = splitLeaf(base, 'w1', 'w2', 'left');
    expect(left).toEqual({ dir: 'row', ratio: 0.5, a: { leaf: 'w2' }, b: { leaf: 'w1' } });
    const top = splitLeaf(base, 'w1', 'w2', 'top');
    expect(top).toEqual({ dir: 'col', ratio: 0.5, a: { leaf: 'w2' }, b: { leaf: 'w1' } });
    const bottom = splitLeaf(base, 'w1', 'w2', 'bottom');
    expect(bottom).toEqual({ dir: 'col', ratio: 0.5, a: { leaf: 'w1' }, b: { leaf: 'w2' } });
  });

  it('drop-to-split nests: dropping onto a half yields a quarter', () => {
    let root = insertEdge(null, 'w1', 'left');
    root = insertEdge(root, 'w2', 'right');
    root = splitLeaf(root, 'w2', 'w3', 'bottom');
    expect(leaves(root)).toEqual(['w1', 'w2', 'w3']);
    const layout = computeLayout(root, BOUNDS, DIVIDER);
    expect(layout.rects.w1.h).toBe(800);
    // w2/w3 stack in the right half: (800 - 6) / 2 = 397 each.
    expect(layout.rects.w2.h).toBe(397);
    expect(layout.rects.w3.h).toBe(397);
    expect(layout.rects.w3.y).toBeGreaterThan(layout.rects.w2.y);
    expect(layout.dividers).toHaveLength(2);
  });

  it('removeLeaf collapses the parent split so the sibling takes the region', () => {
    let root: TileNode | null = insertEdge(null, 'w1', 'left');
    root = insertEdge(root, 'w2', 'right');
    root = splitLeaf(root!, 'w2', 'w3', 'bottom');
    root = removeLeaf(root, 'w2');
    expect(leaves(root)).toEqual(['w1', 'w3']);
    const layout = computeLayout(root, BOUNDS, DIVIDER);
    expect(layout.rects.w3.h).toBe(800);
    // Removing the last window empties the tree.
    root = removeLeaf(root, 'w1');
    root = removeLeaf(root, 'w3');
    expect(root).toBeNull();
  });

  it('removeLeaf of an absent id is a no-op', () => {
    const root = insertEdge(null, 'w1', 'left');
    expect(removeLeaf(root, 'nope')).toEqual(root);
    expect(containsLeaf(root, 'nope')).toBe(false);
  });

  it('setRatio adjusts the addressed split and clamps to usable bounds', () => {
    let root = insertEdge(null, 'w1', 'left');
    root = insertEdge(root, 'w2', 'right');
    root = splitLeaf(root, 'w2', 'w3', 'bottom');
    // Root split ('') and the nested split ('b') are addressed by path.
    root = setRatio(root, '', 0.7);
    root = setRatio(root, 'b', 0.05);
    expect(splitAt(root, '')?.ratio).toBe(0.7);
    expect(splitAt(root, 'b')?.ratio).toBe(RATIO_MIN);
    root = setRatio(root, 'b', 0.95);
    expect(splitAt(root, 'b')?.ratio).toBe(RATIO_MAX);
    // Ratio drives the layout: 1200 usable * 0.7 = 840.
    const layout = computeLayout(root, BOUNDS, DIVIDER);
    expect(layout.rects.w1.w).toBe(840);
  });

  it('setRatio on a missing path is a no-op', () => {
    const root = insertEdge(null, 'w1', 'left');
    expect(setRatio(root, 'ab', 0.5)).toEqual(root);
  });

  it('computeLayout partitions are exhaustive and non-overlapping (row axis)', () => {
    let root = insertEdge(null, 'w1', 'left');
    root = insertEdge(root, 'w2', 'right');
    root = splitLeaf(root, 'w1', 'w4', 'right');
    const layout = computeLayout(root, BOUNDS, DIVIDER);
    const total =
      Object.values(layout.rects).reduce((s, r) => s + r.w * r.h, 0) +
      layout.dividers.reduce((s, d) => s + d.rect.w * d.rect.h, 0);
    expect(total).toBe(BOUNDS.w * BOUNDS.h);
  });
});
