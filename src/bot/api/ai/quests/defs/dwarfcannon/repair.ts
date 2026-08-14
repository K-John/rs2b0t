import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Traversal } from '../../../../walking/Traversal.js';
import type Tile from '../../../../../geometry/Tile.js';
import { isUnderground, talkThrough, walkWithHops } from '../../exec/primitives.js';
import { driveUntil, settleScene } from '../../exec/prompts.js';
import { CANNON_PARTS, CAVE_HOPS, DWARF_CHILD, MC_LOC, MC_OBJ, MC_TILE, RAILINGS } from './areas.js';

const WALK = { attempts: 3, timeoutMs: 180_000 } as const;

export async function walkTo(tile: Tile, radius: number, log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && here.level === tile.level && tile.distanceTo(here) <= radius) {
        return true;
    }
    return Traversal.walkResilient(tile, { ...WALK, radius, log });
}

// Why: nothing in the scene tells a fixed railing from a broken one — the content sets a `%mcannonmulti` bit and leaves the loc alone — so the message is the only oracle.

const RAILING_SETTLED = /already fixed this railing|replace the railing with no problems/i;

/** Repair one railing; true when it is fixed or was already. */
async function fixOne(entry: { id: number; at: Tile }, log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(entry.at, 2, log))) {
        return false;
    }
    await settleScene();
    const railing = Locs.query().where(l => l.id === entry.id).nearest();
    if (!railing) {
        log(`no railing loc ${entry.id} at (${entry.at.x},${entry.at.z})`);
        return false;
    }
    const mark = GameMessages.mark();
    if (!(await railing.interact('Inspect'))) {
        return false;
    }
    return driveUntil(
        () => GameMessages.sawSince(mark, RAILING_SETTLED),
        ['Try to replace the railing.'],
        log,
        20_000
    );
}

/**
 * Walk the six broken railings in order and replace each.
 * @see Server content railings.rs2
 */
export async function fixRailings(log: (m: string) => void): Promise<boolean> {
    for (const entry of RAILINGS) {
        if (!(await fixOne(entry, log))) {
            log(`railing ${entry.id} did not take — moving on and letting the journal decide`);
        }
        await Execution.delayTicks(1);
    }
    return true;
}

// Why: the tower is not an underground crossing, so `crossHops` never fires for it — `needsHop` is a z >= 5000 test.
// Why: the landing is the player's own tile one level up, as `~climb_ladder` passes `movecoord(coord(), 0, 1, 0)`, and the tile directly above each ladder loc is blocked by the ladder.

/** Climb one ladder from a stand beside it and wait for the level to change. */
async function climb(stand: Tile, op: string, toLevel: number, log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(stand, 1, log))) {
        return false;
    }
    await settleScene();
    const ladder = Locs.query().name('Ladder').action(op).within(4).nearest();
    if (!ladder) {
        log(`no Ladder offering '${op}' at (${stand.x},${stand.z},${stand.level})`);
        return false;
    }
    if (!(await ladder.interact(op))) {
        return false;
    }
    return Execution.delayUntil(() => Game.tile()?.level === toLevel, 8000);
}

/**
 * Climb the Black Guard watchtower and take the dwarf remains from its top floor.
 * @see Server content mcannon_ladders.rs2
 */
export async function fetchRemains(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains(MC_OBJ.REMAINS.name)) {
        return true;
    }
    if ((Game.tile()?.level ?? 0) === 0 && !(await climb(MC_TILE.TOWER_LADDER, 'Climb-up', 1, log))) {
        return false;
    }
    if ((Game.tile()?.level ?? 0) === 1 && !(await climb(MC_TILE.TOWER_L1_LADDER, 'Climb-up', 2, log))) {
        return false;
    }
    if (!(await walkTo(MC_TILE.REMAINS, 2, log))) {
        return false;
    }
    await settleScene();
    const drop = GroundItems.query().name(MC_OBJ.REMAINS.name).within(8).nearest();
    if (!drop) {
        log('no Dwarf remains on the tower floor');
        return false;
    }
    if (!(await drop.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.contains(MC_OBJ.REMAINS.name), 8000);
}

export function inCave(tile: { z: number } | null | undefined): boolean {
    return tile ? isUnderground(tile) : false;
}

// Why: no transports edge carries either telejump, so findPath reports the cave unreachable from outside and the mainland unreachable from inside — the module's own hops are the only crossing.

/**
 * Enter the goblin cave, free Gilob's son from the crate, and leave by the mud pile.
 * @see Server content mcannon_crate.rs2, mcannon_cave.rs2
 */
export async function rescueChild(rescued: boolean, log: (m: string) => void): Promise<boolean> {
    if (rescued) {
        return walkWithHops(MC_TILE.COMMANDER, 4, [...CAVE_HOPS], log);
    }
    if (!inCave(Game.tile()) && !(await walkWithHops(MC_TILE.CAVE_ARRIVE, 6, [...CAVE_HOPS], log))) {
        return false;
    }
    if (!(await walkTo(MC_TILE.CRATE, 2, log))) {
        return false;
    }
    await settleScene();
    const crate = Locs.query().where(l => l.id === MC_LOC.CRATE).nearest();
    if (!crate) {
        log(`no crate loc ${MC_LOC.CRATE} at (${MC_TILE.CRATE.x},${MC_TILE.CRATE.z})`);
        return false;
    }
    if (!(await crate.interact('Search'))) {
        return false;
    }
    // The crate spawns the youngster and opens his dialogue in one script, and the
    // stage is set by its last line — leaving it undrained loses the rescue.
    await Execution.delayTicks(2);
    await talkThrough(DWARF_CHILD.npc, DWARF_CHILD.prefer, log);
    return true;
}

const CANNON_WORKING = /seems to be in working order/i;

// Why: each Inspect handles at most one part, and after the fourth the stage is still 7 — one further Inspect is what flips it to 8, so the loop bounds attempts rather than counting parts.

/**
 * Inspect the broken multicannon until every damaged component is fixed.
 * @see Server content mcannon_broken_cannon.rs2
 */
export async function repairCannon(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(MC_TILE.CANNON, 2, log))) {
        return false;
    }
    for (let attempt = 0; attempt < 24; attempt++) {
        await settleScene();
        const cannon = Locs.query().where(l => l.id === MC_LOC.BROKEN_CANNON).nearest();
        if (!cannon) {
            log(`no broken cannon loc ${MC_LOC.BROKEN_CANNON} in the shed`);
            return false;
        }
        const mark = GameMessages.mark();
        if (!(await cannon.interact('Inspect'))) {
            return false;
        }
        const done = (): boolean => GameMessages.sawSince(mark, CANNON_WORKING);
        await driveUntil(done, [...CANNON_PARTS, 'None'], log, 15_000);
        if (done()) {
            log('the cannon is in working order');
            return true;
        }
        await Execution.delayTicks(1);
    }
    log('the cannon did not come together in 24 inspections');
    return true;
}
