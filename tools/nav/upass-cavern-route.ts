/** Which seam joins which pocket of the first cavern, and the chain between two of them.
 *
 *  Why: the level-1 platforms were solved offline because a runtime search over twenty identical bridges
 *  wandered. The first cavern has the same shape and the same failure — an end-to-end run walked into a
 *  161-tile pocket that carries no waypoint and never found its way out, from the same tile a passing leg
 *  had started on. So this solves that graph too, and the answer is baked into the module.
 *
 *  bun tools/nav/upass-cavern-route.ts
 */
import fs from 'node:fs';
import path from 'node:path';

import { gunzipSync } from 'fflate';

import { PathFinder, type NavPoint } from '#/bot/event/webwalk/PathFinder.js';

let bytes: Uint8Array = new Uint8Array(fs.readFileSync('out/collision.lcnav.gz'));
if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = gunzipSync(bytes);
}
const finder = new PathFinder(bytes);

/** The seams the first cavern is cut by, with the op the module crosses them on. */
const SEAMS: Record<number, string> = {
    3309: 'Climb-over',      // rockslide
    2275: 'Swing-on',        // rope swing
    2274: 'Swing-on',        // rope swing back
    3235: 'Squeeze-through', // obstacle pipe
    3264: 'Climb-into'       // the well
};

const MAPS = path.join(process.env.HOME ?? '', 'code/rs2b2t-content/maps');
const found: { id: number; tile: NavPoint }[] = [];
for (const name of fs.readdirSync(MAPS)) {
    const m = /^m(3[78])_(15[01])\.jm2$/.exec(name);
    if (!m) {
        continue;
    }
    const mx = Number(m[1]);
    const mz = Number(m[2]);
    let section = '';
    for (const line of fs.readFileSync(path.join(MAPS, name), 'utf8').split('\n')) {
        if (line.startsWith('====')) {
            section = line.replace(/=/g, '').trim();
            continue;
        }
        if (section !== 'LOC') {
            continue;
        }
        const [head, rest] = line.split(':');
        if (!head || !rest) {
            continue;
        }
        const id = Number(rest.trim().split(/\s+/)[0]);
        if (SEAMS[id] === undefined) {
            continue;
        }
        const [lvl, lx, lz] = head.trim().split(/\s+/).map(Number);
        if (lvl !== 0) {
            continue;
        }
        found.push({ id, tile: { x: mx * 64 + lx!, z: mz * 64 + lz!, level: 0 } });
    }
}

function pocketId(seed: NavPoint): string | null {
    const seen = new Set<number>();
    const stack = [seed];
    let smallest = Number.MAX_SAFE_INTEGER;
    while (stack.length > 0 && seen.size < 9000) {
        const t = stack.pop()!;
        const key = (t.x << 16) | t.z;
        if (seen.has(key)) {
            continue;
        }
        const probe = finder.findPath(seed, t, { policy: { useTeleports: false }, maxExpansions: 30_000 } as never);
        const last = probe.ok ? probe.waypoints[probe.waypoints.length - 1] : undefined;
        if (!probe.ok || !last || last.x !== t.x || last.z !== t.z) {
            continue;
        }
        seen.add(key);
        smallest = Math.min(smallest, key);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            stack.push({ x: t.x + dx!, z: t.z + dz!, level: 0 });
        }
    }
    return seen.size === 0 ? null : smallest.toString(16);
}

const cache = new Map<number, string | null>();
const idOf = (t: NavPoint): string | null => {
    const key = (t.x << 16) | t.z;
    if (!cache.has(key)) {
        cache.set(key, pocketId(t));
    }
    return cache.get(key)!;
};

const WAYPOINTS: [string, NavPoint][] = [
    ['bridge west', { x: 2442, z: 9716, level: 0 }],
    ['grid approach', { x: 2479, z: 9679, level: 0 }],
    ['area 1 landing', { x: 2496, z: 9714, level: 0 }],
    ['orb corridor', { x: 2422, z: 9671, level: 0 }],
    ['stranded pocket', { x: 2470, z: 9696, level: 0 }]
];

console.log('waypoint pockets:');
for (const [name, tile] of WAYPOINTS) {
    console.log(`  ${name.padEnd(18)} ${idOf(tile) ?? 'BLOCKED'}`);
}

console.log(`\n${found.length} seam loc(s) in the first cavern`);
for (const { id, tile } of found) {
    const sides: { tile: NavPoint; pocket: string }[] = [];
    const ring: [number, number][] = [];
    for (let d = 1; d <= 3; d++) {
        ring.push([d, 0], [-d, 0], [0, d], [0, -d]);
    }
    for (const [dx, dz] of ring) {
        const at = { x: tile.x + dx!, z: tile.z + dz!, level: 0 };
        const pocket = idOf(at);
        if (pocket !== null && !sides.some(s => s.pocket === pocket)) {
            sides.push({ tile: at, pocket });
        }
    }
    const names = sides.map(s => `${s.pocket}@${s.tile.x},${s.tile.z}`).join(' | ');
    console.log(`  ${SEAMS[id]} ${id} at (${tile.x},${tile.z}) joins ${sides.length}: ${names}`);
}
