// docs/reference/quest-primitives.md
import { reader } from '../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../execution/Execution.js';
import { GameMessages } from '../../../chatbox/gameMessages.js';
import { Modals } from '../../../ui/widgets/Modals.js';
import { Sustain } from '../../../sustain/Sustain.js';
import { Reach } from '../../../walking/Reach.js';
import type Tile from '../../../../geometry/Tile.js';
import { Traversal } from '../../../walking/Traversal.js';
import { ChatDialog } from '../../../ui/dialogue/ChatDialog.js';
import { Inventory } from '../../../inventory/Inventory.js';
import { Locs, type Loc } from '../../../locs/Locs.js';
import { pickPreferred } from './primitives.js';
import { prayerUpkeep } from '../prayer.js';

export function heldId(id: number): number {
    return Inventory.items().filter(item => item.id === id).reduce((sum, item) => sum + item.count, 0);
}

export function locNear(name: string, op: string, within = 12): Loc | null {
    return Locs.query().name(name).action(op).within(within).nearest();
}

// Why: every loc query is empty for about a tick after a level or region change, so a blank scene is not evidence that a loc is absent.

/**
 * Wait out the window after a level or region change before trusting a loc query.
 * @see docs/decisions/level-change-lag.md
 */
export async function settleScene(): Promise<void> {
    await Execution.delayTicks(2);
}

// Why: loc prompts routinely put the refusal first — "I don't think so, it might animate and attack me!" — so falling through to an unmatched option is worse than stopping.

/**
 * Like `driveDialog`, but abandons rather than guessing.
 * @see docs/reference/quest-primitives.md
 */
export async function driveChoice(prefer: string[], log: (m: string) => void): Promise<boolean> {
    for (let i = 0; i < 60; i++) {
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        const opts = ChatDialog.options();
        if (opts.length > 0) {
            const pick = pickPreferred(opts, prefer);
            if (!pick) {
                log(`no preferred option in [${opts.join(' | ')}]`);
                return false;
            }
            await ChatDialog.chooseOption(pick);
            await Execution.delayTicks(2);
            continue;
        }
        if (!ChatDialog.isOpen()) {
            return true;
        }
        await Execution.delayTicks(1);
    }
    return !ChatDialog.isOpen();
}

// Why: a scripted chain leaves gaps where nothing is open yet, and `driveChoice` alone returns at the first of them, leaving the rest of the chain unrun.
// Why: the goal is tested between chains and not between clicks, because `driveChoice` runs a chain to its end — so a goal matching one box's text never sees it, and the wait spends its budget on a chain that already said the thing. `GameMessages.sawSince` is durable and safe to want here; transient `modalText` wants `driveBoxes` instead.

/**
 * Keep answering prompts until the goal lands.
 * @see docs/reference/quest-primitives.md
 */
export async function driveUntil(
    expect: () => boolean,
    prefer: string[],
    log: (m: string) => void,
    ms = 30_000
): Promise<boolean> {
    const deadline = performance.now() + ms;
    while (performance.now() < deadline) {
        if (expect()) {
            return true;
        }
        if (ChatDialog.isOpen() || ChatDialog.canContinue()) {
            if (!(await driveChoice(prefer, log))) {
                return expect();
            }
        }
        await prayerUpkeep();
        await Execution.delayTicks(1);
    }
    return expect();
}

// Why: `driveChoice` only ever clicks the CHAT modal, and a loc script's `~mesbox` chain is the MAIN one — so a wait watching for what the chain says never lets the chain say it, and entering or leaving a place through a loc is the commonest shape in a quest.
// Why: the goal is tested before each dismissal so the box carrying the answer can still be read, and it eats between boxes since `Sustain` is call-driven and a step standing at a door never asks.

/**
 * Drive a message-box chain to its goal, clicking each box away as it comes.
 * @see docs/reference/quest-primitives.md
 */
export async function driveBoxes(
    expect: () => boolean,
    ms: number,
    prefer: string[] = [],
    log: (m: string) => void = () => {}
): Promise<boolean> {
    const deadline = performance.now() + ms;
    while (performance.now() < deadline) {
        if (expect()) {
            return true;
        }
        // Why: one click per pass, because `driveChoice` runs its own chain to the end without re-testing the goal — and when the goal is the text of the last box, that box has been clicked away before anything reads it. The strength gate's "manage to force the doors open" was drained unseen every time, so a crossing that had already succeeded waited out its budget and then tried again.
        const opts = ChatDialog.options();
        if (opts.length > 0) {
            const pick = pickPreferred(opts, prefer);
            // Why: a list nothing matches is a chain that cannot move, and waiting on one spends the budget to learn what the first look already knew — Gujuo's four dead-end topics cost two minutes of silence each time, and left nothing for the walk that would have fixed them.
            // Why: said out loud, because the option list is the one piece of evidence that names what the script wanted and the module did not offer.
            if (!pick) {
                log(`no preferred option in [${opts.join(' | ')}]`);
                return expect();
            }
            // Why: `driveToEnd` names every choice it takes and this named none, so a chain that answered the wrong topic and a chain that answered the right one and got nothing looked the same from outside.
            log(`chose "${pick}" from [${opts.join(' | ')}]`);
            await ChatDialog.chooseOption(pick);
            await Execution.delayTicks(2);
            continue;
        }
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        if (Modals.isOpen()) {
            // Why: a modal root with no close button answers without having changed anything, so a bare retry would starve the tick it is waiting for.
            if (!(await Modals.close())) {
                await Execution.delayTicks(1);
            }
            continue;
        }
        await Sustain.run();
        await Execution.delayTicks(1);
    }
    return expect();
}

