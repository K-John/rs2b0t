import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

import { Execution } from '#/bot/api/execution/Execution.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Npcs } from '#/bot/api/npcs/Npcs.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Modals } from '#/bot/api/ui/widgets/Modals.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { SM_ID, SM_NPC } from '#/bot/api/ai/quests/defs/mortton/areas.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

interface WorldTileLike {
    x: number;
    z: number;
    level: number;
}

interface FakeNpc {
    name: string;
}

let counts: Map<number, number>;
let walkTargets: WorldTileLike[];
/** Villagers the run has used a serum on, in order, with the vial it was spent from. */
let dosed: { name: string; vial: number }[];
/** Villagers whose permanent bit is already set — their use-on consumes nothing. */
let alreadyCured: Set<string>;
let present: FakeNpc[];
let dialogueOpen: boolean;

// Why: `inv_setslot(..., next_obj_stage, 1)` — a spent dose swaps the vial for the id one dose lower.
const NEXT_STAGE = new Map<number, number>([
    [SM_ID.SERUM_PERM4, SM_ID.SERUM_PERM3],
    [SM_ID.SERUM_PERM3, SM_ID.SERUM_PERM2],
    [SM_ID.SERUM_PERM2, SM_ID.SERUM_PERM1],
    [SM_ID.SERUM_PERM1, SM_ID.VIAL_EMPTY]
]);

const bump = (id: number, by: number): void => {
    counts.set(id, (counts.get(id) ?? 0) + by);
};

const fakeItem = (id: number) => ({
    id,
    useOn: async (npc: FakeNpc): Promise<boolean> => {
        dosed.push({ name: npc.name, vial: id });
        // Why: a dose on a villager whose permanent bit is already set is refused in dialogue and never leaves the pack.
        if (!alreadyCured.has(npc.name)) {
            bump(id, -1);
            bump(NEXT_STAGE.get(id) ?? SM_ID.VIAL_EMPTY, 1);
            alreadyCured.add(npc.name);
        }
        dialogueOpen = true;
        return true;
    }
});

const npcChain = {
    filters: [] as ((n: FakeNpc) => boolean)[],
    name(n: string) {
        this.filters.push(v => v.name === n);
        return this;
    },
    where(fn: (n: FakeNpc) => boolean) {
        this.filters.push(fn);
        return this;
    },
    action() {
        return this;
    },
    within() {
        return this;
    },
    nearest() {
        const hit = present.find(n => this.filters.every(f => f(n))) ?? null;
        this.filters = [];
        return hit;
    }
};

// Why: Bun's mock.module is permanent for the process, so stub the singleton instead.
const restoreInv = stubProps(Inventory, {
    countById: (id: number) => counts.get(id) ?? 0,
    items: () => [...counts].filter(([, n]) => n > 0).map(([id]) => fakeItem(id)) as never
});
const restoreNpcs = stubProps(Npcs, { query: () => npcChain as never });
const restoreTraversal = stubProps(Traversal, {
    walkResilient: async (dest: WorldTileLike): Promise<boolean> => {
        walkTargets.push({ x: dest.x, z: dest.z, level: dest.level });
        return true;
    }
});
const restoreExec = stubProps(Execution, {
    delayTicks: async (): Promise<void> => {},
    delayUntil: async (fn: () => boolean): Promise<boolean> => fn()
});
const restoreChat = stubProps(ChatDialog, {
    isOpen: () => dialogueOpen,
    canContinue: () => dialogueOpen,
    options: () => [],
    continue: async (): Promise<boolean> => {
        dialogueOpen = false;
        return true;
    }
});
const restoreModals = stubProps(Modals, { closeIfOpen: async (): Promise<void> => {} });
afterAll(() => {
    restoreInv();
    restoreNpcs();
    restoreTraversal();
    restoreExec();
    restoreChat();
    restoreModals();
});

