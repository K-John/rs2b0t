import { CANT_REACH, GameMessages } from '../../../../chatbox/gameMessages.js';
import { EventSignal } from '../../../../execution/EventSignal.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Npcs, type Npc } from '../../../../npcs/Npcs.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { Modals } from '../../../../ui/widgets/Modals.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { promptLoc } from '../../exec/prompts.js';
import { BARAEK, RELDO, SOA_ID, SOA_LOC, SOA_TILE, STRAVEN_HANDIN, STRAVEN_JOIN } from './areas.js';
import { enterPhoenixInner, leaveHideout } from './hideout.js';
import { SOA_STAGE } from './journal.js';
import { heldId, liveItem } from './state.js';

/** Baraek wants 20; the float covers a death and a second attempt. */
const BRIBE_GP = 20;
const COIN_FLOAT = 500;

const JONNY_NPC = 645;
const KILL_MS = 60_000;
const WALK_MS = 120_000;

const FOUND_HALF = /you find half a shield/i;
const CHEST_EMPTY = /the chest is empty/i;

export async function readBook(log: (m: string) => void): Promise<boolean> {
    const book = liveItem(SOA_ID.BOOK);
    if (!book) {
        log('no book in the pack to read');
        return false;
    }
    if (!(await book.interact('Read'))) {
        return false;
    }
    await Execution.delayTicks(3);
    await Modals.close();
    return true;
}

function jonny(): Npc | null {
    return Npcs.query().where(n => n.id === JONNY_NPC).nearest();
}

/** Jonny is level 2 and drops the report unconditionally; his respawn is 74 ticks, so a missed window just retries. */
export async function killJonny(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(SOA_ID.REPORT) > 0) {
        return true;
    }
    const drop = GroundItems.query().where(g => g.id === SOA_ID.REPORT).within(12).nearest();
    if (drop) {
        const mark = GameMessages.mark();
        if (!(await drop.interact('Take'))) {
            return false;
        }
        await Execution.delayUntil(() => Inventory.countById(SOA_ID.REPORT) > 0 || GameMessages.sawSince(mark, CANT_REACH), 6000);
        return Inventory.countById(SOA_ID.REPORT) > 0;
    }

    const target = jonny();
    if (!target) {
        log('no Jonny the beard in the scene — walking to the Blue Moon Inn');
        return Traversal.walkResilient(SOA_TILE.JONNY, { radius: 3, attempts: 3, timeoutMs: WALK_MS, log });
    }
    Game.setCombatStyle('strength');
    if (!(await target.interact('Attack'))) {
        return false;
    }
    const deadline = performance.now() + KILL_MS;
    while (performance.now() < deadline) {
        await Sustain.run();
        if (EventSignal.pending()) {
            return false;
        }
        if (!jonny()) {
            log('Jonny the beard died');
            // Why: the report lands as a ground drop, and taking it is the next pass's work.
            return true;
        }
        await Execution.delayTicks(1);
    }
    log(`Jonny outlived ${KILL_MS / 1000}s of combat`);
    return false;
}

const chestOpen = () => Locs.query().within(6).where(l => l.id === SOA_LOC.CHEST_OPEN).nearest();

export async function takePhoenixHalf(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(SOA_ID.SHIELD_PHOENIX) > 0) {
        return leaveHideout(log);
    }
    if (!(await enterPhoenixInner(log))) {
        return false;
    }
    // Why: the chest renders as two locs and only the open one carries Search.
    if (!chestOpen() && !(await promptLoc({
        name: 'Chest',
        op: 'Open',
        near: SOA_TILE.CHEST_STAND,
        id: SOA_LOC.CHEST_SHUT,
        within: 6,
        expect: () => chestOpen() !== null
    }, log))) {
        return false;
    }

    const mark = GameMessages.mark();
    await promptLoc({
        name: 'Chest',
        op: 'Search',
        near: SOA_TILE.CHEST_STAND,
        id: SOA_LOC.CHEST_OPEN,
        within: 6,
        expect: () => Inventory.countById(SOA_ID.SHIELD_PHOENIX) > 0 || GameMessages.sawSince(mark, CHEST_EMPTY)
    }, log);
    await Modals.close();

    if (Inventory.countById(SOA_ID.SHIELD_PHOENIX) === 0) {
        if (GameMessages.sawSince(mark, CHEST_EMPTY)) {
            log('the chest is empty — a half is already held or banked, or the quest is complete');
        } else {
            log(`chest search landed nothing: ${GameMessages.since(mark).map(m => m.text).join(' · ')}`);
        }
        await leaveHideout(log);
        return false;
    }
    if (!GameMessages.sawSince(mark, FOUND_HALF)) {
        log('half is held but the find line never printed');
    }
    // Why: the leg has to end on the surface, or the next decide() is stranded in a pocket nothing routes into.
    return leaveHideout(log);
}

export function phoenixStep(snap: QuestSnapshot): QuestStep {
    const stage = snap.progress?.stage ?? snap.stage ?? SOA_STAGE.NOT_STARTED;
    const flags = snap.progress?.flags ?? new Set<string>();

    switch (stage) {
        case SOA_STAGE.NOT_STARTED:
            return { kind: 'talk', stop: RELDO };

        case SOA_STAGE.TOLD_OF_BOOK:
            if (heldId(snap, SOA_ID.BOOK) > 0) {
                return { kind: 'custom', name: 'read The Shield of Arrav', run: readBook };
            }
            // Why: nine other Bookcase locs stand within four tiles, and only this one carries Check.
            return {
                kind: 'pickLoc',
                loc: 'Bookcase',
                op: 'Check',
                item: 'Book',
                anchor: SOA_TILE.BOOKCASE
            };

        case SOA_STAGE.READ_BOOK:
            return { kind: 'talk', stop: RELDO };

        case SOA_STAGE.SENT_TO_BARAEK:
            if (heldId(snap, SOA_ID.COINS) < BRIBE_GP) {
                return { kind: 'withdraw', items: [{ name: 'Coins', qty: COIN_FLOAT, id: SOA_ID.COINS }] };
            }
            return { kind: 'talk', stop: BARAEK };

        case SOA_STAGE.FIND_STRAVEN:
            return { kind: 'talk', stop: STRAVEN_JOIN };

        case SOA_STAGE.KILL_JONNY:
            if (heldId(snap, SOA_ID.REPORT) > 0 || flags.has('report-held')) {
                return { kind: 'talk', stop: STRAVEN_HANDIN };
            }
            return { kind: 'custom', name: 'kill Jonny the beard for the report', run: killJonny };

        case SOA_STAGE.PHOENIX_JOINED:
            if (heldId(snap, SOA_ID.SHIELD_PHOENIX) > 0) {
                return { kind: 'wait', reason: 'phoenix half held — the other half is not this leg' };
            }
            return { kind: 'custom', name: 'search the Phoenix hideout chest', run: takePhoenixHalf };

        default:
            return { kind: 'wait', reason: `phoenix leg has nothing for stage ${stage}` };
    }
}
