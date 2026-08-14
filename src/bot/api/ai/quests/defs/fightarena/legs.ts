import { Equipment } from '../../../../equipment/Equipment.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { Prayer } from '../../../../prayer/Prayer.js';
import { Reach } from '../../../../walking/Reach.js';
import { Skills } from '../../../../skills/Skills.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { ITEM_DB } from '../../../../../data/itemdb.js';
import type Tile from '../../../../../geometry/Tile.js';
import { driveDialog } from '../../exec/primitives.js';
import { settleScene } from '../../exec/prompts.js';
import { FA_LOC, FA_OBJ, FA_TILE, pocketOf, type FaPocket } from './areas.js';
import { PROTECT_LEVEL, PROTECT_MELEE } from './fights.js';

const SLOT_BY_ID = new Map(ITEM_DB.filter(r => r.slot !== undefined).map(r => [r.id, r.slot]));
const DISGUISE = new Set<number>([FA_OBJ.HELMET, FA_OBJ.ARMOUR]);

// Why: equipping the Khazard pieces pushes whatever was worn into the pack, so the combat kit is already carried and the swap back needs no bank.

/** The pack's own hat and torso ids, hat first. */
export function combatSwap(packIds: readonly number[]): number[] {
    const pick = (slot: string): number | undefined =>
        packIds.find(id => !DISGUISE.has(id) && SLOT_BY_ID.get(id) === slot);
    return [pick('hat'), pick('torso')].filter((id): id is number => id !== undefined);
}

const packIds = (): number[] => Inventory.items().map(item => item.id);
const held = (id: number): boolean => Inventory.countById(id) > 0;
const wearing = (id: number): boolean => Equipment.items().some(item => item.id === id);
const disguised = (): boolean => wearing(FA_OBJ.HELMET) || wearing(FA_OBJ.ARMOUR);

async function walkExactly(tile: Tile, log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && here.level === tile.level && tile.distanceTo(here) === 0) {
        return true;
    }
    return Traversal.walkResilient(tile, { radius: 0, attempts: 4, timeoutMs: 180_000, log });
}

async function landedIn(pocket: FaPocket, ms: number): Promise<boolean> {
    return Execution.delayUntil(() => pocketOf(Game.tile()) === pocket, ms);
}

// Why: `forceapproach=north` means the server drops every op issued from another side, with no refusal and no movement, which is indistinguishable from a missing loc.

/** Open and search the guards' chest for the Khazard disguise. */
export async function searchChest(log: (m: string) => void): Promise<boolean> {
    if (held(FA_OBJ.HELMET) && held(FA_OBJ.ARMOUR)) {
        return true;
    }
    if (!(await walkExactly(FA_TILE.CHEST_STAND, log))) {
        log('could not stand north of the guards\' chest');
        return false;
    }
    await settleScene();
    const shut = Locs.query().name(FA_LOC.CHEST).action('Open').within(4).nearest();
    if (shut) {
        await shut.interact('Open');
        await Execution.delayTicks(2);
        return false;
    }
    const open = Locs.query().name(FA_LOC.CHEST).action('Search').within(4).nearest();
    if (!open) {
        log('no Chest to Search from the north stand');
        return false;
    }
    if (!(await open.interact('Search'))) {
        return false;
    }
    return Execution.delayUntil(() => held(FA_OBJ.HELMET) && held(FA_OBJ.ARMOUR), 8000);
}

async function equipById(id: number, log: (m: string) => void): Promise<boolean> {
    const item = Inventory.items().find(entry => entry.id === id);
    if (!item) {
        return false;
    }
    const name = item.name ?? String(id);
    if (!(await Equipment.equip(name))) {
        log(`could not wear ${name}`);
        return false;
    }
    return Execution.delayUntil(() => wearing(id), 4000);
}

/** Wear the disguise. Whatever it replaces lands in the pack. */
export async function wearKhazard(log: (m: string) => void): Promise<boolean> {
    let ok = true;
    for (const id of [FA_OBJ.HELMET, FA_OBJ.ARMOUR]) {
        if (wearing(id)) {
            continue;
        }
        ok = (await equipById(id, log)) && ok;
    }
    return ok;
}

/** Put the account's own head and body back on before a fight. */
export async function wearCombat(log: (m: string) => void): Promise<boolean> {
    const wanted = combatSwap(packIds());
    if (wanted.length === 0) {
        return true;
    }
    for (const id of wanted) {
        await equipById(id, log);
    }
    return true;
}

async function openLocById(locId: number, near: Tile, log: (m: string) => void): Promise<boolean> {
    if (!(await walkExactly(near, log))) {
        return false;
    }
    await settleScene();
    const door = Locs.query().where(l => l.id === locId).action('Open').within(6).nearest();
    if (!door) {
        log(`no loc ${locId} offering Open at (${near.x},${near.z})`);
        return false;
    }
    return Boolean(await door.interact('Open'));
}