const { cureShopkeepers, curesOutstanding, talkVillager } =
    await import('#/bot/api/ai/quests/defs/mortton/town.js');
const { SM_STAGE, SM_TILE } = await import('#/bot/api/ai/quests/defs/mortton/areas.js');
const { dosesNeeded, forgetCures } = await import('#/bot/api/ai/quests/defs/mortton/supplies.js');
const { decide } = await import('#/bot/api/ai/quests/defs/mortton/index.js');
const { SM_FLAG } = await import('#/bot/api/ai/quests/defs/mortton/journal.js');
const { QuestFood } = await import('#/bot/api/ai/quests/food.js');

/** A pack at the sacred-oil stage: everything the earlier legs of `decide` want, and nothing they do not. */
function pyreSnapshot(invIds: [number, number][], stage: number = SM_STAGE.CREATED_SACRED_OIL) {
    const food = QuestFood.name ?? 'Trout';
    return {
        journal: 'inProgress' as const,
        inv: new Map([[food.toLowerCase(), 6]]),
        invIds: new Map<number, number>([
            [SM_ID.COINS, 30_000], [SM_ID.TINDERBOX, 1], [SM_ID.LOGS, 1],
            [SM_ID.HAMMER, 1], [SM_ID.REMAINS, 2], [SM_ID.SACRED_OIL3, 1],
            ...invIds
        ]),
        worn: new Set<string>(),
        wornIds: new Set<number>(),
        noProgress: 0,
        bankCoins: 2_000_000,
        stage,
        progress: { stage, flags: new Set([`${SM_FLAG.SANCTITY}:40`, `${SM_FLAG.REPAIRED}:100`]) },
        bank: new Map([['coins', 2_000_000]]),
        bankIds: new Map<number, number>(),
        bankKnown: true,
        tile: { x: 3490, z: 3290, level: 0 },
        freeSlots: 14
    };
}

const stepName = (invIds: [number, number][], stage?: number): string => {
    const s = decide(pyreSnapshot(invIds, stage));
    return s.kind === 'custom' ? s.name : s.kind;
};

