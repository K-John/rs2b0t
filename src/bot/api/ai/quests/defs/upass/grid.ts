import { Execution } from '../../../../execution/Execution.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Game } from '../../../../game/Game.js';
import { Locs } from '../../../../locs/Locs.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { GRID_ZONE, UP_ITEM, UP_LOC, UP_TILE, pastGridTile } from './areas.js';
import { driveUntil, settleScene } from '../../exec/prompts.js';
import { locById, walkTo } from './bridge.js';
import { stalledCrossing } from './stall.js';

// Why: the safe path through the spiked grid is three digits in `%ibanmulti` bits 22-31, and `ibanmulti` is
// `scope=perm` with no `transmit` — the client cannot read it. The journal stall walks over the whole thing
// instead, so the combination never has to be guessed.

/** Where a fall lands, and where `upass_grilltrap_hand_holds` climbs back to. */
const PIT = { minZ: 9536, maxZ: 9599 } as const;
const HANDHOLD_RETURN = UP_TILE.GRID_EAST;

function here(): { x: number; z: number; level: number } | null {
    return Game.tile();
}

export function inGrid(): boolean {
    const t = here();
    return t !== null && t.x >= GRID_ZONE.minX && t.x <= GRID_ZONE.maxX && t.z >= GRID_ZONE.minZ && t.z <= GRID_ZONE.maxZ;
}

export function inPit(): boolean {
    const t = here();
    return t !== null && t.z >= PIT.minZ && t.z <= PIT.maxZ;
}

/** West of the grid, on the portcullis side — the crossing is done. */
export function pastGrid(): boolean {
    return pastGridTile(here());
}

// Why: the rope swing is the fallback for reaching the grid lip, not the default — it eats the rope, so it
// is only used once the plain walk to the lip has shown it has no route.

/** Rope on the rock, swinging east onto the grid shelf. */
async function swingEast(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(UP_TILE.ROCKSWING_WEST, 1, log))) {
        return false;
    }
    await settleScene();
    const rock = locById(UP_LOC.ROCKSWING, null, 8) ?? locById(UP_LOC.ROCKSWING_ANCHOR, null, 8);
    const rope = Inventory.items().find(item => item.id === UP_ITEM.ROPE.id);
    if (!rock || !rope) {
        log(`missing ${rock ? 'a rope' : 'the rock swing'} for the crossing east`);
        return false;
    }
    if (!(await rope.useOn(rock))) {
        return false;
    }
    return driveUntil(() => (Game.tile()?.x ?? 0) > UP_TILE.ROCKSWING_WEST.x + 2, [], log, 15_000);
}

async function climbOutOfPit(log: (m: string) => void): Promise<boolean> {
    // Why: the fall is a `p_teleport`, so the scene is still the old one for a tick or two and the rocks
    // read as absent — the query is retried rather than trusted on the first look.
    for (let attempt = 0; attempt < 8 && inPit(); attempt++) {
        const rocks = Locs.query().where(loc => loc.id === UP_LOC.GRID_HANDHOLDS).action('Climb').within(12).nearest();
        if (rocks && (await rocks.interact('Climb')) && (await Execution.delayUntil(() => !inPit(), 8_000))) {
            return true;
        }
        await Execution.delayTicks(2);
    }
    if (inPit()) {
        log('grid: no protruding rocks in the pit to climb');
        return false;
    }
    return true;
}

/**
 * Back to the staging tile the stall is launched from.
 * Why: the launch tile has to sit outside the trapped rectangle by more than the walk covers in the tick
 * before the journal lands, and Koftik's lip is the only tile east of the grid the route reaches.
 */
async function toApproach(log: (m: string) => void): Promise<boolean> {
    if (inPit() && !(await climbOutOfPit(log))) {
        return false;
    }
    const t = here();
    if (t && UP_TILE.GRID_APPROACH.distanceTo(t) <= 1) {
        return true;
    }
    if (await Traversal.walkResilient(UP_TILE.GRID_APPROACH, { radius: 1, attempts: 3, log })) {
        return true;
    }
    if (Inventory.items().some(item => item.id === UP_ITEM.ROPE.id)) {
        log('grid: no route to the lip — trying the rope swing east');
        return (await swingEast(log)) && Traversal.walkResilient(UP_TILE.GRID_APPROACH, { radius: 1, attempts: 3, log });
    }
    return false;
}

/** East to west over the spiked grid, ending beside the portcullis lever. */
export async function crossGrid(log: (m: string) => void): Promise<boolean> {
    if (pastGrid()) {
        return true;
    }
    if (!(await toApproach(log))) {
        return false;
    }
    return stalledCrossing({
        find: () => Locs.query().where(loc => loc.id === UP_LOC.PORTCULLIS_LEVER).action('Pull').within(40).nearest(),
        op: 'Pull',
        arrived: pastGrid,
        abort: inPit,
        recover: () => toApproach(log),
        log
    });
}

export { HANDHOLD_RETURN };
