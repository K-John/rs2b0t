// docs/QUESTS.md
import { DirectNavigator } from '../../../../../event/webwalk/DirectNavigator.js';
import { Equipment } from '../../../../equipment/Equipment.js';
import { EventSignal } from '../../../../execution/EventSignal.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Npcs, type Npc } from '../../../../npcs/Npcs.js';
import { Skills } from '../../../../skills/Skills.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { IKOV_LOC, IKOV_NAME, IKOV_NPC, IKOV_OBJ, IKOV_TILE, LAVA_BRIDGE_ZONE, onWineldaLedge } from './areas.js';
import { escapePocket, wearFearPendant } from './dungeon.js';

/** Ticks the Fire Warrior is given before the leg hands the tick back to the engine. */
const WARRIOR_GUARD = 900;
const LUCIEN_GUARD = 400;
const EAT_AT_MISSING = 18;
const ARROW_RADIUS = 12;
const WALK_MS = 300_000;

function hungry(): boolean {
    const max = Skills.level('hitpoints');
    return max > 0 && Skills.effective('hitpoints') <= max - EAT_AT_MISSING;
}

/** Every ice-arrow stack size renders under one display name, so the pack is counted by name. */
export function iceArrowsHeld(): number {
    return Inventory.count(IKOV_NAME.ICE_ARROWS) + (Equipment.contains(IKOV_NAME.ICE_ARROWS) ? wornArrows() : 0);
}

function wornArrows(): number {
    return Equipment.items()
        .filter(i => (i.name ?? '').toLowerCase() === IKOV_NAME.ICE_ARROWS.toLowerCase())
        .reduce((sum, i) => sum + i.count, 0);
}

/** The Fire Warrior refuses anything but ranged, and only with ice arrows in the quiver. */
export async function armForTheWarrior(log: (m: string) => void): Promise<boolean> {
    if (!Equipment.contains(IKOV_NAME.YEW_SHORTBOW) && !(await Equipment.equip(IKOV_NAME.YEW_SHORTBOW))) {
        log('ikov: no yew shortbow to wield');
        return false;
    }
    if (!Equipment.contains(IKOV_NAME.ICE_ARROWS) && !(await Equipment.equip(IKOV_NAME.ICE_ARROWS))) {
        log('ikov: no ice arrows to nock');
        return false;
    }
    return true;
}

async function pickUpArrows(log: (m: string) => void): Promise<void> {
    for (let sweep = 0; sweep < 12; sweep++) {
        const drop = GroundItems.query()
            .where(g => (g.name ?? '').toLowerCase() === IKOV_NAME.ICE_ARROWS.toLowerCase())
            .action('Take')
            .within(ARROW_RADIUS)
            .nearest();
        if (!drop) {
            return;
        }
        const where = drop.tile();
        if (drop.distance() > 1) {
            await DirectNavigator.walkTo(where, 0, 6000);
        }
        const still = GroundItems.query()
            .where(g => (g.name ?? '').toLowerCase() === IKOV_NAME.ICE_ARROWS.toLowerCase())
            .action('Take')
            .within(ARROW_RADIUS)
            .nearest();
        if (!still || !(await still.interact('Take'))) {
            return;
        }
        await Execution.delayTicks(2);
    }
    log(`ikov: recovered arrows, ${iceArrowsHeld()} held`);
}

function warrior(): Npc | null {
    return Npcs.query().where(n => n.id === IKOV_NPC.FIRE_WARRIOR).action('Attack').within(15).nearest();
}

// Why: opening the door below the stage does not open it — it summons the warrior on the near side and blasts you back a tile.
async function summonWarrior(log: (m: string) => void): Promise<boolean> {
    if (warrior()) {
        return true;
    }
    const door = Locs.query().where(l => l.id === IKOV_LOC.FIREWARRIOR_DOOR).within(6).nearest();
    if (!door) {
        log('ikov: no fire warrior door in reach');
        return false;
    }
    log('ikov: opening the fire warrior door');
    if (!(await door.interact('Open'))) {
        return false;
    }
    return Execution.delayUntil(() => warrior() !== null, 15_000);
}

async function drainDialogue(): Promise<void> {
    for (let i = 0; i < 20; i++) {
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        if (!ChatDialog.isOpen()) {
            return;
        }
        await Execution.delayTicks(1);
    }
}

