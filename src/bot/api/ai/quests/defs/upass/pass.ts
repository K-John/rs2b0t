import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import type { Loc } from '../../../../model/Loc.js';
import { Reachability } from '../../../../../event/webwalk/geometry/Reachability.js';
import { Traversal } from '../../../../walking/Traversal.js';
import Tile from '../../../../../geometry/Tile.js';
import { settleScene } from '../../exec/prompts.js';
import { UP_ITEM, UP_LOC, type UpassItem } from './areas.js';

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
    /** Only treat it as a seam below this z — the same loc is scenery elsewhere in the pass. */
    below?: number;
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
    // Why: `upass_swampbubbles1` is scenery in the first cavern and a crossing in the second, and taking it
    // for a seam on the bridge shelf walked a run twenty tiles off the grid approach. The z bound is what
    // separates the two — the second cavern is everything below 9664.
    { loc: UP_LOC.SWAMP, op: 'Cross', below: 9664 },
    { loc: UP_LOC.ROCKPILE, op: 'Climb', below: 9664 },
    { loc: UP_LOC.CELL_TUNNEL, op: 'Enter', below: 9664 }
];

const HOP_TIMEOUT_MS = 12_000;
/** How long the crossing script itself gets, once the op-click's walk has stopped. */
const CROSS_TIMEOUT_MS = 6_000;
const MAX_HOPS = 24;
/** How much closer to the target an obstacle must sit before it is worth crossing. */
const MIN_GAIN = 3;
// Why: the seam out of a pocket can sit right across it — the rope swing off the bridge shelf is twenty
// tiles from where the bridge lands — so the search has to cover the pocket, not the neighbourhood. Drift is
// held off by the gain threshold and by spending an obstacle that led away, not by looking less far.
const HOP_SEARCH = 32;
// Why: the pockets wind, so a thirty-tile obstacle is well past the flood's default four hundred steps.
const REACH = { adjacentOk: true, maxSteps: 2_000 } as const;

function here(): { x: number; z: number; level: number } | null {
    return Game.tile();
}

function chebyshev(a: { x: number; z: number }, b: { x: number; z: number }): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

// Why: an op-click walks the player before its script resolves, so nothing can be judged until the walk has
// stopped. Two unchanged ticks is what "stopped" means here; the forced move of the crossing itself comes
// after, and shows up as the distance the caller then measures.
async function settleWalk(): Promise<{ x: number; z: number; level: number } | null> {
    let last = here();
    let still = 0;
    const deadline = performance.now() + HOP_TIMEOUT_MS;
    while (performance.now() < deadline) {
        await Execution.delayTicks(1);
        const now = here();
        if (now && last && now.x === last.x && now.z === last.z && now.level === last.level) {
            if (++still >= 2) {
                return now;
            }
        } else {
            still = 0;
        }
        last = now;
    }
    return here();
}

function held(id: number): number {
    return Inventory.items().filter(item => item.id === id).reduce((sum, item) => sum + item.count, 0);
}

/** Obstacles in the scene, nearest the straight line toward `dest` first. */
function hopsToward(dest: Tile, from: { x: number; z: number }): Loc[] {
    const found: Loc[] = [];
    for (const kind of HOP_KINDS) {
        const locs = Locs.query()
            .where(loc => loc.id === kind.loc && (kind.below === undefined || loc.tile().z < kind.below))
            .action(kind.op)
            .within(HOP_SEARCH)
            .results();
        found.push(...locs);
    }
    // Why: the obstacle worth crossing is the one that leaves the player closer to the target than standing
    // still does — sorting by the target's distance from the obstacle is what encodes "forward".
    // Why: "any obstacle closer than I am" picks marginal ones that cross sideways and drift the route —
    // three of them in a row carried a run twenty tiles the wrong way before the loop gave up.
    // Why: and an obstacle in the scene is not one this pocket can walk to. The stone bridges of the second
    // cavern sit behind its locked cages, closer to the target than the cages are, so the search chose them
    // first and burned eighteen seconds each proving it could not get there. The scene's own collision flags
    // answer that for free.
    return found
        .filter(loc => chebyshev(loc.tile(), dest) + MIN_GAIN <= chebyshev(from, dest))
        .filter(loc => Reachability.canReach(loc.tile(), REACH))
        .sort((a, b) => chebyshev(a.tile(), dest) - chebyshev(b.tile(), dest));
}

function kindOf(loc: Loc): HopKind | null {
    return HOP_KINDS.find(k => k.loc === loc.id) ?? null;
}

