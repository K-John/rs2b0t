import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Locs } from '../../../../locs/Locs.js';
import { Reach } from '../../../../walking/Reach.js';
import { Traversal } from '../../../../walking/Traversal.js';
import type Tile from '../../../../../geometry/Tile.js';
import { SOA_LOC, SOA_TILE, inBlackArmUpper, inPhoenixHq, inWeaponStore } from './areas.js';
import { settleScene } from '../../exec/prompts.js';

const CLIMB_MS = 12_000;
const WALK_MS = 120_000;

/** A hideout door opens by teleporting you through, so the far tile is the only proof it worked. */
async function crossDoor(id: number, stand: Tile, far: Tile, log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && here.level === far.level && far.distanceTo(here) <= 3) {
        return true;
    }
    if (!(await Traversal.walkResilient(stand, { radius: 1, attempts: 3, timeoutMs: WALK_MS, log }))) {
        return false;
    }
    const door = Locs.query().action('Open').within(4).where(l => l.id === id).nearest();
    if (!door) {
        log(`no door ${id} within four tiles of (${stand.x},${stand.z})`);
        return false;
    }
    const mark = GameMessages.mark();
    if (!(await door.interact('Open'))) {
        return false;
    }
    const crossed = await Execution.delayUntil(() => {
        const t = Game.tile();
        return t !== null && t.level === far.level && far.distanceTo(t) <= 4;
    }, CLIMB_MS);
    if (!crossed) {
        for (const line of GameMessages.since(mark)) {
            log(`door ${id}: ${line.text}`);
        }
        return false;
    }
    await settleScene();
    return true;
}

/** Climb a loc that changes level, proving the arrival rather than the click. */
export async function climb(
    locId: number,
    op: string,
    stand: Tile,
    arrive: Tile,
    log: (m: string) => void
): Promise<boolean> {
    const here = Game.tile();
    if (here && here.level === arrive.level) {
        return true;
    }
    if (!(await Traversal.walkResilient(stand, { radius: 1, attempts: 3, timeoutMs: WALK_MS, log }))) {
        return false;
    }
    const loc = Locs.query().action(op).within(4).where(l => l.id === locId).nearest();
    if (!loc) {
        log(`no loc ${locId} offering '${op}' near (${stand.x},${stand.z})`);
        return false;
    }
    if (!(await loc.interact(op))) {
        return false;
    }
    const landed = await Execution.delayUntil(() => {
        const t = Game.tile();
        return t !== null && t.level === arrive.level;
    }, CLIMB_MS);
    if (!landed) {
        return false;
    }
    await settleScene();
    return true;
}

export async function enterHideout(log: (m: string) => void): Promise<boolean> {
    if (inPhoenixHq(Game.tile())) {
        return true;
    }
    if (!(await Traversal.walkResilient(SOA_TILE.CELLAR_LADDER, { radius: 1, attempts: 3, timeoutMs: WALK_MS, log }))) {
        return false;
    }
    const status = await Reach.locOp({
        name: 'Ladder',
        op: 'Climb-down',
        near: SOA_TILE.CELLAR_LADDER,
        id: SOA_LOC.CELLAR_LADDER,
        expect: () => inPhoenixHq(Game.tile()),
        log
    });
    if (status !== 'done') {
        return false;
    }
    await settleScene();
    return inPhoenixHq(Game.tile());
}

export async function leaveHideout(log: (m: string) => void): Promise<boolean> {
    if (!inPhoenixHq(Game.tile())) {
        return true;
    }
    // Why: the chest sits behind the gang door, which is the pocket's only crossing in either direction.
    if (!(await crossDoor(SOA_LOC.PHOENIX_DOOR, SOA_TILE.PHOENIX_DOOR_INNER, SOA_TILE.PHOENIX_DOOR, log))) {
        return false;
    }
    const status = await Reach.locOp({
        name: 'Ladder',
        op: 'Climb-up',
        near: SOA_TILE.HQ_LADDER,
        id: SOA_LOC.HQ_LADDER,
        expect: () => !inPhoenixHq(Game.tile()),
        log
    });
    if (status !== 'done') {
        return false;
    }
    await settleScene();
    return !inPhoenixHq(Game.tile());
}

/** Through the gang door into the half of the hideout the chest is in. */
export async function enterPhoenixInner(log: (m: string) => void): Promise<boolean> {
    if (!(await enterHideout(log))) {
        return false;
    }
    return crossDoor(SOA_LOC.PHOENIX_DOOR, SOA_TILE.PHOENIX_DOOR, SOA_TILE.PHOENIX_DOOR_INNER, log);
}

export async function enterBlackArmUpper(log: (m: string) => void): Promise<boolean> {
    if (inBlackArmUpper(Game.tile())) {
        return true;
    }
    if (!(await crossDoor(SOA_LOC.BLACKARM_DOOR, SOA_TILE.BLACKARM_DOOR, SOA_TILE.BLACKARM_DOOR, log))) {
        return false;
    }
    return climb(SOA_LOC.BLACKARM_STAIRS, 'Climb-up', SOA_TILE.BLACKARM_STAIRS, SOA_TILE.BLACKARM_STAIRS_TOP, log);
}

export async function leaveBlackArmUpper(log: (m: string) => void): Promise<boolean> {
    if (!inBlackArmUpper(Game.tile())) {
        return true;
    }
    return climb(SOA_LOC.BLACKARM_STAIRS_TOP, 'Climb-down', SOA_TILE.BLACKARM_STAIRS_TOP, SOA_TILE.BLACKARM_STAIRS, log);
}

export async function leaveWeaponStore(log: (m: string) => void): Promise<boolean> {
    if (!inWeaponStore(Game.tile())) {
        return true;
    }
    return climb(SOA_LOC.STORE_LADDER_TOP, 'Climb-down', SOA_TILE.STORE_LADDER_TOP, SOA_TILE.STORE_LADDER, log);
}
