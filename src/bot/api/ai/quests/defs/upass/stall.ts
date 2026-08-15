import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Locs } from '../../../../locs/Locs.js';
import type { Loc } from '../../../../model/Loc.js';
import { UPASS } from './journal.js';

// Why: `Player.busy()` is `delayed || containsModalInterface()`, and a NORMAL `[timer,…]` only runs under
// `canAccess()`, so an open journal suspends every timer trap in the pass — the spiked grid
// (`upass_grid_traps`) and the spear/spring traps (`upass_trap`). `[softtimer,…]` is unaffected.
// Why: the walk has to be an OP-click. `MoveClickHandler` calls `clearPendingAction()` — which closes the
// modal — for every move except `opClick`, so a plain walk click cancels the stall on the first step.

const POLL_TICKS = 2;

function tileNow(): { x: number; z: number; level: number } | null {
    return reader.worldTile();
}

function modalOpen(): boolean {
    return reader.modals().main !== -1;
}

function journalComId(): number {
    return reader.questStatuses().find(q => q.name.toLowerCase() === UPASS.toLowerCase())?.comId ?? -1;
}

/** Send the journal button and return — the caller owns the timing. */
function pressJournal(): boolean {
    const comId = journalComId();
    return comId !== -1 && actions.ifButton(comId);
}

export async function releaseJournal(): Promise<void> {
    if (modalOpen()) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
}

export interface StalledWalk {
    /** The loc to op-click; walking to it is what carries the player across the traps. */
    find: () => Loc | null;
    op: string;
    /** True once the player is clear of the trapped ground. */
    arrived: () => boolean;
    /** True once the attempt is lost — polled so a fall does not sit out the whole timeout. */
    abort?: () => boolean;
    log: (m: string) => void;
    timeoutMs?: number;
}

/**
 * Walk across timer-trapped ground by op-clicking a loc on the far side and holding
 * the quest journal open for the whole walk.
 * Leaves the modal closed and does not perform the op — the caller re-clicks on arrival.
 */
export async function stalledWalk(opts: StalledWalk): Promise<boolean> {
    const { find, op, arrived, log } = opts;
    const timeoutMs = opts.timeoutMs ?? 30_000;
    if (arrived()) {
        return true;
    }
    const target = find();
    if (!target) {
        log('stall: no target loc on the far side to walk to');
        return false;
    }
    const from = tileNow();
    if (!(await target.interact(op))) {
        log(`stall: '${op}' would not send to ${target.name ?? target.id}`);
        return false;
    }
    // Why: the journal must land in a tick of its own. `moveClickRequest` is settled after a whole tick is
    // decoded — an op-click alone leaves it false and the walk survives an open modal, while a modal opened
    // in that same tick latches it true and `updateMovement` then freezes at the first 8x8 zone boundary,
    // because the engine queue it waits on cannot drain while busy either. A bare tick delay does not prove
    // the split (the click may not be decoded yet), so the first step is what the press waits on — which is
    // why the caller has to stage far enough back that the player is still on safe ground by then.
    const moved = await Execution.delayUntilTicks(() => {
        const now = tileNow();
        return now !== null && from !== null && (now.x !== from.x || now.z !== from.z);
    }, 8);
    if (!moved) {
        log('stall: the op-click never moved the player — nothing to stall');
        return false;
    }
    if (!pressJournal()) {
        log('stall: the quest journal button never sent — traps are live');
        return false;
    }
    try {
        const deadline = performance.now() + timeoutMs;
        let opened = false;
        while (performance.now() < deadline) {
            if (arrived()) {
                return true;
            }
            if (opts.abort?.() === true) {
                const at = tileNow();
                log(`stall: attempt lost at (${at?.x},${at?.z})`);
                return false;
            }
            if (modalOpen()) {
                opened = true;
            } else if (opened) {
                // Why: anything the server pushes closes the modal and re-arms the traps, so it goes straight back up.
                pressJournal();
            }
            await Execution.delayTicks(POLL_TICKS);
        }
        const here = tileNow();
        log(`stall: timed out at (${here?.x},${here?.z}) — never reached the far side`);
        return false;
    } finally {
        await releaseJournal();
    }
}

/** `stalledWalk` against a loc looked up by id. */
export function stalledWalkToLoc(
    locId: number,
    op: string,
    arrived: () => boolean,
    log: (m: string) => void,
    within = 24
): Promise<boolean> {
    return stalledWalk({
        find: () => Locs.query().where(loc => loc.id === locId).action(op).within(within).nearest(),
        op,
        arrived,
        log
    });
}

export interface StalledCrossing extends StalledWalk {
    /** Put the player back on the approach tile after a failed attempt; false if it cannot. */
    recover: () => Promise<boolean>;
    attempts?: number;
}

// Why: whether the modal beats the player onto the trapped ground is a one-tick race — the press cannot go
// out until the op-click has been seen to move the player, or it shares that tick and the walk freezes at
// the first zone boundary instead. Where the approach is short there is no margin to win the race every
// time, so a lost attempt is treated as ordinary cost: recover to the lip and go again.
export async function stalledCrossing(opts: StalledCrossing): Promise<boolean> {
    const attempts = opts.attempts ?? 4;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        if (await stalledWalk(opts)) {
            return true;
        }
        if (opts.arrived()) {
            return true;
        }
        if (attempt === attempts) {
            break;
        }
        opts.log(`stall: attempt ${attempt} did not carry the crossing — recovering`);
        if (!(await opts.recover())) {
            opts.log('stall: could not get back to the approach tile');
            return false;
        }
    }
    return opts.arrived();
}