/**
 * Cross one obstacle toward `dest`. Returns false when there is none that makes progress.
 * Why: the test is the distance to `dest`, not "the tile changed". An op-click walks the player before its
 * script resolves, so a tile change is usually the approach — one run read a one-tile drift toward a cage it
 * never reached as a crossing and spent seventy seconds a round on it. A roll that fails leaves the player
 * where they were, which is a retry rather than a stop, so the locks get theirs.
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
        let now = from;
        for (let attempt = 0; attempt < (kind.tries ?? 1); attempt++) {
            if (!(await obstacle.interact(op))) {
                break;
            }
            now = (await settleWalk()) ?? now;
            if (chebyshev(now, dest) + MIN_GAIN <= chebyshev(from, dest)) {
                break;
            }
            // Why: the walk can stop on the near side while the crossing script is still running — the two
            // locked cages roll thieving over a two-tick delay before moving anyone. So a walk that landed
            // nowhere useful is given the script's own time before it is called a failure.
            const staged = now;
            await Execution.delayUntil(() => {
                const t = here();
                return t !== null && (t.x !== staged.x || t.z !== staged.z || t.level !== staged.level);
            }, CROSS_TIMEOUT_MS);
            now = here() ?? now;
            if (chebyshev(now, dest) + MIN_GAIN <= chebyshev(from, dest)) {
                break;
            }
        }
        await settleScene();
        // Why: an obstacle can sit closer to the target than the player does and still put them on its far
        // side going backwards — crossing one that did not shorten the distance is what makes the loop
        // oscillate between two sides of the same rock, so it is spent for the rest of this journey.
        // Why: the same gain the search demands, because the op-click walks the player before the script
        // resolves — a one-tile drift toward the obstacle is a walk, not a crossing, and reading it as one
        // burned seventy seconds per round on a cage the player never reached.
        if (chebyshev(now, dest) + MIN_GAIN > chebyshev(from, dest)) {
            spent.add(key);
            log(`pass: ${op} ${obstacle.name ?? obstacle.id} did not cross toward (${dest.x},${dest.z}) — not using it again`);
            continue;
        }
        log(`pass: ${op} ${obstacle.name ?? obstacle.id} → (${now.x},${now.z})`);
        return true;
    }
    return useSeamToward(dest, log);
}

/** A seam crossed by using an item on a loc rather than by an op on it. */
interface UseSeam {
    item: UpassItem;
    locs: readonly number[];
    /** The script deletes the item before it rolls, so its leaving the pack is the one honest signal. */
    consumes: boolean;
    label: string;
}

// Why: two of the seams are item-uses rather than ops, and both are the only way out of their pocket — the
// swing east off the bridge shelf onto the grid, and the spade dig that is the sole route south out of the
// slave cages. They belong in the same vocabulary rather than special-cased by a caller that cannot know
// whether the navigator already got there.
const USE_SEAMS: readonly UseSeam[] = [
    {
        item: UP_ITEM.ROPE,
        locs: [UP_LOC.ROCKSWING, UP_LOC.ROCKSWING_ANCHOR],
        consumes: true,
        label: 'rope swing'
    },
    { item: UP_ITEM.SPADE, locs: [UP_LOC.MUD_DIG], consumes: false, label: 'mud dig' }
];

async function useSeamToward(dest: Tile, log: (m: string) => void): Promise<boolean> {
    const from = here();
    if (!from) {
        return false;
    }
    for (const seam of USE_SEAMS) {
        const item = Inventory.items().find(inv => inv.id === seam.item.id);
        if (!item) {
            continue;
        }
        const target = Locs.query()
            .where(loc => seam.locs.includes(loc.id))
            .within(HOP_SEARCH)
            .nearest();
        if (!target
            || chebyshev(target.tile(), dest) + MIN_GAIN > chebyshev(from, dest)
            || !Reachability.canReach(target.tile(), REACH)) {
            continue;
        }
        // Why: the op-click walks the player to the loc before the use resolves, so "the tile changed" fires
        // on the walk and reports a crossing that never happened.
        const before = held(seam.item.id);
        if (!(await item.useOn(target))) {
            continue;
        }
        if (seam.consumes && !(await Execution.delayUntil(() => held(seam.item.id) < before, HOP_TIMEOUT_MS))) {
            continue;
        }
        const staged = (await settleWalk()) ?? from;
        if (chebyshev(staged, dest) + MIN_GAIN > chebyshev(from, dest)) {
            await Execution.delayUntil(() => {
                const t = here();
                return t !== null && (t.x !== staged.x || t.z !== staged.z || t.level !== staged.level);
            }, CROSS_TIMEOUT_MS);
        }
        await settleScene();
        const now = here() ?? from;
        // Why: a failed swing spends the rope and drops the player into the swamp below, so the caller has to
        // see that as no progress rather than as a crossing.
        if (chebyshev(now, dest) + MIN_GAIN > chebyshev(from, dest)) {
            log(`pass: the ${seam.label} did not cross toward (${dest.x},${dest.z}) — now at (${now.x},${now.z})`);
            continue;
        }
        log(`pass: ${seam.label} → (${now.x},${now.z})`);
        return true;
    }
    return false;
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
