import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { ChatDialog } from '../../../api/hud/ChatDialog.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { Shop } from '../../../api/hud/Shop.js';
import { GroundItems } from '../../../api/queries/GroundItems.js';
import { Locs } from '../../../api/queries/Locs.js';
import { Traversal } from '../../../api/Traversal.js';
import Tile from '../../../api/Tile.js';
import { talkThrough } from '../../exec/primitives.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';

/**
 * Where Dragon Slayer's shopping list actually comes from.
 *
 * Four of the seven are simply bought. The other three are not sold anywhere in
 * free-to-play at all: planks only lie on the ground (the nearest pile outside
 * Crandor, which is useless before the ship sails, is the Graveyard of Shadows),
 * nails are two to a steel bar at an anvil, and an unfired bowl is clay,
 * water and a potter's wheel.
 */

export const SUPPLY = {
    /** Hammers, buckets and jugs: any general store, and Falador's is by the bank. */
    GENERAL_STORE: { npc: 'Shop keeper', anchor: new Tile(2955, 3389, 0) },
    /** Silk, 30gp. */
    THESSALIA: { npc: 'Thessalia', anchor: new Tile(3204, 3417, 0) },
    /** Lobster pots, 20gp. */
    GERRANT: { npc: 'Gerrant', anchor: new Tile(3013, 3225, 0) },
    /** The Rising Sun barmaid pours a mind bomb for 2gp; no shop interface. */
    BARMAID: { npc: 'Barmaid', anchor: new Tile(2957, 3371, 0) },
    /** Pickaxes, in the Dwarven Mine itself. */
    NURMOF: { npc: 'Nurmof', anchor: new Tile(2998, 9844, 0) },
    /** Varrock sword shop: the best one-handed blade a free shop sells. */
    SWORD_SHOP: { npc: 'Shop keeper', anchor: new Tile(3203, 3397, 0) },
    /** Peksa's helmet shop, a short walk from the Barbarian Village wheel. */
    PEKSA: { npc: 'Peksa', anchor: new Tile(3076, 3429, 0) }
} as const;

export const SUPPLY_LOC = {
    FOUNTAIN: new Tile(2949, 3381, 0),
    /** Everything the mining legs need is in one corner of the Dwarven Mine. */
    CLAY_ROCKS: new Tile(3029, 9809, 0),
    IRON_ROCKS: new Tile(3033, 9825, 0),
    COAL_ROCKS: new Tile(3038, 9799, 0),
    ANVIL: new Tile(3012, 9812, 0),
    FURNACE: new Tile(2974, 3369, 0),
    POTTERS_WHEEL: new Tile(3087, 3410, 0),
    /** The nearest free planks: wilderness, level 18-20, over open ground. */
    PLANK_SPAWNS: [
        new Tile(3154, 3659, 0),
        new Tile(3154, 3670, 0),
        new Tile(3148, 3671, 0),
        new Tile(3182, 3669, 0),
        new Tile(3171, 3680, 0)
    ]
} as const;

const SUPPLY_ITEM = {
    JUG: 'Jug',
    JUG_WATER: 'Jug of water',
    CLAY: 'Clay',
    SOFT_CLAY: 'Soft clay',
    STEEL_BAR: 'Steel bar',
    IRON_ORE: 'Iron ore',
    COAL: 'Coal',
    PICKAXE: 'Bronze pickaxe'
} as const;

/** Intermediates that must survive the pre-quest deposit. */
export const SUPPLY_TOOLS: readonly string[] = [
    'jug', 'clay', 'steel bar', 'iron ore', 'coal', 'pickaxe', 'bucket'
];

const walk = (to: Tile, log: (m: string) => void, radius = 2): Promise<boolean> =>
    Traversal.walkResilient(to, { radius, attempts: 3, timeoutMs: 180_000, log });

const sceneLoaded = (): Promise<boolean> =>
    Execution.delayUntil(() => Locs.query().within(10).exists(), 6000);

const buy = (item: string, qty: number, shop: { npc: string; anchor: Tile }, estGp: number): QuestStep =>
    ({ kind: 'buy', item, qty, shop: { npc: shop.npc, anchor: shop.anchor }, estGp });

/** The barmaid sells through dialogue, so the generic buy step cannot see her. */
async function buyMindBomb(log: (m: string) => void): Promise<boolean> {
    if (Inventory.count('Coins') < 10) {
        log('no coins for a mind bomb');
        return false;
    }
    if (!(await walk(SUPPLY.BARMAID.anchor, log, 2))) {
        return false;
    }
    const before = Inventory.count("Wizard's mind bomb");
    log('ordering a Wizard\'s Mind Bomb at the Rising Sun');
    if (!(await talkThrough(SUPPLY.BARMAID.npc, ["I'll try the Mind Bomb."], log))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.count("Wizard's mind bomb") > before, 5000);
}

