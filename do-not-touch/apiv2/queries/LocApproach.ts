import { CollisionFlag } from '#/client/dash3d/CollisionFlag.js';
import type { LocSnapshot, SceneSnapshot, WorldTile } from '../snapshots/GameSnapshot.js';

const FOOTPRINT_SHAPES = new Set([10, 11, 22]);

const FORCE_NORTH = 0x1;
const FORCE_EAST = 0x2;
const FORCE_SOUTH = 0x4;
const FORCE_WEST = 0x8;

function rotateForceApproach(forceApproach: number, angle: number): number {
    if (angle === 0) return forceApproach;
    return ((forceApproach << angle) & 0xf) | (forceApproach >> (4 - angle));
}

function collisionAt(scene: SceneSnapshot, lx: number, lz: number): number {
    if (lx < 0 || lz < 0 || lx >= scene.width || lz >= scene.height) return CollisionFlag.SQ_BLOCKED;
    return scene.collisionFlags[lx * scene.height + lz] ?? CollisionFlag.SQ_BLOCKED;
}

function testLoc(
    srcX: number, srcZ: number,
    dstX: number, dstZ: number,
    sizeX: number, sizeZ: number,
    forceApproach: number,
    scene: SceneSnapshot
): boolean {
    const maxX = dstX + sizeX - 1;
    const maxZ = dstZ + sizeZ - 1;

    if (srcX >= dstX && srcX <= maxX && srcZ >= dstZ && srcZ <= maxZ) return true;

    if (srcX === dstX - 1 && srcZ >= dstZ && srcZ <= maxZ
        && (collisionAt(scene, srcX, srcZ) & CollisionFlag.W_E) === 0
        && (forceApproach & FORCE_WEST) === 0) return true;

    if (srcX === maxX + 1 && srcZ >= dstZ && srcZ <= maxZ
        && (collisionAt(scene, srcX, srcZ) & CollisionFlag.W_W) === 0
        && (forceApproach & FORCE_EAST) === 0) return true;

    if (srcZ === dstZ - 1 && srcX >= dstX && srcX <= maxX
        && (collisionAt(scene, srcX, srcZ) & CollisionFlag.W_N) === 0
        && (forceApproach & FORCE_SOUTH) === 0) return true;

    if (srcZ === maxZ + 1 && srcX >= dstX && srcX <= maxX
        && (collisionAt(scene, srcX, srcZ) & CollisionFlag.W_S) === 0
        && (forceApproach & FORCE_NORTH) === 0) return true;

    return false;
}

export function canOperateFrom(loc: LocSnapshot, scene: SceneSnapshot, from: WorldTile): boolean | null {
    if (!FOOTPRINT_SHAPES.has(loc.shape)) return null;
    if (!scene.available || from.level !== scene.level || loc.tile.level !== scene.level) return null;

    const srcX = from.x - scene.baseX;
    const srcZ = from.z - scene.baseZ;
    if (srcX < 0 || srcZ < 0 || srcX >= scene.width || srcZ >= scene.height) return false;

    const dstX = loc.tile.x - scene.baseX;
    const dstZ = loc.tile.z - scene.baseZ;
    const forceApproach = rotateForceApproach(loc.forceApproach, loc.angle);

    return testLoc(srcX, srcZ, dstX, dstZ, loc.footprintWidth, loc.footprintLength, forceApproach, scene);
}

export function operableTiles(loc: LocSnapshot, scene: SceneSnapshot): WorldTile[] | null {
    if (!FOOTPRINT_SHAPES.has(loc.shape)) return null;
    if (!scene.available || loc.tile.level !== scene.level) return null;

    const dstX = loc.tile.x - scene.baseX;
    const dstZ = loc.tile.z - scene.baseZ;
    const forceApproach = rotateForceApproach(loc.forceApproach, loc.angle);
    const sizeX = loc.footprintWidth;
    const sizeZ = loc.footprintLength;

    const tiles: WorldTile[] = [];

    for (let lx = Math.max(0, dstX - 1); lx <= Math.min(scene.width - 1, dstX + sizeX); lx++) {
        for (let lz = Math.max(0, dstZ - 1); lz <= Math.min(scene.height - 1, dstZ + sizeZ); lz++) {
            if ((collisionAt(scene, lx, lz) & CollisionFlag.SQ_BLOCKED) !== 0) continue;
            if (testLoc(lx, lz, dstX, dstZ, sizeX, sizeZ, forceApproach, scene)) {
                tiles.push({ x: scene.baseX + lx, z: scene.baseZ + lz, level: scene.level });
            }
        }
    }

    return tiles;
}
