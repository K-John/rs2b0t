import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Reach } from '../../../../walking/Reach.js';
import { Traversal } from '../../../../walking/Traversal.js';
import type Tile from '../../../../../geometry/Tile.js';
import { driveDialog, gotoNpc, talkThrough, type NpcStop } from '../../exec/primitives.js';
import { settleScene } from '../../exec/prompts.js';
import {
    HOLGART_ISLAND,
    HOLGART_LAND,
    HOLGART_PLATFORM,
    KENT,
    SS_LOC,
    SS_OBJ,
    SS_TILE,
    onIsland,
    onPlatform
} from './areas.js';

export type Region = 'platform' | 'island' | 'mainland';

const WALK = { radius: 1, attempts: 3, timeoutMs: 120_000 } as const;

/** Firemaking 70 lands the rub roughly three times in four, so a single attempt is not a result. */
const RUB_ATTEMPTS = 12;

export function regionOf(tile: { x: number; z: number } | null | undefined): Region {
    if (onPlatform(tile)) {
        return 'platform';
    }
    return onIsland(tile) ? 'island' : 'mainland';
}

function heldId(id: number): number {
    return Inventory.items().filter(item => item.id === id).reduce((sum, item) => sum + item.count, 0);
}

// Why: `slugladder` and `laddertop` both render "Ladder" and sit on the same tile one deck apart, so the op is what separates them.

/** Move between the platform's two decks. */
export async function climbTo(level: 0 | 1, log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (!here) {
        return false;
    }
    if (here.level === level) {
        return true;
    }
    const stand = level === 1 ? SS_TILE.LADDER_FOOT : SS_TILE.LADDER_TOP;
    const op = level === 1 ? 'Climb-up' : 'Climb-down';
    if (!(await Traversal.walkResilient(stand, { ...WALK, log }))) {
        return false;
    }
    const ladder = Locs.query().name('Ladder').action(op).within(4).nearest();
    if (!ladder) {
        log(`seaslug: no Ladder offering '${op}' at (${stand.x},${stand.z},${stand.level})`);
        return false;
    }
    const mark = GameMessages.mark();
    if (!(await ladder.interact(op))) {
        return false;
    }
    const climbed = await Execution.delayUntil(() => Game.tile()?.level === level, 12_000);
    if (!climbed && GameMessages.sawSince(mark, /fishing rod/i)) {
        log('seaslug: the fishermen turned us back — the climb wants a lit torch from stage 6 on');
        return false;
    }
    if (climbed) {
        await settleScene();
    }
    return climbed;
}

async function boardFrom(region: Region, log: (m: string) => void): Promise<boolean> {
    if (region === 'platform' && !(await climbTo(0, log))) {
        return false;
    }
    const stop: NpcStop = region === 'island' ? HOLGART_ISLAND : region === 'platform' ? HOLGART_PLATFORM : HOLGART_LAND;
    if (!(await gotoNpc(stop, [], log))) {
        return false;
    }
    if (!(await talkThrough(stop.npc, stop.prefer, log))) {
        return false;
    }
    return Execution.delayUntil(() => regionOf(Game.tile()) !== region, 20_000);
}

// Why: no boat runs platform → island once Kent has been found, and none runs island → Ardougne at all, so a crossing can need the shore as a staging post.

/** Ride Holgart's row boat until the bot stands in `target`. */
export async function sailTo(target: Region, log: (m: string) => void): Promise<boolean> {
    for (let hop = 0; hop < 3; hop++) {
        const here = regionOf(Game.tile());
        if (here === target) {
            return true;
        }
        log(`seaslug: boarding at the ${here} bound for the ${target}`);
        if (!(await boardFrom(here, log))) {
            return false;
        }
    }
    return regionOf(Game.tile()) === target;
}

// Why: the crates are inside a walled room whose only way in is a shut door, so the walk has to open it — `Reach` does that and a bare `walkResilient` plus click does not.
async function pickLoc(
    id: number,
    op: string,
    stand: Tile,
    what: string,
    expect: () => boolean,
    log: (m: string) => void
): Promise<boolean> {
    if (!(await climbTo(1, log))) {
        return false;
    }
    const status = await Reach.locOp({ name: what, op, near: stand, within: 6, id, expect, log });
    if (status === 'done') {
        return true;
    }
    // Why: `retry` is the first pass closing in on a loc that was out of query range, not a leg that failed.
    const note = status === 'retry' ? 'still closing in' : 'no route';
    log(`seaslug: '${op}' on ${what} (loc ${id}) from (${stand.x},${stand.z},${stand.level}) — ${note}`);
    return false;
}

