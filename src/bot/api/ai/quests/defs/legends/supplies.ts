import type Tile from '../../../../../geometry/Tile.js';
import { Skills } from '../../../../skills/Skills.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { GEM_CUTS, GEM_ROCKS, LQ_BANK, LQ_ID, LQ_ITEM, LQ_SHOP, LQ_SKILLS, LQ_TILE } from './areas.js';
import { mineGem, smeltGoldBar } from './gather.js';

export interface LqItem {
    id: number;
    name: string;
}

type Shop = { npc: string; anchor: Tile };

/** Lobster first: the only food this quest's harness banks, the rest are fallbacks. */
export const LQ_FOODS = ['Lobster', 'Swordfish', 'Shark', 'Tuna'] as const;

/** Enough to cross the trials, both cave fights and the walk home. */
export const FOOD_CARRY = 14;

/** Spending money for the shop legs; the whole list costs a few thousand. */
export const COIN_CARRY = 50_000;

export const SHOP_GP = {
    JIMINUA: 3000,
    MAGIC_GUILD: 60_000
} as const;

export const PRAYER_POTIONS: readonly LqItem[] = [
    { id: 2434, name: 'Prayer potion(4)' },
    { id: 139, name: 'Prayer potion(3)' },
    { id: 141, name: 'Prayer potion(2)' },
    { id: 143, name: 'Prayer potion(1)' }
];

/** Melee weapons worth wielding against the demon and the three guardians. */
export const WEAPONS: readonly LqItem[] = [
    { id: LQ_ID.RUNE_SCIMITAR, name: LQ_ITEM.RUNE_SCIMITAR },
    { id: 1331, name: 'Adamant scimitar' },
    { id: 1329, name: 'Mithril scimitar' }
];

// Why: rune chainbody rather than platebody — the platebody wants Dragon Slayer as well as Defence 40, and the refusal is a bare false with no message.
export const ARMOUR: readonly LqItem[] = [
    { id: 1113, name: 'Rune chainbody' },
    { id: 1079, name: 'Rune platelegs' },
    { id: 1163, name: 'Rune full helm' },
    { id: 1201, name: 'Rune kiteshield' },
    { id: 1704, name: 'Amulet of glory' }
];

export const PICKAXES: readonly LqItem[] = [
    { id: LQ_ID.RUNE_PICKAXE, name: 'Rune pickaxe' },
    { id: LQ_ID.ADAMANT_PICKAXE, name: 'Adamant pickaxe' },
    { id: LQ_ID.MITHRIL_PICKAXE, name: 'Mithril pickaxe' },
    { id: LQ_ID.STEEL_PICKAXE, name: 'Steel pickaxe' },
    { id: LQ_ID.IRON_PICKAXE, name: 'Iron pickaxe' },
    { id: LQ_ID.BRONZE_PICKAXE, name: 'Bronze pickaxe' }
];

export function held(snap: QuestSnapshot, id: number): number {
    return snap.invIds?.get(id) ?? 0;
}

export function banked(snap: QuestSnapshot, id: number): number {
    return snap.bankIds?.get(id) ?? 0;
}

export function worn(snap: QuestSnapshot, id: number): boolean {
    return snap.wornIds?.has(id) ?? false;
}

export function owned(snap: QuestSnapshot, id: number): number {
    return held(snap, id) + (worn(snap, id) ? 1 : 0);
}

export function heldName(snap: QuestSnapshot, name: string): number {
    return snap.inv.get(name.toLowerCase()) ?? 0;
}

export function bankedName(snap: QuestSnapshot, name: string): number {
    return snap.bank?.get(name.toLowerCase()) ?? 0;
}

export function scanBank(bank?: Tile): QuestStep {
    return { kind: 'scanBank', bank };
}

export function withdraw(items: { name: string; qty: number; id?: number }[], bank?: Tile): QuestStep {
    return { kind: 'withdraw', items, bank };
}

