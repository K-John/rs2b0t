import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { GroundItems } from '../../../api/queries/GroundItems.js';
import { Locs } from '../../../api/queries/Locs.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import { Traversal } from '../../../api/Traversal.js';
import Tile from '../../../api/Tile.js';
import { DS_ID } from './areas.js';

/**
 * Melzar's Maze. Every door in here renders as plain "Door" and every coloured
 * key as plain "Key", so legs address both by coordinate and object id.
 */
export interface MazeLeg {
    what: string;
    /** Stand next to the door before using the key on it. */
    stand: Tile;
    door: Tile;
    keyId: number;
    /** Killed until it drops the key; absent for the door Oziach's key opens. */
    drops?: string;
}

export const MAZE_LEGS: readonly MazeLeg[] = [
    { what: 'the front door', stand: new Tile(2943, 3248, 0), door: new Tile(2941, 3248, 0), keyId: DS_ID.MAZE_KEY },
    { what: 'the red door', stand: new Tile(2927, 3248, 0), door: new Tile(2926, 3248, 0), keyId: DS_ID.RED_KEY, drops: 'Giant rat' },
    { what: 'the orange door', stand: new Tile(2930, 3250, 1), door: new Tile(2931, 3250, 1), keyId: DS_ID.ORANGE_KEY, drops: 'Ghost' },
    { what: 'the yellow door', stand: new Tile(2930, 3249, 2), door: new Tile(2931, 3249, 2), keyId: DS_ID.YELLOW_KEY, drops: 'Skeleton' },
    { what: 'the blue door', stand: new Tile(2932, 9643, 0), door: new Tile(2931, 9643, 0), keyId: DS_ID.BLUE_KEY, drops: 'Zombie' },
    { what: 'the magenta door', stand: new Tile(2929, 9651, 0), door: new Tile(2929, 9652, 0), keyId: DS_ID.MAGENTA_KEY, drops: 'Melzar the mad' },
    { what: 'the green door', stand: new Tile(2935, 9655, 0), door: new Tile(2936, 9655, 0), keyId: DS_ID.GREEN_KEY, drops: 'Lesser demon' }
];

export const MAZE_CHEST = new Tile(2935, 9657, 0);
/** The ground-floor ladder that drops straight into the basement. */
export const MAZE_TO_BASEMENT = new Tile(2932, 3240, 0);

const walk = (to: Tile, log: (m: string) => void, radius = 1): Promise<boolean> =>
    Traversal.walkResilient(to, { radius, attempts: 3, timeoutMs: 120_000, log });

/** Locs read blank for about a tick after a level change. */
function sceneLoaded(): Promise<boolean> {
    return Execution.delayUntil(() => Locs.query().within(10).exists(), 6000);
}

export function heldById(id: number): boolean {
    return Inventory.countById(id) > 0;
}

async function takeKey(id: number): Promise<boolean> {
    const drop = GroundItems.query().where(g => g.id === id).within(12).nearest();
    if (!drop || !(await drop.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => heldById(id), 6000);
}

/** Fights the named spawn until its key is in the pack. */
export async function farmKey(npcName: string, keyId: number, log: (m: string) => void): Promise<boolean> {
    if (heldById(keyId)) {
        return true;
    }
    if (await takeKey(keyId)) {
        log(`picked up the key from ${npcName}`);
        return true;
    }
    if (Game.inCombat()) {
        await Execution.delayTicks(2);
        return false;
    }
    const target = Npcs.query().name(npcName).action('Attack').within(14)
        .where(n => !n.inCombat && !n.targetsAnotherPlayer()).nearest();
    if (!target) {
        log(`no ${npcName} in range for its key`);
        return false;
    }
    if (!(await target.interact('Attack'))) {
        return false;
    }
    await Execution.delayUntil(() => Game.inCombat() || !target.valid(), 4000);
    return false;
}

/** Uses the leg's key on its door. The engine eats the key as it unlocks. */
export async function unlockDoor(leg: MazeLeg, log: (m: string) => void): Promise<boolean> {
    const key = Inventory.items().find(i => i.id === leg.keyId);
    if (!key) {
        return false;
    }
    const door = Locs.query().name('Door').where(l => {
        const t = l.tile();
        return t.x === leg.door.x && t.z === leg.door.z && t.level === leg.door.level;
    }).first();
    if (!door) {
        log(`${leg.what} is not in the scene yet`);
        return false;
    }
    log(`unlocking ${leg.what}`);
    if (!(await key.useOn(door))) {
        return false;
    }
    return Execution.delayUntil(() => !heldById(leg.keyId), 10_000);
}

/** True once we are past the door this leg opens. */
function pastLeg(leg: MazeLeg, here: { x: number; z: number; level: number }): boolean {
    const order = MAZE_LEGS.indexOf(leg);
    if (order <= 1) return here.level === 0 && here.x < leg.door.x;
    if (order === 2) return here.level === 1 && here.x > leg.door.x;
    if (order === 3) return here.level === 2 && here.x > leg.door.x;
    return here.z >= 9600 && here.z > leg.door.z;
}

export async function runMazeLeg(leg: MazeLeg, log: (m: string) => void): Promise<boolean> {
    if (!(await walk(leg.stand, log, 1))) {
        return false;
    }
    if (!(await sceneLoaded())) {
        log('the maze scene has not loaded');
        return false;
    }
    if (leg.drops && !heldById(leg.keyId)) {
        return farmKey(leg.drops, leg.keyId, log);
    }
    return unlockDoor(leg, log);
}

export { pastLeg, walk as mazeWalk, sceneLoaded as mazeSceneLoaded };
