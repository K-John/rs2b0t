import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

import * as rsmod from '../vendor/rsmod-pathfinder';

import {
    CONTENT_ROOT,
    MAP_BLOCKED,
    MAP_LINK_BELOW,
    locIdsByName,
    packCoord,
    readContentWorld,
    readLocDefs,
    type LocDef,
} from './content';

import { findDoors } from './doors';
import { DIRS, LEVELS, N, PLANE, X0, X1, XSPAN, Z0, Z1, idxOf, type StepGrid } from './types';

export { rsmod };

const MAP_REMOVE_ROOFS = 0x4;

const LAYER_WALL = 0;
const LAYER_GROUND = 2;
const LAYER_GROUND_DECOR = 3;

const ANGLE_NORTH = 1;
const ANGLE_SOUTH = 3;

const WALK_BLOCKED = 2359552;

const COLLISION_NORMAL = 0;

const ENCODING_VERSION = 1;

let worldBuilt = false;

export function buildWorldCollision(): void {
    if (worldBuilt) return;
    worldBuilt = true;

    const world = readContentWorld();
    const defs = readLocDefs();

    const defsById = new Map<number, LocDef>();
    for (const [name, id] of locIdsByName()) {
        const def = defs.get(name);
        if (def) defsById.set(id, def);
    }

    for (const square of world.mapsquares) {
        const [mx, mz] = square.split('_').map(Number);
        const baseX = mx! << 6;
        const baseZ = mz! << 6;
        for (let level = 0; level < LEVELS; level++) {
            for (let zx = 0; zx < 8; zx++) {
                for (let zz = 0; zz < 8; zz++) {
                    rsmod.allocateIfAbsent(baseX + (zx << 3), baseZ + (zz << 3), level);
                }
            }
        }
    }

    for (const [key, flags] of world.landFlags) {
        const level = (key >>> 28) & 0x3;
        const x = (key >>> 14) & 0x3fff;
        const z = key & 0x3fff;

        if ((flags & MAP_REMOVE_ROOFS) !== 0) rsmod.changeRoof(x, z, level, true);
        if ((flags & MAP_BLOCKED) !== MAP_BLOCKED) continue;

        const actual = bridgedLevel(world.landFlags, level, x, z);
        if (actual < 0) continue;
        rsmod.changeFloor(x, z, actual, true);
    }

    for (const loc of world.locs) {
        const def = defsById.get(loc.id);
        if (!def || !def.blockwalk) continue;

        const actual = bridgedLevel(world.landFlags, loc.level, loc.x, loc.z);
        if (actual < 0) continue;

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
    }
}

function shutEveryDoor(): void {
    const census = findDoors();
    for (const door of [...census.doors, ...census.maze, ...census.oneWay]) {
        rsmod.changeWall(door.x, door.z, door.level, door.angle, door.shape, door.blockrange, false, true);
    }
}

function bridgedLevel(landFlags: Map<number, number>, level: number, x: number, z: number): number {
    const source = landFlags.get(packCoord(1, x, z)) ?? 0;
    return (source & MAP_LINK_BELOW) === MAP_LINK_BELOW ? level - 1 : level;
}

function flooredZones(): Set<number> {
    const world = readContentWorld();
    const zones = new Set<number>();

    for (const key of world.landFlags.keys()) {
        const level = (key >>> 28) & 0x3;
        if (level === 0) continue;
        zones.add(packCoord(level, ((key >>> 14) & 0x3fff) & ~7, (key & 0x3fff) & ~7));
    }
    for (const loc of world.locs) {
        if (loc.level === 0) continue;
        zones.add(packCoord(loc.level, loc.x & ~7, loc.z & ~7));
    }
    return zones;
}

export interface GridReport {
    readonly grid: StepGrid;
    readonly source: 'cache' | 'content';
    readonly ms: number;
    readonly worldMs: number;
    readonly probeMs: number;
    readonly probes: number;
}

