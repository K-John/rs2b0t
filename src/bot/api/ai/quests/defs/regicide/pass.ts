import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import type { Loc } from '../../../../model/Loc.js';
import { Traversal } from '../../../../walking/Traversal.js';
import Tile from '../../../../../geometry/Tile.js';
import { driveUntil, settleScene } from '../../exec/prompts.js';
import { UP_ITEM, UP_LOC, UP_TILE, pastGridTile, upassArea } from '../upass/areas.js';
import { enterMainCavern } from '../upass/area2.js';
import {
    armFireArrow,
    crossToWest,
    enterCave,
    getDampCloth,
    makeFireArrow,
    shootGuiderope
} from '../upass/bridge.js';
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

/** The paladins' shelf is the north end of the first cavern; the orb corridor is everything below it. */
const SHELF_Z = 9700;

/** The one loc that opens onto the paladins' shelf, at the north end of the second cavern. */
const UNICORN_DOORS = new Tile(2370, 9664, 0);

// Why: the chasm splits area1 in two and nothing walks across it. Flooding the collision pack from the cave
// landing and from the bridge's west foot gives two tile sets that do not share a single tile, and this is
// the line between them: the east side is z 9710-9726 and never reaches west of x 2446, the west side never
// reaches east of x 2442 in that band. A bare x test would read the grid approach (2479,9679) as east.
const BRIDGE_EAST_Z = 9710;
const BRIDGE_EAST_X = 2446;

export function eastOfChasm(tile: { x: number; z: number } | null): boolean {
    return tile !== null && tile.z >= BRIDGE_EAST_Z && tile.x >= BRIDGE_EAST_X;
}

function heldId(id: number): number {
    return Inventory.items().filter(item => item.id === id).length;
}

/** Where `cave_well` drops the player, and the pocket it drops them into. */
const CAGES = { minX: 2369, maxX: 2429, minZ: 9640, maxZ: 9661 } as const;

function inSlaveCages(tile: { x: number; z: number } | null): boolean {
    return (
        tile !== null
        && tile.x >= CAGES.minX && tile.x <= CAGES.maxX
        && tile.z >= CAGES.minZ && tile.z <= CAGES.maxZ
    );
}

/**
 * The filled-in tunnel out of the slave cages, dug with a spade.
 * Why: `cave_well` lands at (2423,9660) and that pocket has exactly one op that leaves it. The ledge reads
 * like a second and is not — no tile of the pocket stands beside it. A leg that walked at the far side
 * instead let the mover sweep for anything that gained ground; it picked a cage door twice, and "the cage
 * slams shut behind you" left the run in an eight-tile cell with no edge out.
 */
async function digOutOfCages(log: (m: string) => void): Promise<boolean> {
    if (!(await travelTo(UP_TILE.MUD_DIG, 2, log))) {
        return false;
    }
    await settleScene();
    const mud = locById(UP_LOC.MUD_DIG, null, 8);
    const spade = Inventory.items().find(item => item.id === UP_ITEM.SPADE.id);
    if (!mud || !spade) {
        log(mud ? 'no spade for the filled-in tunnel' : 'no pile of mud in the slave cages');
        return false;
    }
    if (!(await spade.useOn(mud))) {
        return false;
    }
    // Why: the dig ends on `p_teleport(0_37_150_24_46)`, so the far side of the tunnel is the only honest
    // signal that it opened — the message prints on a pack without a spade too.
    return driveUntil(() => !inSlaveCages(Game.tile()), [], log, 15_000);
}

/**
 * The bridge over the chasm, shot down with a lit arrow.
 * Why: `upass_bridge` leaves no permanent state — the crossing is `loc_change(old_bridge_animated, 8)` and a
 * `p_teleport`, both temporary, and the lever that lowers it again stands on the WEST bank and only sends
 * the player east. So a finished Underground Pass buys nothing here: every westbound walk builds the fire
 * arrow again. Koftik hands over a fresh damp cloth whenever the pack holds none, and the shot spends the
 * arrow whether or not the ranged roll lands.
 */
async function crossBridge(log: (m: string) => void): Promise<boolean> {
    const staged = heldId(UP_ITEM.LIT_ARROW.id) + heldId(UP_ITEM.UNLIT_ARROW.id) + heldId(UP_ITEM.DAMP_CLOTH.id);
    if (staged === 0 && !(await getDampCloth(log))) {
        log('Koftik would not hand over a damp cloth at the bridge');
        return false;
    }
    if (!(await makeFireArrow(log)) || !(await armFireArrow(log))) {
        return false;
    }
    return shootGuiderope(log);
}

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
        // Why: the first cavern is three places at once and only `pastGridTile` tells them apart. The bridge
        // shelf and the orb corridor overlap on x — the shelf runs 2431-2464 and the corridor 2380-2466 —
        // so an x test reads the shelf as the corridor, sends the leg at the temple doors on the paladins'
        // shelf, and the walk to them has no route: forty minutes standing at (2464,9726).
        case 'area1':
            if (eastOfChasm(here)) {
                return crossBridge(log);
            }
            if (!pastGridTile(here)) {
                return crossGrid(log);
            }
            return (here?.z ?? 0) > SHELF_Z ? enterMainCavern(log) : climbWell(log);
        case 'area2':
            // Why: the paladins' shelf is entered by one loc and one only. Flooding it lists three ops on its
            // rim — the temple doors out, the blood well, and `upass_unicorn_door`, which `p_telejump`s to
            // (2371,9666) from its south face. So the shelf is behind the whole second cavern, and a leg that
            // walked at `PALADINS` instead asked for a tile in another pocket: the mover swept for anything
            // that gained ground, picked a slave-cage door, and "the cage slams shut behind you" left the run
            // in an eight-tile cell with no edge out.
            return inSlaveCages(here) ? digOutOfCages(log) : travelTo(UNICORN_DOORS, 3, log);
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