/** Mines until the pack holds `want` of the named ore. */
async function mineFor(rockIds: readonly number[], item: string, want: number, at: Tile, log: (m: string) => void): Promise<boolean> {
    if (Inventory.count(item) >= want) {
        return true;
    }
    if (!Inventory.items().some(i => i.name?.toLowerCase().includes('pickaxe'))) {
        log('no pickaxe in the pack');
        return false;
    }
    const ids = new Set(rockIds);
    const rock = () => Locs.query().where(l => ids.has(l.id)).action('Mine').within(8).nearest();
    if (!rock()) {
        if (!(await walk(at, log, 2)) || !(await sceneLoaded())) {
            return false;
        }
    }
    const target = rock();
    if (!target) {
        log(`no ${item} rocks in reach`);
        return false;
    }
    const before = Inventory.count(item);
    if (!(await target.interact('Mine'))) {
        return false;
    }
    await Execution.delayUntil(() => Inventory.count(item) > before, 20_000);
    return Inventory.count(item) >= want;
}

const ROCKS = { clay: [2108, 2109], iron: [2092, 2093], coal: [2096, 2097] } as const;

async function ensurePickaxe(log: (m: string) => void): Promise<boolean> {
    if (Inventory.items().some(i => i.name?.toLowerCase().includes('pickaxe'))) {
        return true;
    }
    if (!(await walk(SUPPLY.NURMOF.anchor, log, 2))) {
        return false;
    }
    if (!(await Shop.open(SUPPLY.NURMOF.npc))) {
        log('could not open Nurmof\'s shop');
        return false;
    }
    await Shop.buy(SUPPLY_ITEM.PICKAXE, 1);
    await Shop.close();
    return Inventory.contains(SUPPLY_ITEM.PICKAXE);
}

/** Clay, water and a potter's wheel; the bowl is fired later or not at all. */
async function makeUnfiredBowl(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains('Unfired bowl')) {
        return true;
    }
    if (Inventory.contains(SUPPLY_ITEM.SOFT_CLAY)) {
        if (!(await walk(SUPPLY_LOC.POTTERS_WHEEL, log, 1)) || !(await sceneLoaded())) {
            return false;
        }
        const wheel = Locs.query().name("Potter's Wheel").within(5).nearest();
        const clay = Inventory.first(SUPPLY_ITEM.SOFT_CLAY);
        if (!wheel || !clay) {
            log('no potter\'s wheel in reach');
            return false;
        }
        log('throwing a bowl on the wheel');
        if (!(await clay.useOn(wheel))) {
            return false;
        }
        if (!(await Execution.delayUntil(() => ChatDialog.isMainMakePanel(), 6000))) {
            return false;
        }
        if (!(await ChatDialog.makeFromPanel('Bowl'))) {
            return false;
        }
        return Execution.delayUntil(() => Inventory.contains('Unfired bowl'), 10_000);
    }
    if (Inventory.contains(SUPPLY_ITEM.CLAY) && Inventory.contains(SUPPLY_ITEM.JUG_WATER)) {
        const clay = Inventory.first(SUPPLY_ITEM.CLAY);
        const water = Inventory.first(SUPPLY_ITEM.JUG_WATER);
        if (!clay || !water) {
            return false;
        }
        log('mixing the clay with water');
        if (!(await clay.useOn(water))) {
            return false;
        }
        return Execution.delayUntil(() => Inventory.contains(SUPPLY_ITEM.SOFT_CLAY), 8000);
    }
    if (!Inventory.contains(SUPPLY_ITEM.JUG_WATER)) {
        if (!Inventory.contains(SUPPLY_ITEM.JUG)) {
            log('buying a jug');
            if (!(await walk(SUPPLY.GENERAL_STORE.anchor, log, 2)) || !(await Shop.open(SUPPLY.GENERAL_STORE.npc))) {
                return false;
            }
            await Shop.buy(SUPPLY_ITEM.JUG, 1);
            await Shop.close();
            return Inventory.contains(SUPPLY_ITEM.JUG);
        }
        if (!(await walk(SUPPLY_LOC.FOUNTAIN, log, 1)) || !(await sceneLoaded())) {
            return false;
        }
        const fountain = Locs.query().name('Fountain').within(5).nearest();
        const jug = Inventory.first(SUPPLY_ITEM.JUG);
        if (!fountain || !jug) {
            log('no fountain in reach');
            return false;
        }
        log('filling the jug');
        if (!(await jug.useOn(fountain))) {
            return false;
        }
        return Execution.delayUntil(() => Inventory.contains(SUPPLY_ITEM.JUG_WATER), 8000);
    }
    if (!(await ensurePickaxe(log))) {
        return false;
    }
    return mineFor(ROCKS.clay, SUPPLY_ITEM.CLAY, 1, SUPPLY_LOC.CLAY_ROCKS, log);
}

/**
 * Nails are two to a steel bar, and nothing sells steel bars: one iron and two
 * coal per bar at the Falador furnace, then the Dwarven Mine anvil.
 */