/** Cross `fightarena_door1` inwards. Needs the disguise and a guard within five tiles. */
export async function enterBuilding(log: (m: string) => void): Promise<boolean> {
    if (!disguised()) {
        log('refusing to knock without the Khazard disguise on');
        return false;
    }
    if (!(await openLocById(FA_LOC.DOOR1, FA_TILE.DOOR1_OUTSIDE, log))) {
        return false;
    }
    await driveDialog([], log);
    return landedIn('building', 12_000);
}

/** Cross `fightarena_door1` outwards. `check_axis` passes from the inside, so nothing is checked. */
export async function leaveBuilding(log: (m: string) => void): Promise<boolean> {
    if (!(await openLocById(FA_LOC.DOOR1, FA_TILE.DOOR1_INSIDE, log))) {
        return false;
    }
    return landedIn('outside', 12_000);
}

/** Cross `fightarena_door2` into the arena. The guard only allows it at stages 6 and 8. */
export async function enterArenaByDoor2(log: (m: string) => void): Promise<boolean> {
    if (!(await openLocById(FA_LOC.DOOR2, FA_TILE.DOOR2_OUTSIDE, log))) {
        return false;
    }
    await driveDialog([], log);
    return landedIn('arena', 15_000);
}

// Why: at stages 9 to 11 the guard at door1 escorts the player straight into the arena, which is the only way back in after a death.

/** Knock at `fightarena_door1` from outside and let the guard walk us into the arena. */
export async function enterArenaByGuard(log: (m: string) => void): Promise<boolean> {
    if (!(await openLocById(FA_LOC.DOOR1, FA_TILE.DOOR1_OUTSIDE, log))) {
        return false;
    }
    await driveDialog([], log);
    return landedIn('arena', 30_000);
}

/** Use the cell keys on Jeremy's gate. The server frees him and teleports us into the arena. */
export async function unlockJeremy(log: (m: string) => void): Promise<boolean> {
    if (!(await walkExactly(FA_TILE.JEREMY_DOOR_STAND, log))) {
        return false;
    }
    await settleScene();
    const door = Locs.query().where(l => l.id === FA_LOC.JEREMY_DOOR).within(6).nearest();
    const keys = Inventory.items().find(item => item.id === FA_OBJ.KEYS);
    if (!door || !keys) {
        log('no Jeremy gate in reach, or no cell keys held');
        return false;
    }
    if (!(await keys.useOn(door))) {
        return false;
    }
    await driveDialog([], log);
    return landedIn('arena', 40_000);
}

/** Talk to an npc found by id, then drive whatever it opens. */
export async function talkById(npcId: number, prefer: string[], log: (m: string) => void): Promise<boolean> {
    const ready = (): boolean => ChatDialog.isOpen() || ChatDialog.canContinue();
    const status = await Reach.entityOp({
        find: () => Npcs.query().where(n => n.id === npcId).nearest(),
        op: 'Talk-to',
        expect: ready,
        openWhenUnreachable: true,
        what: `npc ${npcId}`,
        log
    });
    if (status !== 'done') {
        log(`npc ${npcId} never opened a dialogue`);
        return false;
    }
    return driveDialog(prefer, log);
}

const FLEE_EAT_AT = 25;

// Why: General Khazard is attacking throughout this, and auto-retaliate walks the character back off the route to swing at him.

/** Leave the arena and the building while Khazard chases. */
export async function fleeArena(log: (m: string) => void): Promise<boolean> {
    const retaliate = Game.autoRetaliateOn();
    Game.setAutoRetaliate(false);
    try {
        if (Skills.level('prayer') >= PROTECT_LEVEL && Prayer.points() > 0 && !Prayer.active(PROTECT_MELEE)) {
            await Prayer.set(PROTECT_MELEE, true);
        }
        if (pocketOf(Game.tile()) === 'arena') {
            if (Skills.effective('hitpoints') <= Skills.level('hitpoints') - FLEE_EAT_AT) {
                await Sustain.run();
            }
            if (!(await openLocById(FA_LOC.DOOR2, FA_TILE.DOOR2_INSIDE, log))) {
                return false;
            }
            if (!(await landedIn('building', 15_000))) {
                return false;
            }
            log('out of the arena');
        }
        if (pocketOf(Game.tile()) === 'building') {
            return leaveBuilding(log);
        }
        return true;
    } finally {
        Game.setAutoRetaliate(retaliate);
        if (Prayer.active(PROTECT_MELEE)) {
            await Prayer.set(PROTECT_MELEE, false);
        }
    }
}
