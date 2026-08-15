import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Npcs, type Npc } from '../../../../npcs/Npcs.js';
import { Modals } from '../../../../ui/widgets/Modals.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { driveUntil, heldId, settleScene } from '../../exec/prompts.js';
import { RG_ITEM, RG_LOC, RG_NPC, RG_SULPHUR_LOCS, RG_TILE } from './areas.js';
import { RG_STAGE } from './journal.js';
import { walkTo } from './isafdar.js';

const GRIND_MS = 12_000;

async function useHeldOnLoc(itemId: number, locIds: readonly number[], expect: () => boolean, log: (m: string) => void): Promise<boolean> {
    await settleScene();
    const target = Locs.query().where(loc => locIds.includes(loc.id)).within(10).nearest();
    const item = Inventory.items().find(entry => entry.id === itemId);
    if (!target || !item) {
        log(`nothing to use ${itemId} on within reach`);
        return false;
    }
    if (!(await item.useOn(target))) {
        return false;
    }
    return driveUntil(expect, [], log, GRIND_MS);
}

/** An empty barrel off the floor of the elf camp. */
export async function takeBarrel(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(RG_TILE.BARREL_SPAWN, 6, RG_STAGE.SPOKEN_IORWERTH2, log))) {
        return false;
    }
    await settleScene();
    const before = heldId(RG_ITEM.BARREL.id);
    const barrel = GroundItems.query().where(item => item.id === RG_ITEM.BARREL.id).within(14).nearest();
    if (!barrel) {
        log('no barrel on the floor of the elf camp');
        return false;
    }
    if (!(await barrel.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(RG_ITEM.BARREL.id) > before, 10_000);
}

/** A pot off the floor of the elf camp — the quicklime dust has to be stored in something. */
export async function takePot(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(RG_TILE.POT_SPAWN, 4, RG_STAGE.SPOKEN_IORWERTH2, log))) {
        return false;
    }
    await settleScene();
    const before = heldId(RG_ITEM.POT.id);
    const pot = GroundItems.query().where(item => item.id === RG_ITEM.POT.id).within(12).nearest();
    if (!pot || !(await pot.interact('Take'))) {
        log('no pot on the floor of the elf camp');
        return false;
    }
    return Execution.delayUntil(() => heldId(RG_ITEM.POT.id) > before, 10_000);
}

// Why: `[oplocu,regicide_loom]` takes the wool four at a time and answers "You don't have enough of that
// item" for anything less, so the weave is one action rather than a loop.

/** Four balls of wool woven into the strip of cloth that becomes the fuse. */
export async function weaveCloth(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(RG_TILE.LOOM, 2, RG_STAGE.SPOKEN_IORWERTH2, log))) {
        return false;
    }
    return useHeldOnLoc(RG_ITEM.BALL_OF_WOOL.id, [RG_LOC.LOOM], () => heldId(RG_ITEM.CLOTH.id) > 0, log);
}

/** The barrel filled from the coal-tar seep in the southern swamp. */
export async function fillTar(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(RG_TILE.TAR, 3, RG_STAGE.SPOKEN_IORWERTH2, log))) {
        return false;
    }
    const before = heldId(RG_ITEM.BARREL_TAR.id);
    return useHeldOnLoc(RG_ITEM.BARREL.id, [RG_LOC.TAR], () => heldId(RG_ITEM.BARREL_TAR.id) > before, log);
}

/** A lump broken off one of the sulphur formations beside the swamp. */
export async function takeSulphur(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(RG_TILE.SULPHUR, 4, RG_STAGE.SPOKEN_IORWERTH2, log))) {
        return false;
    }
    await settleScene();
    const before = heldId(RG_ITEM.SULPHUR.id);
    const rock = Locs.query().where(loc => RG_SULPHUR_LOCS.includes(loc.id)).action('Take').within(12).nearest();
    if (!rock || !(await rock.interact('Take'))) {
        log('no sulphur formation within reach of the swamp');
        return false;
    }
    return Execution.delayUntil(() => heldId(RG_ITEM.SULPHUR.id) > before, 10_000);
}