// Why: `~mesbox` can land in either widget, and a box holds the server script suspended until it is clicked — so a page left standing is a script left unrun.

/** Dismiss every message box currently standing, in whichever widget it rendered. */
export async function clearBoxes(max = 8): Promise<void> {
    for (let i = 0; i < max; i++) {
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        if (Modals.isOpen()) {
            if (!(await Modals.close())) {
                return;
            }
            continue;
        }
        return;
    }
}

export interface DoorCrossing {
    /** Exact loc id of the shut door. */
    id: number;
    /** The tile to click it from, on the side being left. */
    stand: Tile;
    /** True once the character stands past the door — a component test, never a distance one. */
    isFar: () => boolean;
    /** Options to take when the door raises a dialogue instead of opening. */
    prefer?: readonly string[];
    /** Display name of the loc, when it is not a Door. */
    name?: string;
    /** Op the loc advertises, when it is not Open. */
    op?: string;
    /** Id of the key to use on the loc, for a door whose Open answers "This door is locked". */
    useItem?: number;
    // Why: `~check_axis` reads your side off one coordinate, so an axis door is clicked from its own tile.
    /** How far off the stand counts as arrived. Zero for an axis-tested door. */
    standRadius?: number;
    log: (m: string) => void;
}

// Why: `open_and_close_door` teleports in the same script run as the click, with at most one `p_delay(1)` between its two teleports — so a crossing that is going to land has landed within a couple of ticks, and a longer cap only buys standing still on a door that refused.
const DOOR_MS = 3_000;
// Why: the server runs the door's script a tick after the click, so the dialogue check needs a window.
const DIALOG_MS = 2_000;
// Why: a quest door can be a kingdom away — the Brimhaven crossings are reached from Varrock by ferry,
// and a two-minute budget times out mid-ocean and reports the door as missing.
const DOOR_WALK_MS = 300_000;

// Why: `~open_and_close_door` teleports the actor through and re-shuts in three ticks, so the far side
// is the only proof a crossing landed — and no door can ever be held open for a partner.

/**
 * Cross a quest door that teleports rather than opening.
 * @see docs/reference/quest-primitives.md
 */
export async function crossTeleportDoor(door: DoorCrossing): Promise<boolean> {
    const { id, stand, isFar, log } = door;
    if (isFar()) {
        return true;
    }
    // Why: a `~mesbox` left over from the door's own challenge — "You hear the door being unbarred from
    // inside." — swallows the next Open click with no refusal to say why.
    if (reader.modals().main !== -1) {
        await Modals.close();
    }
    const radius = door.standRadius ?? 1;
    if (!(await Traversal.walkResilient(stand, { radius, attempts: 3, timeoutMs: DOOR_WALK_MS, log }))) {
        return false;
    }
    const op = door.op ?? 'Open';
    const name = door.name ?? 'Door';
    // Why: `~door_open` swings the loc onto a different tile and id, so the shut id is not what stands
    // there after anyone has opened it — and a sealed pocket has one door, so the actioned neighbour is it.
    const loc = Locs.query().action(op).within(4).where(l => l.id === id).nearest()
        ?? Locs.query().action(op).within(2).where(l => l.name === name).nearest();
    if (!loc) {
        log(`no ${name.toLowerCase()} ${id} offering '${op}' within four tiles of (${stand.x},${stand.z})`);
        return false;
    }
    // Why: the door prints nothing on a crossing — `open_and_close_door` is two teleports, a `loc_change` and a synth — so a game message arriving instead of the crossing is the script saying no, whatever the wording. Marked before the click, as the refusal is often the click's own answer.
    const said = GameMessages.mark();
    // Why: a key door's `oploc1` answers "This <name> is locked" and only its `oplocu` opens, so the
    // crossing is a use-item on the leaf rather than a click on its op.
    if (door.useItem !== undefined) {
        const key = Inventory.items().find(item => item.id === door.useItem);
        if (!key) {
            log(`no key ${door.useItem} in the pack for ${name.toLowerCase()} ${id}`);
            return false;
        }
        if (!(await key.useOn(loc))) {
            log(`${name.toLowerCase()} ${id} refused the key`);
            return false;
        }
    } else if (!(await loc.interact(op))) {
        log(`${name.toLowerCase()} ${id} refused the ${op} click`);
        return false;
    }
    // Why: the server runs the door's script a tick after the click, so a check taken straight off `interact` sees nothing and the challenge goes unanswered — and a door that talks does it in either modal, the challenge in the chat and the flavour in a box.
    // Why: a refusal ends the wait too, so a door that says no is not paid for in full.
    const talked = (): boolean => ChatDialog.isOpen() || ChatDialog.canContinue() || Modals.isOpen();
    await Execution.delayUntil(() => isFar() || talked() || GameMessages.since(said).length > 0, DIALOG_MS);
    if (!isFar() && talked()) {
        await driveBoxes(isFar, DIALOG_MS, [...(door.prefer ?? [])]);
    }
    await Execution.delayUntil(() => isFar() || GameMessages.since(said).length > 0, DOOR_MS);
    if (!isFar() && GameMessages.since(said).length > 0) {
        // Why: a quest door that narrates its own crossing would otherwise be abandoned a tick early, and an early abandon costs one retry where a full cap costs the wait.
        await Execution.delayTicks(2);
    }
    if (!isFar()) {
        return false;
    }
    await settleScene();
    return true;
}

