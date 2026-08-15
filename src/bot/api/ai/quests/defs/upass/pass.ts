import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import type { Loc } from '../../../../model/Loc.js';
import { Traversal } from '../../../../walking/Traversal.js';
import Tile from '../../../../../geometry/Tile.js';
import { settleScene } from '../../exec/prompts.js';
import { UP_ITEM, UP_LOC } from './areas.js';

// Why: the pass is not one map the navigator can route across — a component report over its own seam
// endpoints answers FAIL for 10 of 14 anchors. Every seam is a scripted obstacle whose tile the collision
// pack marks blocked, so `walkResilient` toward anything past one reports "unreachable" and the step reads
// as a missing loc. Movement here is therefore: walk inside the pocket, cross one obstacle, repeat.

/** An obstacle that joins two pockets. All of these move the player across a tile the pack calls blocked. */
interface HopKind {
    loc: number;
    op: string;
}

// Why: ordered by how often the route meets them, so the nearest-first search below settles quickly.
const HOP_KINDS: readonly HopKind[] = [
    { loc: UP_LOC.ROCKSLIDE, op: 'Climb-over' },
    { loc: UP_LOC.ROCK_BRIDGE, op: 'Cross' },
    { loc: UP_LOC.LEDGE, op: 'Cross' },
    { loc: UP_LOC.PIPE_AREA1, op: 'Squeeze-through' },
    { loc: UP_LOC.PIPE_AREA2, op: 'Squeeze-through' },
    { loc: UP_LOC.COLLAPSED_A, op: 'Cross' },
    { loc: UP_LOC.COLLAPSED_B, op: 'Cross' },
    { loc: UP_LOC.ROCKSWING_BACK, op: 'Swing-on' }
];

const HOP_TIMEOUT_MS = 12_000;
const MAX_HOPS = 24;
/** How much closer to the target an obstacle must sit before it is worth crossing. */
const MIN_GAIN = 3;
// Why: the seam out of a pocket can sit right across it — the rope swing off the bridge shelf is twenty
// tiles from where the bridge lands — so the search has to cover the pocket, not the neighbourhood. Drift is
// held off by the gain threshold and by spending an obstacle that led away, not by looking less far.
const HOP_SEARCH = 32;

function here(): { x: number; z: number; level: number } | null {
    return Game.tile();
}

function chebyshev(a: { x: number; z: number }, b: { x: number; z: number }): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

/** Obstacles in the scene, nearest the straight line toward `dest` first. */
function hopsToward(dest: Tile, from: { x: number; z: number }): Loc[] {
    const found: Loc[] = [];
    for (const kind of HOP_KINDS) {
        const locs = Locs.query()
            .where(loc => loc.id === kind.loc)
            .action(kind.op)
            .within(HOP_SEARCH)
            .results();
        found.push(...locs);
    }
    // Why: the obstacle worth crossing is the one that leaves the player closer to the target than standing
    // still does — sorting by the target's distance from the obstacle is what encodes "forward".
    // Why: "any obstacle closer than I am" picks marginal ones that cross sideways and drift the route —
    // three of them in a row carried a run twenty tiles the wrong way before the loop gave up.
    return found
        .filter(loc => chebyshev(loc.tile(), dest) + MIN_GAIN <= chebyshev(from, dest))
        .sort((a, b) => chebyshev(a.tile(), dest) - chebyshev(b.tile(), dest));
}

function opOf(loc: Loc): string | null {
    const kind = HOP_KINDS.find(k => k.loc === loc.id);
    return kind ? kind.op : null;
}

/**
 * Cross one obstacle toward `dest`. Returns false when there is none that makes progress.
 * Why: the arrival test is "the tile changed", because every one of these is a forced move of one or two
 * tiles — an agility roll that fails leaves the player where they were, which is a retry rather than a stop.
 */