// Why: `[opheldu,regicide_sulphar]` and `[opheldu,regicide_quicklime]` both fire off the TARGET, so the
// pestle is the item used and the lump is what it is used on — the other way round produces nothing.

async function grind(fromId: number, toId: number, log: (m: string) => void): Promise<boolean> {
    const pestle = Inventory.items().find(item => item.id === RG_ITEM.PESTLE.id);
    const lump = Inventory.items().find(item => item.id === fromId);
    if (!pestle || !lump) {
        log(`missing ${pestle ? 'the lump' : 'the pestle and mortar'} to grind ${fromId}`);
        return false;
    }
    const before = heldId(toId);
    if (!(await pestle.useOn(lump))) {
        return false;
    }
    return driveUntil(() => heldId(toId) > before, [], log, GRIND_MS);
}

export function grindSulphur(log: (m: string) => void): Promise<boolean> {
    return grind(RG_ITEM.SULPHUR.id, RG_ITEM.SULPHUR_DUST.id, log);
}

export function grindQuicklime(log: (m: string) => void): Promise<boolean> {
    return grind(RG_ITEM.QUICKLIME.id, RG_ITEM.QUICKLIME_DUST.id, log);
}

// Why: `regicide_heat_quicklime` is reached through the generic `use_furnace` switch, so any furnace does.
// The camp has one, but reaching it is six crossings deeper into the forest and six back — East Ardougne's
// is sixty tiles from the bank the run passes through anyway on its way to the still.
// Why: it costs 8 damage without gloves (`inv_totalcat(worn, armour_hands)`), which the food float covers.

/** Limestone burned to quicklime at the East Ardougne furnace. */
export async function heatQuicklime(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(RG_TILE.ARDOUGNE_FURNACE, { radius: 2, attempts: 3, timeoutMs: 300_000, log }))) {
        return false;
    }
    const before = heldId(RG_ITEM.QUICKLIME.id);
    return useHeldOnLoc(
        RG_ITEM.LIMESTONE.id,
        [RG_LOC.FURNACE, RG_LOC.FURNACE_MAIN, RG_LOC.FURNACE_SIDE],
        () => heldId(RG_ITEM.QUICKLIME.id) > before,
        log
    );
}

function rabbitNear(): Npc | null {
    return Npcs.query()
        .where(npc => npc.id === RG_NPC.RABBIT || npc.id === 1193 || npc.id === 1194)
        .action('Attack')
        .within(14)
        .nearest();
}

/** A rabbit out of the forest, for the guard who cannot catch one himself. */
export async function catchRabbit(log: (m: string) => void): Promise<boolean> {
    if (!rabbitNear() && !(await walkTo(RG_TILE.RABBITS, 5, RG_STAGE.SPOKEN_IORWERTH2, log))) {
        return false;
    }
    await settleScene();
    const rabbit = rabbitNear();
    if (!rabbit || !(await rabbit.interact('Attack'))) {
        log('no rabbit in the forest clearing');
        return false;
    }
    // Why: `~npc_death` drops the meat on the floor rather than into the pack, so the kill and the pickup
    // are two steps — and the drop lands under the rabbit, not under the player.
    if (await driveUntil(() => heldId(RG_ITEM.RAW_RABBIT.id) > 0, [], log, 60_000)) {
        return true;
    }
    return takeRabbitCorpse(log);
}

async function takeRabbitCorpse(log: (m: string) => void): Promise<boolean> {
    const meat = GroundItems.query().where(item => item.id === RG_ITEM.RAW_RABBIT.id).within(10).nearest();
    if (!meat || !(await meat.interact('Take'))) {
        return false;
    }
    log('picked the rabbit up off the forest floor');
    return Execution.delayUntil(() => heldId(RG_ITEM.RAW_RABBIT.id) > 0, 8_000);
}

