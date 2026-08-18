import { afterAll, beforeEach, expect, test } from 'bun:test';

import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Modals } from '#/bot/api/ui/widgets/Modals.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { driveBoxes } from '#/bot/api/ai/quests/defs/legends/scene.js';
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