async function shoutAcross(log: (m: string) => void): Promise<boolean> {
    const spoke = await pickLoc(
        SS_LOC.CRATES,
        'Shout-across',
        SS_TILE.CRATES_STAND,
        'Crates',
        () => ChatDialog.isOpen() || ChatDialog.canContinue(),
        log
    );
    if (!spoke) {
        return false;
    }
    return driveDialog([], log);
}

export async function callKennith(log: (m: string) => void): Promise<boolean> {
    if (!(await sailTo('platform', log))) {
        return false;
    }
    return shoutAcross(log);
}

// Why: kicking a panel that is already open only prints "nothing interesting happens", so the two halves run as one leg and the pair covers both of the stages the journal cannot separate.
export async function openPanelAndCall(log: (m: string) => void): Promise<boolean> {
    if (!(await sailTo('platform', log))) {
        return false;
    }
    const mark = GameMessages.mark();
    const kicked = await pickLoc(
        SS_LOC.LOOSE_PANEL,
        'Kick',
        SS_TILE.PANEL_STAND,
        'Loose panel',
        () => GameMessages.sawSince(mark, /you kick the loose panel/i),
        log
    );
    if (!kicked) {
        return false;
    }
    await Execution.delayUntil(() => GameMessages.sawSince(mark, /crumbles away|nothing interesting happens/i), 12_000);
    return shoutAcross(log);
}

export async function rotateCrane(log: (m: string) => void): Promise<boolean> {
    if (!(await sailTo('platform', log))) {
        return false;
    }
    const mark = GameMessages.mark();
    const turned = await pickLoc(
        SS_LOC.CRANE,
        'Rotate',
        SS_TILE.CRANE_STAND,
        'Crane',
        () => GameMessages.sawSince(mark, /rotate the crane around|get closer to use that/i),
        log
    );
    if (!turned) {
        return false;
    }
    const lowered = await Execution.delayUntil(() => GameMessages.sawSince(mark, /lower kennith to the row boat/i), 25_000);
    if (!lowered && GameMessages.sawSince(mark, /get closer to use that/i)) {
        log(`seaslug: the crane refused from (${Game.tile()?.x},${Game.tile()?.z}) — its stand has to be north of the 4x4 footprint`);
    }
    return lowered;
}

export async function findKent(log: (m: string) => void): Promise<boolean> {
    if (!(await sailTo('island', log))) {
        return false;
    }
    if (!(await gotoNpc(KENT, [], log))) {
        return false;
    }
    return talkThrough(KENT.npc, KENT.prefer, log);
}

// Why: the dry sticks survive a failed rub, so the only cost of a miss is the tick it took.
export async function rubSticks(log: (m: string) => void): Promise<boolean> {
    for (let attempt = 0; attempt < RUB_ATTEMPTS; attempt++) {
        const sticks = Inventory.items().find(item => item.id === SS_OBJ.DRY_STICKS);
        if (!sticks) {
            log('seaslug: no Dry sticks in the pack to rub');
            return false;
        }
        const mark = GameMessages.mark();
        if (!(await sticks.interact('Rub-together'))) {
            return false;
        }
        const answered = await Execution.delayUntil(
            () => GameMessages.sawSince(mark, /catch alight|smoke momentarily|firemaking level of 30/i),
            8000
        );
        if (GameMessages.sawSince(mark, /catch alight/i)) {
            return true;
        }
        if (GameMessages.sawSince(mark, /firemaking level of 30/i)) {
            log('seaslug: Firemaking is under 30 — the sticks will never catch');
            return false;
        }
        if (!answered) {
            log('seaslug: the rub produced no message at all');
            return false;
        }
    }
    log(`seaslug: ${RUB_ATTEMPTS} rubs and the sticks never caught`);
    return heldId(SS_OBJ.TORCH_LIT) > 0;
}