async function hopToward(dest: Tile, log: (m: string) => void, spent: Set<string>): Promise<boolean> {
    const from = here();
    if (!from) {
        return false;
    }
    for (const obstacle of hopsToward(dest, from)) {
        const key = `${obstacle.id}@${obstacle.tile().x},${obstacle.tile().z}`;
        if (spent.has(key)) {
            continue;
        }
        const op = opOf(obstacle);
        if (!op) {
            continue;
        }
        if (!(await obstacle.interact(op))) {
            continue;
        }
        const moved = await Execution.delayUntil(() => {
            const now = here();
            return now !== null && (now.x !== from.x || now.z !== from.z || now.level !== from.level);
        }, HOP_TIMEOUT_MS);
        if (!moved) {
            continue;
        }
        const now = here();
        await settleScene();
        // Why: an obstacle can sit closer to the target than the player does and still put them on its far
        // side going backwards — crossing one that did not shorten the distance is what makes the loop
        // oscillate between two sides of the same rock, so it is spent for the rest of this journey.
        if (now && chebyshev(now, dest) >= chebyshev(from, dest)) {
            spent.add(key);
            log(`pass: ${op} ${obstacle.name ?? obstacle.id} led away from (${dest.x},${dest.z}) — not using it again`);
            continue;
        }
        log(`pass: ${op} ${obstacle.name ?? obstacle.id} → (${now?.x},${now?.z})`);
        return true;
    }
    return ropeSwingToward(dest, log);
}

// Why: the swing east off the bridge shelf is the one seam that is an item-use rather than an op, and it is
// the only way onto the grid shelf — so it belongs in the same vocabulary rather than special-cased by a
// caller that cannot know whether the navigator already got there.
async function ropeSwingToward(dest: Tile, log: (m: string) => void): Promise<boolean> {
    const from = here();
    const rope = Inventory.items().find(item => item.id === UP_ITEM.ROPE.id);
    if (!from || !rope) {
        return false;
    }
    const rock = Locs.query()
        .where(loc => loc.id === UP_LOC.ROCKSWING || loc.id === UP_LOC.ROCKSWING_ANCHOR)
        .within(HOP_SEARCH)
        .nearest();
    if (!rock || chebyshev(rock.tile(), dest) + MIN_GAIN > chebyshev(from, dest)) {
        return false;
    }
    if (!(await rope.useOn(rock))) {
        return false;
    }
    const moved = await Execution.delayUntil(() => {
        const now = here();
        return now !== null && (now.x !== from.x || now.z !== from.z);
    }, HOP_TIMEOUT_MS);
    if (!moved) {
        return false;
    }
    await settleScene();
    log(`pass: rope swing → (${here()?.x},${here()?.z})`);
    return true;
}

/**
 * Walk to `dest`, crossing whatever obstacles stand between its pocket and this one.
 * Why: a plain `walkResilient` is tried first every round, because inside a pocket it is the right tool —
 * the obstacle search only runs once the navigator has said there is no route.
 */
export async function travelTo(dest: Tile, radius: number, log: (m: string) => void): Promise<boolean> {
    const spent = new Set<string>();
    // Why: once the navigator has said there is no route to this tile, saying it again costs a full walk
    // timeout per obstacle and changes nothing — only crossing one can change the answer.
    let navWorthTrying = true;
    for (let hop = 0; hop < MAX_HOPS; hop++) {
        const at = here();
        if (at && at.level === dest.level && dest.distanceTo(at) <= radius) {
            return true;
        }
        if (navWorthTrying) {
            if (await Traversal.walkResilient(dest, { radius, attempts: 1, timeoutMs: 60_000, log })) {
                return true;
            }
            navWorthTrying = false;
        }
        if (!(await hopToward(dest, log, spent))) {
            const stuck = here();
            log(`pass: no obstacle from (${stuck?.x},${stuck?.z}) makes progress toward (${dest.x},${dest.z})`);
            return false;
        }
        navWorthTrying = true;
    }
    log(`pass: ${MAX_HOPS} obstacles crossed without reaching (${dest.x},${dest.z})`);
    return false;
}
