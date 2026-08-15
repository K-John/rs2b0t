import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { UP_ITEM, UP_TILE, banked, carried, held, type UpassItem } from './areas.js';

/** Bronze arrows are what the fire arrow is built from — a stack covers every missed shot. */
export const ARROW_TARGET = 50;
// Why: the pass hands out food of its own - Koftik, the paladins and Nilhoof between them give more
// than a dozen - and the pack has to hold four orbs, three badges, three amulets and the doll at once.
export const FOOD_TARGET = 12;

export function scanBank(): QuestStep {
    return { kind: 'scanBank', bank: UP_TILE.ARDOUGNE_BANK };
}

export function withdraw(items: { name: string; id: number; qty: number }[]): QuestStep {
    return { kind: 'withdraw', items, bank: UP_TILE.ARDOUGNE_BANK };
}

/** Draw `qty` of `item` from the bank, or null when the pack already holds enough. */
export function fromBank(snap: QuestSnapshot, item: UpassItem, qty: number): QuestStep | null {
    const have = carried(snap, item);
    if (have >= qty) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const stock = banked(snap, item);
    if (stock <= 0) {
        return null;
    }
    return withdraw([{ name: item.name, id: item.id, qty: Math.min(qty - have, stock) }]);
}

// Why: the pass has no bank and no shop, and every trip back out is the whole dungeon again — so the
// kit is drawn in one go before the cave mouth rather than fetched when each obstacle asks for it.

/** Everything the pass consumes, in the order the quest reaches it. */
export const KIT: readonly { item: UpassItem; qty: number; reason: string }[] = [
    // Why: `upass_rock_ropeswing` deletes the rope before it rolls agility, so a failed swing costs one and
    // drops the player into the swamp — one rope is a single point of failure on a roll that is not certain.
    { item: UP_ITEM.ROPE, qty: 3, reason: 'the rock swing east, which eats one per attempt' },
    { item: UP_ITEM.SHORTBOW, qty: 1, reason: 'firing the bridge stay rope' },
    { item: UP_ITEM.BRONZE_ARROW, qty: ARROW_TARGET, reason: 'the fire arrow' },
    { item: UP_ITEM.TINDERBOX, qty: 1, reason: 'lighting the cloth arrow and burning the tomb' },
    { item: UP_ITEM.BUCKET, qty: 1, reason: "the dwarf brew for Iban's tomb" },
    { item: UP_ITEM.LOBSTER, qty: FOOD_TARGET, reason: 'the demons, Kalrag and the trap falls' }
];

export const KEEP_IDS: readonly number[] = [
    ...Object.values(UP_ITEM).map(item => item.id)
];

/** The next missing piece of kit, or null once the pack is ready to go underground. */
export function sourceKit(snap: QuestSnapshot): QuestStep | null {
    for (const { item, qty } of KIT) {
        const step = fromBank(snap, item, qty);
        if (step) {
            return step;
        }
    }
    return null;
}

/** What the kit is still short of, for an honest stop rather than a silent retry loop. */
export function kitShortfall(snap: QuestSnapshot): string[] {
    return KIT.filter(({ item, qty }) => carried(snap, item) < qty)
        .map(({ item, qty, reason }) => `${qty}x ${item.name} (${reason}), have ${carried(snap, item)}`);
}

export function needsEquip(snap: QuestSnapshot, item: UpassItem): boolean {
    return held(snap, item) > 0;
}
