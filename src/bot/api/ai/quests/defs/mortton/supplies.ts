import { Execution } from '../../../../execution/Execution.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Equipment } from '../../../../equipment/Equipment.js';
import { Locs } from '../../../../locs/Locs.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { Bank } from '../../../../bank/Bank.js';
import { AXES } from '../../../../acquisition/Tools.js';
import { AXE_SHOP_COSTS, BOB_VENDOR } from '../../../../acquisition/ToolAcquire.js';
import { QuestFood } from '../../food.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { settleScene, useOnLoc } from '../../exec/prompts.js';
import { SM_ID, SM_LOC, SM_LOC_ID, SM_NAME, SM_NPC, SM_STAGE, SM_TILE, VARROCK_GENERAL } from './areas.js';

export const COIN_TARGET = 30_000;
export const COIN_LOW = 5_000;
// Why: six is what the temple loadout can spare — the shopping trip fills fifteen slots and Morytania has no bank to trim against.
export const FOOD_TARGET = 6;
// Why: the only bank inside Morytania is Canifis, two hundred tiles north of the temple, so a restock only happens when the last piece of food has gone.
export const FOOD_LOW = 1;
/** A brewed vial of serum 207 carries three doses. */
export const DOSES_PER_VIAL = 3;
const TINDERBOX_GP = 100;
/** The cheapest axe Bob stocks; any tier chops a dead tree. */
const SHOP_AXE = 'Bronze axe';
const BRONZE_AXE_GP = 16;
// Why: a fire burns 100–200 ticks before it drops its ashes and the spawn respawns on its own timer, so two burns is minutes rather than a handful of cycles.
const BURN_BUDGET_MS = 420_000;

/** Kept through any deposit this quest issues. */
export const SM_TOOLS: readonly string[] = [
    'coins', 'tinderbox', 'hammer', 'logs', 'ashes', 'diary', 'vial', 'herb',
    'tarromin', 'unfinished potion', 'serum 207', 'loar remains', 'olive oil',
    'sacred oil', 'pyre logs', 'plank', 'limestone brick', 'swamp paste', 'axe'
];

export const heldId = (snap: QuestSnapshot, id: number): number => snap.invIds?.get(id) ?? 0;
export const bankedId = (snap: QuestSnapshot, id: number): number => snap.bankIds?.get(id) ?? 0;

/** Serum 207 by dose count, highest first — `next_obj_stage` walks a vial down this list. */
export const SERUM_BY_DOSE: readonly (readonly [number, number])[] = [
    [SM_ID.SERUM4, 4],
    [SM_ID.SERUM3, 3],
    [SM_ID.SERUM2, 2],
    [SM_ID.SERUM1, 1]
];

/** Serum 207(p): the sanctified vial, whose dose sets a villager's permanent bit. */
export const PERM_SERUM_BY_DOSE: readonly (readonly [number, number])[] = [
    [SM_ID.SERUM_PERM4, 4],
    [SM_ID.SERUM_PERM3, 3],
    [SM_ID.SERUM_PERM2, 2],
    [SM_ID.SERUM_PERM1, 1]
];

// Why: one dose sets one villager's permanent bit, and Razmire and Ulsquire are the two the quest keeps coming back to.
/** Doses of serum 207(p) the run wants: one for Razmire, one for Ulsquire. */
export const PERM_CURES = 2;

// Why: the permanent bit lives in `%morttonmulti`, which is `scope=perm` with no `transmit`, so the run remembers who it has settled rather than reading it back off a varp.
const settled = new Set<string>();

/** True once this run has settled a villager's permanent cure. */
export const isCured = (name: string): boolean => settled.has(name);

/** Record that a villager no longer needs a dose. */
export const markCured = (name: string): void => {
    settled.add(name);
};

/** Villagers this run has settled. */
export const curedCount = (): number => settled.size;

/** Forget who has been settled. */
export const forgetCures = (): void => {
    settled.clear();
};

function doses(snap: QuestSnapshot, table: readonly (readonly [number, number])[]): number {
    return table.reduce((sum, [id, per]) => sum + heldId(snap, id) * per, 0);
}

