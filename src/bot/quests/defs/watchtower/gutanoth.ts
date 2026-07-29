import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { Locs, type Loc } from '../../../api/queries/Locs.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import { Reach } from '../../../api/Reach.js';
import { Traversal } from '../../../api/Traversal.js';
import { talkThrough } from '../../exec/primitives.js';
import { WT_ITEM, WT_LOC, WT_NPC, WT_TILE, watchtowerArea } from './areas.js';
import { settleScene } from './scene.js';

export const CHASM_TOLL = 20;

function heldId(id: number): number {
    return Inventory.items().filter(item => item.id === id).reduce((sum, item) => sum + item.count, 0);
}

function locNear(id: number, op: string, within = 8): Loc | null {
    return Locs.query().where(loc => loc.id === id).action(op).within(within).nearest();
}

/** West of the relic gate is inside the city; the guard throws you east onto the hill. */
function pastRelicGate(): boolean {
    const tile = Game.tile();
    return tile !== null && tile.x <= 2503 && tile.z >= 3058 && tile.z <= 3066;
}

async function offerRelic(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(WT_TILE.GATE_RELIC_STAND, { radius: 2, attempts: 3, timeoutMs: 300_000, log }))) {
        return false;
    }
    const guard = Npcs.query().name(WT_NPC.OGRE_GUARD).nearest();
    const relic = Inventory.items().find(item => item.id === WT_ITEM.OGRE_RELIC.id);
    if (!guard || !relic) {
        log('no ogre guard at the north-west gate, or no relic in the pack');
        return false;
    }
    if (!(await relic.useOn(guard))) {
        return false;
    }
    await talkThrough(WT_NPC.OGRE_GUARD, [], log);
    return Execution.delayUntil(() => pastRelicGate(), 10_000);
}

export async function showRelicToGuard(log: (m: string) => void): Promise<boolean> {
    if (heldId(WT_ITEM.OGRE_RELIC.id) === 0) {
        log('no Ogre relic in the pack');
        return false;
    }
    if (await offerRelic(log)) {
        await settleScene();
        return true;
    }
    // First contact only records that he wants a sign of friendship and throws us
    // down the hill; the crossing needs a second approach.
    log('guard threw us down the hill — returning to show the relic again');
    if (!(await offerRelic(log))) {
        return false;
    }
    await settleScene();
    return true;
}

export async function stealRockCake(log: (m: string) => void): Promise<boolean> {
    if (heldId(WT_ITEM.ROCK_CAKE.id) > 0) {
        return true;
    }
    if (!(await Traversal.walkResilient(WT_TILE.ROCK_CAKE_STALL, { radius: 1, attempts: 3, timeoutMs: 300_000, log }))) {
        return false;
    }
    for (let attempt = 0; attempt < 8; attempt++) {
        const stall = locNear(WT_LOC.ROCK_CAKE_STALL, 'Steal-From', 6);
        if (stall && (await stall.interact('Steal-From'))) {
            if (await Execution.delayUntil(() => heldId(WT_ITEM.ROCK_CAKE.id) > 0, 6000)) {
                return true;
            }
        }
        // The counter swaps to its empty form for 12 ticks after a theft.
        await Execution.delayTicks(6);
    }
    log('could not steal a rock cake — the ogre trader may be guarding the stall');
    return false;
}

export async function crossBattlement(log: (m: string) => void): Promise<boolean> {
    if (watchtowerArea(Game.tile()) === 'lowerCity') {
        return true;
    }
    if (!(await Traversal.walkResilient(WT_TILE.BATTLEMENT_GUARD, { radius: 2, attempts: 3, timeoutMs: 300_000, log }))) {
        return false;
    }
    const guard = Npcs.query().name(WT_NPC.OGRE_GUARD).nearest();
    if (!guard) {
        log('no battlement guard in range');
        return false;
    }
    // First contact sets "prove it with a gift"; the cake is what satisfies it.
    const cake = Inventory.items().find(item => item.id === WT_ITEM.ROCK_CAKE.id);
    const opened = cake ? await cake.useOn(guard) : await guard.interact('Talk-to');
    if (!opened) {
        return false;
    }
    await talkThrough(WT_NPC.OGRE_GUARD, ['But I am a friend to ogres...'], log);
    if (await Execution.delayUntil(() => watchtowerArea(Game.tile()) === 'lowerCity', 10_000)) {
        await settleScene();
        return true;
    }
    // Handing the cake over normally auto-climbs; climb it ourselves if it did not.
    const wall = locNear(WT_LOC.BATTLEMENT, 'Climb-over', 8);
    if (!wall || !(await wall.interact('Climb-over'))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => watchtowerArea(Game.tile()) === 'lowerCity', 10_000))) {
        return false;
    }
    await settleScene();
    return true;
}

