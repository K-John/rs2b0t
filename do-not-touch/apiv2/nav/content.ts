import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

export const MAP_BLOCKED = 0x1;
export const MAP_LINK_BELOW = 0x2;

export interface LocPlacement {
    id: number;
    shape: number;
    angle: number;
    level: number;
    x: number;
    z: number;
}

export interface NpcSpawn {
    id: number;
    level: number;
    x: number;
    z: number;
}

export interface ContentWorld {
    locs: LocPlacement[];
    npcs: NpcSpawn[];
    landFlags: Map<number, number>;
    mapsquares: string[];
}

export function packCoord(level: number, x: number, z: number): number {
    return ((level & 0x3) << 28) | ((x & 0x3fff) << 14) | (z & 0x3fff);
}

export function unpackCoord(key: number): { level: number; x: number; z: number } {
    return { level: (key >>> 28) & 0x3, x: (key >>> 14) & 0x3fff, z: key & 0x3fff };
}

export const CONTENT_ROOT = join(import.meta.dir, '..', 'content');

function readMapsquare(text: string, baseX: number, baseZ: number, out: ContentWorld): void {
    let section = '';

    for (const raw of text.split('\n')) {
        const line = raw.trimEnd();
        if (!line) continue;

        if (line.startsWith('====')) {
            section = line.replace(/=/g, '').trim();
            continue;
        }

        const colon = line.indexOf(':');
        if (colon < 0) continue;

        const sp1 = line.indexOf(' ');
        const sp2 = line.indexOf(' ', sp1 + 1);
        if (sp1 < 0 || sp2 < 0) continue;

        const level = line.charCodeAt(0) - 48;
        const x = baseX + parseInt(line.slice(sp1 + 1, sp2));
        const z = baseZ + parseInt(line.slice(sp2 + 1, colon));
        const data = line.slice(colon + 2);

        if (section === 'MAP') {
            const f = / f(\d+)/.exec(` ${data}`);
            if (f) {
                out.landFlags.set(packCoord(level, x, z), parseInt(f[1]!));
            }
        } else if (section === 'LOC') {
            const parts = data.split(' ');
            out.locs.push({
                id: parseInt(parts[0]!),

                shape: parts.length > 1 ? parseInt(parts[1]!) : 10,
                angle: parts.length > 2 ? parseInt(parts[2]!) : 0,
                level, x, z,
            });
        } else if (section === 'NPC') {
            out.npcs.push({ id: parseInt(data), level, x, z });
        }

    }
}

let cached: ContentWorld | null = null;

export function readContentWorld(contentRoot?: string): ContentWorld {
    if (cached && !contentRoot) return cached;

    const root = contentRoot ?? CONTENT_ROOT;
    const mapsDir = join(root, 'maps');
    if (!existsSync(mapsDir)) {
        throw new Error(
            `sdk: no map content at ${mapsDir}. The content submodule is missing — run: git submodule update --init`
        );
    }

    const world: ContentWorld = { locs: [], npcs: [], landFlags: new Map(), mapsquares: [] };

    for (const file of readdirSync(mapsDir)) {
        const m = /^m(\d+)_(\d+)\.jm2$/.exec(file);
        if (!m) continue;

        const mx = parseInt(m[1]!);
        const mz = parseInt(m[2]!);
        readMapsquare(readFileSync(join(mapsDir, file), 'utf-8'), mx << 6, mz << 6, world);
        world.mapsquares.push(`${mx}_${mz}`);
    }

    if (world.mapsquares.length === 0) {
        throw new Error(`sdk: ${mapsDir} contains no m<x>_<z>.jm2 files`);
    }

    if (!contentRoot) cached = world;
    return world;
}

export function locPositions(contentRoot?: string): Map<number, LocPlacement[]> {
    const byId = new Map<number, LocPlacement[]>();
    for (const loc of readContentWorld(contentRoot).locs) {
        const list = byId.get(loc.id);
        if (list) list.push(loc);
        else byId.set(loc.id, [loc]);
    }
    return byId;
}

export function npcPositions(contentRoot?: string): Map<number, NpcSpawn[]> {
    const byId = new Map<number, NpcSpawn[]>();
    for (const npc of readContentWorld(contentRoot).npcs) {
        const list = byId.get(npc.id);
        if (list) list.push(npc);
        else byId.set(npc.id, [npc]);
    }
    return byId;
}

let locNames: Map<string, number> | null = null;

export function locIdsByName(contentRoot?: string): Map<string, number> {
    if (locNames && !contentRoot) return locNames;

    const path = join(contentRoot ?? CONTENT_ROOT, 'pack', 'loc.pack');
    const map = new Map<string, number>();

    if (existsSync(path)) {
        for (const line of readFileSync(path, 'utf-8').split('\n')) {
            const eq = line.indexOf('=');
            if (eq < 1) continue;

            const id = parseInt(line.slice(0, eq));
            const name = line.slice(eq + 1).trim();
            if (Number.isFinite(id) && name) map.set(name, id);
        }
    }

    if (!contentRoot) locNames = map;
    return map;
}

export interface LocDef {

    name: string;

    label?: string;
    category?: string;

    ops: string[];

    width: number;
    length: number;
    blockwalk: boolean;
    blockrange: boolean;
    active: number;

    forceapproach: number;
}

let locDefs: Map<string, LocDef> | null = null;

export function readLocDefs(contentRoot?: string): Map<string, LocDef> {
    if (locDefs && !contentRoot) return locDefs;

    const root = contentRoot ?? CONTENT_ROOT;
    const defs = new Map<string, LocDef>();

    const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.loc')) parseLocFile(readFileSync(full, 'utf-8'), defs);
        }
    };

    const scripts = join(root, 'scripts');
    if (existsSync(scripts)) walk(scripts);

    if (!contentRoot) locDefs = defs;
    return defs;
}

const FORCE_APPROACH: Record<string, number> = {
    north: 0b1111 & ~0b0001,
    east: 0b1111 & ~0b0010,
    south: 0b1111 & ~0b0100,
    west: 0b1111 & ~0b1000,
};

function parseLocFile(text: string, out: Map<string, LocDef>): void {
    let current: LocDef | null = null;

    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('//')) continue;

        if (line.startsWith('[') && line.endsWith(']')) {
            current = {
                name: line.slice(1, -1), ops: [],
                width: 1, length: 1, blockwalk: true, blockrange: true, active: 0, forceapproach: 0,
            };
            out.set(current.name, current);
            continue;
        }
        if (!current) continue;

        const eq = line.indexOf('=');
        if (eq < 1) continue;

        const key = line.slice(0, eq);
        const value = line.slice(eq + 1).trim();

        if (key === 'name') current.label = value;
        else if (key === 'category') current.category = value;
        else if (/^op\d$/.test(key)) current.ops.push(value);
        else if (key === 'width') current.width = parseInt(value) || 1;
        else if (key === 'length') current.length = parseInt(value) || 1;
        else if (key === 'blockwalk') current.blockwalk = value !== 'no';
        else if (key === 'blockrange') current.blockrange = value !== 'no';
        else if (key === 'active') current.active = value === 'yes' ? 1 : 0;
        else if (key === 'forceapproach') current.forceapproach = FORCE_APPROACH[value] ?? 0b1111;
    }
}