/** Shoot the Fire Warrior down with ice arrows and sweep the spent ones up. */
export async function fightFireWarrior(log: (m: string) => void): Promise<boolean> {
    if (!(await escapePocket(log))) {
        return false;
    }
    if (!(await wearFearPendant(log))) {
        return false;
    }
    if (!(await armForTheWarrior(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(IKOV_TILE.FIRE_DOOR_SOUTH, {
        radius: 2,
        attempts: 3,
        timeoutMs: WALK_MS,
        avoidZones: [LAVA_BRIDGE_ZONE],
        log
    }))) {
        return false;
    }
    if (!(await summonWarrior(log))) {
        return false;
    }

    Game.setAutoRetaliate(true);
    let attacking = -1;
    let missing = 0;
    let swings = 0;
    let lastTick = -1;
    let reported = -1;
    for (let i = 0; i < WARRIOR_GUARD; i++) {
        if (EventSignal.pending()) {
            log('ikov: yielding the Fire Warrior to a random event');
            return false;
        }
        const now = Game.tick();
        if (now === lastTick) {
            await Execution.delayTicks(1);
            continue;
        }
        lastTick = now;
        if (ChatDialog.isOpen() || ChatDialog.canContinue()) {
            await drainDialogue();
            continue;
        }
        if (hungry()) {
            await Sustain.run();
            continue;
        }
        const npc = warrior();
        if (!npc) {
            attacking = -1;
            missing++;
            if (swings > 0 && missing >= 4) {
                log(`ikov: the Fire Warrior is down after ${swings} shots`);
                await drainDialogue();
                await pickUpArrows(log);
                return true;
            }
            await Execution.delayTicks(1);
            continue;
        }
        missing = 0;
        if (iceArrowsHeld() === 0) {
            log('ikov: out of ice arrows mid-fight');
            return false;
        }
        if (now - reported >= 40) {
            reported = now;
            log(`ikov: warrior fight hp=${Skills.effective('hitpoints')}/${Skills.level('hitpoints')} arrows=${iceArrowsHeld()} shots=${swings}`);
        }
        if (npc.index === attacking && Game.inCombat()) {
            await Execution.delayTicks(1);
            continue;
        }
        if (await npc.interact('Attack')) {
            attacking = npc.index;
            swings++;
        }
        await Execution.delayTicks(1);
    }
    log(`ikov: the Fire Warrior outlived ${WARRIOR_GUARD} ticks`);
    return false;
}

function lucien(): Npc | null {
    return Npcs.query().where(n => n.id === IKOV_NPC.LUCIEN_HOSTILE).action('Attack').nearest();
}

/**
 * Kill Lucien for the Armadyl ending. He is level 14 and the pendant is what makes him attackable.
 * @see docs/decisions/quest-pitfalls-8.md
 */
export async function killLucien(log: (m: string) => void): Promise<boolean> {
    if (!Equipment.contains(IKOV_NAME.PENDANT_ARMADYL)) {
        if (!(await Equipment.equip(IKOV_NAME.PENDANT_ARMADYL))) {
            log('ikov: no Armadyl pendant to wear — Lucien cannot be attacked without it');
            return false;
        }
    }
    // Why: a bow with an empty quiver refuses every swing, and the ice arrows are usually spent by now.
    if (Equipment.contains(IKOV_NAME.YEW_SHORTBOW) && iceArrowsHeld() === 0) {
        await Equipment.unequip(IKOV_NAME.YEW_SHORTBOW);
    }
    if (!(await Traversal.walkResilient(IKOV_TILE.LUCIEN_HUT, { radius: 4, attempts: 3, timeoutMs: 600_000, log }))) {
        return false;
    }
    Game.setAutoRetaliate(true);
    let attacking = -1;
    let missing = 0;
    let swings = 0;
    let lastTick = -1;
    for (let i = 0; i < LUCIEN_GUARD; i++) {
        if (EventSignal.pending()) {
            return false;
        }
        const now = Game.tick();
        if (now === lastTick) {
            await Execution.delayTicks(1);
            continue;
        }
        lastTick = now;
        if (ChatDialog.isOpen() || ChatDialog.canContinue()) {
            await drainDialogue();
            continue;
        }
        if (hungry()) {
            await Sustain.run();
            continue;
        }
        const npc = lucien();
        if (!npc) {
            attacking = -1;
            missing++;
            if (swings > 0 && missing >= 5) {
                log(`ikov: Lucien is banished after ${swings} attacks`);
                await drainDialogue();
                return true;
            }
            await Execution.delayTicks(1);
            continue;
        }
        missing = 0;
        if (npc.index === attacking && Game.inCombat()) {
            await Execution.delayTicks(1);
            continue;
        }
        if (await npc.interact('Attack')) {
            attacking = npc.index;
            swings++;
        }
        await Execution.delayTicks(1);
    }
    log(`ikov: Lucien outlived ${LUCIEN_GUARD} ticks`);
    return false;
}

/** True while the bot is on Winelda's side of the lava, where the Fire Warrior's door is behind it. */
export function onLedge(): boolean {
    const here = Game.tile();
    return here !== null && onWineldaLedge(here);
}

export { IKOV_OBJ };
