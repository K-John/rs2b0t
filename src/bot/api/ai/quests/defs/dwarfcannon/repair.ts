import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Locs } from '../../../../locs/Locs.js';
import { Traversal } from '../../../../walking/Traversal.js';
import type Tile from '../../../../../geometry/Tile.js';
import { driveUntil, settleScene } from '../../exec/prompts.js';
import { RAILINGS } from './areas.js';

const WALK = { attempts: 3, timeoutMs: 180_000 } as const;

export async function walkTo(tile: Tile, radius: number, log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && here.level === tile.level && tile.distanceTo(here) <= radius) {
        return true;
    }
    return Traversal.walkResilient(tile, { ...WALK, radius, log });
}

// Why: nothing in the scene tells a fixed railing from a broken one — the content sets a `%mcannonmulti` bit and leaves the loc alone — so the message is the only oracle.

const RAILING_SETTLED = /already fixed this railing|replace the railing with no problems/i;

/** Repair one railing; true when it is fixed or was already. */
async function fixOne(entry: { id: number; at: Tile }, log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(entry.at, 2, log))) {
        return false;
    }
    await settleScene();
    const railing = Locs.query().where(l => l.id === entry.id).nearest();
    if (!railing) {
        log(`no railing loc ${entry.id} at (${entry.at.x},${entry.at.z})`);
        return false;
    }
    const mark = GameMessages.mark();
    if (!(await railing.interact('Inspect'))) {
        return false;
    }
    return driveUntil(
        () => GameMessages.sawSince(mark, RAILING_SETTLED),
        ['Try to replace the railing.'],
        log,
        20_000
    );
}

/**
 * Walk the six broken railings in order and replace each.
 * @see Server content railings.rs2
 */
export async function fixRailings(log: (m: string) => void): Promise<boolean> {
    for (const entry of RAILINGS) {
        if (!(await fixOne(entry, log))) {
            log(`railing ${entry.id} did not take — moving on and letting the journal decide`);
        }
        await Execution.delayTicks(1);
    }
    return true;
}
