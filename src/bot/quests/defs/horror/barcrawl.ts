import { actions, reader } from '../../../adapter/ClientAdapter.js';
import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { Reach } from '../../../api/Reach.js';
import { Traversal } from '../../../api/Traversal.js';
import { ChatDialog } from '../../../api/hud/ChatDialog.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { Npcs, type Npc } from '../../../api/queries/Npcs.js';
import { GameMessages } from '../../../events/gameMessages.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { driveUntil } from '../../exec/prompts.js';
import { BARBARIAN_GUARD_ID, BARS, HD_ID, HD_ITEM, OUTPOST_GUARD, type Bar } from './areas.js';

/**
 * Alfred Grimhand's Barcrawl — ten bars, and the only way past the Barbarian
 * Outpost gate to Larrissa's cousin Gunnjorn.
 *
 * `%barcrawl` is `scope=perm` with no transmit, so which bars are signed is not
 * on the wire. The card's Read op is: it renders one green/red line per bar
 * into the scroll modal, which is the same shape as a quest journal and read
 * the same way.
 */

/** Every drink, plus slack for the card and the gate. */
export const BARCRAWL_GP = BARS.reduce((sum, bar) => sum + bar.gp, 0) + 200;

/** The card's own refusal once all ten lines are green. */
const TOO_DRUNK = /too drunk to be able to read/i;

export interface BarcrawlProgress {
    /** Bars whose card line is still red. */
    remaining: readonly Bar[];
    /** True once every line is green. */
    done: boolean;
}

function normalise(lines: readonly string[]): string {
    return lines.join(' ').replace(/@[a-z0-9]{3}@/gi, ' ').replace(/[|\s]+/g, ' ').trim().toLowerCase();
}

/**
 * Which bars are still red. "Completed!" and "Not Completed..." both contain
 * the happy word, so each line is matched by its negation instead.
 */
export function parseCard(lines: readonly string[]): BarcrawlProgress | null {
    const text = normalise(lines);
    if (!text.includes('barcrawl')) {
        return null;
    }
    const remaining = BARS.filter(bar => {
        const at = text.indexOf(bar.line);
        return at === -1 || text.slice(at, at + bar.line.length + 24).includes('not completed');
    });
    return { remaining, done: remaining.length === 0 };
}

/**
 * Read the card. The scroll is a **main** modal built with `if_settext`, so no
 * dialogue driver can see it and every other modal read comes back empty while
 * it is up — it has to be closed again, exactly like a quest journal.
 */
export async function readCard(): Promise<BarcrawlProgress | null> {
    const card = Inventory.first(HD_ITEM.BARCRAWL_CARD);
    if (!card) {
        return null;
    }
    const before = reader.modals().main;
    const mark = GameMessages.mark();
    if (!(await card.interact('Read'))) {
        return null;
    }
    const opened = await Execution.delayUntil(() => {
        const main = reader.modals().main;
        return main !== -1 && main !== before;
    }, 5000);
    if (!opened) {
        // `opheld1,barcrawl_card` stops opening the scroll once every bar is
        // signed — "You are too drunk to be able to read the barcrawl card" is
        // the *finished* state, not a failed read, and taking it for a failure
        // leaves the tour looping at the tenth bar forever.
        return GameMessages.sawSince(mark, TOO_DRUNK) ? { remaining: [], done: true } : null;
    }
    const parsed = parseCard(reader.mainModalTexts());
    actions.closeModal();
    return parsed;
}

/** Every bartender in the game renders "Bartender", so they are found by id. */
const byId = (id: number): Npc | null => Npcs.query().where(n => n.id === id).nearest();

/** Barcrawl-first, so an ale menu never wins the pick. */
const BARCRAWL_PREFER = ['Alfred Grimhand', 'Barcrawl', 'Yes'];

/**
 * One bar. `[opnpcu,<bartender>]` takes the card straight to the barcrawl
 * branch, which skips the four-option menu the talk op puts up and behaves the
 * same at every one of the ten.
 */