// Why: every quest item this list forgets is deposited on the next bank trip and has to be re-earned, so it denies rather than allows.
export const KEEP_IDS: readonly number[] = [
    LQ_ID.MAP, LQ_ID.MAP_COMPLETE, LQ_ID.BULLROARER, LQ_ID.GOLD_BOWL_SKETCH,
    LQ_ID.GOLD_BOWL, LQ_ID.GOLD_BOWL_BLESSED, LQ_ID.GOLD_BOWL_WATER, LQ_ID.GOLD_BOWL_PURE,
    LQ_ID.GOLD_BOWL_BLESSED_WATER, LQ_ID.GOLD_BOWL_BLESSED_PURE, LQ_ID.HOLLOW_REED,
    LQ_ID.BOOK_OF_BINDING, LQ_ID.YOMMI_SEEDS, LQ_ID.YOMMI_SEEDS_GERM,
    LQ_ID.SNAKEWEED_MIXTURE, LQ_ID.ARDRIGAL_MIXTURE, LQ_ID.BRAVERY_POTION,
    LQ_ID.SNAKE_WEED, LQ_ID.ARDRIGAL, LQ_ID.UNID_SNAKE_WEED, LQ_ID.UNID_ARDRIGAL,
    LQ_ID.CRYSTAL_CHUNK, LQ_ID.CRYSTAL_HUNK, LQ_ID.CRYSTAL_LUMP,
    LQ_ID.HEART_CRYSTAL, LQ_ID.HEART_CRYSTAL_GLOW,
    LQ_ID.DEATH_DAGGER, LQ_ID.DEATH_DAGGER_DONE, LQ_ID.HOLY_FORCE,
    LQ_ID.TOTEM_POLE, LQ_ID.GILDED_TOTEM,
    LQ_ID.MACHETE, LQ_ID.RUNE_AXE, LQ_ID.LOCKPICK, LQ_ID.UNPOWERED_ORB,
    LQ_ID.PAPYRUS, LQ_ID.CHARCOAL, LQ_ID.GOLD_BAR, LQ_ID.HAMMER, LQ_ID.KNIFE,
    LQ_ID.ROPE, LQ_ID.CHISEL, LQ_ID.VIAL_WATER, LQ_ID.VIAL,
    LQ_ID.SOUL_RUNE, LQ_ID.MIND_RUNE, LQ_ID.EARTH_RUNE, LQ_ID.LAW_RUNE,
    LQ_ID.WATER_RUNE, LQ_ID.COSMIC_RUNE, LQ_ID.AIR_RUNE, LQ_ID.FIRE_RUNE, LQ_ID.DEATH_RUNE,
    ...GEM_ROCKS.map(g => g.id),
    ...GEM_CUTS.map(g => g.uncut),
    ...PICKAXES.map(p => p.id),
    ...WEAPONS.map(w => w.id),
    ...ARMOUR.map(a => a.id),
    ...PRAYER_POTIONS.map(p => p.id),
    LQ_ID.COINS
];

// Why: the trials hand back three lumps of rock and the pack is already full to its last slot, so a top-up decided with no room fails its withdraw for ever.

/** Ids the deposit keeps by name rather than by id, so they do not read as junk. */
const FOOD_IDS: readonly number[] = [LQ_ID.LOBSTER, 373, 385, 361];

/** Everything in the pack this quest has no use for, random-event gifts included. */
export function junkIds(snap: QuestSnapshot): number[] {
    return [...(snap.invIds ?? new Map<number, number>()).keys()]
        .filter(id => !KEEP_IDS.includes(id) && !FOOD_IDS.includes(id));
}

/** Something in the pack a deposit would actually take. */
export function junkHeld(snap: QuestSnapshot): boolean {
    return junkIds(snap).length > 0;
}

export function deposit(bank?: Tile): QuestStep {
    return { kind: 'deposit', keep: [...LQ_FOODS], keepIds: KEEP_IDS, bank };
}

// Why: `null` covers both "already carried" and "the bank cannot help", and the caller decides whether that is a shop trip or a park.

/** Withdraw a shortfall when the bank has it. */
export function fromBank(snap: QuestSnapshot, item: LqItem, qty = 1, bank?: Tile): QuestStep | null {
    const short = qty - owned(snap, item.id);
    if (short <= 0) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank(bank);
    }
    const inBank = banked(snap, item.id);
    return inBank > 0 ? withdraw([{ name: item.name, id: item.id, qty: Math.min(short, inBank) }], bank) : null;
}

/** Bank first, then the counter that stocks it. */
export function source(snap: QuestSnapshot, item: LqItem, qty: number, shop: Shop, estGp: number, bank?: Tile): QuestStep | null {
    if (owned(snap, item.id) >= qty) {
        return null;
    }
    return fromBank(snap, item, qty, bank)
        ?? { kind: 'buy', item: item.name, qty: qty - owned(snap, item.id), shop, estGp, bank };
}