export function buildStepGrid(): GridReport {
    const started = performance.now();

    const worldStarted = performance.now();
    buildWorldCollision();
    shutEveryDoor();
    const worldMs = performance.now() - worldStarted;

    if (PLANE * LEVELS !== N) throw new Error(`nav/grid: PLANE * LEVELS is ${PLANE * LEVELS}, N is ${N}`);
    if (idxOf(LEVELS - 1, X1 - 1, Z1 - 1) !== N - 1) throw new Error('nav/grid: idxOf does not reach N-1');

    const steps = new Uint8Array(N);
    if (steps.length !== N) throw new Error(`nav/grid: allocated ${steps.length} step masks, wanted ${N}`);

    const floored = flooredZones();
    const world = readContentWorld();
    const openPerLevel = [0, 0, 0, 0];
    let probes = 0;
    let outsideBox = 0;

    const probeStarted = performance.now();
    for (const square of world.mapsquares) {
        const [mx, mz] = square.split('_').map(Number);
        const baseX = mx! << 6;
        const baseZ = mz! << 6;

        for (let level = 0; level < LEVELS; level++) {
            for (let z = baseZ; z < baseZ + 64; z++) {
                for (let x = baseX; x < baseX + 64; x++) {
                    if (x < X0 || x >= X1 || z < Z0 || z >= Z1) {
                        outsideBox++;
                        continue;
                    }
                    if (level > 0 && !floored.has(packCoord(level, x & ~7, z & ~7))) continue;
                    if (rsmod.isFlagged(x, z, level, WALK_BLOCKED)) continue;

                    let mask = 0;
                    for (const dir of DIRS) {
                        if (rsmod.canTravel(level, x, z, dir.dx, dir.dz, 1, 0, COLLISION_NORMAL)) mask |= dir.bit;
                    }
                    probes += 8;
                    if (mask === 0) continue;

                    steps[level * PLANE + (z - Z0) * XSPAN + (x - X0)] = mask;
                    openPerLevel[level]!++;
                }
            }
        }
    }
    const probeMs = performance.now() - probeStarted;

    if (outsideBox !== 0) throw new Error(`nav/grid: ${outsideBox} mapsquare tiles fall outside the box in types.ts`);

    const grid: StepGrid = { steps, openPerLevel };
    writeCache(grid);

    return { grid, source: 'content', ms: performance.now() - started, worldMs, probeMs, probes };
}

let memo: GridReport | null = null;

export function stepGridReport(): GridReport {
    if (memo) return memo;

    const started = performance.now();
    const cached = readCache();
    if (cached) {

        const worldStarted = performance.now();
        buildWorldCollision();
        shutEveryDoor();
        const worldMs = performance.now() - worldStarted;

        memo = { grid: cached, source: 'cache', ms: performance.now() - started, worldMs, probeMs: 0, probes: 0 };
        return memo;
    }

    memo = buildStepGrid();
    return memo;
}

export function stepGrid(): StepGrid {
    return stepGridReport().grid;
}

const CACHE_DIR = join(import.meta.dir, '..', '..', 'node_modules', '.cache', 'apiv2-nav');

const HEADER_BYTES = 16;

function cachePath(): string {
    const hash = createHash('sha1');
    hash.update(`v${ENCODING_VERSION}\n`);

    const stamp = (path: string): void => {
        const s = statSync(path);
        hash.update(`${path}:${s.size}:${s.mtimeMs}\n`);
    };

    const maps = join(CONTENT_ROOT, 'maps');
    for (const file of readdirSync(maps).sort()) {
        if (/^m\d+_\d+\.jm2$/.test(file)) stamp(join(maps, file));
    }
    stamp(join(CONTENT_ROOT, 'pack', 'loc.pack'));

    const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.loc')) stamp(full);
        }
    };
    walk(join(CONTENT_ROOT, 'scripts'));

    return join(CACHE_DIR, `steps-${hash.digest('hex').slice(0, 16)}.bin`);
}

function readCache(): StepGrid | null {
    const path = cachePath();
    if (!existsSync(path)) return null;

    const buf = readFileSync(path);

    if (buf.byteLength !== HEADER_BYTES + N) return null;

    const header = new DataView(buf.buffer, buf.byteOffset, HEADER_BYTES);
    const openPerLevel = [0, 1, 2, 3].map(l => header.getUint32(l * 4, true));
    const steps = new Uint8Array(buf.buffer, buf.byteOffset + HEADER_BYTES, N);

    return { steps, openPerLevel };
}

function writeCache(grid: StepGrid): void {
    mkdirSync(CACHE_DIR, { recursive: true });

    const path = cachePath();

    for (const file of readdirSync(CACHE_DIR)) {
        const other = join(CACHE_DIR, file);
        if (file.startsWith('steps-') && file.endsWith('.bin') && other !== path) rmSync(other);
    }

    const out = new Uint8Array(HEADER_BYTES + N);
    const header = new DataView(out.buffer, 0, HEADER_BYTES);
    for (let l = 0; l < LEVELS; l++) header.setUint32(l * 4, grid.openPerLevel[l] ?? 0, true);
    out.set(grid.steps, HEADER_BYTES);

    writeFileSync(path, out);
}
