import type { WorldTile } from '../snapshots/GameSnapshot.js';

export interface WorldArea {
    readonly minX: number;
    readonly maxX: number;
    readonly minZ: number;
    readonly maxZ: number;
    readonly level: number;
}

export class Area implements WorldArea {
    readonly minX: number;
    readonly maxX: number;
    readonly minZ: number;
    readonly maxZ: number;
    readonly level: number;

    constructor(x1: number, z1: number, x2: number, z2: number, level: number) {
        this.minX = Math.min(x1, x2);
        this.maxX = Math.max(x1, x2);
        this.minZ = Math.min(z1, z2);
        this.maxZ = Math.max(z1, z2);
        this.level = level;
    }

    contains(tile: WorldTile): boolean {
        return containsTile(tile, this);
    }
}

export function containsTile(tile: WorldTile, area: WorldArea): boolean {
    return tile.level === area.level && tile.x >= area.minX && tile.x <= area.maxX && tile.z >= area.minZ && tile.z <= area.maxZ;
}

export function chebyshevDistance(a: WorldTile, b: WorldTile): number {
    if (a.level !== b.level) {
        return Number.POSITIVE_INFINITY;
    }

    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}
