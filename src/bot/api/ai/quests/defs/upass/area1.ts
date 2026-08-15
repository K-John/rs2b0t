import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import type Tile from '../../../../../geometry/Tile.js';
import { driveDialog } from '../../exec/primitives.js';
import { driveUntil, heldId, settleScene } from '../../exec/prompts.js';
import { UP_ITEM, UP_LOC, UP_ORBS, UP_TILE, type UpassItem } from './areas.js';
import { locById, walkTo } from './bridge.js';
import { crossGrid } from './grid.js';

/** Where each orb of light is, and how it is taken. */
export const ORB_SITES: readonly { orb: UpassItem; tile: Tile; fromTrap: boolean }[] = [
    { orb: UP_ITEM.ORB1, tile: UP_TILE.LOGTRAP, fromTrap: true },
    { orb: UP_ITEM.ORB2, tile: UP_TILE.ORB2, fromTrap: false },
    { orb: UP_ITEM.ORB3, tile: UP_TILE.ORB3, fromTrap: false },
    { orb: UP_ITEM.ORB4, tile: UP_TILE.ORB4, fromTrap: false }
];

/** How many orbs are in the pack right now. */
export function orbsHeld(): number {
    return UP_ORBS.filter(orb => heldId(orb.id) > 0).length;
}

// Why: the rope swing east is the only link from the bridge shelf down to the grid, and it eats the rope
// each time — a second crossing needs a second rope, which is why the kit carries one and the leg is ordered
// so the swing is made once.

/** Rope on the rock, swinging east onto the grid shelf. */
export async function swingEast(log: (m: string) => void): Promise<boolean> {
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

/** The hanging-log trap yields the first orb when it is disarmed rather than sprung. */
export async function takeTrappedOrb(log: (m: string) => void): Promise<boolean> {
    if (heldId(UP_ITEM.ORB1.id) > 0) {
        return true;
    }
    if (!(await walkTo(UP_TILE.LOGTRAP, 2, log))) {
        return false;
    }
    await settleScene();
    const trigger = locById(UP_LOC.LOGTRAP_TRIGGER, null, 8);
    if (!trigger) {
        log('no hanging-log trigger rock at the orb — already burned');
        return true;
    }
    const ops = trigger.actions();
    const op = ops[0];
    if (!op || !(await trigger.interact(op))) {
        log(`the log trap trigger offers no op (${ops.join(' | ')})`);
        return false;
    }
    // Why: the disarm asks "Do you want to try and disarm it?" before it rolls thieving — declining is the
    // default option, so the yes branch has to be named.
    await driveDialog(["Yes, I'll give it a go"], log);
    return driveUntil(() => heldId(UP_ITEM.ORB1.id) > 0, [], log, 12_000);
}

// Why: nothing records which orbs are already dark — the varp is untransmitted and the journal only says
// "after destroying four orbs" once the well has been used. An orb that is neither in the pack nor on its
// own floor tile has therefore already gone into the furnace, and the sweep steps past it.
export async function takeGroundOrb(orb: UpassItem, tile: Tile, log: (m: string) => void): Promise<boolean> {
    if (heldId(orb.id) > 0) {
        return true;
    }
    if (!(await walkTo(tile, 2, log))) {
        return false;
    }
    await settleScene();
    // Why: all four orbs display as "Orb of light", so the ground pile is matched on the exact id.
    const drop = GroundItems.query().where(item => item.id === orb.id).within(8).nearest();
    if (!drop) {
        log(`no Orb of light on the floor at (${tile.x},${tile.z}) — already burned`);
        return true;
    }
    if (!(await drop.interact('Take'))) {
        return false;
    }
    return driveUntil(() => heldId(orb.id) > 0, [], log, 10_000);
}

/** Every orb in the pack, thrown into the furnace one at a time. */
export async function burnOrbs(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(UP_TILE.FURNACE, 2, log))) {
        return false;
    }
    await settleScene();
    let burned = 0;
    for (const orb of UP_ORBS) {
        if (heldId(orb.id) === 0) {
            continue;
        }
        const furnace = Locs.query().where(loc => loc.id === UP_LOC.FURNACE).within(8).nearest();
        const held = Inventory.items().find(item => item.id === orb.id);
        if (!furnace || !held) {
            break;
        }
        if (!(await held.useOn(furnace))) {
            break;
        }
        if (!(await driveUntil(() => heldId(orb.id) === 0, [], log, 15_000))) {
            log('the furnace would not take the orb');
            break;
        }
        burned++;
        await Execution.delayTicks(1);
    }
    log(`burned ${burned} orb(s) in the furnace`);
    return true;
}

/** The well only takes the player down once all four orbs are dark. */
export async function enterWell(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(UP_TILE.WELL, 2, log))) {
        return false;
    }
    await settleScene();
    const well = locById(UP_LOC.WELL, null, 8);
    if (!well) {
        log('no well at the west end of the first cavern');
        return false;
    }
    const op = well.actions()[0];
    if (!op || !(await well.interact(op))) {
        log('the well offers no usable op');
        return false;
    }
    return driveUntil(() => (Game.tile()?.z ?? 0) < 9664, [], log, 15_000);
}

export { crossGrid };
