import type { WorldTile } from '../../../adapter/ClientAdapter.js';
import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import Tile from '../../../api/Tile.js';
import { Traversal } from '../../../api/Traversal.js';
import { ChatDialog } from '../../../api/hud/ChatDialog.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import { locNear, settleScene } from '../../exec/prompts.js';
import { KS_ID, KS_TILE } from './areas.js';

/**
 * `~vyvin_distracted` is `npc_find(coord, sir_vyvin, 1, 0)` against the player's
 * own coord, so the guard is proximity rather than a timer.
 */
const VYVIN_LEASH = 1;

const ATTEMPTS = 60;

/**
 * How many passes may be skipped on Vyvin's position alone. He has
 * `wanderrange=8` in a room barely wider than that, so he is adjacent most of
 * the time — treating the check as a blocker spins until the watchdog parks.
 * It is a hint that saves a wasted click, never a gate.
 */
const MAX_SKIPS = 4;

export function vyvinTooClose(here: WorldTile | null, vyvin: WorldTile | null): boolean {
    if (!here || !vyvin) {
        return false;
    }
    return Tile.from(here).distanceTo(vyvin) <= VYVIN_LEASH;
}

/** Bounded by construction: after `MAX_SKIPS` passes the search happens regardless. */
export function shouldWaitOut(skips: number, here: WorldTile | null, vyvin: WorldTile | null): boolean {
    return skips < MAX_SKIPS && vyvinTooClose(here, vyvin);
}

function vyvinTile(): WorldTile | null {
    return Npcs.query().name('Sir Vyvin').nearest()?.tile() ?? null;
}

/** A caught search leaves a mesbox up; it must go before the next click. */
async function dismissRefusal(): Promise<void> {
    for (let i = 0; i < 4 && ChatDialog.canContinue(); i++) {
        await ChatDialog.continue();
        await Execution.delayTicks(1);
    }
}

/**
 * `vyvincupboardshut` is `forceapproach=east`, so the stand is west of it. Open
 * turns it into `vyvincupboardopen`, which is the one that Searches.
 *
 * The oracle is whether the portrait lands, not whether Vyvin looks far enough
 * away: his position is read a tick before the click and re-evaluated
 * server-side after the walk, so the only honest test is to search and see.
 */
export async function fetchPortrait(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(KS_ID.PORTRAIT) > 0) {
        return true;
    }
    if (!(await Traversal.walkResilient(KS_TILE.VYVIN_ROOM, { radius: 1, attempts: 4, timeoutMs: 300_000, log }))) {
        log("could not reach Sir Vyvin's room");
        return false;
    }
    await settleScene();
    let skips = 0;
    for (let i = 0; i < ATTEMPTS; i++) {
        if (Inventory.countById(KS_ID.PORTRAIT) > 0) {
            return true;
        }
        await dismissRefusal();
        const shut = locNear('Cupboard', 'Open', 5);
        if (shut) {
            await shut.interact('Open');
            await Execution.delayTicks(2);
            continue;
        }
        const open = locNear('Cupboard', 'Search', 5);
        if (!open) {
            log('no Cupboard in reach of the stand');
            await Execution.delayTicks(2);
            continue;
        }
        if (shouldWaitOut(skips, Game.tile(), vyvinTile())) {
            skips++;
            await Execution.delayTicks(2);
            continue;
        }
        skips = 0;
        await open.interact('Search');
        if (await Execution.delayUntil(() => Inventory.countById(KS_ID.PORTRAIT) > 0, 5000)) {
            return true;
        }
        log('Sir Vyvin was watching — waiting for him to move off');
        await Execution.delayTicks(4);
    }
    log('never got a clear look at the cupboard');
    return false;
}
