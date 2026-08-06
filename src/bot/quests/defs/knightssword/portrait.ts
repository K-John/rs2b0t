import type { WorldTile } from '../../../adapter/ClientAdapter.js';
import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import Tile from '../../../api/Tile.js';
import { Traversal } from '../../../api/Traversal.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import { locNear, settleScene } from '../../exec/prompts.js';
import { KS_ID, KS_TILE } from './areas.js';

/**
 * `~vyvin_distracted` is `npc_find(coord, sir_vyvin, 1, 0)` against the player's
 * own coord, so the guard is proximity rather than a timer — and Vyvin spawns
 * one diagonal tile from the cupboard he is guarding.
 */
const VYVIN_LEASH = 1;

const ATTEMPTS = 40;

export function vyvinTooClose(here: WorldTile | null, vyvin: WorldTile | null): boolean {
    if (!here || !vyvin) {
        return false;
    }
    return Tile.from(here).distanceTo(vyvin) <= VYVIN_LEASH;
}

function vyvinTile(): WorldTile | null {
    return Npcs.query().name('Sir Vyvin').nearest()?.tile() ?? null;
}

/**
 * `vyvincupboardshut` is `forceapproach=east`, so the stand is on its north
 * side. Open turns it into `vyvincupboardopen`, which is the one that Searches.
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
    for (let i = 0; i < ATTEMPTS; i++) {
        if (Inventory.countById(KS_ID.PORTRAIT) > 0) {
            return true;
        }
        if (vyvinTooClose(Game.tile(), vyvinTile())) {
            await Execution.delayTicks(2);
            continue;
        }
        const shut = locNear('Cupboard', 'Open', 4);
        if (shut) {
            await shut.interact('Open');
            await Execution.delayTicks(2);
            continue;
        }
        const open = locNear('Cupboard', 'Search', 4);
        if (!open) {
            log('no Cupboard in reach of the stand');
            await Execution.delayTicks(2);
            continue;
        }
        await open.interact('Search');
        if (await Execution.delayUntil(() => Inventory.countById(KS_ID.PORTRAIT) > 0, 5000)) {
            return true;
        }
        log('Sir Vyvin was watching — waiting for him to wander off');
        await Execution.delayTicks(3);
    }
    log('never got a clear look at the cupboard');
    return false;
}