/** Bank only — nothing in the game sells this. */
export function bankOnly(snap: QuestSnapshot, item: LqItem, qty: number, bank?: Tile): QuestStep | null {
    if (owned(snap, item.id) >= qty) {
        return null;
    }
    return fromBank(snap, item, qty, bank)
        ?? { kind: 'wait', reason: `no ${item.name} in the pack or the bank, and no shop stocks one` };
}

export function coinTopUp(snap: QuestSnapshot, want = COIN_CARRY, bank?: Tile): QuestStep | null {
    const have = heldName(snap, LQ_ITEM.COINS);
    if (have >= want / 2) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank(bank);
    }
    const inBank = bankedName(snap, LQ_ITEM.COINS);
    return inBank > 0 ? withdraw([{ name: LQ_ITEM.COINS, id: LQ_ID.COINS, qty: Math.min(want - have, inBank) }], bank) : null;
}

export function heldFood(snap: QuestSnapshot): number {
    return LQ_FOODS.reduce((sum, f) => sum + heldName(snap, f), 0);
}

export function foodTopUp(snap: QuestSnapshot, want = FOOD_CARRY, bank?: Tile): QuestStep | null {
    if (heldFood(snap) >= Math.ceil(want / 2)) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank(bank);
    }
    const food = LQ_FOODS.find(f => bankedName(snap, f) > 0);
    if (!food) {
        return null;
    }
    const take = Math.min(want - heldFood(snap), bankedName(snap, food));
    return take > 0 ? withdraw([{ name: food, qty: take }], bank) : null;
}

// Why: Nezikchened is level 187 with 150 hitpoints and casts from range, and Protect from Melee is the only thing that makes him survivable at 70 — so the points have to outlast the fight rather than the walk to it.

/** Withdraw prayer potions up to `want` doses' worth of flasks. */
export function potionTopUp(snap: QuestSnapshot, want: number, bank?: Tile): QuestStep | null {
    if (want <= 0) {
        return null;
    }
    const have = PRAYER_POTIONS.reduce((sum, pot) => sum + held(snap, pot.id), 0);
    if (have >= want) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank(bank);
    }
    const pot = PRAYER_POTIONS.find(p => banked(snap, p.id) > 0);
    if (!pot) {
        return null;
    }
    return withdraw([{ name: pot.name, id: pot.id, qty: Math.min(want - have, banked(snap, pot.id)) }], bank);
}

/** Equip the best melee weapon and armour the bank can dress us in, or null. */
export function dressForCombat(snap: QuestSnapshot, bank?: Tile): QuestStep | null {
    for (const piece of [...WEAPONS.slice(0, 1), ...ARMOUR]) {
        if (worn(snap, piece.id)) {
            continue;
        }
        if (held(snap, piece.id) > 0) {
            return { kind: 'equip', item: piece.name };
        }
        if (piece.id === WEAPONS[0]!.id) {
            const alternative = WEAPONS.find(w => worn(snap, w.id) || held(snap, w.id) > 0);
            if (alternative) {
                return worn(snap, alternative.id) ? null : { kind: 'equip', item: alternative.name };
            }
        }
        if (!snap.bankKnown) {
            return scanBank(bank);
        }
        if (banked(snap, piece.id) > 0) {
            return withdraw([{ name: piece.name, id: piece.id, qty: 1 }], bank);
        }
    }
    return null;
}

export function hasPickaxe(snap: QuestSnapshot): boolean {
    return PICKAXES.some(p => owned(snap, p.id) > 0);
}

/** Bank first, then Obli's bronze pickaxe — mining 52 is met by anything. */
export function sourcePickaxe(snap: QuestSnapshot, bank?: Tile): QuestStep | null {
    if (hasPickaxe(snap)) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank(bank);
    }
    const inBank = PICKAXES.find(p => banked(snap, p.id) > 0);
    if (inBank) {
        return withdraw([{ name: inBank.name, id: inBank.id, qty: 1 }], bank);
    }
    return { kind: 'buy', item: 'Bronze pickaxe', qty: 1, shop: LQ_SHOP.JIMINUA, estGp: SHOP_GP.JIMINUA, bank };
}

