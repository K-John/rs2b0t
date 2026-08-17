import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Locs } from '../../../../locs/Locs.js';
import { Navigator } from '../../../../../event/webwalk/Navigator.js';
import { Traversal } from '../../../../walking/Traversal.js';
import Tile from '../../../../../geometry/Tile.js';
import { settleScene } from '../../exec/prompts.js';
import { UP_LOC } from './areas.js';
import { verdictSince } from './verdict.js';

// Why: the way from the mud pocket to the loose railings is four crossings and it never varies. A search over it offered five ledge locs whose stand is in another pocket, two telejumps twenty-one tiles the wrong way, seven walled stone bridges and ten cages in another cell — and reported a cage thirty tiles off as crossed. Spelled out, there is nothing to choose.

/** One crossing of the run: walk the stand, send the op at THAT loc, arrive on `lands`. */
interface Crossing {
    what: string;
    /** Stepping stones walked before the stand, where one walk will not carry it. */
    via?: readonly Tile[];
    /** The tile the op is sent from. */
    stand: Tile;
    /** The loc's OWN tile. A seam that is a row of identical locs cannot be picked by `nearest()`. */
    at: Tile;
    loc: number;
    op: string;
    /** Where the crossing puts the character — and the guard that says it has already happened. */
    lands: Tile;
}

// Why: `at` is carried because the ledge is six locs in a column and the two nearest the stand are BOTH chebyshev one from it — `nearest()` picks whichever, and the wrong one answers "I can't reach that!" without the script ever running.
export const TO_RAILINGS: readonly Crossing[] = [
    {
        what: 'the ledge south out of the mud pocket',
        stand: new Tile(2375, 9644, 0), at: new Tile(2374, 9644, 0),
        loc: UP_LOC.LEDGE, op: 'Cross', lands: new Tile(2374, 9638, 0)
    },
    {
        what: 'the first thieving railing',
        stand: new Tile(2380, 9619, 0), at: new Tile(2380, 9619, 0),
        loc: UP_LOC.RAILINGS_HARD, op: 'Pick-lock', lands: new Tile(2381, 9619, 0)
    },
    {
        what: 'the second thieving railing',
        stand: new Tile(2403, 9620, 0), at: new Tile(2404, 9620, 0),
        loc: UP_LOC.RAILINGS_HARD, op: 'Pick-lock', lands: new Tile(2404, 9620, 0)
    },
    {
        what: 'the pipe into the loose railings',
        via: [new Tile(2420, 9617, 0)],
        stand: new Tile(2419, 9605, 0), at: new Tile(2417, 9605, 0),
        loc: UP_LOC.PIPE_AREA2, op: 'Squeeze-through', lands: new Tile(2412, 9605, 0)
    }
];

/** How long a crossing gets to land once its script has spoken. */
const CROSS_MS = 12_000;
/** What a silent op gets — three ticks covers a teleport end to end. */
const QUIET_MS = 1_800;

async function canWalkTo(to: Tile): Promise<boolean> {
    const me = Game.tile();
    return me !== null && (await Navigator.findPath(me, to, { policy: { useTeleports: false } })).ok;
}

async function take(step: Crossing, log: (m: string) => void): Promise<boolean> {
    for (const stone of step.via ?? []) {
        await Traversal.walkResilient(stone, { radius: 2, attempts: 1, timeoutMs: 30_000 });
    }
    if (!(await Traversal.walkResilient(step.stand, { radius: 0, attempts: 2, timeoutMs: 30_000 }))) {
        log(`pass: could not stand on (${step.stand.x},${step.stand.z}) for ${step.what}`);
        return false;
    }
    // Why: by its own tile, not by `nearest()`. Both (2374,9644) and (2374,9643) are one tile from the
    // stand, and only the first of them can be crossed from there.
    const loc = Locs.query()
        .where(l => l.id === step.loc && l.tile().x === step.at.x && l.tile().z === step.at.z)
        .action(step.op)
        .nearest();
    if (!loc) {
        log(`pass: ${step.loc} is not at (${step.at.x},${step.at.z}) from (${Game.tile()?.x},${Game.tile()?.z})`);
        return false;
    }
    const mark = GameMessages.mark();
    if (!(await loc.interact(step.op))) {
        log(`pass: '${step.op}' would not send at ${step.what}`);
        return false;
    }
    await Execution.delayUntil(() => verdictSince(mark) !== null, QUIET_MS);
    const said = verdictSince(mark);
    if (said === 'refused') {
        log(`pass: ${step.what} refused — ${GameMessages.since(mark).map(m => m.text).slice(-2).join(' / ')}`);
        return false;
    }
    await Execution.delayUntil(() => {
        const t = Game.tile();
        return t !== null && t.x === step.lands.x && t.z === step.lands.z;
    }, said === 'crossing' ? CROSS_MS : QUIET_MS);
    await settleScene();
    const now = Game.tile();
    const done = await canWalkTo(step.lands);
    log(`pass: ${step.what} → (${now?.x},${now?.z})${done ? '' : ' — but it did not land'}`
        + (said === null ? '' : ` [${said}]`));
    return done;
}

/**
 * Walk the mud pocket down to the loose railings, one named crossing at a time.
 * Why: a step whose landing the character can already walk to has happened, so the run resumes from
 * wherever it is rather than tracking an index — the four crossings are one-way and in one order.
 */
export async function reachLooseRailings(log: (m: string) => void): Promise<boolean> {
    for (let round = 0; round < 3; round++) {
        let outstanding = 0;
        for (const step of TO_RAILINGS) {
            if (await canWalkTo(step.lands)) {
                continue;
            }
            outstanding++;
            if (!(await take(step, log))) {
                break;
            }
        }
        if (outstanding === 0) {
            return true;
        }
    }
    const last = TO_RAILINGS[TO_RAILINGS.length - 1]!;
    return canWalkTo(last.lands);
}
