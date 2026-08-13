import * as rsmod from '../vendor/rsmod-pathfinder';

import {
    MAP_BLOCKED,
    MAP_LINK_BELOW,
    locIdsByName,
    packCoord,
    readContentWorld,
    readLocDefs,
    type LocDef,
} from './content';

import { DIRS, edgeKey, idxOf, type DoorPlacement, type DoorTable } from './types';

const MAP_REMOVE_ROOFS = 0x4;

const LAYER_WALL = 0;
const LAYER_GROUND = 2;
const LAYER_GROUND_DECOR = 3;

const ANGLE_NORTH = 1;
const ANGLE_SOUTH = 3;

const MAZE_NAME = /^mac(?:ro|or)_maze_wall/;

const ONE_WAY_DOORS = new Set<string>([
    '0,3108,3353',
    '0,3109,3353',
    '0,3268,3227',
    '0,3268,3228',
]);

function bridgedLevel(landFlags: Map<number, number>, level: number, x: number, z: number): number {
    const source = landFlags.get(packCoord(1, x, z)) ?? 0;
    return (source & MAP_LINK_BELOW) === MAP_LINK_BELOW ? level - 1 : level;
}

let collisionStats: { zones: number; tiles: number; locs: number } | null = null;

export function buildCollisionGrid(): { zones: number; tiles: number; locs: number } {
    if (collisionStats) return collisionStats;

    const world = readContentWorld();
    const defs = readLocDefs();

    const defsById = new Map<number, LocDef>();
    for (const [name, id] of locIdsByName()) {
        const def = defs.get(name);
        if (def) defsById.set(id, def);
    }

    const zones = new Set<number>();
    const allocate = (level: number, x: number, z: number): void => {
        const key = packCoord(level, x & ~7, z & ~7);
        if (zones.has(key)) return;
        zones.add(key);
        rsmod.allocateIfAbsent(x, z, level);
    };

    for (const square of world.mapsquares) {
        const [mx, mz] = square.split('_').map(Number);
        const baseX = mx! << 6;
        const baseZ = mz! << 6;
        for (let level = 0; level < 4; level++) {
            for (let zx = 0; zx < 8; zx++) {
                for (let zz = 0; zz < 8; zz++) allocate(level, baseX + (zx << 3), baseZ + (zz << 3));
            }
        }
    }

    let tiles = 0;
    for (const [key, flags] of world.landFlags) {
        const level = (key >>> 28) & 0x3;
        const x = (key >>> 14) & 0x3fff;
        const z = key & 0x3fff;

        if ((flags & MAP_REMOVE_ROOFS) !== 0) {
            allocate(level, x, z);
            rsmod.changeRoof(x, z, level, true);
        }

        if ((flags & MAP_BLOCKED) !== MAP_BLOCKED) continue;

        const actual = bridgedLevel(world.landFlags, level, x, z);
        if (actual < 0) continue;

        allocate(actual, x, z);
        rsmod.changeFloor(x, z, actual, true);
        tiles++;
    }

    let locs = 0;
    for (const loc of world.locs) {
        const def = defsById.get(loc.id);
        if (!def || !def.blockwalk) continue;

        const actual = bridgedLevel(world.landFlags, loc.level, loc.x, loc.z);
        if (actual < 0) continue;

        allocate(actual, loc.x, loc.z);

        const layer = rsmod.locShapeLayer(loc.shape);
        if (layer === LAYER_WALL) {
            rsmod.changeWall(loc.x, loc.z, actual, loc.angle, loc.shape, def.blockrange, false, true);
        } else if (layer === LAYER_GROUND) {
            if (loc.angle === ANGLE_NORTH || loc.angle === ANGLE_SOUTH) {
                rsmod.changeLoc(loc.x, loc.z, actual, def.length, def.width, def.blockrange, false, true);
            } else {
                rsmod.changeLoc(loc.x, loc.z, actual, def.width, def.length, def.blockrange, false, true);
            }
        } else if (layer === LAYER_GROUND_DECOR && def.active === 1) {
            rsmod.changeFloor(loc.x, loc.z, actual, true);
        }
        locs++;
    }

    collisionStats = { zones: zones.size, tiles, locs };
    return collisionStats;
}

