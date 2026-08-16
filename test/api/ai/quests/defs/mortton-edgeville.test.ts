import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { GroundItems } from '#/bot/api/grounditems/GroundItems.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Npcs } from '#/bot/api/npcs/Npcs.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { EDGEVILLE_MEN, SM_ID, SM_NPC } from '#/bot/api/ai/quests/defs/mortton/areas.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

interface WorldTileLike {
    x: number;
    z: number;
    level: number;
}

interface FakeNpc {
    index: number;
    name: string;
    ops: string[];
    targetsAnotherPlayer: () => boolean;
    interact: (op: string) => Promise<boolean>;
}

interface FakeDrop {
    id: number;
    interact: (op: string) => Promise<boolean>;
}

let counts: Map<number, number>;
let walkTargets: WorldTileLike[];
let alive: FakeNpc[];
let floor: FakeDrop[];
let clock: number;
/** What each successive kill leaves on the floor. */
let dropQueue: number[];
let nextIndex: number;

const bump = (id: number, by: number): void => {
    counts.set(id, (counts.get(id) ?? 0) + by);
};

const makeDrop = (id: number): FakeDrop => ({
    id,
    interact: async (): Promise<boolean> => {
        floor = floor.filter(d => d.id !== id);
        bump(id, 1);
        return true;
    }
});

function spawnMan(name = SM_NPC.MAN): FakeNpc {
    const npc: FakeNpc = {
        index: nextIndex++,
        name,
        ops: ['Attack'],
        targetsAnotherPlayer: () => false,
        interact: async (): Promise<boolean> => {
            alive = alive.filter(n => n.index !== npc.index);
            const dropped = dropQueue.shift();
            if (dropped !== undefined) {
                floor.push(makeDrop(dropped));
            }
            return true;
        }
    };
    return npc;
}

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
const restoreInv = stubProps(Inventory, { countById: (id: number) => counts.get(id) ?? 0 });
const restoreNpcs = stubProps(Npcs, {
    query: () => chain(() => alive) as never,
    all: () => alive as never
});
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
const restoreGame = stubProps(Game, {
    tick: () => clock++,
    inCombat: () => false,
    setAutoRetaliate: (): boolean => true
});
const restoreSkills = stubProps(Skills, { level: () => 10, effective: () => 10 });
const restoreSignal = stubProps(EventSignal, { pending: () => false });
afterAll(() => {
    restoreInv();
    restoreNpcs();
    restoreGround();
    restoreTraversal();
    restoreExec();
    restoreGame();
    restoreSkills();
    restoreSignal();
});

const { farmHerbs } = await import('#/bot/api/ai/quests/defs/mortton/herbs.js');

describe('farming the Edgeville men for tarromin', () => {
    beforeEach(() => {
        counts = new Map();
        walkTargets = [];
        floor = [];
        clock = 1;
        nextIndex = 1;
        dropQueue = [];
        alive = [spawnMan(), spawnMan(), spawnMan(), spawnMan()];
    });

    test('the leg walks to the citizen spawns first', async () => {
        dropQueue = [SM_ID.UNID_TARROMIN];
        await farmHerbs(1)(() => {});
        expect(walkTargets[0]).toEqual({ x: EDGEVILLE_MEN.x, z: EDGEVILLE_MEN.z, level: 0 });
    });

    test('one tarromin off one kill is enough', async () => {
        dropQueue = [SM_ID.UNID_TARROMIN];
        expect(await farmHerbs(1)(() => {})).toBe(true);
        expect(counts.get(SM_ID.UNID_TARROMIN)).toBe(1);
    });

    // Why: every unid renders as "Herb", so the floor is filtered by id — a guam is left where it fell.
    test('herbs that are not tarromin are left on the floor', async () => {
        const GUAM = 199;
        dropQueue = [GUAM, GUAM, SM_ID.UNID_TARROMIN];
        expect(await farmHerbs(1)(() => {})).toBe(true);
        expect(counts.get(GUAM) ?? 0).toBe(0);
        expect(counts.get(SM_ID.UNID_TARROMIN)).toBe(1);
    });

    test('two vials short means two tarromin before it stops', async () => {
        dropQueue = [SM_ID.UNID_TARROMIN, 199, SM_ID.UNID_TARROMIN];
        expect(await farmHerbs(2)(() => {})).toBe(true);
        expect(counts.get(SM_ID.UNID_TARROMIN)).toBe(2);
    });

    // Why: four spawns on a 50-tick timer means the stand runs dry between waves rather than the leg being finished.
    test('an empty stand waits for the respawn rather than reporting done', async () => {
        alive = [];
        const done = farmHerbs(1)(() => {});
        // Nothing to kill and nothing on the floor: the leg must not claim success.
        expect(await Promise.race([done, Promise.resolve('pending')])).toBe('pending');
        alive = [spawnMan()];
        dropQueue = [SM_ID.UNID_TARROMIN];
        expect(await done).toBe(true);
    });

    test('a tarromin already on the floor is taken without a kill', async () => {
        floor = [makeDrop(SM_ID.UNID_TARROMIN)];
        const before = alive.length;
        expect(await farmHerbs(1)(() => {})).toBe(true);
        expect(alive.length).toBe(before);
    });
});
