import type { WorldTile } from '../snapshots/GameSnapshot.js';

export interface WorldArea {
    readonly minX: number;
    readonly maxX: number;
    readonly minZ: number;
    readonly maxZ: number;
    readonly level: number;
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
