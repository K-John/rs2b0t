import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Traversal } from '../../../../walking/Traversal.js';
import type Tile from '../../../../../geometry/Tile.js';
import { driveUntil, settleScene } from '../../exec/prompts.js';
import { MC_OBJ, MC_TILE, RAILINGS } from './areas.js';

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
