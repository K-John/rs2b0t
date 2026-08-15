import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { driveUntil, heldId, settleScene } from '../../exec/prompts.js';
import type { QuestSnapshot } from '../../engine/types.js';
import { UP_BADGES, UP_ITEM, UP_LOC, UP_NPC, UP_TILE, countHeld, type UpassItem } from './areas.js';
import { locById, walkTo } from './bridge.js';

/** Search the middle cage for the loose railing that levers the boulder. */
export async function takeRailing(log: (m: string) => void): Promise<boolean> {
    if (heldId(UP_ITEM.RAILING.id) > 0) {
        return true;
    }
    if (!(await walkTo(UP_TILE.RAILINGS_LOOSE, 1, log))) {
        return false;
    }
    await settleScene();
    const cage = locById(UP_LOC.RAILINGS_LOOSE, 'Search', 8);
    if (!cage || !(await cage.interact('Search'))) {
        log('no searchable cage bars at the loose railing');
        return false;
    }
    return driveUntil(() => heldId(UP_ITEM.RAILING.id) > 0, [], log, 12_000);
}

/** Lever the boulder onto the unicorn; the script telejumps the player west afterwards. */
export async function dropBoulder(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(UP_TILE.BOULDER, 2, log))) {
        return false;
    }
    await settleScene();
    const boulder = Npcs.query().where(npc => npc.id === UP_NPC.BOULDER).within(10).nearest();
    const railing = Inventory.items().find(item => item.id === UP_ITEM.RAILING.id);
    if (!boulder || !railing) {
        log(`missing ${boulder ? 'the piece of railing' : 'the boulder'} for the unicorn`);
        return false;
    }
    const from = Game.tile();
    if (!(await railing.useOn(boulder))) {
        return false;
    }
    return driveUntil(() => {
        const now = Game.tile();
        return now !== null && from !== null && Math.abs(now.x - from.x) > 10;
    }, [], log, 15_000);
}

/** All that is left of the unicorn is the horn the blood well wants. */
export async function takeUnicornHorn(log: (m: string) => void): Promise<boolean> {
    if (heldId(UP_ITEM.UNICORN_HORN.id) > 0) {
        return true;
    }
    if (!(await walkTo(UP_TILE.UNICORN_CAGE, 2, log))) {
        return false;
    }
    await settleScene();
    const cage = locById(UP_LOC.UNICORN_CAGE, null, 8);
    const op = cage?.actions()[0];
    if (!cage || !op || !(await cage.interact(op))) {
        log('no crushed unicorn cage to search');
        return false;
    }
    return driveUntil(() => heldId(UP_ITEM.UNICORN_HORN.id) > 0, [], log, 12_000);
}

/** Climb the mud pile out of the second cavern and back up to the paladins' shelf. */
export async function climbToPaladins(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(UP_TILE.MUDPILE, 2, log))) {
        return false;
    }
    await settleScene();
    const pile = locById(UP_LOC.MUDPILE, null, 8);
    const op = pile?.actions()[0];
    if (!pile || !op || !(await pile.interact(op))) {
        log('no mud pile to climb out of the second cavern');
        return false;
    }
    return driveUntil(() => (Game.tile()?.z ?? 0) >= 9664, [], log, 15_000);
}

const PALADINS: readonly { npc: number; badge: UpassItem }[] = [
    { npc: UP_NPC.PALADIN_JERRO, badge: UP_ITEM.BADGE_JERRO },
    { npc: UP_NPC.PALADIN_CARL, badge: UP_ITEM.BADGE_CARL },
    { npc: UP_NPC.PALADIN_HARRY, badge: UP_ITEM.BADGE_HARRY }
];

export function badgesHeld(snap: QuestSnapshot): number {
    return countHeld(snap, UP_BADGES);
}

// Why: the three paladins only turn hostile once the main cavern has been entered, so before that they are
// killed one at a time from a standing start rather than left to aggro as a group.

/** Kill whichever paladin still owes a badge and take it off the floor. */
export async function killPaladin(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(UP_TILE.PALADINS, 4, log))) {
        return false;
    }
    await settleScene();
    const owed = PALADINS.find(p => heldId(p.badge.id) === 0);
    if (!owed) {
        return true;
    }
    const target = Npcs.query().where(npc => npc.id === owed.npc).action('Attack').within(14).nearest();
    if (!target) {
        log(`no paladin ${owed.npc} on the shelf`);
        return false;
    }
    if (!(await target.interact('Attack'))) {
        log(`could not attack paladin ${owed.npc}`);
        return false;
    }
    return driveUntil(() => heldId(owed.badge.id) > 0, [], log, 120_000);
}

/** The blood well opens the temple doors once it has all three crests and the horn. */
export async function feedBloodWell(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(UP_TILE.BLOODWELL, 1, log))) {
        return false;
    }
    await settleScene();
    let fed = 0;
    for (const item of [...UP_BADGES, UP_ITEM.UNICORN_HORN]) {
        if (heldId(item.id) === 0) {
            continue;
        }
        const well = locById(UP_LOC.BLOODWELL, null, 8);
        const held = Inventory.items().find(inv => inv.id === item.id);
        if (!well || !held) {
            break;
        }
        if (!(await held.useOn(well))) {
            break;
        }
        if (!(await driveUntil(() => heldId(item.id) === 0, [], log, 15_000))) {
            log(`the blood well would not take ${item.name}`);
            break;
        }
        fed++;
    }
    log(`fed ${fed} item(s) to the blood well`);
    return fed > 0;
}

/** Through the double doors into the main cavern. */
export async function enterMainCavern(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(UP_TILE.TEMPLE_DOOR, 2, log))) {
        return false;
    }
    await settleScene();
    const door = locById(UP_LOC.TEMPLE_DOOR_L, null, 8) ?? locById(UP_LOC.TEMPLE_DOOR_R, null, 8);
    const op = door?.actions()[0];
    if (!door || !op || !(await door.interact(op))) {
        log('no temple double door at the west end of the shelf');
        return false;
    }
    return driveUntil(() => (Game.tile()?.level ?? 0) === 1, [], log, 15_000);
}