async function drinkAt(bar: Bar, log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(bar.tile, { radius: 3, attempts: 3, timeoutMs: 300_000, log }))) {
        log(`could not reach the ${bar.line} bartender`);
        return false;
    }
    await Execution.delayTicks(2);
    const npc = byId(bar.id);
    const card = Inventory.first(HD_ITEM.BARCRAWL_CARD);
    if (!npc || !card) {
        log(`no bartender ${bar.id} or no card at the ${bar.line}`);
        return false;
    }
    const beforeCoins = Inventory.count(HD_ITEM.COINS);
    if (!(await card.useOn(npc))) {
        return false;
    }
    // Nine of the ten go straight into the drink; the Rising Sun's barmaid
    // still offers her ale list first, so the barcrawl line has to be in the
    // preference list or her menu sits unanswered and the card never signs.
    //
    // The coin deduction is what says the drink was actually bought — the card
    // only turns green several `p_delay`s later, so the read is retried rather
    // than taken once.
    await driveUntil(() => Inventory.count(HD_ITEM.COINS) < beforeCoins, BARCRAWL_PREFER, log, 20_000);
    for (let attempt = 0; attempt < 3; attempt++) {
        await Execution.delayTicks(5);
        const after = await readCard();
        if (after !== null && !after.remaining.some(b => b.line === bar.line)) {
            log(`signed at the ${bar.line}`);
            return true;
        }
    }
    log(`the ${bar.line} did not sign the card`);
    return false;
}

/** Consecutive bars that answer nothing before the tour is called broken. */
const BARCRAWL_GIVE_UP = 3;

/**
 * Drive the whole crawl. Returns once the card is fully signed; the guard still
 * has to be told, which `handInBarcrawl` does.
 */
export async function runBarcrawl(log: (m: string) => void): Promise<boolean> {
    let missed = 0;
    for (let pass = 0; pass < BARS.length * 2; pass++) {
        const progress = await readCard();
        if (!progress) {
            log('no barcrawl card in the pack to read');
            return false;
        }
        if (progress.done) {
            log('barcrawl card fully signed');
            return true;
        }
        // Nearest-first, so the tour is a rough loop rather than the list order.
        const here = Game.tile();
        const next = here
            ? [...progress.remaining].sort((a, b) => a.tile.distanceTo(here) - b.tile.distanceTo(here))[0]
            : progress.remaining[0];
        log(`barcrawl: ${progress.remaining.length} bars left, heading for the ${next.line}`);
        // One bar that will not answer is not a reason to walk the whole tour
        // again from the top — the next pass re-reads the card and re-sorts, so
        // the loop moves on and comes back to it.
        missed = (await drinkAt(next, log)) ? 0 : missed + 1;
        if (missed >= BARCRAWL_GIVE_UP) {
            log(`${missed} bars in a row refused the card — stopping`);
            return false;
        }
    }
    return (await readCard())?.done ?? false;
}

/**
 * Give the signed card to the gate guard. `outpost_guard_progress` consumes it
 * and sets `%barcrawl` to complete, which is what actually opens the gate.
 */
export async function handInBarcrawl(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(OUTPOST_GUARD.anchor, { radius: 4, attempts: 3, timeoutMs: 300_000, log }))) {
        return false;
    }
    await Execution.delayTicks(2);
    if (!byId(BARBARIAN_GUARD_ID)) {
        log('no barbarian guard at the outpost gate');
        return false;
    }
    const status = await Reach.entityOp({
        find: () => byId(BARBARIAN_GUARD_ID),
        op: 'Talk-to',
        expect: () => ChatDialog.isOpen() || ChatDialog.canContinue(),
        what: 'Barbarian guard',
        log
    });
    if (status !== 'done') {
        return false;
    }
    await driveUntil(() => Inventory.count(HD_ITEM.BARCRAWL_CARD) === 0, [], log, 20_000);
    return Inventory.count(HD_ITEM.BARCRAWL_CARD) === 0;
}

export type GuardVerdict = 'complete' | 'issued' | 'retry';

