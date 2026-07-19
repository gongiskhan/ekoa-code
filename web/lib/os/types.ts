import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * OS-mode surface contract types (docs/os-mode/surface-contract.md, section 2).
 * A surface = a container-agnostic component + a manifest. The same component is
 * mounted by the classic shell (route) or the OS shell (window / full-screen).
 */

/** Geometry in px within the desktop area. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * One menu definition per surface/item type, rendered identically by the
 * always-visible "..." affordance, right-click, and long-press (contract 3.1).
 */
export interface ActionDef<Ctx = unknown> {
  id: string;
  /** PT-PT label. */
  label: string;
  icon?: LucideIcon;
  /** Styled red and sorted last. */
  destructive?: boolean;
  /** Absent = always available. */
  available?: (ctx: Ctx) => boolean;
  run: (ctx: Ctx) => void | Promise<void>;
}

/**
 * The single seam between a surface and whichever shell mounts it, so one
 * action definition can behave host-appropriately (classic "open" = overlay or
 * navigation; OS "open" = a window). Deliberately this small (contract 2.2).
 */
export interface SurfaceHost {
  mode: 'classic' | 'os';
  openSurface: (surfaceId: string, props?: Record<string, unknown>) => void;
  /** OS windows only: close the hosting window. */
  requestClose?: () => void;
}

export interface SurfaceProps {
  instanceId: string;
  /** Instance props, e.g. { artifactId } for artifact-app. */
  props: Record<string, unknown>;
  host: SurfaceHost;
}

/** Context handed to surface-level actions (icon / window menu). */
export interface SurfaceActionCtx {
  host: SurfaceHost;
}

export interface SurfaceManifest {
  id: string;
  /** PT-PT title; window instances may override (e.g. the artifact name). */
  title: string;
  icon: LucideIcon;
  /** px; window resize clamp. */
  minSize: { w: number; h: number };
  /** px; initial float size. */
  preferredSize: { w: number; h: number };
  /** true = at most one instance (artifacts manager); false = instance per props key (artifact-app). */
  singleton: boolean;
  component: ComponentType<SurfaceProps>;
  actions: ActionDef<SurfaceActionCtx>[];
}

export type DesktopItemRef =
  | { kind: 'surface'; id: string }
  | { kind: 'artifact'; id: string };

/** Window = surface instance + layout state (contract 4.1). */
export interface WindowState {
  id: string;
  surfaceId: string;
  props: Record<string, unknown>;
  /** Instance title override (e.g. artifact name). */
  title?: string;
  mode: 'float' | 'tile';
  /** Float geometry; kept while tiled so un-tiling restores it. */
  rect: Rect;
  minimized: boolean;
}

/**
 * Binary split tree for the tiled region (contract 4.1/4.2). An `empty` leaf
 * is an unoccupied half: edge-snapping the FIRST window yields
 * [window | empty] so it takes half the region (the brief's gesture), and the
 * next opposite-edge snap fills the empty slot.
 */
export type TileNode = { leaf: string } | { empty: true } | TileSplit;

export interface TileSplit {
  dir: 'row' | 'col';
  /** Fraction of the region given to `a`; clamped 0.2-0.8 by setRatio. */
  ratio: number;
  a: TileNode;
  b: TileNode;
}

/** A workspace is a name + desktop/pinned item ids + the saved window layout. Nothing more. */
export interface Workspace {
  id: string;
  name: string;
  desktopItems: DesktopItemRef[];
  pinnedIds: DesktopItemRef[];
  windows: WindowState[];
  tiling: TileNode | null;
}
