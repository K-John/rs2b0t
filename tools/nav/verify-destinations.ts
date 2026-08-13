import { router } from '../../do-not-touch/apiv2/nav/router.js';
import { stepGrid } from '../../do-not-touch/apiv2/nav/grid.js';
import { idxOf } from '../../do-not-touch/apiv2/nav/types.js';

interface Candidate {
    readonly group: string;
    readonly label: string;
    readonly x: number;
    readonly z: number;
    readonly level: number;
}

const ORIGINS: readonly { label: string; x: number; z: number; level: number }[] = [
    { label: 'Lumbridge', x: 3222, z: 3218, level: 0 },
    { label: 'Falador', x: 3013, z: 3356, level: 0 },
    { label: 'Seers', x: 2725, z: 3491, level: 0 },
];

const CANDIDATES: readonly Candidate[] = [
    { group: 'Banks', label: 'Varrock West bank', x: 3185, z: 3440, level: 0 },
    { group: 'Banks', label: 'Varrock East bank', x: 3251, z: 3420, level: 0 },
    { group: 'Banks', label: 'Draynor bank', x: 3092, z: 3243, level: 0 },
    { group: 'Banks', label: 'Falador East bank', x: 3013, z: 3356, level: 0 },
    { group: 'Banks', label: 'Falador West bank', x: 2946, z: 3368, level: 0 },
    { group: 'Banks', label: 'Edgeville bank', x: 3094, z: 3491, level: 0 },
    { group: 'Banks', label: 'Al Kharid bank', x: 3269, z: 3167, level: 0 },
    { group: 'Banks', label: "Seers' Village bank", x: 2725, z: 3491, level: 0 },
    { group: 'Banks', label: 'Catherby bank', x: 2809, z: 3441, level: 0 },
    { group: 'Banks', label: 'Ardougne South bank', x: 2655, z: 3286, level: 0 },
    { group: 'Banks', label: 'Ardougne North bank', x: 2617, z: 3332, level: 0 },
    { group: 'Banks', label: 'Yanille bank', x: 2612, z: 3093, level: 0 },
    { group: 'Banks', label: 'Fishing Guild bank', x: 2586, z: 3420, level: 0 },
    { group: 'Banks', label: 'Rellekka bank', x: 2649, z: 3661, level: 0 },
    { group: 'Banks', label: 'Varrock GE area', x: 3165, z: 3489, level: 0 },

    { group: 'Cities', label: 'Lumbridge Castle', x: 3222, z: 3218, level: 0 },
    { group: 'Cities', label: 'Varrock Square', x: 3212, z: 3428, level: 0 },
    { group: 'Cities', label: 'Falador Park', x: 2995, z: 3375, level: 0 },
    { group: 'Cities', label: 'Draynor Village', x: 3093, z: 3250, level: 0 },
    { group: 'Cities', label: 'Al Kharid Palace', x: 3293, z: 3169, level: 0 },
    { group: 'Cities', label: 'Port Sarim docks', x: 3029, z: 3217, level: 0 },
    { group: 'Cities', label: 'Rimmington', x: 2957, z: 3215, level: 0 },
    { group: 'Cities', label: 'Barbarian Village', x: 3082, z: 3420, level: 0 },
    { group: 'Cities', label: 'Edgeville', x: 3087, z: 3495, level: 0 },
    { group: 'Cities', label: 'Taverley', x: 2895, z: 3443, level: 0 },
    { group: 'Cities', label: 'Burthorpe', x: 2899, z: 3545, level: 0 },
    { group: 'Cities', label: 'Catherby', x: 2810, z: 3435, level: 0 },
    { group: 'Cities', label: 'Camelot', x: 2757, z: 3477, level: 0 },
    { group: 'Cities', label: 'East Ardougne', x: 2662, z: 3305, level: 0 },
    { group: 'Cities', label: 'Yanille', x: 2605, z: 3096, level: 0 },
    { group: 'Cities', label: 'Rellekka', x: 2660, z: 3660, level: 0 },
    { group: 'Cities', label: 'Port Khazard', x: 2661, z: 3160, level: 0 },
    { group: 'Cities', label: 'Gnome Stronghold', x: 2461, z: 3428, level: 0 },
    { group: 'Cities', label: 'Canifis', x: 3495, z: 3489, level: 0 },
    { group: 'Cities', label: 'Shilo Village', x: 2852, z: 2954, level: 0 },
    { group: 'Cities', label: 'Brimhaven', x: 2758, z: 3178, level: 0 },
    { group: 'Cities', label: 'Ardougne Zoo', x: 2607, z: 3282, level: 0 },
    { group: 'Cities', label: 'Hemenster', x: 2636, z: 3441, level: 0 },
    { group: 'Cities', label: 'Sinclair Mansion', x: 2732, z: 3574, level: 0 },
    { group: 'Cities', label: 'Wilderness gate', x: 3087, z: 3520, level: 0 },
];

const nav = router();
const grid = stepGrid();

function nearestWalkable(level: number, x: number, z: number, radius = 6): { x: number; z: number } | null {
    for (let r = 0; r <= radius; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
                const i = idxOf(level, x + dx, z + dz);
                if (i >= 0 && grid.steps[i] !== 0) return { x: x + dx, z: z + dz };
            }
        }
    }
    return null;
}

interface Result { readonly c: Candidate; readonly ok: boolean; readonly detail: string; readonly at: string }
const results: Result[] = [];

for (const c of CANDIDATES) {
    const spot = nearestWalkable(c.level, c.x, c.z);
    if (spot === null) {
        results.push({ c, ok: false, detail: 'no walkable tile within 6', at: `${c.x},${c.z}` });
        continue;
    }
    const moved = spot.x !== c.x || spot.z !== c.z;
    const at = `${spot.x},${spot.z}${moved ? ' (nudged)' : ''}`;
    const to = idxOf(c.level, spot.x, spot.z);

    const reached: string[] = [];
    const failed: string[] = [];
    let legs = 0;
    let tiles = 0;

    for (const o of ORIGINS) {
        const route = nav.route(idxOf(o.level, o.x, o.z), to);
        if (route.ok) {
            reached.push(o.label);
            legs = Math.max(legs, route.legs.length);
            tiles = Math.max(tiles, route.tiles);
        } else {
            failed.push(o.label);
        }
    }

    const ok = failed.length === 0;
    results.push({
        c,
        ok,
        at,
        detail: ok ? `${legs} legs, up to ${tiles} tiles` : `unreachable from ${failed.join(', ')}`,
    });
}

console.log('\n# Destination routability\n');
let group = '';
for (const r of results) {
    if (r.c.group !== group) {
        group = r.c.group;
        console.log(`\n## ${group}\n`);
        console.log('| Destination | Tile | Routable | Detail |');
        console.log('|---|---|---|---|');
    }
    console.log(`| ${r.c.label} | ${r.at} | ${r.ok ? 'YES' : 'NO'} | ${r.detail} |`);
}

const pass = results.filter(r => r.ok).length;
console.log(`\n**${pass} of ${results.length} routable from all three origins**`);