/** Jiminua's counter in Tai Bwo Wannai stocks everything on this list. */
export const JIMINUA_KIT: readonly { item: LqItem; qty: number }[] = [
    { item: { id: LQ_ID.MACHETE, name: LQ_ITEM.MACHETE }, qty: 1 },
    { item: { id: LQ_ID.PAPYRUS, name: LQ_ITEM.PAPYRUS }, qty: 8 },
    { item: { id: LQ_ID.CHARCOAL, name: LQ_ITEM.CHARCOAL }, qty: 8 },
    { item: { id: LQ_ID.KNIFE, name: LQ_ITEM.KNIFE }, qty: 1 },
    { item: { id: LQ_ID.ROPE, name: LQ_ITEM.ROPE }, qty: 1 },
    { item: { id: LQ_ID.HAMMER, name: LQ_ITEM.HAMMER }, qty: 1 },
    { item: { id: LQ_ID.CHISEL, name: LQ_ITEM.CHISEL }, qty: 1 },
    { item: { id: LQ_ID.VIAL_WATER, name: LQ_ITEM.VIAL_WATER }, qty: 1 }
];

/** The Magic Guild counter is the only soul rune in the game. */
/** The five the marked wall swallows, in the one order it accepts. */
export const RUNE_KIT: readonly { item: LqItem; qty: number }[] = [
    { item: { id: LQ_ID.SOUL_RUNE, name: LQ_ITEM.SOUL_RUNE }, qty: 1 },
    { item: { id: LQ_ID.MIND_RUNE, name: LQ_ITEM.MIND_RUNE }, qty: 1 },
    { item: { id: LQ_ID.EARTH_RUNE, name: LQ_ITEM.EARTH_RUNE }, qty: 1 },
    { item: { id: LQ_ID.LAW_RUNE, name: LQ_ITEM.LAW_RUNE }, qty: 2 }
];

// Why: the magic gate eats an orb and a cast every time it is crossed downwards, while everything else in the trials is spent once and stays spent — so the two kits are asked for separately.

/** One charge-water-orb cast, which is what the magic gate is. */
export const ORB_RUNE_KIT: readonly { item: LqItem; qty: number }[] = [
    { item: { id: LQ_ID.COSMIC_RUNE, name: LQ_ITEM.COSMIC_RUNE }, qty: 3 },
    { item: { id: LQ_ID.WATER_RUNE, name: LQ_ITEM.WATER_RUNE }, qty: 30 }
];

/** Nothing in the game sells this, and the Yommi tree takes no lesser axe. */
export const BANK_ONLY_KIT: readonly { item: LqItem; qty: number }[] = [
    { item: { id: LQ_ID.RUNE_AXE, name: LQ_ITEM.RUNE_AXE }, qty: 1 }
];

// Why: the outer gate shuts behind whoever picked it and the three boulders drop back down behind whoever mined them, so the descent is paid for again in full every time it is made.

/** The lockpick and the orb, both spent on every descent and stocked by no counter. */
export const DESCENT_KIT: readonly { item: LqItem; qty: number }[] = [
    { item: { id: LQ_ID.LOCKPICK, name: LQ_ITEM.LOCKPICK }, qty: 1 },
    { item: { id: LQ_ID.UNPOWERED_ORB, name: LQ_ITEM.UNPOWERED_ORB }, qty: 1 }
];

export function sourceFrom(
    snap: QuestSnapshot,
    kit: readonly { item: LqItem; qty: number }[],
    shop: Shop,
    estGp: number,
    bank?: Tile
): QuestStep | null {
    for (const want of kit) {
        const step = source(snap, want.item, want.qty, shop, estGp, bank);
        if (step) {
            return step;
        }
    }
    return null;
}

export function sourceBankOnly(snap: QuestSnapshot, kit: readonly { item: LqItem; qty: number }[], bank?: Tile): QuestStep | null {
    for (const want of kit) {
        const step = bankOnly(snap, want.item, want.qty, bank);
        if (step) {
            return step;
        }
    }
    return null;
}

// Why: only the Falador and Al Kharid gem counters sell a cut gem at all, they hold one apiece, and neither ever stocks opal, jade or red topaz.
// Why: the only rocks that drop all seven are north of Shilo Village, reached by Hajedy's cart out of Brimhaven, so the chain is mine-then-cut with the bank in front of it.

