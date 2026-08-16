import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

import { Bank } from '#/bot/api/bank/Bank.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { GroundItems } from '#/bot/api/grounditems/GroundItems.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Locs } from '#/bot/api/locs/Locs.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { SM_ID, SM_LOC, SM_TILE } from '#/bot/api/ai/quests/defs/mortton/areas.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

interface WorldTileLike {
    x: number;
    z: number;
    level: number;
}

let counts: Map<number, number>;
let walkTargets: WorldTileLike[];
let floor: { id: number }[];
let chops: number;
let burns: number;
/** Dead trees standing at the chop stand. */
let trees: number;

const bump = (id: number, by: number): void => {
    counts.set(id, (counts.get(id) ?? 0) + by);
};

const fakeTree = {
    ops: ['Chop down'],
    name: SM_LOC.DEAD_TREE,
    interact: async (): Promise<boolean> => {
        chops++;
        bump(SM_ID.LOGS, 1);
        return true;
    }
};

const drop = (id: number) => ({
    id,
    interact: async (): Promise<boolean> => {
        floor = floor.filter(d => d.id !== id);
        bump(id, 1);
        return true;
    }
});

/** Bronze axe, the cheapest tier `AXES` knows. */
const BRONZE_AXE = 1351;

const NAMES = new Map<number, string>([
    [SM_ID.TINDERBOX, 'Tinderbox'],
    [SM_ID.LOGS, 'Logs'],
    [SM_ID.ASHES, 'Ashes'],
    [BRONZE_AXE, 'Bronze axe']
]);

const fakeItem = (id: number) => ({
    id,
    name: NAMES.get(id) ?? 'Unknown',
    useOn: async (): Promise<boolean> => {
        burns++;
        bump(SM_ID.LOGS, -1);
        floor.push(drop(SM_ID.ASHES));
        return true;
    }
});

function chain<T>(pool: () => T[]) {
    const filters: ((v: T) => boolean)[] = [];
    const self = {
        name(n: string) {
            filters.push(v => (v as { name?: string }).name === n);
            return self;
        },
        action(op: string) {
            filters.push(v => ((v as { ops?: string[] }).ops ?? []).includes(op));
            return self;
        },
        where(fn: (v: T) => boolean) {
            filters.push(fn);
            return self;
        },
        within() {
            return self;
        },
        nearest() {
            const hit = pool().find(v => filters.every(f => f(v))) ?? null;
            filters.length = 0;
            return hit;
        }
    };
    return self;
}

// Why: Bun's mock.module is permanent for the process, so stub the singleton instead.
const restoreInv = stubProps(Inventory, {
    countById: (id: number) => counts.get(id) ?? 0,
    items: () => [...counts].filter(([, n]) => n > 0).map(([id]) => fakeItem(id)) as never
});
const restoreLocs = stubProps(Locs, { query: () => chain(() => (trees > 0 ? [fakeTree] : [])) as never });
const restoreGround = stubProps(GroundItems, { query: () => chain(() => floor) as never });
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
const restoreBank = stubProps(Bank, { isOpen: () => false });
afterAll(() => {
    restoreInv();
    restoreLocs();
    restoreGround();
    restoreTraversal();
    restoreExec();
    restoreBank();
});

const { makeAshes } = await import('#/bot/api/ai/quests/defs/mortton/supplies.js');

describe('sourcing the logs the ashes come from', () => {
    beforeEach(() => {
        counts = new Map([[SM_ID.TINDERBOX, 1]]);
        walkTargets = [];
        floor = [];
        chops = 0;
        burns = 0;
        trees = 1;
    });

    const withAxe = (): void => {
        counts.set(BRONZE_AXE, 1);
    };

    // Why: 29 dead trees stand in the mapsquare the quest already works in; the Varrock spawn is a swamp crossing away.
    test('an axe in the pack chops in Mort\'ton rather than crossing to Varrock', async () => {
        withAxe();
        expect(await makeAshes({ ashes: 1, logs: 0 })(() => {})).toBe(true);
        expect(walkTargets[0]).toEqual({ x: SM_TILE.DEAD_TREE.x, z: SM_TILE.DEAD_TREE.z, level: 0 });
        expect(chops).toBeGreaterThan(0);
    });

    // Why: an axeless run still has to finish, so the proven Varrock spawn stays as the fallback.
    test('no axe falls back to the Varrock log spawn', async () => {
        floor = [drop(SM_ID.LOGS), drop(SM_ID.LOGS)];
        await makeAshes({ ashes: 1, logs: 0 })(() => {});
        expect(walkTargets[0]).toEqual({ x: SM_TILE.VARROCK_LOGS.x, z: SM_TILE.VARROCK_LOGS.z, level: 0 });
        expect(chops).toBe(0);
    });

    test('the leg stops once it holds the ashes and the spare log', async () => {
        withAxe();
        expect(await makeAshes({ ashes: 2, logs: 1 })(() => {})).toBe(true);
        expect(counts.get(SM_ID.ASHES)).toBe(2);
        expect(counts.get(SM_ID.LOGS)).toBe(1);
        expect(burns).toBe(2);
    });

    test('a chop stand with every tree felled waits rather than failing', async () => {
        withAxe();
        trees = 0;
        const done = makeAshes({ ashes: 1, logs: 0 })(() => {});
        expect(await Promise.race([done, Promise.resolve('pending')])).toBe('pending');
        trees = 1;
        expect(await done).toBe(true);
    });
});
