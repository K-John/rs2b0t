import { Game } from '../../../../game/Game.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import type { Npc } from '../../../../model/Npc.js';
import type Tile from '../../../../../geometry/Tile.js';
import { driveUntil, heldId, settleScene } from '../../exec/prompts.js';
import { UP_AMULETS, UP_ITEM, UP_LOC, UP_NPC, UP_TILE, type UpassItem } from './areas.js';
import { locById, walkTo } from './bridge.js';

/** Rub an element into the doll. */
async function rubIntoDoll(element: UpassItem, log: (m: string) => void): Promise<boolean> {
    const held = Inventory.items().find(item => item.id === element.id);
    const doll = Inventory.items().find(item => item.id === UP_ITEM.DOLL.id);
    if (!held || !doll) {
        log(`missing ${held ? 'the doll' : element.name} to complete the doll`);
        return false;
    }
    if (!(await held.useOn(doll))) {
        return false;
    }
    return driveUntil(() => heldId(element.id) === 0, [], log, 20_000);
}

export const rubAshes = (log: (m: string) => void): Promise<boolean> => rubIntoDoll(UP_ITEM.ASHES, log);
export const rubShadow = (log: (m: string) => void): Promise<boolean> => rubIntoDoll(UP_ITEM.SHADOW, log);
export const rubDove = (log: (m: string) => void): Promise<boolean> => rubIntoDoll(UP_ITEM.DOVE, log);

/** Bucket under the dwarves' brew barrel. */
export async function fillBrew(log: (m: string) => void): Promise<boolean> {
    if (heldId(UP_ITEM.DWARF_BREW.id) > 0) {
        return true;
    }
    if (!(await walkTo(UP_TILE.BREW_BARREL, 1, log))) {
        return false;
    }
    await settleScene();
    const barrel = locById(UP_LOC.BREW_BARREL, null, 8);
    const bucket = Inventory.items().find(item => item.id === UP_ITEM.BUCKET.id);
    if (!barrel || !bucket) {
        log(`missing ${barrel ? 'an empty bucket' : 'the brew barrel'}`);
        return false;
    }
    if (!(await bucket.useOn(barrel))) {
        return false;
    }
    return driveUntil(() => heldId(UP_ITEM.DWARF_BREW.id) > 0, [], log, 12_000);
}

// Why: the tomb only takes the brew once the doll is in hand, and only burns after it is soaked —
// so the pour and the light are two separate uses of the same loc, in that order.

/** Pour the brew over Iban's tomb, then light it, and take the ashes. */
export async function burnTomb(log: (m: string) => void): Promise<boolean> {
    if (heldId(UP_ITEM.ASHES.id) > 0) {
        return true;
    }
    if (!(await walkTo(UP_TILE.IBAN_TOMB, 1, log))) {
        return false;
    }
    await settleScene();
    if (heldId(UP_ITEM.DWARF_BREW.id) > 0) {
        const tomb = locById(UP_LOC.IBAN_TOMB_L, null, 8) ?? locById(UP_LOC.IBAN_TOMB_R, null, 8);
        const brew = Inventory.items().find(item => item.id === UP_ITEM.DWARF_BREW.id);
        if (!tomb || !brew) {
            log('no tomb to pour the brew over');
            return false;
        }
        if (!(await brew.useOn(tomb))) {
            return false;
        }
        if (!(await driveUntil(() => heldId(UP_ITEM.DWARF_BREW.id) === 0, [], log, 15_000))) {
            log('the tomb would not take the brew');
            return false;
        }
    }
    const tomb = locById(UP_LOC.IBAN_TOMB_L, null, 8) ?? locById(UP_LOC.IBAN_TOMB_R, null, 8);
    const tinderbox = Inventory.items().find(item => item.id === UP_ITEM.TINDERBOX.id);
    if (!tomb || !tinderbox) {
        log(`missing ${tomb ? 'a tinderbox' : 'the tomb'} to burn the corpse`);
        return false;
    }
    if (!(await tinderbox.useOn(tomb))) {
        return false;
    }
    return driveUntil(() => heldId(UP_ITEM.ASHES.id) > 0, [], log, 20_000);
}

// Why: an NPC that dies leaves the scene, so "the target is gone" is the only completion signal that does
// not depend on a drop landing or on a journal line the engine has not re-read yet.
async function killNpc(npcId: number, near: Tile, name: string, log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(near, 5, log))) {
        return false;
    }
    await settleScene();
    const find = (): Npc | null => Npcs.query().where(npc => npc.id === npcId).within(14).nearest();
    const target = find();
    if (!target) {
        log(`no ${name} near (${near.x},${near.z}) — already dead this spawn`);
        return true;
    }
    if (!(await target.interact('Attack'))) {
        log(`could not attack ${name}`);
        return false;
    }
    return driveUntil(() => find() === null, [], log, 180_000);
}

