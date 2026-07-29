import Tile from '../../../api/Tile.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { WT_ITEM, WT_TILE, type WatchtowerItem } from './areas.js';

export const ARDOUGNE_GENERAL = { npc: 'Shop keeper', anchor: new Tile(2615, 3294, 0) };
export const ARDOUGNE_HERBLORE = { npc: 'Shop keeper', anchor: new Tile(2666, 3304, 0) };
export const MAGIC_GUILD = { npc: 'Shop keeper', anchor: new Tile(2596, 3088, 0) };
export const OGRE_HERBLORE = { npc: 'Grud', anchor: new Tile(2510, 3032, 0) };

const ROPE_PRICE = 25;
const DEATH_RUNE_PRICE = 300;
const VIAL_PRICE = 60;
const PESTLE_PRICE = 200;

export function held(snap: QuestSnapshot, id: number): number {
    return snap.invIds?.get(id) ?? 0;
}

export function banked(snap: QuestSnapshot, id: number): number {
    return snap.bankIds?.get(id) ?? 0;
}

export function owned(snap: QuestSnapshot, id: number): number {
    return held(snap, id) + banked(snap, id);
}

export function withdrawFrom(items: { name: string; id: number; qty: number }[]): QuestStep {
    return { kind: 'withdraw', items, bank: WT_TILE.YANILLE_BANK };
}

export function scanBank(): QuestStep {
    return { kind: 'scanBank', bank: WT_TILE.YANILLE_BANK };
}

/** Bank first, then shop. Null once the pack already holds enough. */
export function source(
    snap: QuestSnapshot,
    item: WatchtowerItem,
    qty: number,
    shop: { npc: string; anchor: Tile },
    unitGp: number
): QuestStep | null {
    if (held(snap, item.id) >= qty) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const missing = qty - held(snap, item.id);
    const inBank = banked(snap, item.id);
    if (inBank > 0) {
        return withdrawFrom([{ name: item.name, id: item.id, qty: Math.min(missing, inBank) }]);
    }
    return { kind: 'buy', item: item.name, qty: missing, shop, estGp: missing * unitGp };
}

/** Bank only. Drop-only items are never bought, so an empty bank is an honest park. */
export function bankOnly(snap: QuestSnapshot, item: WatchtowerItem, qty: number = 1): QuestStep | null {
    if (held(snap, item.id) >= qty) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const inBank = banked(snap, item.id);
    if (inBank > 0) {
        return withdrawFrom([{ name: item.name, id: item.id, qty: Math.min(qty - held(snap, item.id), inBank) }]);
    }
    return { kind: 'wait', reason: `no ${item.name} in the bank — it is a drop-only item` };
}

export function sourceCoins(snap: QuestSnapshot, want: number): QuestStep | null {
    if (held(snap, WT_ITEM.COINS.id) >= want) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const available = banked(snap, WT_ITEM.COINS.id);
    if (available <= 0) {
        return { kind: 'wait', reason: `need ${want} gp for Gu'Tanoth tolls and shops` };
    }
    return withdrawFrom([{ name: WT_ITEM.COINS.name, id: WT_ITEM.COINS.id, qty: Math.min(want, available) }]);
}

export function sourceRope(snap: QuestSnapshot): QuestStep | null {
    return source(snap, WT_ITEM.ROPE, 1, ARDOUGNE_GENERAL, ROPE_PRICE);
}

export function sourceDeathRune(snap: QuestSnapshot): QuestStep | null {
    return source(snap, WT_ITEM.DEATH_RUNE, 1, MAGIC_GUILD, DEATH_RUNE_PRICE);
}

export function sourceVial(snap: QuestSnapshot): QuestStep | null {
    return source(snap, WT_ITEM.VIAL_WATER, 1, ARDOUGNE_HERBLORE, VIAL_PRICE);
}

export function sourcePestle(snap: QuestSnapshot): QuestStep | null {
    return source(snap, WT_ITEM.PESTLE, 1, OGRE_HERBLORE, PESTLE_PRICE);
}

/** The candle by the tower respawns already lit, so no tinderbox is needed. */
export function sourceLightSource(snap: QuestSnapshot): QuestStep | null {
    if (held(snap, WT_ITEM.LIT_CANDLE.id) > 0) {
        return null;
    }
    if (banked(snap, WT_ITEM.LIT_CANDLE.id) > 0) {
        return withdrawFrom([{ name: WT_ITEM.LIT_CANDLE.name, id: WT_ITEM.LIT_CANDLE.id, qty: 1 }]);
    }
    return { kind: 'grabGround', item: WT_ITEM.LIT_CANDLE.name, anchor: WT_TILE.CANDLE, waitIfMissing: true };
}