/** Doses of serum 207 in the pack. */
export const serumDoses = (snap: QuestSnapshot): number => doses(snap, SERUM_BY_DOSE);

/** Doses of the sanctified serum 207(p) in the pack. */
export const permSerumDoses = (snap: QuestSnapshot): number => doses(snap, PERM_SERUM_BY_DOSE);

/** Vials of serum 207 held, whatever their dose. */
export function serumVials(snap: QuestSnapshot): number {
    return SERUM_BY_DOSE.reduce((sum, [id]) => sum + heldId(snap, id), 0);
}

function firstHeld(table: readonly (readonly [number, number])[]): number | null {
    for (const [id] of table) {
        if (Inventory.countById(id) > 0) {
            return id;
        }
    }
    return null;
}

/** The serum 207 vial to spend a dose from. */
export const serumVialId = (): number | null => firstHeld(SERUM_BY_DOSE);

/** The serum 207(p) vial to spend a dose from. */
export const permSerumVialId = (): number | null => firstHeld(PERM_SERUM_BY_DOSE);

/** Doses of serum 207(p) in the live pack. */
export const permSerumDosesHeld = (): number =>
    PERM_SERUM_BY_DOSE.reduce((sum, [id, per]) => sum + Inventory.countById(id) * per, 0);

/** True for a vial of serum 207(p), whose dose sets a villager's permanent bit. */
export const isPermSerum = (id: number): boolean => PERM_SERUM_BY_DOSE.some(([permId]) => permId === id);

const scanBank: QuestStep = { kind: 'scanBank' };

// Why: `~axe_checker` accepts a held or a worn axe and this era gates axes on Attack rather than Woodcutting, so any tier in the pack chops a Mort'ton dead tree.

/** True when the pack or the worn kit carries any axe. */
export function hasAxe(snap: QuestSnapshot): boolean {
    return AXES.some(t => (snap.inv.get(t.name.toLowerCase()) ?? 0) > 0 || snap.worn.has(t.name.toLowerCase()));
}

// Why: the dead trees stand in the town the quest already works in, so the axe replaces a swamp crossing to the Varrock log spawn with a walk across the street.

/** Draw or buy the axe the chopping leg needs, or null once one is carried. */
export function axeLeg(snap: QuestSnapshot): QuestStep | null {
    if (hasAxe(snap)) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank;
    }
    // Why: `AXES` runs rune-first and the axe is only carried, never wielded, so no level gates the pick and the first row present is the best.
    const banked = AXES.find(t => (snap.bank?.get(t.name.toLowerCase()) ?? 0) > 0);
    if (banked) {
        return { kind: 'withdraw', items: [{ name: banked.name, qty: 1 }] };
    }
    return {
        kind: 'buy',
        item: SHOP_AXE,
        qty: 1,
        shop: { npc: BOB_VENDOR.keeper, anchor: BOB_VENDOR.stand },
        estGp: AXE_SHOP_COSTS[SHOP_AXE] ?? BRONZE_AXE_GP
    };
}

// Why: a dose is spent per villager conversation the quest still owes, and each conversation is gated on a stage, so what is left to brew falls out of where the quest is.

/** Doses of serum the rest of the quest still spends from this stage on. */
export function dosesNeeded(stage: number): number {
    let doses = 0;
    if (!isCured(SM_NPC.RAZMIRE)) {
        if (stage < SM_STAGE.KILL_SHADES) {
            doses++; // to be sent after the shades
        }
        if (stage < SM_STAGE.SHADES_TO_RAZMIRE) {
            doses++; // to take the remains
        }
    }
    if (!isCured(SM_NPC.ULSQUIRE)) {
        if (stage < SM_STAGE.ULSQUIRE_TEMPLE) {
            doses++; // who studies the remains and then names the temple
        }
        doses++; // once the pyre is lit
    }
    // Why: the permanent cures are not billed here — the second vial the table funds carries two spare doses, and brewing for them would send a run with a spent table hunting herbs for an optimisation.
    return doses;
}

// Why: a half-brewed vial is not a vial — counting it as one stops the chain on the unfinished potion and leaves the last conversation unpayable.

