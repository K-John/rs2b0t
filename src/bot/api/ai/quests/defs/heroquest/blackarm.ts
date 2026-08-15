import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GroundItems, type GroundItem } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Modals } from '../../../../ui/widgets/Modals.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { openContainer, talkAndClose, talkUntil } from '../../exec/legs.js';
import { promptLoc } from '../../exec/prompts.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import {
    GRIP,
    HERO_ID,
    HERO_LOC,
    HERO_NAMED,
    HERO_NPC,
    HERO_SAY,
    HERO_SHOP,
    HERO_TILE,
    KATRINE_ARMBAND,
    KATRINE_TASK,
    TROBERT,
    inMansion,
    inTreasureRoom
} from './areas.js';
import { crossTreasureDoorIn, crossTreasureDoorOut, enterBrimhavenHq, enterMansion, returnToStreet } from './doors.js';
import { HERO_STAGE } from './journal.js';
import { anywhere, bankedId, heldId, wornId } from './state.js';

/** Hartigen's disguise: Garv checks all three worn, and refuses silently otherwise. */
const DISGUISE = [
    { id: HERO_ID.BLACK_PLATEBODY, name: HERO_NAMED.BLACK_PLATEBODY, shop: HERO_SHOP.HORVIK, gp: 4_500 },
    { id: HERO_ID.BLACK_PLATELEGS, name: HERO_NAMED.BLACK_PLATELEGS, shop: HERO_SHOP.VALAINE, gp: 30_000 },
    { id: HERO_ID.BLACK_FULL_HELM, name: HERO_NAMED.BLACK_FULL_HELM, shop: HERO_SHOP.VALAINE, gp: 2_000 }
] as const;

const LURE_WAIT_MS = 60_000;
const GROUND_RANGE = 12;

/** The disguise, in whatever state it is in: bought, withdrawn, then worn. */
export function disguiseStep(snap: QuestSnapshot): QuestStep | null {
    for (const piece of DISGUISE) {
        if (wornId(snap, piece.id)) {
            continue;
        }
        if (heldId(snap, piece.id) > 0) {
            return { kind: 'equip', item: piece.name };
        }
        if (bankedId(snap, piece.id) > 0) {
            return { kind: 'withdraw', items: [{ name: piece.name, qty: 1, id: piece.id }] };
        }
        // Why: Valaine is upstairs in the Champions' Guild, which is the only shop that stocks the
        // helm and the legs; the stairs are baked, so the buy step's own walk gets there.
        return { kind: 'buy', item: piece.name, qty: 1, shop: piece.shop, estGp: piece.gp };
    }
    return null;
}

/** True once all three pieces are somewhere the bot can reach them. */
export function disguiseOwned(snap: QuestSnapshot): boolean {
    return DISGUISE.every(piece => anywhere(snap, piece.id) > 0);
}

export async function talkToTrobert(log: (m: string) => void): Promise<boolean> {
    if (!(await enterBrimhavenHq(log))) {
        return false;
    }
    return talkUntil(TROBERT, TROBERT.prefer, () => Inventory.countById(HERO_ID.ID_PAPERS) > 0, log, 60_000);
}

// Why: the first talk takes the papers and only then opens the option tree, so one leg covers both
// the introduction and the key — and Grip re-issues the spare whenever `~obj_gettotal` reads zero.

/** Report for duty, then ask for a job, which is what hands over the spare key. */
export async function askGripForKey(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(HERO_ID.MISC_KEY) > 0) {
        return true;
    }
    if (!(await enterMansion(log))) {
        return false;
    }
    return talkUntil(GRIP, GRIP.prefer, () => Inventory.countById(HERO_ID.MISC_KEY) > 0, log, 90_000);
}

function keyringOnFloor(): GroundItem | null {
    return GroundItems.query().where(g => g.id === HERO_ID.GRIP_KEYS).within(GROUND_RANGE).nearest();
}

function gripLured(): boolean {
    const grip = Npcs.query().where(n => n.id === HERO_NPC.GRIP).nearest();
    if (!grip) {
        return false;
    }
    const tile = grip.tile();
    return tile !== null && Math.max(Math.abs(tile.x - HERO_TILE.GRIP_LURE.x), Math.abs(tile.z - HERO_TILE.GRIP_LURE.z)) <= 2;
}

async function takeKeyring(log: (m: string) => void): Promise<boolean> {
    const drop = keyringOnFloor();
    if (!drop) {
        return false;
    }
    const before = Inventory.countById(HERO_ID.GRIP_KEYS);
    if (!(await drop.interact('Take'))) {
        return false;
    }
    const took = await Execution.delayUntil(() => Inventory.countById(HERO_ID.GRIP_KEYS) > before, 8_000);
    if (took) {
        log("took Grip's keyring off the floor");
    }
    return took;
}

// Why: the side room is sealed from the hall by a `snipable_wall` (blockrange=no), so the rival shoots
// Grip through the arrow slit — and only reaches him at all while the drinks cabinet has walked him
// onto that row. The lure is repeatable: the open cabinet's Search re-runs `summon_grip`.

