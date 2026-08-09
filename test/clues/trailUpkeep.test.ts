import * as RealInventory from '#/bot/api/hud/Inventory.js';
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

import { Execution } from '#/bot/api/Execution.js';
import { Sustain } from '#/bot/api/Sustain.js';
import { Skills } from '#/bot/api/hud/Skills.js';
import { ClueExecutor } from '#/bot/clues/ClueExecutor.js';
import { SolveClue, type SolveClueHost } from '#/bot/clues/SolveClue.js';
import { stubProps } from '../lib/stubSingletons.js';

const LOBSTER = 'Lobster';
const MAX_HP = 70;

let hp: number;
let eaten: number;
let inv: { id: number; name: string }[];
let logs: string[];

const restoreExec = stubProps(Execution, {
    delayUntil: async (fn: () => boolean): Promise<boolean> => fn(),
    delayTicks: async (): Promise<void> => {}
});
const restoreSkills = stubProps(Skills, {
    level: (n: string) => (n === 'hitpoints' ? MAX_HP : 70),
    effective: (n: string) => (n === 'hitpoints' ? hp : 70)
});
const realInventoryFns = { ...RealInventory.Inventory };
const stubInventory = {
    items: () =>
        inv.map(i => ({
            ...i,
            count: 1,
            actions: () => ['Eat'],
            interact: async (): Promise<boolean> => {
                eaten++;
                inv = inv.filter(x => x !== i);
                hp = Math.min(MAX_HP, hp + 12);
                return true;
            }
        }))
};

afterAll(() => {
    restoreExec();
    restoreSkills();
    Object.assign(RealInventory.Inventory, realInventoryFns);
    Sustain.set(null);
});

function host(): SolveClueHost {
    return {
        log: m => logs.push(m),
        setStatus: () => {},
        isFood: n => n === LOBSTER,
        foodName: () => LOBSTER,
        foodWithdraw: () => 8
    };
}

beforeEach(() => {
    Object.assign(RealInventory.Inventory, stubInventory);
    hp = MAX_HP;
    eaten = 0;
    inv = [1, 2, 3].map(id => ({ id, name: LOBSTER }));
    logs = [];
    Sustain.set(null);
});

describe('trail upkeep', () => {
    // The regression: a whole trail runs inside one SolveClue.execute(), so a
    // host's own Eat task never gets a turn, and GreenDragon installed no hook
    // at all — every Sustain.run() the executor and fightGuardian pump was a
    // no-op and the bot fought guardians without eating.
    test('a host with no hook of its own still eats while the trail runs', async () => {
        let ateMidTrail = 0;
        const restoreSolve = stubProps(ClueExecutor, {
            solveHeldClue: async (): Promise<'done'> => {
                hp = 30;
                await Sustain.run();
                ateMidTrail = eaten;
                return 'done';
            }
        });
        try {
            await new SolveClue(host()).execute();
        } finally {
            restoreSolve();
        }
        expect(ateMidTrail).toBe(1);
        expect(hp).toBe(42);
        expect(logs.some(l => l.includes('eating Lobster'))).toBe(true);
    });

    test('full health eats nothing', async () => {
        const restoreSolve = stubProps(ClueExecutor, {
            solveHeldClue: async (): Promise<'done'> => {
                await Sustain.run();
                return 'done';
            }
        });
        try {
            await new SolveClue(host()).execute();
        } finally {
            restoreSolve();
        }
        expect(eaten).toBe(0);
    });

    test("the host's own hook is put back when the trail ends", async () => {
        const hostHook = async (): Promise<void> => {};
        Sustain.set(hostHook);
        const restoreSolve = stubProps(ClueExecutor, {
            solveHeldClue: async (): Promise<'abandon'> => {
                expect(Sustain.hook).not.toBe(hostHook);
                return 'abandon';
            }
        });
        try {
            await new SolveClue(host()).execute();
        } finally {
            restoreSolve();
        }
        expect(Sustain.hook).toBe(hostHook);
    });

    test('an empty pack eats nothing rather than throwing', async () => {
        inv = [];
        const restoreSolve = stubProps(ClueExecutor, {
            solveHeldClue: async (): Promise<'done'> => {
                hp = 5;
                await Sustain.run();
                return 'done';
            }
        });
        try {
            await new SolveClue(host()).execute();
        } finally {
            restoreSolve();
        }
        expect(eaten).toBe(0);
    });
});
