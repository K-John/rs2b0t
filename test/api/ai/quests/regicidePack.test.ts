import { describe, expect, test } from 'bun:test';

import { RG_ITEM } from '#/bot/api/ai/quests/defs/regicide/areas.js';
import { managePack, type PackPlan } from '#/bot/api/ai/quests/defs/regicide/pack.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

const counts = (stacks: [number, number][]): Map<number, number> => new Map(stacks);

function snapshot(over: {
    carried?: [number, number][];
    banked?: [number, number][];
    freeSlots?: number;
    bankKnown?: boolean;
} = {}): QuestSnapshot {
    const { carried = [], banked = [], freeSlots = 28, bankKnown = true } = over;
    const used = carried.reduce((n, [, q]) => n + q, 0);
    return {
        journal: 'inProgress',
        inv: new Map(),
        invIds: counts(carried),
        worn: new Set(),
        wornIds: new Set(),
        noProgress: 0,
        bankCoins: 1_000_000,
        bank: new Map(),
        bankIds: counts(banked),
        bankKnown,
        freeSlots: over.freeSlots ?? 28 - used,
        tile: { x: 2655, z: 3283, level: 0 },
        ...(over.freeSlots === undefined ? {} : { freeSlots })
    } as QuestSnapshot;
}

const PLAN: PackPlan = {
    what: 'the coal run',
    allow: [RG_ITEM.BARREL_TAR.id, RG_ITEM.PICKAXE.id, RG_ITEM.COAL.id],
    caps: [{ item: RG_ITEM.SHARK, qty: 4 }],
    freeNeeded: 12
};

describe('regicide pack planning', () => {
    test('an unread bank is scanned before anything is moved', () => {
        const step = managePack(snapshot({ bankKnown: false }), PLAN);
        expect(step?.kind).toBe('scanBank');
    });

    // Why: the kit is what the forest leg carried out, and none of it belongs on a coal run.
    test('anything the leg has no use for is banked', () => {
        const step = managePack(snapshot({ carried: [[RG_ITEM.SPADE.id, 1], [RG_ITEM.BARREL_TAR.id, 1]] }), PLAN);
        expect(step?.kind).toBe('deposit');
        expect(step?.kind === 'deposit' && step.keepIds).toContain(RG_ITEM.BARREL_TAR.id);
        expect(step?.kind === 'deposit' && step.keepIds).not.toContain(RG_ITEM.SPADE.id);
    });

    // Why: the deposit is all-or-nothing per item, so an over-count is shed outright and drawn back at its target on the next cycle. Keeping it in the list would leave the surplus in the pack forever.
    test('an item over its cap is left out of the keep list entirely', () => {
        const step = managePack(snapshot({ carried: [[RG_ITEM.SHARK.id, 11]] }), PLAN);
        expect(step?.kind).toBe('deposit');
        expect(step?.kind === 'deposit' && step.keepIds).not.toContain(RG_ITEM.SHARK.id);
    });

    test('an item under its cap is drawn back to it', () => {
        const step = managePack(snapshot({ carried: [], banked: [[RG_ITEM.SHARK.id, 40]] }), PLAN);
        expect(step?.kind).toBe('withdraw');
        expect(step?.kind === 'withdraw' && step.items[0]?.qty).toBe(4);
    });

    test('a bank with none of it does not stall the leg', () => {
        expect(managePack(snapshot({ carried: [], banked: [] }), PLAN)).toBeNull();
    });

    test('a pack already in shape asks for nothing', () => {
        const snap = snapshot({ carried: [[RG_ITEM.BARREL_TAR.id, 1], [RG_ITEM.PICKAXE.id, 1], [RG_ITEM.SHARK.id, 4]] });
        expect(managePack(snap, PLAN)).toBeNull();
    });

    // Why: shed, draw, done — three cycles and no fourth, because a plan that never settles is a bank trip every tick.
    test('shedding a surplus and drawing it back settles', () => {
        let carried: [number, number][] = [[RG_ITEM.SPADE.id, 1], [RG_ITEM.SHARK.id, 11], [RG_ITEM.BARREL_TAR.id, 1]];
        const banked: [number, number][] = [[RG_ITEM.SHARK.id, 40]];
        const kinds: string[] = [];
        for (let cycle = 0; cycle < 4; cycle++) {
            const step = managePack(snapshot({ carried, banked }), PLAN);
            if (step === null) {
                kinds.push('settled');
                break;
            }
            kinds.push(step.kind);
            if (step.kind === 'deposit') {
                const keep = new Set(step.keepIds ?? []);
                carried = carried.filter(([id]) => keep.has(id));
            }
            if (step.kind === 'withdraw') {
                carried = [...carried, [RG_ITEM.SHARK.id, step.items[0]!.qty]];
            }
        }
        expect(kinds).toEqual(['deposit', 'withdraw', 'settled']);
    });

    test('a pack that cannot make room says so rather than retrying', () => {
        const snap = snapshot({ carried: [[RG_ITEM.COAL.id, 20]], freeSlots: 2 });
        const step = managePack(snap, PLAN);
        expect(step?.kind).toBe('wait');
        expect(step?.kind === 'wait' && step.reason).toContain('12 free slot');
    });
});

// Why: a plan is a whitelist, so anything it forgets to name is banked — and the scroll, the pendant and every barrel state are one-way. Banking one does not cost a walk, it ends the run.
describe('what no plan may bank', () => {
    const BARE: PackPlan = { what: 'a plan that names nothing', allow: [] };

    const IRREPLACEABLE: [string, { id: number; name: string }][] = [
        ['the summons', RG_ITEM.SUMMONS],
        ['Iorwerth\'s letter', RG_ITEM.MESSAGE],
        ['the crystal pendant', RG_ITEM.PENDANT],
        ['an empty barrel', RG_ITEM.BARREL],
        ['a barrel of coal-tar', RG_ITEM.BARREL_TAR],
        ['a barrel of naphtha', RG_ITEM.BARREL_NAPHTHA],
        ['a sealed barrel bomb', RG_ITEM.BARREL_LID],
        ['a fused barrel bomb', RG_ITEM.BARREL_FUSED],
        ['the fuse cloth', RG_ITEM.CLOTH]
    ];

    test.each(IRREPLACEABLE)('%s survives a plan that does not name it', (_what, item) => {
        expect(managePack(snapshot({ carried: [[item.id, 1]] }), BARE)).toBeNull();
    });

    test('a bomb is kept even while junk is being shed', () => {
        const snap = snapshot({ carried: [[RG_ITEM.BARREL_FUSED.id, 1], [RG_ITEM.SPADE.id, 1]] });
        const step = managePack(snap, { what: 'the coal run', allow: [RG_ITEM.COAL.id] });
        expect(step?.kind).toBe('deposit');
        expect(step?.kind === 'deposit' && step.keepIds).toContain(RG_ITEM.BARREL_FUSED.id);
        expect(step?.kind === 'deposit' && step.keepIds).not.toContain(RG_ITEM.SPADE.id);
    });
});