/** The next rung of the seven-gem chain, or null once all seven are carried. */
export function sourceGems(snap: QuestSnapshot, bank?: Tile): QuestStep | null {
    const missing = GEM_ROCKS.filter(gem => owned(snap, gem.id) === 0);
    if (missing.length === 0) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank(bank);
    }
    const fromTheBank = missing.find(gem => banked(snap, gem.id) > 0);
    if (fromTheBank) {
        return withdraw([{ name: fromTheBank.name, id: fromTheBank.id, qty: 1 }], bank);
    }
    const cut = GEM_CUTS.find(gem => owned(snap, gem.cut) === 0 && (held(snap, gem.uncut) > 0 || banked(snap, gem.uncut) > 0));
    if (cut) {
        const rough = fromBank(snap, { id: cut.uncut, name: cut.uncutName }, 1, bank);
        if (rough) {
            return rough;
        }
        const chisel = source(snap, { id: LQ_ID.CHISEL, name: LQ_ITEM.CHISEL }, 1, LQ_SHOP.JIMINUA, SHOP_GP.JIMINUA, bank);
        if (chisel) {
            return chisel;
        }
        return { kind: 'useOn', item: LQ_ITEM.CHISEL, targetKind: 'item', target: cut.uncutName, anchor: bank ?? LQ_BANK.ARDOUGNE, product: cut.name };
    }
    const pickaxe = sourcePickaxe(snap, bank);
    if (pickaxe) {
        return pickaxe;
    }
    return { kind: 'custom', name: `mine a gem (${missing.length} of seven still missing)`, run: mineGem };
}

// Why: Drogo's is the only gold-bar counter and its baseline stock is zero, so the honest chain is mine at Brimhaven and smelt at the Shilo furnace next to the booth.

/** The next rung of the two-gold-bar chain, or null once both are carried. */
export function sourceGoldBars(snap: QuestSnapshot, bank?: Tile): QuestStep | null {
    const bars = { id: LQ_ID.GOLD_BAR, name: LQ_ITEM.GOLD_BAR };
    if (owned(snap, bars.id) >= 2) {
        return null;
    }
    const fromTheBank = fromBank(snap, bars, 2, bank);
    if (fromTheBank) {
        return fromTheBank;
    }
    if (heldName(snap, 'Gold ore') > 0) {
        return { kind: 'custom', name: 'smelt a gold bar at the Ardougne furnace', run: smeltGoldBar };
    }
    const pickaxe = sourcePickaxe(snap, bank);
    if (pickaxe) {
        return pickaxe;
    }
    return { kind: 'mineRock', rock: 'Gold', item: 'Gold ore', qty: 1, anchor: LQ_TILE.GOLD_ROCKS };
}

export function warnLegendsReadiness(): string | null {
    const missing = Object.entries(LQ_SKILLS)
        .map(([skill, need]) => ({ skill, need, have: Skills.level(skill) }))
        .filter(entry => entry.have < entry.need)
        .map(entry => `${entry.skill} ${entry.have}/${entry.need}`);
    if (missing.length > 0) {
        return `official skill reqs not met (${missing.join(', ')}) — the trials and the Yommi tree both refuse below them`;
    }
    const combat = (['attack', 'strength', 'defence', 'hitpoints', 'prayer'] as const)
        .map(skill => ({ skill, have: Skills.level(skill) }))
        .filter(entry => entry.have < LQ_PROVEN_COMBAT_FLOOR)
        .map(entry => `${entry.skill} ${entry.have}/${LQ_PROVEN_COMBAT_FLOOR}`);
    if (combat.length === 0) {
        return null;
    }
    return `combat below the only proven profile (${combat.join(', ')}; headed PASS at 70s). `
        + 'Nezikchened is a level-187 demon fought three times and the three Viyeldi guardians follow him — expect death risk.';
}

/** The profile a headed end-to-end run has cleared. */
export const LQ_PROVEN_COMBAT_FLOOR = 70;

// Why: nothing on Karamja banks, so the island's legs draw on Ardougne West across the Brimhaven ship — the same booth Shilo Village uses.
export const LEG_BANK = {
    /** Ardougne West is the nearest booth to the Legends Guild gate. */
    guild: LQ_BANK.ARDOUGNE,
    /** Every Karamja leg, by way of the ship. */
    karamja: LQ_BANK.ARDOUGNE,
    /** The Magic Guild counter is upstairs in Yanille, sixty tiles from its booth. */
    runes: LQ_BANK.YANILLE
} as const;