/** Serums still to brew for the rest of the quest, at three doses a vial. */
export function serumsShort(snap: QuestSnapshot, stage: number): number {
    const have = serumDoses(snap) + permSerumDoses(snap);
    return Math.max(0, Math.ceil((dosesNeeded(stage) - have) / DOSES_PER_VIAL));
}

// Why: nothing inside Morytania sells or spawns logs, so the source is either Mort'ton's dead trees with an axe or the two spawns beside the Varrock east bank without one.

/** Ashes still to burn: one per serum this quest has yet to brew. */
export function ashesShort(snap: QuestSnapshot, stage: number): number {
    return Math.max(0, serumsShort(snap, stage) - heldId(snap, SM_ID.ASHES));
}

// Why: past `logs_on_pyre` the log is already stacked on the pyre, and a predicate that still wants one sends the bot back across the swamp for a log the quest has finished with.

/** Logs the pack still needs: one per outstanding burn, plus the one the pyre consumes. */
export function logsShort(snap: QuestSnapshot, stage: number): number {
    const spent = stage >= SM_STAGE.LOGS_ON_PYRE || heldId(snap, SM_ID.PYRE_LOGS) > 0;
    return Math.max(0, ashesShort(snap, stage) + (spent ? 0 : 1) - heldId(snap, SM_ID.LOGS));
}

// Why: `ownsInventory` opts this quest out of the engine's coin and food withdrawal, so both are drawn here.
// Why: the tinderbox and the logs ride the same trip, since the ashes leg burns them at the Varrock spawn on the way east.

/** Coins, food, tinderbox and logs, bank first. Null once the approach pack is ready. */
export function kit(snap: QuestSnapshot, stage: number): QuestStep | null {
    const foodName = QuestFood.name?.trim();
    const foodHeld = foodName ? (snap.inv.get(foodName.toLowerCase()) ?? 0) : 0;
    const needCoins = heldId(snap, SM_ID.COINS) < COIN_LOW;
    const needFood = Boolean(foodName) && foodHeld < FOOD_LOW;
    const needTinderbox = heldId(snap, SM_ID.TINDERBOX) === 0;
    const needLogs = logsShort(snap, stage) > 0;

    if (!needCoins && !needFood && !needTinderbox && !needLogs) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank;
    }

    const items: { name: string; qty: number; id?: number }[] = [];
    const bankedCoins = snap.bank?.get('coins') ?? 0;
    if (needCoins && bankedCoins > 0) {
        items.push({ name: SM_NAME.COINS, qty: Math.min(COIN_TARGET, bankedCoins), id: SM_ID.COINS });
    }
    if (needFood && foodName) {
        const banked = snap.bank?.get(foodName.toLowerCase()) ?? 0;
        if (banked > 0) {
            items.push({ name: foodName, qty: Math.min(FOOD_TARGET - foodHeld, banked) });
        }
    }
    if (needTinderbox && bankedId(snap, SM_ID.TINDERBOX) > 0) {
        items.push({ name: SM_NAME.TINDERBOX, qty: 1, id: SM_ID.TINDERBOX });
    }
    if (needLogs && bankedId(snap, SM_ID.LOGS) > 0) {
        items.push({ name: SM_NAME.LOGS, qty: logsShort(snap, stage), id: SM_ID.LOGS });
    }
    if (items.length > 0) {
        return { kind: 'withdraw', items };
    }
    if (needTinderbox) {
        return { kind: 'buy', item: SM_NAME.TINDERBOX, qty: 1, shop: VARROCK_GENERAL, estGp: TINDERBOX_GP };
    }
    return null;
}

