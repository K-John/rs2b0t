import { reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { pickPreferred } from '../../exec/primitives.js';
import { legendsArea, type LegendsArea } from './areas.js';

export { driveChoice, driveUntil, heldId, locNear, promptLoc, settleScene, useOnLoc } from '../../exec/prompts.js';

/** Which sealed pocket the character is standing in right now. */
export function here(): LegendsArea {
    return legendsArea(Game.tile());
}

// Why: `~mesbox` and `~objbox` are modal boxes rather than `mes` lines, so `GameMessages` never sees them — half this quest's confirmations arrive that way.
// Why: both the chat and the main modal are read, as the journal and the books use the main one and the boxes use the chat one.

// Why: several conversations here end themselves rather than landing an item or a tile — Ungadulu collapses, Gujuo walks off — so their only honest goal is "the chain ran to its end".
// Why: `driveUntil` with a goal that never becomes true burns its whole budget after the chat has closed, and `driveDialog` guesses the last option when nothing matches.

// Why: a chain can also run to an end that is not the end wanted — Gujuo greets, chats and says goodbye without ever offering the rescue — and that ending looks identical to the right one.

// Why: the chat modal shuts for a tick or two between a page and the option list behind it, which at 200ms ticks is most of a three-tick silence — Gujuo's chain read four of those as its ending, one option short of the rescue.
const ENDED_TICKS = 10;
const NEVER_OPENED_TICKS = 25;

/** Drive a self-terminating conversation, abandoning rather than guessing. */
export async function driveToEnd(prefer: string[], log: (m: string) => void, ms = 45_000, required?: string): Promise<boolean> {
    const deadline = performance.now() + ms;
    let quiet = 0;
    // Why: a conversation that never opened has not ended, it has not happened — and reporting it as a win feeds the engine's no-progress watchdog a success every pass.
    let spoke = false;
    let took = false;
    while (performance.now() < deadline) {
        if (ChatDialog.canContinue()) {
            spoke = true;
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            quiet = 0;
            continue;
        }
        const options = ChatDialog.options();
        if (options.length > 0) {
            spoke = true;
            const pick = pickPreferred(options, prefer);
            if (!pick) {
                log(`no preferred option in [${options.join(' | ')}]`);
                return false;
            }
            // Why: a chain that ends without moving the quest on is invisible otherwise — the driver reports the same success either way.
            log(`chose "${pick}" from [${options.join(' | ')}]`);
            took = took || pick === required;
            await ChatDialog.chooseOption(pick);
            await Execution.delayTicks(2);
            quiet = 0;
            continue;
        }
        if (!ChatDialog.isOpen()) {
            quiet += 1;
            if (quiet >= ENDED_TICKS && spoke) {
                if (required && !took) {
                    log(`the chain ended without ever offering "${required}"`);
                    return false;
                }
                return true;
            }
            if (quiet >= NEVER_OPENED_TICKS) {
                log('no dialogue ever opened');
                return false;
            }
        }
        await Execution.delayTicks(1);
    }
    return spoke && !ChatDialog.isOpen();
}

/** Whatever a modal box is currently showing, normalised for matching. */
export function modalText(): string {
    return [...reader.mainModalTexts(), ...ChatDialog.texts()]
        .join(' ')
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}
