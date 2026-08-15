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
// Why: measured pocket counts, so the next leg knows what it is walking into — the first cavern is five
// pockets, the second five, and the level-1 platforms six, of which only the main landing reaches both wall
// tunnels on foot (costs 60 and 194). The soulless cages, the witch's cat, her door, the demons' platform
// and Iban's temple are each sealed behind their own crossing.

/** An obstacle that joins two pockets. All of these move the player across a tile the pack calls blocked. */
interface HopKind {
    loc: number;
    op: string;
    /** How many times to send the op before giving up on this obstacle. */
    tries?: number;
}

// Why: the two locked cages roll `stat_random(thieving, …)` and leave the player where they were on a
// failure, so one send is not a verdict on the obstacle — it is one roll.
const LOCK_TRIES = 5;

// Why: ordered by how often the route meets them, so the nearest-first search below settles quickly.
const HOP_KINDS: readonly HopKind[] = [
    { loc: UP_LOC.ROCKSLIDE, op: 'Climb-over' },
    { loc: UP_LOC.ROCK_BRIDGE, op: 'Cross' },
    { loc: UP_LOC.LEDGE, op: 'Cross' },
    { loc: UP_LOC.PIPE_AREA1, op: 'Squeeze-through' },
    { loc: UP_LOC.PIPE_AREA2, op: 'Squeeze-through' },
    { loc: UP_LOC.COLLAPSED_A, op: 'Cross' },
    { loc: UP_LOC.COLLAPSED_B, op: 'Cross' },
    { loc: UP_LOC.ROCKSWING_BACK, op: 'Swing-on' },
    // Why: a component report over leg 3's anchors puts the unicorn cage and the paladins' shelf in
    // different pockets joined only by these — `upass_area_2_3_entrance` telejumps between them.
    { loc: UP_LOC.UNICORN_DOOR_L, op: 'Pass-through' },
    { loc: UP_LOC.UNICORN_DOOR_R, op: 'Pass-through' },
    // Why: the second cavern's own seams. The route from the well down to the boulder crosses the slave
    // cages, the swamp and a pipe, and every one of them reads "unreachable" to the navigator.
    { loc: UP_LOC.RAILINGS_LOCKED, op: 'Pick-lock', tries: LOCK_TRIES },
    { loc: UP_LOC.RAILINGS_HARD, op: 'Pick-lock', tries: LOCK_TRIES },
    { loc: UP_LOC.SWAMP, op: 'Cross' },
    { loc: UP_LOC.ROCKPILE, op: 'Climb' },
    { loc: UP_LOC.CELL_TUNNEL, op: 'Enter' }
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

function held(id: number): number {
    return Inventory.items().filter(item => item.id === id).reduce((sum, item) => sum + item.count, 0);
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

function kindOf(loc: Loc): HopKind | null {
    return HOP_KINDS.find(k => k.loc === loc.id) ?? null;
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
        const kind = kindOf(obstacle);
        if (!kind) {
            continue;
        }
        const op = kind.op;
        let moved = false;
        for (let attempt = 0; attempt < (kind.tries ?? 1) && !moved; attempt++) {
            if (!(await obstacle.interact(op))) {
                break;
            }
            moved = await Execution.delayUntil(() => {
                const now = here();
                return now !== null && (now.x !== from.x || now.z !== from.z || now.level !== from.level);
            }, HOP_TIMEOUT_MS);
        }
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
    // Why: the op-click walks the player to the rock before the use resolves, so "the tile changed" fires on
    // the walk and reports a swing that never happened. `inv_del(inv, rope, 1)` runs before the agility roll,
    // which makes the rope leaving the pack the one signal that the script actually ran.
    const ropes = held(UP_ITEM.ROPE.id);
    if (!(await rope.useOn(rock))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => held(UP_ITEM.ROPE.id) < ropes, HOP_TIMEOUT_MS))) {
        return false;
    }
    await settleScene();
    const now = here();
    // Why: a failed roll spends the rope and drops the player into the swamp below, so the caller has to see
    // that as no progress rather than as a crossing.
    if (now && chebyshev(now, dest) >= chebyshev(from, dest)) {
        log(`pass: the rope swing failed and cost a rope — now at (${now.x},${now.z})`);
        return false;
    }
    log(`pass: rope swing → (${now?.x},${now?.z})`);
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