/** Light one held log and take the ashes the fire leaves behind. */
async function burnOne(log: (m: string) => void): Promise<boolean> {
    const tinder = Inventory.items().find(i => i.id === SM_ID.TINDERBOX);
    const logs = Inventory.items().find(i => i.id === SM_ID.LOGS);
    if (!tinder || !logs) {
        log('burnOne: no tinderbox or no logs in the pack');
        return false;
    }
    const before = Inventory.countById(SM_ID.ASHES);
    if (!(await tinder.useOn(logs))) {
        return false;
    }
    // Why: the fire burns 100–200 ticks before `obj_addall` drops its ashes, so the wait is minutes rather than seconds.
    const ashesNear = (): boolean =>
        GroundItems.query().where(g => g.id === SM_ID.ASHES).within(3).nearest() !== null;
    if (!(await Execution.delayUntil(ashesNear, 180_000))) {
        log('burnOne: the fire never left any ashes');
        return false;
    }
    const ash = GroundItems.query().where(g => g.id === SM_ID.ASHES).within(3).nearest();
    if (!ash || !(await ash.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.countById(SM_ID.ASHES) > before, 8000);
}

const CHOP = 'Chop down';
const CHOP_MS = 25_000;
const CHOP_RADIUS = 8;

/** True when the live pack or the worn kit carries any axe. */
export function hasAxeHeld(): boolean {
    const wanted = new Set(AXES.map(t => t.name.toLowerCase()));
    const named = (i: { name?: string | null }): boolean => wanted.has((i.name ?? '').toLowerCase());
    return Inventory.items().some(named) || Equipment.items().some(named);
}

/** Fell one Mort'ton dead tree for the log it drops. */
async function chopOne(): Promise<boolean> {
    const tree = Locs.query().name(SM_LOC.DEAD_TREE).action(CHOP).within(CHOP_RADIUS).nearest();
    if (!tree) {
        return false;
    }
    const before = Inventory.countById(SM_ID.LOGS);
    if (!(await tree.interact(CHOP))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.countById(SM_ID.LOGS) > before, CHOP_MS);
}

// Why: the spawn is two logs at a time on its own respawn timer, so the loop burns whatever is spare rather than waiting to hold every log the order asks for.
// Why: Mort'ton's own mapsquare holds 29 dead trees, all of them plain `category=tree`, so an axe turns the Varrock round trip into a walk across the street — the spawn stays as the fallback for a run that never got one.

/** Gather logs and burn them until the pack holds the ashes and the pyre log. */
export function makeAshes(want: { ashes: number; logs: number }): (log: (m: string) => void) => Promise<boolean> {
    return async (log: (m: string) => void): Promise<boolean> => {
        if (Bank.isOpen()) {
            await Bank.close();
        }
        const chopping = hasAxeHeld();
        const stand = chopping ? SM_TILE.DEAD_TREE : SM_TILE.VARROCK_LOGS;
        if (!(await Traversal.walkResilient(stand, { radius: 2, attempts: 3, timeoutMs: 180_000, log }))) {
            return false;
        }
        await settleScene();
        const deadline = performance.now() + BURN_BUDGET_MS;
        while (performance.now() < deadline) {
            const burnsLeft = Math.max(0, want.ashes - Inventory.countById(SM_ID.ASHES));
            const held = Inventory.countById(SM_ID.LOGS);
            if (burnsLeft === 0 && held >= want.logs) {
                return true;
            }
            if (burnsLeft > 0 && held > want.logs) {
                if (!(await burnOne(log))) {
                    return false;
                }
                continue;
            }
            if (chopping) {
                if (!(await chopOne())) {
                    // Every tree in reach is a stump; they come back on their own timer.
                    await Execution.delayTicks(2);
                }
                continue;
            }
            const spawn = GroundItems.query().where(g => g.id === SM_ID.LOGS).within(8).nearest();
            if (!spawn) {
                // Both spawns are taken; they come back on their own timer.
                await Execution.delayTicks(4);
                continue;
            }
            if (await spawn.interact('Take')) {
                await Execution.delayUntil(() => Inventory.countById(SM_ID.LOGS) > held, 8000);
            }
        }
        log(`makeAshes: gave up holding ${Inventory.countById(SM_ID.ASHES)} ashes and ${Inventory.countById(SM_ID.LOGS)} logs`);
        return false;
    };
}

/** Fill an empty vial at the Mort'ton sink. */
export function fillVial(log: (m: string) => void): Promise<boolean> {
    const before = Inventory.countById(SM_ID.VIAL_WATER);
    return useOnLoc(
        SM_ID.VIAL_EMPTY,
        { name: SM_LOC.SINK, near: SM_TILE.SINK, id: SM_LOC_ID.SINK, within: 8 },
        [],
        () => Inventory.countById(SM_ID.VIAL_WATER) > before,
        log
    );
}