async function smithNails(need: number, log: (m: string) => void): Promise<boolean> {
    const bars = Math.ceil(need / 2);
    if (Inventory.count('Nails') >= need) {
        return true;
    }
    if (Inventory.count(SUPPLY_ITEM.STEEL_BAR) > 0) {
        if (!(await walk(SUPPLY_LOC.ANVIL, log, 1)) || !(await sceneLoaded())) {
            return false;
        }
        const anvil = Locs.query().name('Anvil').within(5).nearest();
        const bar = Inventory.first(SUPPLY_ITEM.STEEL_BAR);
        if (!anvil || !bar) {
            log('no anvil in reach');
            return false;
        }
        log('hammering out nails');
        if (!(await bar.useOn(anvil))) {
            return false;
        }
        if (!(await Execution.delayUntil(() => ChatDialog.isMainMakePanel(), 6000))) {
            return false;
        }
        const before = Inventory.count('Nails');
        if (!(await ChatDialog.makeFromPanelMax('Nails'))) {
            return false;
        }
        await Execution.delayUntil(() => Inventory.count('Nails') > before, 30_000);
        return Inventory.count('Nails') >= need;
    }
    if (Inventory.count(SUPPLY_ITEM.IRON_ORE) >= bars && Inventory.count(SUPPLY_ITEM.COAL) >= bars * 2) {
        if (!(await walk(SUPPLY_LOC.FURNACE, log, 1)) || !(await sceneLoaded())) {
            return false;
        }
        const furnace = Locs.query().name('Furnace').within(5).nearest();
        const ore = Inventory.first(SUPPLY_ITEM.IRON_ORE);
        if (!furnace || !ore) {
            log('no furnace in reach');
            return false;
        }
        log('smelting steel bars');
        if (!(await ore.useOn(furnace))) {
            return false;
        }
        if (!(await Execution.delayUntil(() => ChatDialog.isMakeMenu(), 6000))) {
            return false;
        }
        if (!(await ChatDialog.make('Steel'))) {
            return false;
        }
        return Execution.delayUntil(() => Inventory.count(SUPPLY_ITEM.STEEL_BAR) > 0, 30_000);
    }
    if (!(await ensurePickaxe(log))) {
        return false;
    }
    if (Inventory.count(SUPPLY_ITEM.IRON_ORE) < bars) {
        return mineFor(ROCKS.iron, SUPPLY_ITEM.IRON_ORE, bars, SUPPLY_LOC.IRON_ROCKS, log);
    }
    return mineFor(ROCKS.coal, SUPPLY_ITEM.COAL, bars * 2, SUPPLY_LOC.COAL_ROCKS, log);
}

/** Spawns already emptied this trip, so the walk moves on instead of circling. */
const plankTried = new Set<string>();

/** Walks the Graveyard of Shadows picking up the plank spawns. */
async function grabPlanks(need: number, log: (m: string) => void): Promise<boolean> {
    if (Inventory.count('Plank') >= need) {
        plankTried.clear();
        return true;
    }
    const loose = GroundItems.query().name('Plank').within(14).nearest();
    if (loose) {
        const before = Inventory.count('Plank');
        log('taking a plank');
        if (!(await loose.interact('Take'))) {
            return false;
        }
        await Execution.delayUntil(() => Inventory.count('Plank') > before, 8000);
        return Inventory.count('Plank') >= need;
    }
    const here = Game.tile();
    if (here) {
        for (const t of SUPPLY_LOC.PLANK_SPAWNS) {
            if (t.distanceTo(here) <= 6 && t.level === here.level) {
                plankTried.add(`${t.x},${t.z}`);
            }
        }
    }
    const next = SUPPLY_LOC.PLANK_SPAWNS
        .filter(t => !plankTried.has(`${t.x},${t.z}`))
        .sort((a, b) => (here ? a.distanceTo(here) - b.distanceTo(here) : 0))[0];
    if (!next) {
        log('every plank spawn was empty — they respawn, so waiting');
        plankTried.clear();
        await Execution.delayTicks(10);
        return false;
    }
    log(`walking to the plank spawn at (${next.x},${next.z})`);
    await walk(next, log, 2);
    await sceneLoaded();
    return false;
}

const custom = (name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep =>
    ({ kind: 'custom', name, run });

/** Wired into the quest module's `gather` map, keyed by item display name. */
export const SUPPLY_GATHERS: Record<string, (snap: QuestSnapshot, need: number) => QuestStep> = {
    hammer: () => buy('Hammer', 1, SUPPLY.GENERAL_STORE, 100),
    silk: () => buy('Silk', 1, SUPPLY.THESSALIA, 200),
    'lobster pot': () => buy('Lobster pot', 1, SUPPLY.GERRANT, 200),
    "wizard's mind bomb": () => custom('buy a mind bomb at the Rising Sun', buyMindBomb),
    'unfired bowl': () => custom('make an unfired bowl', makeUnfiredBowl),
    nails: (_snap, need) => custom(`smith ${need} nails`, log => smithNails(need, log)),
    plank: (_snap, need) => custom(`fetch ${need} planks`, log => grabPlanks(need, log)),
    'adamant longsword': () => buy('Adamant longsword', 1, SUPPLY.SWORD_SHOP, 4500),
    'adamant full helm': () => buy('Adamant full helm', 1, SUPPLY.PEKSA, 5000)
};

/** Worn before anything in the maze or the lair is attacked. */
export const SUPPLY_LOADOUT: readonly string[] = ['Adamant longsword', 'Adamant full helm'];