export interface LocPrompt {
    name: string;
    op: string;
    near: Tile;
    /** Options to take, in order, once the loc opens a prompt. */
    prefer?: string[];
    expect: () => boolean;
    expectMs?: number;
    within?: number;
    /** Exact loc id, when the display name is shared with something else in range. */
    id?: number;
    /** Game-message pattern the loc's script answers with when the op cannot work yet. */
    refused?: RegExp;
}

/**
 * Walk to a stand, act on a loc, then answer whatever prompt it raised.
 * @see docs/reference/quest-primitives.md
 */
export async function promptLoc(step: LocPrompt, log: (m: string) => void): Promise<boolean> {
    if (step.expect()) {
        return true;
    }
    const status = await Reach.locOp({
        name: step.name,
        op: step.op,
        near: step.near,
        within: step.within,
        id: step.id,
        // Why: a box counts as the loc having answered. Without it `Reach` reads a talking loc as one that did nothing and re-sends the op to its cap.
        expect: () => step.expect() || ChatDialog.isOpen() || ChatDialog.canContinue() || Modals.isOpen(),
        refused: step.refused,
        log
    });
    if (status !== 'done') {
        // Why: the two ways this fails want opposite answers — one is a loc that could not be clicked, the other a click that landed and led nowhere — and telling them apart from the outside was guesswork every time it mattered.
        log(`prompt: '${step.op}' on '${step.name}' never reached the loc (${status})`);
        return false;
    }
    const answered = await driveBoxes(step.expect, step.expectMs ?? 20_000, step.prefer ?? [], log);
    if (!answered) {
        log(`prompt: '${step.op}' on '${step.name}' was sent and the goal never came`);
    }
    // Why: a satisfied goal owns the screen and this must not touch it — Tribal Totem's combination lock asks for `Modals.main() === DOOR_UI`, so clearing after a success shut the panel the caller had been waiting for, and the dials were set on a dead modal for forty minutes.
    // Why: a failure is cleared, because that is the one whose next step is a retry, and a retry that cannot click is a step that never recovers.
    if (!answered) {
        await clearBoxes();
    }
    return answered;
}

// Why: quest item chains run through `oplocu`, which no op-based step can express.

/**
 * Use a carried item on a loc, then answer whatever prompt it raised.
 * @see docs/reference/quest-primitives.md
 */
export async function useOnLoc(
    itemId: number,
    loc: { name: string; near: Tile; within?: number; id?: number },
    prefer: string[],
    expect: () => boolean,
    log: (m: string) => void
): Promise<boolean> {
    if (expect()) {
        return true;
    }
    if (!(await Traversal.walkResilient(loc.near, { radius: 2, attempts: 3, timeoutMs: 180_000, log }))) {
        return false;
    }
    await settleScene();
    // Why: same-named locs a tile apart are the rule inside a quest area, and `nearest` picks the decoy.
    const target = Locs.query()
        .name(loc.name)
        .where(l => loc.id === undefined || l.id === loc.id)
        .within(loc.within ?? 12)
        .nearest();
    const item = Inventory.items().find(entry => entry.id === itemId);
    if (!target || !item) {
        log(`no '${loc.name}'${loc.id === undefined ? '' : ` id ${loc.id}`} or no item ${itemId} to use on it near (${loc.near.x},${loc.near.z})`);
        return false;
    }
    if (!(await item.useOn(target))) {
        return false;
    }
    return driveUntil(expect, prefer, log);
}
