import Tile from '../../../../../geometry/Tile.js';
import { gpShort } from '../../engine/provisioning.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { RG_ITEM, RG_TILE, banked, carried, type RegicideItem } from './areas.js';

// Why: Tirannwn has one shop and no bank, and the way back out is either the Arandar palisade
// or the Underground Pass walked end to end — so everything the forest consumes is bought and drawn in
// Ardougne, one leg's walk from the bank, before the quest ever leaves the mainland.

/** Aemad's Adventuring Supplies, twenty tiles from the Ardougne bank. */
export const ARDOUGNE_STORE = { npc: 'Aemad', anchor: new Tile(2613, 3293, 0) };
/** Jatix's Herblore Shop in Taverley — the nearest pestle and mortar to Ardougne. */
export const TAVERLEY_HERBLORE = { npc: 'Jatix', anchor: new Tile(2899, 3428, 0) };
/** The coal trucks site north-east of Ardougne. */
export const COAL_ROCKS = new Tile(2581, 3480, 0);
/** The range beside the Ardougne bank, for the rabbit the lazy guard wants. */
export const ARDOUGNE_RANGE = new Tile(2648, 3298, 0);

export const FOOD_TARGET = 14;
/** Four balls of wool weave one strip of cloth, and the loom takes them in one go. */
export const WOOL_TARGET = 4;
// Why: a clean distillation costs six coal under the module's own control law, and a blown pressure gauge
// resets the tally to zero — so the float covers two failed runs before a trip back to the rocks.
export const COAL_TARGET = 18;
/** Two barrels of tar, so a still that resets does not send the run back across the Underground Pass. */
export const BARREL_TARGET = 2;

export function scanBank(): QuestStep {
    return { kind: 'scanBank', bank: RG_TILE.ARDOUGNE_BANK };
}

export function withdraw(items: { name: string; id: number; qty: number }[]): QuestStep {
    return { kind: 'withdraw', items, bank: RG_TILE.ARDOUGNE_BANK };
}

/** Draw `qty` from the bank, or null when the pack already holds enough or the bank has none. */
export function fromBank(snap: QuestSnapshot, item: RegicideItem, qty: number): QuestStep | null {
    const have = carried(snap, item);
    if (have >= qty) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const stock = banked(snap, item);
    return stock <= 0 ? null : withdraw([{ name: item.name, id: item.id, qty: Math.min(qty - have, stock) }]);
}

function buyOrWait(snap: QuestSnapshot, step: Extract<QuestStep, { kind: 'buy' }>): QuestStep {
    if (gpShort(snap, step.estGp) > 0) {
        return { kind: 'wait', reason: `need ~${step.estGp} gp for ${step.item}` };
    }
    return step;
}

interface Supply {
    item: RegicideItem;
    qty: number;
    reason: string;
    /** Where to buy it when neither the pack nor the bank has one. */
    shop?: { npc: string; anchor: Tile };
    estGp?: number;
}

/** Everything Tirannwn needs, in the order the quest reaches it. */
export const KIT: readonly Supply[] = [
    {
        item: RG_ITEM.BALL_OF_WOOL,
        qty: WOOL_TARGET,
        reason: 'the loom, which weaves four into the bomb\'s fuse cloth',
        shop: ARDOUGNE_STORE,
        estGp: 60
    },
    {
        item: RG_ITEM.PICKAXE,
        qty: 1,
        reason: 'the limestone quarry on the Arandar pass',
        shop: ARDOUGNE_STORE,
        estGp: 40
    },
    {
        item: RG_ITEM.PESTLE,
        qty: 1,
        reason: 'grinding the sulphur and the quicklime',
        shop: TAVERLEY_HERBLORE,
        estGp: 60
    },
    { item: RG_ITEM.LOBSTER, qty: FOOD_TARGET, reason: 'the traps, the soldiers and the elf warriors' }
];

export const KEEP_IDS: readonly number[] = Object.values(RG_ITEM).map(item => item.id);

/** The next missing piece of kit, or null once the pack is ready for Tirannwn. */
export function sourceKit(snap: QuestSnapshot): QuestStep | null {
    for (const supply of KIT) {
        if (carried(snap, supply.item) >= supply.qty) {
            continue;
        }
        const drawn = fromBank(snap, supply.item, supply.qty);
        if (drawn) {
            return drawn;
        }
        if (supply.shop && supply.estGp !== undefined) {
            return buyOrWait(snap, {
                kind: 'buy',
                item: supply.item.name,
                qty: supply.qty - carried(snap, supply.item),
                shop: supply.shop,
                estGp: supply.estGp
            });
        }
    }
    return null;
}

/** What the kit is still short of, for an honest stop rather than a silent retry loop. */
export function kitShortfall(snap: QuestSnapshot): string[] {
    return KIT.filter(supply => carried(snap, supply.item) < supply.qty).map(
        supply => `${supply.qty}x ${supply.item.name} (${supply.reason}), have ${carried(snap, supply.item)}`
    );
}

/** Coal for the still, mined at the trucks rather than bought — no 2004 shop keeps a stock of it. */
export function sourceCoal(snap: QuestSnapshot): QuestStep | null {
    if (carried(snap, RG_ITEM.COAL) >= COAL_TARGET) {
        return null;
    }
    const drawn = fromBank(snap, RG_ITEM.COAL, COAL_TARGET);
    if (drawn) {
        return drawn;
    }
    return { kind: 'mineRock', rock: 'Coal', item: RG_ITEM.COAL.name, qty: COAL_TARGET, anchor: COAL_ROCKS };
}
