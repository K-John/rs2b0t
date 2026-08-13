export const X0 = 1856;
export const X1 = 3648;
export const Z0 = 1280;
export const Z1 = 10368;
export const LEVELS = 4;

export const XSPAN = X1 - X0;
export const ZSPAN = Z1 - Z0;
export const PLANE = XSPAN * ZSPAN;
export const N = PLANE * LEVELS;

export function idxOf(level: number, x: number, z: number): number {
    if (level < 0 || level >= LEVELS) return -1;
    if (x < X0 || x >= X1 || z < Z0 || z >= Z1) return -1;
    return level * PLANE + (z - Z0) * XSPAN + (x - X0);
}

export function tileOf(idx: number): { level: number; x: number; z: number } {
    const level = (idx / PLANE) | 0;
    const rem = idx - level * PLANE;
    const z = ((rem / XSPAN) | 0) + Z0;
    const x = (rem % XSPAN) + X0;
    return { level, x, z };
}

export function tileStr(idx: number): string {
    const t = tileOf(idx);
    return `(${t.x},${t.z},L${t.level})`;
}

export interface Dir {
    readonly name: string;
    readonly dx: number;
    readonly dz: number;
    readonly bit: number;
    readonly delta: number;
}

export const DIRS: readonly Dir[] = [
    { name: 'N', dx: 0, dz: 1, bit: 1 << 0, delta: XSPAN },
    { name: 'NE', dx: 1, dz: 1, bit: 1 << 1, delta: XSPAN + 1 },
    { name: 'E', dx: 1, dz: 0, bit: 1 << 2, delta: 1 },
    { name: 'SE', dx: 1, dz: -1, bit: 1 << 3, delta: -XSPAN + 1 },
    { name: 'S', dx: 0, dz: -1, bit: 1 << 4, delta: -XSPAN },
    { name: 'SW', dx: -1, dz: -1, bit: 1 << 5, delta: -XSPAN - 1 },
    { name: 'W', dx: -1, dz: 0, bit: 1 << 6, delta: -1 },
    { name: 'NW', dx: -1, dz: 1, bit: 1 << 7, delta: XSPAN - 1 },
] as const;

export function edgeKey(idx: number, dirIndex: number): number {
    return idx * 8 + dirIndex;
}

export interface TickCosts {

    readonly perStep: number;

    readonly opBase: number;

    readonly byLoc: ReadonlyMap<string, number>;
}

export interface StepGrid {
    readonly steps: Uint8Array;

    readonly openPerLevel: readonly number[];
}

export interface DoorEdge {
    readonly idx: number;
    readonly dirIndex: number;

    readonly door: number;
}

export interface DoorPlacement {
    readonly level: number;
    readonly x: number;
    readonly z: number;
    readonly locId: number;
    readonly locName: string;
    readonly shape: number;
    readonly angle: number;
    readonly blockrange: boolean;
}

export interface DoorTable {
    readonly doors: readonly DoorPlacement[];

    readonly blockedBy: ReadonlyMap<number, readonly number[]>;
}

export interface Transport {
    readonly from: number;
    readonly to: number;
    readonly locId: number;
    readonly locName: string;

    readonly option: number;
    readonly ticks: number;
}

export interface TransportTable {
    readonly edges: readonly Transport[];

    readonly from: ReadonlyMap<number, readonly number[]>;

    readonly skipped: ReadonlyMap<string, number>;
}

export type LegKind = 'walk' | 'door' | 'stairs' | 'ladder';

export interface RouteLeg {
    readonly kind: LegKind;
    readonly from: number;
    readonly to: number;
    readonly ticks: number;

    readonly tiles: number;

    readonly path?: readonly number[];

    readonly at?: number;

    readonly locId?: number;
    readonly locName?: string;
    readonly option?: number;
}

export type RouteResult =
    | {
          readonly ok: true;
          readonly legs: readonly RouteLeg[];
          readonly ticks: number;
          readonly tiles: number;
          readonly expanded: number;
          readonly ms: number;
      }
    | {
          readonly ok: false;
          readonly reason: string;
          readonly closest: number | null;
          readonly closestDistance: number;
          readonly expanded: number;
          readonly ms: number;
      };
