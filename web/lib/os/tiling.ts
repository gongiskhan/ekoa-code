import type { Rect, TileNode, TileSplit } from './types';

/**
 * Pure operations over the tiled-region binary split tree (surface contract
 * 4.1/4.2). No DOM, no store - unit-tested in web/__tests__/os-tiling.test.ts.
 *
 * A node path identifies a position in the tree as a string of 'a'/'b' steps
 * from the root ('' = root). Dividers are identified by the path of their
 * split node. An `empty` leaf is an unoccupied half (see types.ts): it takes
 * space in the layout but renders nothing, so a lone edge-snapped window
 * occupies exactly half the region.
 */

export type TilePath = string;

export type Quadrant = 'left' | 'right' | 'top' | 'bottom';

export const RATIO_MIN = 0.2;
export const RATIO_MAX = 0.8;

export function isLeaf(node: TileNode): node is { leaf: string } {
  return 'leaf' in node;
}

export function isEmpty(node: TileNode): node is { empty: true } {
  return 'empty' in node;
}

export function isSplit(node: TileNode): node is TileSplit {
  return 'dir' in node;
}

/** All window ids in the tree, left-to-right (empty halves skipped). */
export function leaves(root: TileNode | null): string[] {
  if (!root) return [];
  if (isLeaf(root)) return [root.leaf];
  if (isEmpty(root)) return [];
  return [...leaves(root.a), ...leaves(root.b)];
}

export function containsLeaf(root: TileNode | null, winId: string): boolean {
  return leaves(root).includes(winId);
}

/**
 * Edge snap: the window takes the left or right HALF of the whole tiled
 * region. Empty region -> [window | empty]. A top-level empty slot on the
 * snapped side is filled; otherwise the existing tree compresses into the
 * other half.
 */
export function insertEdge(root: TileNode | null, winId: string, side: 'left' | 'right'): TileNode {
  const leaf: TileNode = { leaf: winId };
  if (!root || isEmpty(root)) {
    return side === 'left'
      ? { dir: 'row', ratio: 0.5, a: leaf, b: { empty: true } }
      : { dir: 'row', ratio: 0.5, a: { empty: true }, b: leaf };
  }
  // Fill a top-level empty half on the snapped side (the canonical second
  // half/half snap).
  if (isSplit(root) && root.dir === 'row') {
    if (side === 'left' && isEmpty(root.a)) return { ...root, a: leaf };
    if (side === 'right' && isEmpty(root.b)) return { ...root, b: leaf };
  }
  return side === 'left'
    ? { dir: 'row', ratio: 0.5, a: leaf, b: root }
    : { dir: 'row', ratio: 0.5, a: root, b: leaf };
}

/**
 * Drop-onto-window: replace the target leaf with a split of target + new
 * window. The hovered quadrant picks direction and order (left/right = 'row',
 * top/bottom = 'col'; the new window takes the named side).
 */
export function splitLeaf(
  root: TileNode,
  targetWinId: string,
  newWinId: string,
  quadrant: Quadrant,
): TileNode {
  if (isEmpty(root)) return root;
  if (isLeaf(root)) {
    if (root.leaf !== targetWinId) return root;
    const target: TileNode = { leaf: targetWinId };
    const added: TileNode = { leaf: newWinId };
    switch (quadrant) {
      case 'left':
        return { dir: 'row', ratio: 0.5, a: added, b: target };
      case 'right':
        return { dir: 'row', ratio: 0.5, a: target, b: added };
      case 'top':
        return { dir: 'col', ratio: 0.5, a: added, b: target };
      case 'bottom':
        return { dir: 'col', ratio: 0.5, a: target, b: added };
    }
  }
  return {
    ...root,
    a: splitLeaf(root.a, targetWinId, newWinId, quadrant),
    b: splitLeaf(root.b, targetWinId, newWinId, quadrant),
  };
}