describe('curing the shopkeepers for good', () => {
    beforeEach(() => {
        counts = new Map([[SM_ID.SERUM_PERM3, 1]]);
        walkTargets = [];
        dosed = [];
        alreadyCured = new Set();
        present = [{ name: SM_NPC.RAZMIRE }, { name: SM_NPC.ULSQUIRE }];
        dialogueOpen = false;
        npcChain.filters = [];
        forgetCures();
    });

    test('one dose of serum 207(p) goes to each shopkeeper', async () => {
        expect(await cureShopkeepers(() => {})).toBe(true);
        expect(dosed.map(d => d.name)).toEqual([SM_NPC.RAZMIRE, SM_NPC.ULSQUIRE]);
        // Why: one vial walks down its own dose chain rather than a second vial being opened.
        expect(dosed.map(d => d.vial)).toEqual([SM_ID.SERUM_PERM3, SM_ID.SERUM_PERM2]);
    });

    // Why: `%morttonmulti` is not transmitted, so the run has to remember rather than read the bit back.
    test('a cured run does not walk back out to them again', async () => {
        expect(curesOutstanding()).toBe(true);
        await cureShopkeepers(() => {});
        expect(curesOutstanding()).toBe(false);
    });

    // Why: a second dose on a cured villager is refused in dialogue and consumes nothing, so it is a pass rather than a retry.
    test('a shopkeeper another run already cured still counts as settled', async () => {
        alreadyCured.add(SM_NPC.RAZMIRE);
        expect(await cureShopkeepers(() => {})).toBe(true);
        expect(counts.get(SM_ID.SERUM_PERM3)).toBe(0);
        expect(curesOutstanding()).toBe(false);
    });

    test('the afflicted face answers to the same dose', async () => {
        present = [{ name: SM_NPC.RAZMIRE_AFFLICTED }, { name: SM_NPC.ULSQUIRE_AFFLICTED }];
        expect(await cureShopkeepers(() => {})).toBe(true);
        expect(dosed.map(d => d.name))
            .toEqual([SM_NPC.RAZMIRE_AFFLICTED, SM_NPC.ULSQUIRE_AFFLICTED]);
    });

    test('an empty pack is refused with a reason and leaves the cures outstanding', async () => {
        counts = new Map();
        const lines: string[] = [];
        expect(await cureShopkeepers(m => lines.push(m))).toBe(false);
        expect(lines.join(' ')).toContain('207(p)');
        expect(curesOutstanding()).toBe(true);
    });

    // Why: `talkVillager` already reaches for the sanctified vial first, so a shop trip that cures Razmire should spare the cure leg the walk.
    test('a permanent dose spent on a shop trip settles that shopkeeper', async () => {
        present = [{ name: SM_NPC.RAZMIRE_AFFLICTED }, { name: SM_NPC.ULSQUIRE_AFFLICTED }];
        expect(await talkVillager(SM_NPC.RAZMIRE, SM_NPC.RAZMIRE_AFFLICTED, SM_TILE.RAZMIRE, [], () => {})).toBe(true);
        dosed = [];
        expect(await cureShopkeepers(() => {})).toBe(true);
        expect(dosed.map(d => d.name)).toEqual([SM_NPC.ULSQUIRE_AFFLICTED]);
    });

    // Why: a leg that keeps re-issuing itself never reaches the pyre, and a failed step does not feed the no-progress watchdog.
    test('the leg hands back to the pyre once it has run', async () => {
        const held: [number, number][] = [[SM_ID.SERUM_PERM3, 1]];
        expect(stepName(held)).toBe('cure Razmire and Ulsquire for good');
        await cureShopkeepers(() => {});
        expect(stepName(held)).toBe('soak the logs in sacred oil');
    });

    // Why: a permanently cured villager answers without a dose, so the quest owes no serum once both carry the bit.
    test('both cures done means the quest owes no more serum', async () => {
        expect(dosesNeeded(SM_STAGE.LIT_PYRE)).toBeGreaterThan(0);
        await cureShopkeepers(() => {});
        expect(dosesNeeded(SM_STAGE.LIT_PYRE)).toBe(0);
    });

    // Why: this is the other half of the t38 loop — a run chasing a dose it no longer needs from a table that is spent.
    test('a cured run past the flame stops chasing serum it does not need', async () => {
        counts = new Map([[SM_ID.SERUM_PERM3, 1]]);
        await cureShopkeepers(() => {});
        counts = new Map();
        expect(stepName([])).not.toBe('search the smashed table for herbs');
        expect(stepName([])).toBe('soak the logs in sacred oil');
    });

    // Why: the guard is process-wide, so a second quest run in the same process would inherit the first run's cures and skip its own.
    test('a run that is not yet at the flame forgets who was settled', async () => {
        const held: [number, number][] = [[SM_ID.SERUM_PERM3, 1]];
        await cureShopkeepers(() => {});
        expect(curesOutstanding()).toBe(false);
        stepName([[SM_ID.SERUM3, 1]], SM_STAGE.KILL_SHADES);
        expect(curesOutstanding()).toBe(true);
        expect(stepName(held)).toBe('cure Razmire and Ulsquire for good');
    });

    // Why: the pyre is the next leg and it does not want the trip repeated for a dose that no longer exists.
    test('a single dose settles both stops rather than looping on the second', async () => {
        counts = new Map([[SM_ID.SERUM_PERM1, 1]]);
        const lines: string[] = [];
        expect(await cureShopkeepers(m => lines.push(m))).toBe(true);
        expect(dosed.map(d => d.name)).toEqual([SM_NPC.RAZMIRE]);
        expect(curesOutstanding()).toBe(false);
        expect(lines.join(' ')).toContain(SM_NPC.ULSQUIRE);
    });
});