/** Walk Grip to the arrow slit, wait for the rival to drop him, and take the keyring. */
export async function lureGripAndTakeKeyring(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(HERO_ID.GRIP_KEYS) > 0) {
        return true;
    }
    if (!(await enterMansion(log))) {
        return false;
    }
    if (await takeKeyring(log)) {
        return true;
    }
    const openCabinet = (): boolean => Locs.query().within(6).where(l => l.id === HERO_LOC.CABINET_OPEN).nearest() !== null;
    const shut = !openCabinet();
    await promptLoc({
        name: 'Cupboard',
        op: shut ? 'Open' : 'Search',
        near: HERO_TILE.CABINET_STAND,
        id: shut ? HERO_LOC.CABINET_SHUT : HERO_LOC.CABINET_OPEN,
        within: 6,
        prefer: [HERO_SAY.CABINET_PEEK],
        expect: () => gripLured() || keyringOnFloor() !== null,
        expectMs: 20_000
    }, log);
    await Modals.close();
    // Why: the partner's kill is not this client's work, so the wait is wall-clock and bounded — a
    // pass that times out re-lures, which is what a Grip who walked home needs anyway.
    await Execution.delayUntil(() => keyringOnFloor() !== null, LURE_WAIT_MS);
    return takeKeyring(log);
}

/** Grip's keyring opens the treasure room, and the chest inside hands over two candlesticks. */
export async function lootCandlesticks(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(HERO_ID.CANDLESTICK) >= 2) {
        return crossTreasureDoorOut(log);
    }
    if (!inTreasureRoom(Game.tile())) {
        if (!(await enterMansion(log))) {
            return false;
        }
        if (!(await Traversal.walkResilient(HERO_TILE.TREASURE_DOOR, { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) {
            return false;
        }
        if (!(await crossTreasureDoorIn(log))) {
            return false;
        }
    }
    if (!(await openContainer('Chest', HERO_LOC.CHEST_SHUT, HERO_LOC.CHEST_OPEN, HERO_TILE.CHEST_STAND, log))) {
        await crossTreasureDoorOut(log);
        return false;
    }
    await promptLoc({
        name: 'Chest',
        op: 'Search',
        near: HERO_TILE.CHEST_STAND,
        id: HERO_LOC.CHEST_OPEN,
        within: 6,
        expect: () => Inventory.countById(HERO_ID.CANDLESTICK) > 0
    }, log);
    await Modals.close();
    const took = Inventory.countById(HERO_ID.CANDLESTICK) > 0;
    if (!took) {
        log('the chest handed over nothing — a candlestick is already held or banked');
    }
    // Why: the take is the work; a failed exit is retried for free by the next pass's early branch.
    await crossTreasureDoorOut(log);
    return took;
}

/** Katrine stands above ground in Varrock, but the candlestick is looted inside a sealed pocket. */
export async function handInCandlestick(log: (m: string) => void): Promise<boolean> {
    if (!(await returnToStreet(log))) {
        return false;
    }
    return talkUntil(KATRINE_ARMBAND, KATRINE_ARMBAND.prefer,
        () => Inventory.countById(HERO_ID.ARMBAND) > 0, log, 60_000);
}

/** The Black Arm half of the armband, from Katrine's task to her reward. */
export function blackarmArmbandStep(snap: QuestSnapshot, stage: number): QuestStep | null {
    switch (stage) {
        case HERO_STAGE.STARTED:
            return {
                kind: 'custom',
                name: 'ask Katrine about the master thief rank',
                run: log => talkAndClose(KATRINE_TASK, KATRINE_TASK.prefer, log)
            };

        case HERO_STAGE.BLACKARM_SPOKEN: {
            // Why: the disguise is bought in Varrock, where Katrine already stands — buying it after
            // the crossing costs a return ferry and a walk across two kingdoms.
            const piece = disguiseOwned(snap) ? null : disguiseStep(snap);
            if (piece) {
                return piece;
            }
            return { kind: 'custom', name: 'say the password at the Brimhaven hideout', run: enterBrimhavenHq };
        }

        case HERO_STAGE.BLACKARM_HQ:
            return { kind: 'custom', name: 'take Hartigen’s papers from Trobert', run: talkToTrobert };

        case HERO_STAGE.BLACKARM_PAPERS: {
            if (heldId(snap, HERO_ID.ID_PAPERS) === 0) {
                return { kind: 'custom', name: 'ask Trobert for a spare set of papers', run: talkToTrobert };
            }
            const dressed = disguiseStep(snap);
            if (dressed) {
                return dressed;
            }
            return { kind: 'custom', name: 'pass Garv as Hartigen the Black Knight', run: enterMansion };
        }

        case HERO_STAGE.BLACKARM_MANSION:
            return { kind: 'custom', name: 'report to Grip as his new deputy', run: askGripForKey };

        case HERO_STAGE.BLACKARM_PAPERS_GIVEN:
            if (heldId(snap, HERO_ID.GRIP_KEYS) > 0) {
                return { kind: 'custom', name: 'open the treasure room and the chest', run: lootCandlesticks };
            }
            if (heldId(snap, HERO_ID.MISC_KEY) === 0) {
                return { kind: 'custom', name: 'ask Grip for a job, which hands over his spare key', run: askGripForKey };
            }
            return { kind: 'custom', name: 'lure Grip to the arrow slit for the rival', run: lureGripAndTakeKeyring };

        case HERO_STAGE.BLACKARM_LOOTED:
            if (heldId(snap, HERO_ID.CANDLESTICK) === 0) {
                return { kind: 'wait', reason: 'the chest is looted but no candlestick is carried' };
            }
            return { kind: 'custom', name: 'give Katrine the candlestick', run: handInCandlestick };

        default:
            return null;
    }
}

/** Where the Black Arm bot must stand before anything but the armband can run. */
export function blackarmSealed(snap: QuestSnapshot): boolean {
    return inMansion(snap.tile) || inTreasureRoom(snap.tile);
}