/**
 * Remove a window; the sibling takes the whole region. A tree left with no
 * real windows collapses to null.
 */
export function removeLeaf(root: TileNode | null, winId: string): TileNode | null {
  if (!root) return null;
  if (isEmpty(root)) return root;
  if (isLeaf(root)) return root.leaf === winId ? null : root;
  const a = removeLeaf(root.a, winId);
  const b = removeLeaf(root.b, winId);
  if (a === null) return b === null || isEmpty(b) ? null : b;
  if (b === null) return isEmpty(a) ? null : a;
  if (isEmpty(a) && isEmpty(b)) return null;
  return { ...root, a, b };
}

/** Adjust a split's ratio (divider drag), clamped to keep both sides usable. */
export function setRatio(root: TileNode, path: TilePath, ratio: number): TileNode {
  const clamped = Math.min(RATIO_MAX, Math.max(RATIO_MIN, ratio));
  if (isLeaf(root) || isEmpty(root)) return root;
  if (path === '') {
    return { ...root, ratio: clamped };
  }
  const step = path[0] as 'a' | 'b';
  const rest = path.slice(1);
  return { ...root, [step]: setRatio(root[step], rest, clamped) } as TileSplit;
}

export interface TileLayout {
  rects: Record<string, Rect>;
  /** `region` is the split's whole area - divider drags derive ratios from it. */
  dividers: { path: TilePath; dir: 'row' | 'col'; rect: Rect; region: Rect }[];
}

/**
 * Partition `bounds` among the tree's leaves. Each split reserves
 * `dividerPx` on the boundary between its children (the draggable gutter).
 * Empty halves take their space but produce no rect; a divider renders only
 * when BOTH sides hold at least one real window.
 */
export function computeLayout(root: TileNode | null, bounds: Rect, dividerPx = 6): TileLayout {
  const layout: TileLayout = { rects: {}, dividers: [] };
  if (!root) return layout;

  const walk = (node: TileNode, region: Rect, path: TilePath) => {
    if (isEmpty(node)) return;
    if (isLeaf(node)) {
      layout.rects[node.leaf] = region;
      return;
    }
    const bothReal = leaves(node.a).length > 0 && leaves(node.b).length > 0;
    if (node.dir === 'row') {
      const usable = Math.max(0, region.w - dividerPx);
      const aw = Math.round(usable * node.ratio);
      const aRegion: Rect = { x: region.x, y: region.y, w: aw, h: region.h };
      const bRegion: Rect = {
        x: region.x + aw + dividerPx,
        y: region.y,
        w: usable - aw,
        h: region.h,
      };
      if (bothReal) {
        layout.dividers.push({
          path,
          dir: 'row',
          rect: { x: region.x + aw, y: region.y, w: dividerPx, h: region.h },
          region,
        });
      }
      walk(node.a, aRegion, path + 'a');
      walk(node.b, bRegion, path + 'b');
    } else {
      const usable = Math.max(0, region.h - dividerPx);
      const ah = Math.round(usable * node.ratio);
      const aRegion: Rect = { x: region.x, y: region.y, w: region.w, h: ah };
      const bRegion: Rect = {
        x: region.x,
        y: region.y + ah + dividerPx,
        w: region.w,
        h: usable - ah,
      };
      if (bothReal) {
        layout.dividers.push({
          path,
          dir: 'col',
          rect: { x: region.x, y: region.y + ah, w: region.w, h: dividerPx },
          region,
        });
      }
      walk(node.a, aRegion, path + 'a');
      walk(node.b, bRegion, path + 'b');
    }
  };

  walk(root, bounds, '');
  return layout;
}

/** Find the split node at a path (divider hit-testing helper). */
export function splitAt(root: TileNode, path: TilePath): TileSplit | null {
  let node: TileNode = root;
  for (const step of path) {
    if (!isSplit(node)) return null;
    node = node[step as 'a' | 'b'];
  }
  return isSplit(node) ? node : null;
}