/** Kalrag's fluids smear onto the doll on her death, so the doll has to be in the pack. */
export async function killKalrag(log: (m: string) => void): Promise<boolean> {
    if (heldId(UP_ITEM.DOLL.id) === 0) {
        log('no doll of Iban in the pack — killing Kalrag now would waste the blood');
        return false;
    }
    return killNpc(UP_NPC.KALRAG, UP_TILE.KALRAG, 'Kalrag', log);
}

const DEMONS: readonly { npc: number; amulet: UpassItem; tile: Tile; name: string }[] = [
    { npc: UP_NPC.DOOMION, amulet: UP_ITEM.AMULET_DOOMION, tile: UP_TILE.DOOMION, name: 'Doomion' },
    { npc: UP_NPC.HOLTHION, amulet: UP_ITEM.AMULET_HOLTHION, tile: UP_TILE.HOLTHION, name: 'Holthion' },
    { npc: UP_NPC.OTHAINIAN, amulet: UP_ITEM.AMULET_OTHAINIAN, tile: UP_TILE.OTHAINIAN, name: 'Othainian' }
];

export function amuletsHeld(): number {
    return UP_AMULETS.filter(amulet => heldId(amulet.id) > 0).length;
}

/** Kill whichever demon still owes an amulet, then take it off the floor. */
export async function killDemon(log: (m: string) => void): Promise<boolean> {
    const owed = DEMONS.find(d => heldId(d.amulet.id) === 0);
    if (!owed) {
        return true;
    }
    if (!(await killNpc(owed.npc, owed.tile, owed.name, log))) {
        return false;
    }
    const drop = GroundItems.query().where(item => item.id === owed.amulet.id).within(10).nearest();
    if (!drop) {
        log(`${owed.name} died but left no amulet in reach`);
        return false;
    }
    if (!(await drop.interact('Take'))) {
        return false;
    }
    return driveUntil(() => heldId(owed.amulet.id) > 0, [], log, 10_000);
}

/** The three amulets unseal the chest that holds Iban's shadow. */
export async function openSealedChest(log: (m: string) => void): Promise<boolean> {
    if (heldId(UP_ITEM.SHADOW.id) > 0) {
        return true;
    }
    if (!(await walkTo(UP_TILE.SEALED_CHEST, 1, log))) {
        return false;
    }
    await settleScene();
    const chest = locById(UP_LOC.SEALED_CHEST, null, 8);
    const op = chest?.actions()[0];
    if (!chest || !op || !(await chest.interact(op))) {
        log('no sealed chest on the demons platform');
        return false;
    }
    return driveUntil(() => heldId(UP_ITEM.SHADOW.id) > 0, [], log, 20_000);
}

/** Search the soulless cages for Iban's dove; the gauntlets are what stop the bite. */
export async function searchCages(log: (m: string) => void): Promise<boolean> {
    if (heldId(UP_ITEM.DOVE.id) > 0) {
        return true;
    }
    if (!(await walkTo(UP_TILE.CAGE_DOVE, 2, log))) {
        return false;
    }
    await settleScene();
    const cage = locById(UP_LOC.CAGE_DOVE, null, 8);
    const op = cage?.actions()[0];
    if (!cage || !op || !(await cage.interact(op))) {
        log('no soulless cage holding the dove');
        return false;
    }
    return driveUntil(() => heldId(UP_ITEM.DOVE.id) > 0, [], log, 20_000);
}

/** Iban's temple doors. */
export async function openIbanDoor(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(UP_TILE.IBAN_DOOR, 2, log))) {
        return false;
    }
    await settleScene();
    const door = locById(UP_LOC.IBAN_DOOR_L, null, 8) ?? locById(UP_LOC.IBAN_DOOR_R, null, 8);
    const op = door?.actions()[0];
    if (!door || !op || !(await door.interact(op))) {
        log("no doors on Iban's temple");
        return false;
    }
    return driveUntil(() => (Game.tile()?.x ?? 9999) < UP_TILE.IBAN_DOOR.x, [], log, 15_000);
}

/** The doll into the pit of the damned. */
export async function throwDoll(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(UP_TILE.IBAN_ALTAR, 1, log))) {
        return false;
    }
    await settleScene();
    const altar = locById(UP_LOC.IBAN_ALTAR, null, 8);
    const doll = Inventory.items().find(item => item.id === UP_ITEM.DOLL.id);
    if (!altar || !doll) {
        log(`missing ${altar ? 'the doll of Iban' : 'the temple altar'}`);
        return false;
    }
    if (!(await doll.useOn(altar))) {
        return false;
    }
    return driveUntil(() => heldId(UP_ITEM.DOLL.id) === 0, [], log, 30_000);
}
