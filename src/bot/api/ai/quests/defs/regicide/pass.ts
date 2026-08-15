import { Game } from '../../../../game/Game.js';
import { Locs } from '../../../../locs/Locs.js';
import type { Loc } from '../../../../model/Loc.js';
import { Traversal } from '../../../../walking/Traversal.js';
import type Tile from '../../../../../geometry/Tile.js';
import { driveUntil, settleScene } from '../../exec/prompts.js';
import { UP_LOC, UP_TILE, pastGridTile, upassArea } from '../upass/areas.js';
import { enterMainCavern } from '../upass/area2.js';
import { crossToWest, enterCave } from '../upass/bridge.js';
import { crossGrid } from '../upass/grid.js';
import { travelTo } from '../upass/pass.js';
import { RG_LOC, RG_TILE, regicideArea } from './areas.js';
import { climbOutOfPit, travelTirannwn } from './pockets.js';

// Why: this leg is the Underground Pass walked a second time, with the quest already finished. Both of its
// hard gates are `%ibanmulti` bits that stay set — `cave_well` wants the four orb bits and `bloodwell_upass`
// the three badges and the horn — so what is left is the physical crossings, which is what upass's own
// pocket-crossing mover was built for. Nothing here re-solves the quest; it re-walks it.
// Why: and the way out at the far end is Iban's own temple door. `open_iban_door` grows a branch at
// `%regicide_quest >= ^regicide_spoken_lathas` that teleports the player `loc + (-129, +64)` — the Well of
// Voyage room — instead of into the temple.

/** Where in the pass the crossing legs branch. */
const GRID_EAST_X = 2467;
/** The paladins' shelf is the north end of the first cavern; the orb corridor is everything below it. */
const SHELF_Z = 9700;

function locById(id: number, op: string | null, within = 12): Loc | null {
    const base = Locs.query().where(loc => loc.id === id);
    return (op === null ? base : base.action(op)).within(within).nearest();
}

async function climbWell(log: (m: string) => void): Promise<boolean> {
    if (!(await travelTo(UP_TILE.WELL, 3, log))) {
        return false;
    }
    await settleScene();
    const well = locById(UP_LOC.WELL, null, 10);
    const op = well?.actions()[0];
    if (!well || !op) {
        log('no well in the orb corridor');
        return false;
    }
    if (!(await well.interact(op))) {
        return false;
    }
    // Why: the well blasts the player back out with damage unless all four orb bits are set, so the drop
    // into the second cavern is the only honest signal that the descent happened.
    return driveUntil(() => upassArea(Game.tile()) === 'area2', [], log, 20_000);
}

/** Iban's temple door, which at this quest stage opens onto the Well of Voyage instead. */
async function openVoyageDoor(log: (m: string) => void): Promise<boolean> {
    if (!(await travelTo(RG_TILE.IBAN_DOOR, 3, log))) {
        return false;
    }
    await settleScene();
    const door = locById(UP_LOC.IBAN_DOOR_L, null, 8) ?? locById(UP_LOC.IBAN_DOOR_R, null, 8);
    const op = door?.actions()[0];
    if (!door || !op || !(await door.interact(op))) {
        log("no doors on Iban's temple");
        return false;
    }
    return driveUntil(() => (Game.tile()?.x ?? 9999) < 2100, [], log, 15_000);
}

/** Down the Well of Voyage, which lands in the temple on the far side of the world. */
async function climbVoyageWell(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(RG_TILE.WELL_OF_VOYAGE, { radius: 2, attempts: 2, timeoutMs: 60_000, log }))) {
        // Why: the well sits in a sealed room whose own door the pack blocks — the temple-door hop lands the
        // player on its threshold, so a walk that finds no route means the door is still shut.
        const inner = Locs.query().name('Door').action('Open').within(8).nearest();
        if (!inner || !(await inner.interact('Open'))) {
            log('no way into the Well of Voyage room');
            return false;
        }
        await settleScene();
        if (!(await Traversal.walkResilient(RG_TILE.WELL_OF_VOYAGE, { radius: 2, attempts: 2, timeoutMs: 60_000, log }))) {
            return false;
        }
    }
    await settleScene();
    const well = locById(RG_LOC.WELL_OF_VOYAGE, 'Climb-down', 10);
    if (!well || !(await well.interact('Climb-down'))) {
        log('no Well of Voyage to climb into');
        return false;
    }
    return driveUntil(() => regicideArea(Game.tile()) === 'voyage', [], log, 20_000);
}

/** Out of the voyage temple onto the Isafdar forest floor. */
async function leaveVoyageTemple(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(RG_TILE.VOYAGE_EXIT, { radius: 3, attempts: 3, timeoutMs: 90_000, log }))) {
        return false;
    }
    await settleScene();
    const exit = locById(RG_LOC.TEMPLE_EXIT, 'Exit', 12);
    if (!exit || !(await exit.interact('Exit'))) {
        log('no cave exit in the voyage temple');
        return false;
    }
    return driveUntil(() => regicideArea(Game.tile()) === 'tirannwn', [], log, 20_000);
}

/**
 * One leg of the walk from the mainland to Isafdar. Called until `regicideArea` reads `tirannwn`.
 * Why: every leg is keyed on where the player already is rather than on a remembered step, because the pass
 * teleports on failure — a pitfall, the well, Iban's door — and a remembered step would resume in the wrong
 * pocket after any of them.
 */
export async function enterTirannwn(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    const area = regicideArea(here);
    if (area === 'tirannwn') {
        return true;
    }
    if (area === 'pit') {
        return climbOutOfPit(log);
    }
    if (area === 'voyage') {
        return leaveVoyageTemple(log);
    }
    switch (upassArea(here)) {
        case 'mainland':
            return crossToWest(log);
        case 'westardougne':
            return enterCave(log);
        case 'area1':
            if ((here?.x ?? 0) > GRID_EAST_X && !pastGridTile(here)) {
                return crossGrid(log);
            }
            return (here?.z ?? 0) > SHELF_Z ? enterMainCavern(log) : climbWell(log);
        case 'area2':
            // Why: the way back up to the paladins' shelf is the unicorn tunnel at the south end of the
            // second cavern, which is one of the mover's own seams.
            return travelTo(UP_TILE.PALADINS, 4, log);
        case 'gridpit':
            return travelTo(UP_TILE.GRID_APPROACH, 3, log);
        case 'voyage':
            return climbVoyageWell(log);
        case 'main':
        case 'witch':
        case 'temple':
        case 'dwarves':
        case 'kalrag':
            return openVoyageDoor(log);
        default:
            log(`lost on the way to Isafdar at (${here?.x},${here?.z},${here?.level})`);
            return false;
    }
}

// Why: the palisade is one seam of the same graph the forest is routed by — `travelTirannwn` walks the
// crossings out to it and takes the gate itself, and degrades to a plain resilient walk once the player is
// on the Ardougne side of it. Walking straight at the gate instead reports "unreachable", because from any
// pocket in the forest that is what it is.

/** Out of Tirannwn through the Arandar palisade — free northbound at any stage. */
export function leaveTirannwn(dest: Tile, stage: number, log: (m: string) => void): Promise<boolean> {
    return travelTirannwn(dest, 3, stage, log);
}
