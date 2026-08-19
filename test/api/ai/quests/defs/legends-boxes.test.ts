import { afterAll, beforeEach, expect, test } from 'bun:test';

import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Modals } from '#/bot/api/ui/widgets/Modals.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { clearBoxes, driveBoxes } from '#/bot/api/ai/quests/exec/prompts.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

/** The five boxes `search_outer_ancient_gate` raises before its roll, then the result. */
let chain: string[];
let ticks: number;
let closes: number;

const restore = [
    stubProps(Execution, {
        delayTicks: async (): Promise<void> => { ticks++; },
        delayUntil: async (fn: () => boolean): Promise<boolean> => fn()
    }),
    stubProps(Modals, {
        isOpen: () => chain.length > 0,
        close: async (): Promise<boolean> => { closes++; chain.shift(); return true; }
    }),
    stubProps(ChatDialog, { isOpen: () => false, canContinue: () => false, texts: () => (chain[0] ? [chain[0]] : []) }),
    stubProps(Sustain, { run: async (): Promise<void> => {} })
];

afterAll(() => restore.forEach(fn => fn()));
beforeEach(() => { ticks = 0; closes = 0; });

// Why: `~mesbox` renders in the MAIN modal and the chat driver only clicks the CHAT one, so a wait that watches for the chain's result never lets the chain reach it.
test('clicks the box chain through to its result', async () => {
    chain = [
        'You attempt to pick the lock...',
        'It looks very sophisticated...',
        'You carefully insert your lockpick into the lock.',
        'You feel for the pins and levers in the mechanism.',
        'But you fail to pick the lock.'
    ];
    const got = await driveBoxes(() => /fail to pick the lock/.test(chain[0] ?? ''), 30_000);

    expect(got).toBe(true);
    // four dismissed, the fifth left up so its text can still be read
    expect(closes).toBe(4);
    expect(chain[0]).toBe('But you fail to pick the lock.');
});

// Why: `Modals.close` answers at once on a root with no close button, so a bare retry would spin flat out until the deadline.
test('a box that will not close yields instead of spinning', async () => {
    chain = ['a box with no close button'];
    const stuck = stubProps(Modals, { isOpen: () => true, close: async (): Promise<boolean> => { closes++; return false; } });
    const got = await driveBoxes(() => false, 60);

    expect(got).toBe(false);
    expect(ticks).toBeGreaterThan(0);
    stuck();
});

// Why: the strength gate and the outer ancient gate render their chains as chat continues, and `driveChoice` runs a chain to its end without re-testing the goal — so the box carrying the result was clicked away before anything read it, and a crossing that had already succeeded waited out its whole budget.
test('stops on the goal box when the chain renders as chat continues', async () => {
    chain = [
        'You ripple your muscles.',
        'You brace yourself against the doors.',
        'You start to force the doors open.',
        'And you just manage to force the doors open slightly.'
    ];
    let continues = 0;
    const asChat = [
        stubProps(Modals, { isOpen: () => false }),
        stubProps(ChatDialog, {
            isOpen: () => chain.length > 0,
            canContinue: () => chain.length > 0,
            options: () => [],
            continue: async (): Promise<boolean> => { continues++; chain.shift(); return true; }
        })
    ];
    const got = await driveBoxes(() => /manage to force the doors open/.test(chain[0] ?? ''), 30_000);

    expect(got).toBe(true);
    expect(continues).toBe(3);
    expect(chain[0]).toBe('And you just manage to force the doors open slightly.');
    asChat.forEach(fn => fn());
});

// Why: a box holds the server script suspended until it is clicked, and closing main modals did nothing for one that rendered as a chat continue — the outer ancient gate's teleport runs after its box is dismissed, so the click that never came was the crossing that never happened.
test('clearBoxes dismisses a chain that rendered as chat continues', async () => {
    chain = ['You see a lever which you pull on to open the door.'];
    let continues = 0;
    const asChat = [
        stubProps(Modals, { isOpen: () => false }),
        stubProps(ChatDialog, {
            canContinue: () => chain.length > 0,
            continue: async (): Promise<boolean> => { continues++; chain.shift(); return true; }
        })
    ];
    await clearBoxes();

    expect(continues).toBe(1);
    expect(chain).toHaveLength(0);
    asChat.forEach(fn => fn());
});

// Why: a list nothing matches is a chain that cannot move, and waiting on one spends the budget to learn what the first look already knew — Gujuo's four dead-end topics cost two minutes of silence each time, and left nothing for the walk that would have fixed them.
test('an option list nothing matches gives up at once, and says what it saw', async () => {
    chain = [];
    const said: string[] = [];
    const asChat = [
        stubProps(Modals, { isOpen: () => false }),
        stubProps(ChatDialog, {
            isOpen: () => true,
            canContinue: () => false,
            options: () => ['Sorry for bothering you.', "Ungadulu mumbled something about 'pure' water?"]
        })
    ];
    const got = await driveBoxes(() => false, 30_000, ['I need some pure water to douse some magic flames.'], m => said.push(m));

    expect(got).toBe(false);
    expect(said[0]).toContain('no preferred option');
    expect(said[0]).toContain('mumbled');
    asChat.forEach(fn => fn());
});

// Why: a satisfied goal owns the screen. Tribal Totem's combination lock asks for `Modals.main() === DOOR_UI`, so a clear after success shut the very panel the caller had waited for, and the dials were set on a dead modal for forty minutes.
test('a prompt whose goal is an open panel leaves it open', async () => {
    let panel = -1;
    const opened = (): boolean => panel === 42;
    const asPanel = [
        stubProps(Modals, {
            isOpen: () => panel !== -1,
            main: () => panel,
            close: async (): Promise<boolean> => { panel = -1; return true; }
        }),
        stubProps(ChatDialog, { isOpen: () => false, canContinue: () => false, options: () => [] })
    ];
    panel = 42;
    const got = await driveBoxes(opened, 5000);

    expect(got).toBe(true);
    expect(panel).toBe(42);
    asPanel.forEach(fn => fn());
});