/** The battlement climbs both ways once the market gift is paid. */
export async function leaveLowerCity(log: (m: string) => void): Promise<boolean> {
    if (watchtowerArea(Game.tile()) !== 'lowerCity') {
        return true;
    }
    if (!(await Traversal.walkResilient(WT_TILE.BATTLEMENT_INSIDE, { radius: 1, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    const wall = locNear(WT_LOC.BATTLEMENT, 'Climb-over', 8);
    if (!wall || !(await wall.interact('Climb-over'))) {
        log('no battlement in range to climb back over');
        return false;
    }
    if (!(await Execution.delayUntil(() => watchtowerArea(Game.tile()) !== 'lowerCity', 12_000))) {
        return false;
    }
    await settleScene();
    return true;
}

export async function jumpChasm(log: (m: string) => void): Promise<boolean> {
    if (watchtowerArea(Game.tile()) === 'cityGuard') {
        return true;
    }
    if (heldId(WT_ITEM.COINS.id) < CHASM_TOLL) {
        log(`need ${CHASM_TOLL} gp for the chasm toll`);
        return false;
    }
    if (!(await crossBattlement(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(WT_TILE.JUMP_STAND, { radius: 1, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    const rock = locNear(WT_LOC.JUMP_IN, 'Jump-From', 6);
    if (!rock || !(await rock.interact('Jump-From'))) {
        log('no Jump-From rock at the chasm — the level-1 loc may not be clickable from level 0');
        return false;
    }
    if (!(await talkThrough(WT_NPC.OGRE_GUARD, ["Okay, I'll pay it."], log))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => watchtowerArea(Game.tile()) === 'cityGuard', 12_000))) {
        return false;
    }
    await settleScene();
    return true;
}

export async function jumpBack(log: (m: string) => void): Promise<boolean> {
    if (watchtowerArea(Game.tile()) !== 'cityGuard') {
        return true;
    }
    if (!(await Traversal.walkResilient(WT_TILE.JUMP_BACK_STAND, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const rock = locNear(WT_LOC.JUMP_OUT, 'Jump-From', 6);
    if (!rock || !(await rock.interact('Jump-From'))) {
        log('no Jump-From rock back out of the city-guard pocket');
        return false;
    }
    if (!(await Execution.delayUntil(() => watchtowerArea(Game.tile()) !== 'cityGuard', 12_000))) {
        return false;
    }
    await settleScene();
    return true;
}

export async function askRiddle(log: (m: string) => void): Promise<boolean> {
    if (!(await jumpChasm(log))) {
        return false;
    }
    if ((await Reach.npcDialog({ name: WT_NPC.CITY_GUARD, near: WT_TILE.CITY_GUARD, log })) !== 'done') {
        return false;
    }
    return talkThrough(
        WT_NPC.CITY_GUARD,
        ['I seek passage into the skavid caves.', 'I have lost the map you gave me.'],
        log
    );
}

export async function answerRiddle(log: (m: string) => void): Promise<boolean> {
    if (heldId(WT_ITEM.DEATH_RUNE.id) === 0) {
        log('no Death rune to answer the riddle with');
        return false;
    }
    if (!(await jumpChasm(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(WT_TILE.CITY_GUARD, { radius: 2, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const guard = Npcs.query().name(WT_NPC.CITY_GUARD).nearest();
    const rune = Inventory.items().find(item => item.id === WT_ITEM.DEATH_RUNE.id);
    if (!guard || !rune || !(await rune.useOn(guard))) {
        return false;
    }
    await talkThrough(WT_NPC.CITY_GUARD, [], log);
    return Execution.delayUntil(() => heldId(WT_ITEM.SKAVID_MAP.id) > 0, 10_000);
}
