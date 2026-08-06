import { Execution } from '../../../api/Execution.js';
import { ChatDialog } from '../../../api/hud/ChatDialog.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { Locs } from '../../../api/queries/Locs.js';
import { Traversal } from '../../../api/Traversal.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { isUnderground } from '../../exec/primitives.js';
import { driveUntil, useOnLoc } from '../../exec/prompts.js';
import { GENERAL_STORE, KS_ID, KS_NAME, KS_TILE, WYDIN } from './areas.js';

const COINS_ID = 995;

/**
 * The float is a threshold, not a target. `buy` withdraws exactly `estGp` when
 * the pack is short, so topping up to an exact balance sends the bot back to a
 * booth after every item bought.
 */
export const COIN_FLOAT = 1000;
export const COIN_LOW = 200;

/** Comfortably over any price here, comfortably under the float. */
const SHOP_GP = 30;

/** All four fields are required: a defaulted low-water mark is a branch that never fires. */
export interface FoodWant {
    name: string;
    held: number;
    target: number;
    low: number;
}

export function heldId(snap: QuestSnapshot, id: number): number {
    return snap.invIds?.get(id) ?? 0;
}

export function bankedId(snap: QuestSnapshot, id: number): number {
    return snap.bankIds?.get(id) ?? 0;
}

function withdraw(items: { name: string; qty: number; id?: number }[]): QuestStep {
    return { kind: 'withdraw', items, bank: KS_TILE.FALADOR_BANK };
}

const scanBank: QuestStep = { kind: 'scanBank', bank: KS_TILE.FALADOR_BANK };

/**
 * `ownsInventory` opts this quest out of the engine's coin and food withdrawal,
 * so the module draws both itself. Food is only ever asked for above ground:
 * preparation has to stop at the door, or a top-up mid-dungeon walks the bot
 * back out of it.
 */
export function kit(snap: QuestSnapshot, food?: FoodWant | null): QuestStep | null {
    const underground = snap.tile ? isUnderground(snap.tile) : false;
    const items: { name: string; qty: number; id?: number }[] = [];
    if (heldId(snap, COINS_ID) < COIN_LOW) {
        items.push({ name: 'Coins', qty: COIN_FLOAT, id: COINS_ID });
    }
    if (food && !underground && food.held < food.low) {
        items.push({ name: food.name, qty: food.target - food.held });
    }
    if (items.length === 0) {
        return null;
    }
    return snap.bankKnown ? withdraw(items) : scanBank;
}

async function fillBucket(log: (m: string) => void): Promise<boolean> {
    return useOnLoc(
        KS_ID.BUCKET,
        { name: 'Fountain', near: KS_TILE.FOUNTAIN },
        [],
        () => Inventory.countById(KS_ID.BUCKET_OF_WATER) > 0,
        log
    );
}

async function mixDough(log: (m: string) => void): Promise<boolean> {
    const flour = Inventory.first(KS_NAME.POT_OF_FLOUR);
    const water = Inventory.first(KS_NAME.BUCKET_OF_WATER);
    if (!flour || !water) {
        log('no flour or water in the pack to mix');
        return false;
    }
    if (!(await flour.useOn(water))) {
        return false;
    }
    // dough_interface offers bread / pastry / pizza / pitta; only pastry makes a shell.
    return driveUntil(
        () => Inventory.countById(KS_ID.PASTRY_DOUGH) > 0,
        ['Pastry dough'],
        log
    );
}

async function cookPie(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(KS_ID.REDBERRY_PIE) > 0) {
        return true;
    }
    if (!(await Traversal.walkResilient(KS_TILE.RANGE, { radius: 2, attempts: 4, timeoutMs: 240_000, log }))) {
        return false;
    }
    // A fire will not do: cooking_generic_redberry_pie answers "You need a
    // proper oven to cook that."
    const range = Locs.query().name('Range').action('Cook').within(10).nearest();
    if (!range) {
        log('no Range in reach of the Port Sarim stand');
        return false;
    }
    const uncooked = Inventory.first(KS_NAME.UNCOOKED_PIE);
    if (!uncooked || !(await uncooked.useOn(range))) {
        return false;
    }
    if (await Execution.delayUntil(() => ChatDialog.isMakeMenu(), 6000)) {
        await ChatDialog.makeOne(KS_NAME.REDBERRY_PIE);
    }
    return Execution.delayUntil(() => Inventory.countById(KS_ID.REDBERRY_PIE) > 0, 30_000);
}

const buy = (item: string, shop: { npc: string; anchor: typeof KS_TILE.WYDIN }): QuestStep =>
    ({ kind: 'buy', item, qty: 1, shop, estGp: SHOP_GP });

const combine = (item: string, target: string, product: string): QuestStep =>
    ({ kind: 'useOn', item, targetKind: 'item', target, anchor: KS_TILE.WYDIN, product });

/**
 * Backwards from the pie, so a part-built chain resumes at the right rung.
 * Nothing in the game sells a redberry pie and there is no ground spawn, so it
 * has to be baked.
 */
export function pie(snap: QuestSnapshot): QuestStep {
    if (heldId(snap, KS_ID.REDBERRY_PIE) > 0) {
        return { kind: 'wait', reason: 'redberry pie already held' };
    }
    if (!snap.bankKnown) {
        return scanBank;
    }
    if (bankedId(snap, KS_ID.REDBERRY_PIE) > 0) {
        return withdraw([{ name: KS_NAME.REDBERRY_PIE, qty: 1, id: KS_ID.REDBERRY_PIE }]);
    }
    if (heldId(snap, KS_ID.UNCOOKED_PIE) > 0) {
        return { kind: 'custom', name: 'cook the redberry pie', run: cookPie };
    }
    if (heldId(snap, KS_ID.PIE_SHELL) > 0) {
        return heldId(snap, KS_ID.REDBERRIES) > 0
            ? combine(KS_NAME.REDBERRIES, KS_NAME.PIE_SHELL, KS_NAME.UNCOOKED_PIE)
            : buy(KS_NAME.REDBERRIES, WYDIN);
    }
    // The dish comes before the dough: its only non-members source is a ground
    // spawn in Varrock, and mixing first carries dough all the way there.
    if (heldId(snap, KS_ID.PIE_DISH) === 0) {
        return bankedId(snap, KS_ID.PIE_DISH) > 0
            ? withdraw([{ name: KS_NAME.PIE_DISH, qty: 1, id: KS_ID.PIE_DISH }])
            : { kind: 'grabGround', item: KS_NAME.PIE_DISH, anchor: KS_TILE.PIE_DISH_SPAWN, waitIfMissing: true };
    }
    if (heldId(snap, KS_ID.PASTRY_DOUGH) > 0) {
        return combine(KS_NAME.PASTRY_DOUGH, KS_NAME.PIE_DISH, KS_NAME.PIE_SHELL);
    }
    if (heldId(snap, KS_ID.POT_OF_FLOUR) === 0) {
        return buy(KS_NAME.POT_OF_FLOUR, WYDIN);
    }
    if (heldId(snap, KS_ID.REDBERRIES) === 0) {
        return buy(KS_NAME.REDBERRIES, WYDIN);
    }
    if (heldId(snap, KS_ID.BUCKET_OF_WATER) === 0) {
        return heldId(snap, KS_ID.BUCKET) > 0
            ? { kind: 'custom', name: 'fill the bucket', run: fillBucket }
            : buy(KS_NAME.BUCKET, GENERAL_STORE);
    }
    return { kind: 'custom', name: 'mix pastry dough', run: mixDough };
}