/** Cooked on the range beside the Ardougne bank, on the way through to the still. */
export async function cookRabbit(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(RG_TILE.ARDOUGNE_BANK, { radius: 12, attempts: 3, timeoutMs: 300_000, log }))) {
        return false;
    }
    if (!(await Traversal.walkResilient(RG_TILE.ARDOUGNE_RANGE, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const before = heldId(RG_ITEM.COOKED_RABBIT.id);
    return useHeldOnLoc(RG_ITEM.RAW_RABBIT.id, [RANGE_LOC], () => heldId(RG_ITEM.COOKED_RABBIT.id) > before, log);
}

/** The plain `range` loc — the nearest one to the bank is a dozen tiles from it. */
const RANGE_LOC = 2728;

// ---------------------------------------------------------------------------
// The fractionalising still
// ---------------------------------------------------------------------------

// Why: `%regicide_still_total` and `%regicide_still_settings` are the two varps in this quest with
// `transmit=yes`, so the still is the one part of it the bot can read directly. `%temp` is not among them,
// which is why the control law reads the heat needle rather than the temperature.

const STILL = {
    /** `regicide_still` — the interface the tar barrel opens. */
    root: 4919,
    /** Pressure valve, one step towards shut. */
    valveShut: 6174,
    /** Pressure valve, one step further open. */
    valveOpen: 6175,
    /** Tar regulator, one step down. */
    regulatorDown: 6176,
    /** Tar regulator, one step up. */
    regulatorUp: 6177,
    /** Shovel a lump of coal into the firebox: `%temp` + 60. */
    coal: 5061
} as const;

const VARP_STILL_TOTAL = 330;
const VARP_STILL_SETTINGS = 331;
/** `if_close` hands over the naphtha at this tally. */
const STILL_TARGET = 26;
// Why: the tar regulator at full flow is +2 pressure a tick and the valve one step open is -2, which is the
// only pairing that holds the gauge still — shut is +2 a tick and blows in six, wide open falls to zero and
// the regulator has to come back down.
const VALVE_HOLD = 1;
const REGULATOR_FULL = 2;
// Why: the needle climbs one step a tick while `%temp` is 51-79 and three while it is over 80, and passing
// bit 25 resets the tally to zero. Coal at six or below therefore peaks at nine, two clear of the ceiling, and
// the four-tick gap is what stops two lumps landing inside one softtimer period and stacking the jump.
const COAL_BELOW = 6;
const COAL_GAP_TICKS = 4;
/** Green zone for the progress check — heat needle bits 19 to 24. */
const HEAT_MIN = 6;
const HEAT_MAX = 11;

function needle(settings: number, base: number, max: number): number {
    for (let bit = base; bit <= max; bit++) {
        if (((settings >>> bit) & 1) === 1) {
            return bit - base;
        }
    }
    return -1;
}

interface StillView {
    total: number;
    heat: number;
    valve: number;
    regulator: number;
}

function readStill(): StillView {
    const settings = reader.varp(VARP_STILL_SETTINGS);
    return {
        total: reader.varp(VARP_STILL_TOTAL),
        heat: needle(settings, 13, 25),
        valve: needle(settings, 26, 28),
        regulator: needle(settings, 29, 31)
    };
}

/** The next button the control law wants, or -1 when this tick is a wait. */
export function stillButton(view: StillView, sinceCoal: number, coal: number): number {
    if (view.valve < VALVE_HOLD) {
        return STILL.valveOpen;
    }
    if (view.valve > VALVE_HOLD) {
        return STILL.valveShut;
    }
    if (view.regulator < REGULATOR_FULL) {
        return STILL.regulatorUp;
    }
    if (coal > 0 && view.heat <= COAL_BELOW && sinceCoal >= COAL_GAP_TICKS) {
        return STILL.coal;
    }
    return -1;
}

export { HEAT_MIN, HEAT_MAX, STILL, STILL_TARGET, readStill, type StillView };

const STILL_TIMEOUT_TICKS = 600;

/** Pour a barrel of tar into the still and work the valves until it yields naphtha. */
export async function distilNaphtha(log: (m: string) => void): Promise<boolean> {
    if (heldId(RG_ITEM.BARREL_NAPHTHA.id) > 0) {
        return true;
    }
    if (reader.modals().main !== STILL.root) {
        if (!(await Traversal.walkResilient(RG_TILE.STILL, { radius: 2, attempts: 3, timeoutMs: 300_000, log }))) {
            return false;
        }
        if (!(await useHeldOnLoc(RG_ITEM.BARREL_TAR.id, [RG_LOC.STILL], () => reader.modals().main === STILL.root, log))) {
            log('the still would not take the barrel of coal tar');
            return false;
        }
    }
    let sinceCoal = COAL_GAP_TICKS;
    let best = 0;
    for (let tick = 0; tick < STILL_TIMEOUT_TICKS; tick++) {
        if (reader.modals().main !== STILL.root) {
            log('the still interface closed early');
            break;
        }
        const view = readStill();
        if (view.total >= STILL_TARGET) {
            break;
        }
        if (view.total > best) {
            best = view.total;
        } else if (view.total === 0 && best > 0) {
            log(`the still blew its gauge at ${best}/${STILL_TARGET} and reset — starting the run again`);
            best = 0;
        }
        const button = stillButton(view, sinceCoal, Inventory.count(RG_ITEM.COAL.name));
        if (button === STILL.coal) {
            sinceCoal = 0;
        } else {
            sinceCoal++;
        }
        if (button !== -1) {
            actions.ifButton(button);
        }
        await Execution.delayTicks(1);
    }
    if (readStill().total < STILL_TARGET) {
        log(`the still stopped at ${readStill().total}/${STILL_TARGET}`);
        await Modals.close();
        return false;
    }
    // Why: `[if_close,regicide_still]` is what swaps the empty barrel for the naphtha — the tally alone
    // hands over nothing, so the run is only finished once the interface has been shut.
    await Modals.close();
    return Execution.delayUntil(() => heldId(RG_ITEM.BARREL_NAPHTHA.id) > 0, 10_000);
}

// Why: the two powders go into the naphtha in either order and the barrel seals itself on the second, so
// this is one step that pours whichever it still has rather than two that have to be sequenced.

/** Both powders into the naphtha, which seals the barrel into a bomb. */
export async function mixBomb(log: (m: string) => void): Promise<boolean> {
    for (const dust of [RG_ITEM.QUICKLIME_DUST, RG_ITEM.SULPHUR_DUST]) {
        if (heldId(RG_ITEM.BARREL_LID.id) > 0) {
            return true;
        }
        const powder = Inventory.items().find(item => item.id === dust.id);
        const barrel = Inventory.items().find(
            item => item.id === RG_ITEM.BARREL_NAPHTHA.id || item.id === RG_ITEM.MIX_QUICKLIME.id || item.id === RG_ITEM.MIX_SULPHUR.id
        );
        if (!powder || !barrel) {
            continue;
        }
        const before = heldId(dust.id);
        if (!(await powder.useOn(barrel))) {
            return false;
        }
        if (!(await driveUntil(() => heldId(dust.id) < before, [], log, GRIND_MS))) {
            log(`the naphtha would not take the ${dust.name}`);
            return false;
        }
    }
    return heldId(RG_ITEM.BARREL_LID.id) > 0;
}

/** The woven cloth stuffed through the barrel's hole as a fuse. */
export async function fuseBomb(log: (m: string) => void): Promise<boolean> {
    const cloth = Inventory.items().find(item => item.id === RG_ITEM.CLOTH.id);
    const barrel = Inventory.items().find(item => item.id === RG_ITEM.BARREL_LID.id);
    if (!cloth || !barrel) {
        log(`missing ${cloth ? 'the sealed barrel' : 'the cloth'} for the fuse`);
        return false;
    }
    if (!(await cloth.useOn(barrel))) {
        return false;
    }
    return driveUntil(() => heldId(RG_ITEM.BARREL_FUSED.id) > 0, [], log, GRIND_MS);
}
