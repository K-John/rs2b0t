import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { CONTENT_ROOT } from './content';
import type { TickCosts } from './types';

export const PER_STEP = 0.5;

export const OP_BASE = 1;

export function walkTicks(tiles: number): number {
    return Math.ceil(tiles * PER_STEP);
}

const BY_NAME: readonly (readonly [string, number])[] = [
    ['ship_ladder', 2],
    ['ship_laddertop', 2],
    ['laddertop', 2],
    ['ladder', 2],
    ['laddermiddle', 2],
    ['laddertop_directional', 2],
    ['ladder_directional', 2],
    ['ladder_cellar', 2],
    ['ladder_from_cellar', 2],
    ['ladder_from_cellar_directional', 2],
    ['ladder_cellar_inside_down', 2],
    ['phoenixladder', 2],
    ['grandtree_laddermiddle', 2],
    ['laddertop_norim', 2],

    ['shipladder_angled', 1],
    ['shipladder_top_angled', 1],

    ['wizards_tower_laddertop', 1],
    ['wizards_tower_ladder', 1],

    ['stairs', 1],
    ['stairstop', 1],
    ['spookystairs', 1],
    ['spookystairstop', 1],
    ['stairs_cellar', 1],
    ['loc_1734', 1],
    ['loc_1736', 1],
    ['outdoorstairs_wooden_bottom', 1],
    ['cryptstairsdown', 1],
    ['cryptstairsup', 1],
    ['board_game_stairs_top', 1],
    ['board_game_stairs_base', 1],
    ['board_game_stairs_grey_all', 1],
    ['board_game_stairs_grey_top', 1],
    ['board_game_stairs_grey_base', 1],
    ['board_game_stairs_grey_base2', 1],

    ['yanillestairsdown', 0],
    ['yanillestairsup', 0],
    ['spiralstairs', 0],
    ['spiralstairsmiddle', 0],
    ['spiralstairstop', 0],
    ['spiralstairs_wooden', 0],
    ['spiralstairstop_wooden', 0],
    ['balance40up', 0],
    ['woodenstairs', 0],
    ['woodenstairstop', 0],

    ['membergatel', 0],
    ['membergater', 0],

    ['viking_fur_door', 0],
    ['viking_fur_door_open', 0],
    ['loc_1528', 0],

    ['fullstyle', 1],
    ['watchshortcut', 0],
    ['castlecrumbly', 2],
];

const BY_CATEGORY: readonly (readonly [string, number])[] = [
    ['door_closed', 0],
    ['door_opened', 0],
    ['reverse_door_closed', 0],
    ['reverse_door_opened', 0],

    ['door_left_closed', 0],
    ['door_right_closed', 0],
    ['door_left_opened', 0],
    ['door_right_opened', 0],
    ['reverse_door_left_closed', 0],
    ['reverse_door_right_closed', 0],
    ['reverse_door_left_opened', 0],
    ['reverse_door_right_opened', 0],

    ['gate_main_closed', 0],
    ['gate_outer_closed', 0],
    ['gate_main_open', 0],
    ['gate_outer_open', 0]
];

export const UNPRICED: ReadonlyMap<string, string> = new Map([
    [
        'laddermiddle option 1',
        'opens a Climb Up / Climb Down dialog (ladders.rs2:163-172), so the wait is the player answering, not the engine. Route option 2 or 3 instead.'
    ],
    [
        'grandtree_laddermiddle option 1',
        'same dialog, inline at ladders.rs2:128-139. Route option 2 or 3 instead.'
    ],
    [
        'spiralstairsmiddle option 1',
        'opens a stair dialog (stairs.rs2:485-491). Route option 2 or 3 instead.'
    ],
    [
        'wildymirrorladdertop1',
        'its two placements run different scripts — one ~climb_ladder, one bare p_teleport (ladders.rs2:104-111) — so the type has no single cost.'
    ],
    [
        'board_game_stairs_top2 / board_game_stairs_base2',
        'every coord falls through to @unhandled_stairs (stairs.rs2:431-449): the loc exists but goes nowhere.'
    ],
    [
        'door_open_and_close, double_door_open_and_close_left, double_door_open_and_close_right',
        'p_delay(1) fires only when the player is not already on the doorway tile (open_and_close_doors.rs2:21-35), so the cost depends on which side the route arrives from and a name-keyed number cannot say it. 60 locs, nearly all of them quest-gated and overridden by their own script anyway.'
    ]
]);

function contentScripts(contentRoot?: string): string {
    return join(contentRoot ?? CONTENT_ROOT, 'scripts');
}

function walk(dir: string, ext: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full, ext, out);
        else if (entry.name.endsWith(ext)) out.push(full);
    }
    return out;
}

function locCategories(scripts: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const file of walk(scripts, '.loc')) {
        let name = '';
        for (const raw of readFileSync(file, 'utf-8').split('\n')) {
            const line = raw.trim();
            if (line.startsWith('[') && line.endsWith(']')) name = line.slice(1, -1);
            else if (name && line.startsWith('category=')) out.set(name, line.slice('category='.length));
        }
    }
    return out;
}

function namedOpScripts(scripts: string): Set<string> {
    const out = new Set<string>();
    for (const file of walk(scripts, '.rs2')) {
        for (const m of readFileSync(file, 'utf-8').matchAll(/^\[oploc[1-5],([^\],]+)\]/gm)) {
            const name = m[1];
            if (name !== undefined) out.add(name);
        }
    }
    return out;
}

function buildByLoc(contentRoot?: string): ReadonlyMap<string, number> {
    const scripts = contentScripts(contentRoot);
    const byLoc = new Map<string, number>(BY_NAME);

    const wanted = new Map(BY_CATEGORY);
    const overridden = namedOpScripts(scripts);
    for (const [name, category] of locCategories(scripts)) {
        const extra = wanted.get(category);
        if (extra === undefined) continue;
        if (byLoc.has(name)) continue;
        if (overridden.has(name)) continue;
        byLoc.set(name, extra);
    }

    return byLoc;
}

let cached: TickCosts | undefined;

export function tickCosts(contentRoot?: string): TickCosts {
    if (contentRoot !== undefined) {
        return { perStep: PER_STEP, opBase: OP_BASE, byLoc: buildByLoc(contentRoot) };
    }
    cached ??= { perStep: PER_STEP, opBase: OP_BASE, byLoc: buildByLoc() };
    return cached;
}
