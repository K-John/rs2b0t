import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

import { GameMessages } from '#/bot/api/chatbox/gameMessages.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Modals } from '#/bot/api/ui/widgets/Modals.js';
import { Reach } from '#/bot/api/walking/Reach.js';
import { SM_ID, SM_STAGE } from '#/bot/api/ai/quests/defs/mortton/areas.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

let counts: Map<number, number>;
/** What the table answers with when the bot searches it. */
let tableAnswer: 'herbs' | 'nothing';

const bump = (id: number, by: number): void => {
    counts.set(id, (counts.get(id) ?? 0) + by);
};

// Why: Bun's mock.module is permanent for the process, so stub the singleton instead.
const restoreInv = stubProps(Inventory, { countById: (id: number) => counts.get(id) ?? 0 });
// Why: a spent table answers with a plain `mes` and no herb, so `locOp`'s expect never fires and it reports 'retry' rather than 'done'.
const restoreReach = stubProps(Reach, {
    locOp: async (): Promise<'done' | 'retry'> => {
        if (tableAnswer === 'herbs') {
            bump(SM_ID.UNID_TARROMIN, 2);
            bump(SM_ID.UNID_ROGUES_PURSE, 1);
            return 'done';
        }
        GameMessages.record('You search the table but find nothing.');
        return 'retry';
    }
});
const restoreExec = stubProps(Execution, {
    delayTicks: async (): Promise<void> => {},
    delayUntil: async (fn: () => boolean): Promise<boolean> => fn()
});
const restoreChat = stubProps(ChatDialog, { isOpen: () => false, canContinue: () => false });
const restoreModals = stubProps(Modals, { closeIfOpen: async (): Promise<void> => {} });
afterAll(() => {
    restoreInv();
    restoreReach();
    restoreExec();
    restoreChat();
    restoreModals();
});

const { forgetTable, searchTable, tableIsSpent } =
    await import('#/bot/api/ai/quests/defs/mortton/town.js');
const { decide } = await import('#/bot/api/ai/quests/defs/mortton/index.js');
const { QuestFood } = await import('#/bot/api/ai/quests/food.js');

/** A pack early enough that the serum chain is what `decide` reaches for. */
function brewSnapshot(invIds: [number, number][] = [], bankIds: [number, number][] = []) {
    const stage = SM_STAGE.READ_DIARY;
    const food = QuestFood.name ?? 'Trout';
    return {
        journal: 'inProgress' as const,
        inv: new Map([[food.toLowerCase(), 6]]),
        invIds: new Map<number, number>([
            [SM_ID.COINS, 30_000], [SM_ID.TINDERBOX, 1], [SM_ID.ASHES, 2], [SM_ID.LOGS, 1],
            ...invIds
        ]),
        worn: new Set<string>(),
        wornIds: new Set<number>(),
        noProgress: 0,
        bankCoins: 2_000_000,
        stage,
        progress: { stage, flags: new Set<string>() },
        bank: new Map([['coins', 2_000_000]]),
        bankIds: new Map<number, number>(bankIds),
        bankKnown: true,
        tile: { x: 3490, z: 3290, level: 0 },
        freeSlots: 14
    };
}

const stepName = (invIds: [number, number][] = [], bankIds: [number, number][] = []): string => {
    const s = decide(brewSnapshot(invIds, bankIds));
    return s.kind === 'custom' ? s.name : s.kind;
};

describe('the smashed table', () => {
    beforeEach(() => {
        counts = new Map();
        tableAnswer = 'herbs';
        GameMessages.reset();
        forgetTable();
    });

    test('a full table hands over its herbs and stays a live source', async () => {
        expect(await searchTable(() => {})).toBe(true);
        expect(tableIsSpent()).toBe(false);
    });

    // Why: `^shades_table_searched` is set for good and is not transmitted, so "find nothing" is the only reading the bot gets.
    test('a table that answers "find nothing" is marked spent', async () => {
        tableAnswer = 'nothing';
        expect(await searchTable(() => {})).toBe(false);
        expect(tableIsSpent()).toBe(true);
    });

    // Why: this is the t38 loop — a spent table re-offered every cycle, each retry paying a 90-second swamp crossing.
    test('a spent table is never offered again', async () => {
        expect(stepName()).toBe('search the smashed table for herbs');
        tableAnswer = 'nothing';
        await searchTable(() => {});
        expect(stepName()).not.toBe('search the smashed table for herbs');
    });

    test('a held unidentified herb is still identified after the table is spent', async () => {
        tableAnswer = 'nothing';
        await searchTable(() => {});
        expect(stepName([[SM_ID.UNID_TARROMIN, 1]])).toBe('identify the tarromin');
    });
});

describe('sourcing tarromin once the table is spent', () => {
    beforeEach(async () => {
        counts = new Map();
        GameMessages.reset();
        forgetTable();
        tableAnswer = 'nothing';
        await searchTable(() => {});
    });

    test('a clean tarromin in the bank is withdrawn', () => {
        const s = decide(brewSnapshot([], [[SM_ID.TARROMIN, 5]]));
        expect(s.kind).toBe('withdraw');
        expect(s.kind === 'withdraw' && s.items[0]?.id).toBe(SM_ID.TARROMIN);
    });

    // Why: every unid renders as "Herb", so the bank row is picked by id rather than by name.
    test('an unidentified tarromin in the bank is withdrawn by id', () => {
        const s = decide(brewSnapshot([], [[SM_ID.UNID_TARROMIN, 5]]));
        expect(s.kind).toBe('withdraw');
        expect(s.kind === 'withdraw' && s.items[0]?.id).toBe(SM_ID.UNID_TARROMIN);
    });

    test('an unread bank is read before the walk to Edgeville', () => {
        const bare = brewSnapshot();
        bare.bankKnown = false;
        expect(decide(bare).kind).toBe('scanBank');
    });

    // Why: `~randomherb` is 18% of a citizen kill and tarromin is 14% of that, so this is the only renewable source left on the route.
    test('an empty bank sends the bot to the Edgeville men', () => {
        expect(stepName()).toBe('kill men in Edgeville for herbs');
    });
});
