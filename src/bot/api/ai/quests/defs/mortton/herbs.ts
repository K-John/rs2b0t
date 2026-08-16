import { EventSignal } from '../../../../execution/EventSignal.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Npcs, type Npc } from '../../../../npcs/Npcs.js';
import { Skills } from '../../../../skills/Skills.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { settleScene } from '../../exec/prompts.js';
import { EDGEVILLE_MEN, SM_ID, SM_NPC } from './areas.js';

const SEARCH_RADIUS = 12;
const LOOT_RADIUS = 10;
const EAT_AT_MISSING = 12;
/** Ticks one citizen is given before the loop drops it and picks another. */
const FIGHT_GUARD = 60;
// Why: `~randomherb` is 23 of 128 on a citizen and tarromin is 18 of 128 of that — about one herb every forty kills, against four spawns on a 50-tick timer.
const FARM_BUDGET_MS = 900_000;

function hungry(): boolean {
    const max = Skills.level('hitpoints');
    return max > 0 && Skills.effective('hitpoints') <= max - EAT_AT_MISSING;
}

function citizen(): Npc | null {
    return Npcs.query()
        .name(SM_NPC.MAN)
        .action('Attack')
        .where(n => !n.targetsAnotherPlayer())
        .within(SEARCH_RADIUS)
        .nearest();
}

// Why: every unidentified herb renders as "Herb", so the floor is filtered by id and the other nine kinds are left where they fell.
const tarrominOnFloor = () =>
    GroundItems.query().where(g => g.id === SM_ID.UNID_TARROMIN).within(LOOT_RADIUS).nearest();

/** Take one unidentified tarromin off the floor. */
async function loot(): Promise<boolean> {
    const drop = tarrominOnFloor();
    if (!drop) {
        return false;
    }
    const before = Inventory.countById(SM_ID.UNID_TARROMIN);
    if (!(await drop.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.countById(SM_ID.UNID_TARROMIN) > before, 6000);
}

/** Kill one citizen, waiting out its death so the drop lands. */
async function killOne(log: (m: string) => void): Promise<boolean> {
    const mark = citizen();
    if (!mark) {
        return false;
    }
    Game.setAutoRetaliate(true);
    const index = mark.index;
    let lastTick = -1;
    for (let i = 0; i < FIGHT_GUARD; i++) {
        if (EventSignal.pending()) {
            log('yielding to a random event mid-kill');
            return false;
        }
        const now = Game.tick();
        if (now === lastTick) {
            await Execution.delayTicks(1);
            continue;
        }
        lastTick = now;
        if (!Npcs.all().some(n => n.index === index)) {
            // The drop lands on the tile it fell on; give the server a tick to place it.
            await Execution.delayTicks(1);
            return true;
        }
        if (hungry()) {
            await Sustain.run();
            continue;
        }
        if (Game.inCombat()) {
            await Execution.delayTicks(1);
            continue;
        }
        const live = Npcs.all().find(n => n.index === index);
        if (live) {
            await live.interact('Attack');
        }
        await Execution.delayTicks(1);
    }
    return false;
}

// Why: the smashed table is a one-shot and no shop on this route sells tarromin, so a run that overspends its six doses has the citizen drop table and nothing else.

/** Kill Edgeville men until the pack holds the unidentified tarromin the serums still need. */
export function farmHerbs(want: number): (log: (m: string) => void) => Promise<boolean> {
    return async (log: (m: string) => void): Promise<boolean> => {
        const target = Inventory.countById(SM_ID.UNID_TARROMIN) + Math.max(1, want);
        if (!(await Traversal.walkResilient(EDGEVILLE_MEN, { radius: 4, attempts: 3, timeoutMs: 240_000, log }))) {
            return false;
        }
        await settleScene();
        const deadline = performance.now() + FARM_BUDGET_MS;
        let kills = 0;
        while (performance.now() < deadline) {
            if (await loot()) {
                if (Inventory.countById(SM_ID.UNID_TARROMIN) >= target) {
                    log(`took ${target} unidentified tarromin off ${kills} kills`);
                    return true;
                }
                continue;
            }
            if (!citizen()) {
                // Four spawns on a 50-tick timer; they come back on their own.
                await Execution.delayTicks(4);
                continue;
            }
            if (await killOne(log)) {
                kills++;
            }
        }
        log(`gave up after ${kills} kills holding ${Inventory.countById(SM_ID.UNID_TARROMIN)} of ${target} tarromin`);
        return false;
    };
}
