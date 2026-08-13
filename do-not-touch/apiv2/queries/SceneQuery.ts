import { CollisionFlag } from '#/client/dash3d/CollisionFlag.js';
import { canReachLocal, canStepLocal } from '#/bot/event/webwalk/geometry/localReach.js';
import type { LocalTile, LocSnapshot, SceneSnapshot, WorldTile } from '../snapshots/GameSnapshot.js';
import { canOperateFrom as locCanOperateFrom, operableTiles as locOperableTiles } from './LocApproach.js';

export interface SceneReachOptions {
    readonly maxSteps?: number;
    readonly adjacentOk?: boolean;
}

function localInBounds(snapshot: SceneSnapshot, tile: LocalTile): boolean {
    return tile.lx >= 0 && tile.lz >= 0 && tile.lx < snapshot.width && tile.lz < snapshot.height;
}

export class SceneQuery {
    constructor(
        private readonly snapshot: SceneSnapshot,
        private readonly playerTile: WorldTile | null
    ) {}

    contains(tile: WorldTile): boolean {
        if (!this.snapshot.available || tile.level !== this.snapshot.level) return false;
        const lx = tile.x - this.snapshot.baseX;
        const lz = tile.z - this.snapshot.baseZ;
        return lx >= 0 && lz >= 0 && lx < this.snapshot.width && lz < this.snapshot.height;
    }

    base(): { x: number; z: number; level: number } {
        return { x: this.snapshot.baseX, z: this.snapshot.baseZ, level: this.snapshot.level };
    }

    toLocal(tile: WorldTile): LocalTile | null {
        if (!this.contains(tile)) return null;
        return { lx: tile.x - this.snapshot.baseX, lz: tile.z - this.snapshot.baseZ };
    }

    toWorld(tile: LocalTile): WorldTile | null {
        if (!this.snapshot.available || !localInBounds(this.snapshot, tile)) return null;
        return { x: this.snapshot.baseX + tile.lx, z: this.snapshot.baseZ + tile.lz, level: this.snapshot.level };
    }

    collisionAt(tile: WorldTile): number | null {
        const local = this.toLocal(tile);
        return local === null ? null : this.collisionAtLocal(local);
    }

    collisionAtLocal(tile: LocalTile): number | null {
        if (!this.snapshot.available || !localInBounds(this.snapshot, tile)) return null;
        return this.snapshot.collisionFlags[tile.lx * this.snapshot.height + tile.lz] ?? null;
    }

    probeable(tile: WorldTile): boolean {
        return this.collisionAt(tile) !== null;
    }

    walkable(tile: WorldTile): boolean {
        const flags = this.collisionAt(tile);
        return flags !== null && (flags & CollisionFlag.SQ_BLOCKED) === CollisionFlag._OPEN;
    }

    canStep(from: WorldTile, to: WorldTile): boolean {
        if (from.level !== to.level) return false;
        const dx = to.x - from.x;
        const dz = to.z - from.z;
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== 1) return false;
        const local = this.toLocal(from);
        if (local === null || this.toLocal(to) === null) return false;
        return canStepLocal((lx, lz) => this.collisionAtLocal({ lx, lz }), local.lx, local.lz, dx, dz);
    }

    canOperateFrom(loc: LocSnapshot, from: WorldTile): boolean | null {
        return locCanOperateFrom(loc, this.snapshot, from);
    }

    operableTiles(loc: LocSnapshot): WorldTile[] | null {
        return locOperableTiles(loc, this.snapshot);
    }

    canReach(destination: WorldTile, options?: SceneReachOptions): boolean {
        if (this.playerTile === null || this.playerTile.level !== destination.level) return false;
        const from = this.toLocal(this.playerTile);
        const to = this.toLocal(destination);
        if (from === null || to === null) return false;
        return canReachLocal((lx, lz) => this.collisionAtLocal({ lx, lz }), from, to, options);
    }
}
