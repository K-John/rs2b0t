import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Locs } from '#/bot/api/locs/Locs.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { SM_ID, SM_VARP } from '#/bot/api/ai/quests/defs/mortton/areas.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

/** Serum 207 vial id → the serum 207(p) the sacred flame turns it into. */
const SANCTIFIED = new Map<number, number>([
    [SM_ID.SERUM4, SM_ID.SERUM_PERM4],
    [SM_ID.SERUM3, SM_ID.SERUM_PERM3],
    [SM_ID.SERUM2, SM_ID.SERUM_PERM2],
    [SM_ID.SERUM1, SM_ID.SERUM_PERM1]
]);

/** Sanctity the flame charges to sanctify one vial, as a percentage. */
const SANCTIFY_COST = 20;

let counts: Map<number, number>;
let sanctity: number;

const bump = (id: number, by: number): void => {
    counts.set(id, (counts.get(id) ?? 0) + by);
};

const fakeItem = (id: number) => ({
    id,
    useOn: async (): Promise<boolean> => {
        const into = SANCTIFIED.get(id);
        if (into === undefined) {
            return false;
        }
        bump(id, -1);
        bump(into, 1);
        sanctity -= SANCTIFY_COST;
        return true;
    }
});

const fakeAltar = {};
const locChain = {
    name: () => locChain,
    where: () => locChain,
    within: () => locChain,
    nearest: () => fakeAltar
};

// Why: Bun's mock.module is permanent for the process, so stub the singleton instead.
const restoreInv = stubProps(Inventory, {
    countById: (id: number) => counts.get(id) ?? 0,
    items: () => [...counts].filter(([, n]) => n > 0).map(([id]) => fakeItem(id)) as never
});
const restoreLocs = stubProps(Locs, { query: () => locChain as never });
const restoreTraversal = stubProps(Traversal, { walkResilient: async (): Promise<boolean> => true });
const restoreExec = stubProps(Execution, { delayTicks: async (): Promise<void> => {} });
const restoreChat = stubProps(ChatDialog, { isOpen: () => false, canContinue: () => false });
const restoreReader = stubProps(reader, {
    varp: (id: number) => (id === SM_VARP.TEMPLE_SANCTITY ? sanctity : 0)
});
afterAll(() => {
    restoreInv();
    restoreLocs();
    restoreTraversal();
    restoreExec();
    restoreChat();
    restoreReader();
});

const { canSanctifySerum, sanctifySerum } = await import('#/bot/api/ai/quests/defs/mortton/temple.js');
const { permSerumDosesHeld, PERM_CURES } = await import('#/bot/api/ai/quests/defs/mortton/supplies.js');

describe('sanctifying serum in the sacred flame', () => {
    beforeEach(() => {
        counts = new Map();
        sanctity = 60;
    });

    // Why: one dose per villager, and a vial sanctifies in one go — two single-dose vials need two trips to the flame.
    test('keeps converting until the pack holds a dose for each villager', async () => {
        counts.set(SM_ID.SERUM1, 2);
        expect(await sanctifySerum(() => {})).toBe(true);
        expect(permSerumDosesHeld()).toBe(PERM_CURES);
    });

    test('one vial that already carries both doses is converted once', async () => {
        counts.set(SM_ID.SERUM3, 1);
        expect(await sanctifySerum(() => {})).toBe(true);
        expect(counts.get(SM_ID.SERUM_PERM3)).toBe(1);
        expect(sanctity).toBe(40);
    });

    test('a pack one vial short sanctifies what it has and says so', async () => {
        counts.set(SM_ID.SERUM1, 1);
        const lines: string[] = [];
        expect(await sanctifySerum(m => lines.push(m))).toBe(true);
        expect(permSerumDosesHeld()).toBe(1);
        expect(lines.join(' ')).toContain('1');
    });

    test('sanctity too low for a second trip stops at one dose', async () => {
        counts.set(SM_ID.SERUM1, 2);
        sanctity = 25;
        expect(await sanctifySerum(() => {})).toBe(true);
        expect(permSerumDosesHeld()).toBe(1);
    });

    // Why: a later trip to the flame arrives holding the single-dose vial the first trip made, and "a vial exists" would call that finished.
    test('one dose already made still leaves the flame something to do', () => {
        counts.set(SM_ID.SERUM_PERM1, 1);
        expect(canSanctifySerum()).toBe(true);
        counts.set(SM_ID.SERUM_PERM1, 0);
        counts.set(SM_ID.SERUM_PERM2, 1);
        expect(canSanctifySerum()).toBe(false);
    });

    test('sanctity under the flame\'s price is not worth the trip', () => {
        sanctity = 19;
        expect(canSanctifySerum()).toBe(false);
    });

    test('no serum at all is a failure, not a silent pass', async () => {
        const lines: string[] = [];
        expect(await sanctifySerum(m => lines.push(m))).toBe(false);
        expect(lines.join(' ')).toContain('no serum 207');
    });
});