/** `outpost_guard_talk`'s greeting for `%barcrawl = ^barcrawl_complete`. */
const GATE_IS_OPEN = /ello friend/i;

/**
 * Ask the gate guard where the crawl stands, which is the only oracle there is:
 * `%barcrawl` is not on the wire, and an empty pack looks the same before the
 * card is issued as after it is handed in.
 *
 * `outpost_guard_talk` branches on the varp — "Oi, whaddya want?" for not
 * started, "'Ello friend." for complete, "So, how's the Barcrawl coming along?"
 * for anything between, and that last branch re-issues a lost card.
 *
 * **The greeting is the verdict, not the empty pack.** A random event landing
 * mid-conversation abandons the option chain, and reading "no card came out" as
 * "already done" sends the bot at a gate that will not open, for good. Only
 * "'Ello friend." means finished.
 */
export async function askGuard(log: (m: string) => void): Promise<GuardVerdict> {
    if (!(await Traversal.walkResilient(OUTPOST_GUARD.anchor, { radius: 4, attempts: 3, timeoutMs: 300_000, log }))) {
        log('could not reach the outpost gate guard');
        return 'retry';
    }
    await Execution.delayTicks(2);
    // By id, not by display name: the outpost's other "Barbarian guard" is the
    // attackable one, and the gate loc runs the same conversation, so a talk
    // aimed by name can land on either.
    if (!byId(BARBARIAN_GUARD_ID)) {
        log('no barbarian guard at the outpost gate');
        return 'retry';
    }
    const status = await Reach.entityOp({
        find: () => byId(BARBARIAN_GUARD_ID),
        op: 'Talk-to',
        expect: () => ChatDialog.isOpen() || ChatDialog.canContinue(),
        what: 'Barbarian guard',
        log
    });
    if (status !== 'done') {
        log('the outpost guard never opened a dialogue');
        return 'retry';
    }
    const greeting = ChatDialog.texts().join(' / ');
    log(`guard opens with: ${greeting || '(nothing)'}`);
    if (GATE_IS_OPEN.test(greeting)) {
        return 'complete';
    }
    // Drive to the card, not to the end of the conversation: the branch that
    // issues one is three menus deep, and stopping at the first lull leaves the
    // choice on screen with the tour un-started.
    await driveUntil(
        () => Inventory.count(HD_ITEM.BARCRAWL_CARD) > 0,
        OUTPOST_GUARD.prefer,
        log,
        25_000
    );
    const held = Inventory.count(HD_ITEM.BARCRAWL_CARD);
    log(`guard done — card in pack: ${held}`);
    return held > 0 ? 'issued' : 'retry';
}

/**
 * Everything between "no barcrawl" and a gate that opens. Returns true when the
 * guard will let the character through, whether that took the whole tour or the
 * account had already done it.
 */
export async function ensureBarcrawl(log: (m: string) => void): Promise<boolean> {
    if (Inventory.count(HD_ITEM.BARCRAWL_CARD) === 0) {
        const verdict = await askGuard(log);
        if (verdict === 'complete') {
            log('the guard waves us through — the barcrawl is already done');
            return true;
        }
        if (verdict === 'retry') {
            // Not "already done": the conversation was cut short, most often by a
            // random event. Fail the step so decide() walks back and asks again.
            log('the guard handed over no card and did not wave us through — retrying');
            return false;
        }
    }
    if (!(await runBarcrawl(log))) {
        return false;
    }
    return handInBarcrawl(log);
}

/** Coin cover for the tour, drawn before the walk rather than at the tenth bar. */
export function barcrawlFunds(snap: QuestSnapshot): QuestStep | null {
    if ((snap.invIds?.get(HD_ID.COINS) ?? 0) >= BARCRAWL_GP) {
        return null;
    }
    if (!snap.bankKnown) {
        return { kind: 'scanBank' };
    }
    return {
        kind: 'withdraw',
        items: [{ name: HD_ITEM.COINS, qty: BARCRAWL_GP * 4, id: HD_ID.COINS }]
    };
}