export interface DoorCensus {
    readonly doors: readonly DoorPlacement[];
    readonly maze: readonly DoorPlacement[];
    readonly oneWay: readonly DoorPlacement[];
    readonly offLayer: readonly DoorPlacement[];
}

export function findDoors(): DoorCensus {
    const world = readContentWorld();
    const defs = readLocDefs();

    const nameById = new Map<number, string>();
    const mazeIds = new Set<number>();
    const openable = new Map<number, LocDef>();
    for (const [name, id] of locIdsByName()) {
        nameById.set(id, name);
        if (MAZE_NAME.test(name)) mazeIds.add(id);

        const def = defs.get(name);
        if (!def || !def.blockwalk) continue;
        if (!def.ops.some(op => /^open$/i.test(op))) continue;
        openable.set(id, def);
    }

    const doors: DoorPlacement[] = [];
    const maze: DoorPlacement[] = [];
    const oneWay: DoorPlacement[] = [];
    const offLayer: DoorPlacement[] = [];

    for (const loc of world.locs) {
        const def = openable.get(loc.id);
        if (!def) continue;

        const level = bridgedLevel(world.landFlags, loc.level, loc.x, loc.z);
        if (level < 0) continue;

        const placement: DoorPlacement = {
            level,
            x: loc.x,
            z: loc.z,
            locId: loc.id,
            locName: nameById.get(loc.id) ?? `loc_${loc.id}`,
            shape: loc.shape,
            angle: loc.angle,
            blockrange: def.blockrange,
        };

        if (rsmod.locShapeLayer(loc.shape) !== LAYER_WALL) offLayer.push(placement);
        else if (mazeIds.has(loc.id)) maze.push(placement);
        else if (ONE_WAY_DOORS.has(`${level},${loc.x},${loc.z}`)) oneWay.push(placement);
        else doors.push(placement);
    }

    return { doors, maze, oneWay, offLayer };
}

export function openDoors(doors: readonly DoorPlacement[]): void {
    for (const door of doors) {
        rsmod.changeWall(door.x, door.z, door.level, door.angle, door.shape, door.blockrange, false, false);
    }
}

const RADIUS = 2;

export function buildDoorTable(doors: readonly DoorPlacement[]): DoorTable {
    const blockedBy = new Map<number, number[]>();
    const wasOpen: boolean[] = new Array(((RADIUS * 2 + 1) ** 2) * 8);

    for (let di = 0; di < doors.length; di++) {
        const door = doors[di]!;

        let p = 0;
        for (let dx = -RADIUS; dx <= RADIUS; dx++) {
            for (let dz = -RADIUS; dz <= RADIUS; dz++) {
                for (const dir of DIRS) {
                    wasOpen[p++] = rsmod.canTravel(door.level, door.x + dx, door.z + dz, dir.dx, dir.dz, 1, 0, 0);
                }
            }
        }

        rsmod.changeWall(door.x, door.z, door.level, door.angle, door.shape, door.blockrange, false, true);

        p = 0;
        for (let dx = -RADIUS; dx <= RADIUS; dx++) {
            for (let dz = -RADIUS; dz <= RADIUS; dz++) {
                for (let k = 0; k < 8; k++) {
                    const dir = DIRS[k]!;
                    const open = rsmod.canTravel(door.level, door.x + dx, door.z + dz, dir.dx, dir.dz, 1, 0, 0);
                    if (!wasOpen[p++] || open) continue;

                    const idx = idxOf(door.level, door.x + dx, door.z + dz);
                    if (idx < 0) continue;

                    const key = edgeKey(idx, k);
                    const claimed = blockedBy.get(key);
                    if (claimed) claimed.push(di);
                    else blockedBy.set(key, [di]);
                }
            }
        }

        rsmod.changeWall(door.x, door.z, door.level, door.angle, door.shape, door.blockrange, false, false);
    }

    return { doors, blockedBy };
}
