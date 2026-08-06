import { describe, expect, test } from 'bun:test';

import { KS_ID } from '#/bot/quests/defs/knightssword/areas.js';
import { COIN_LOW, kit, pie } from '#/bot/quests/defs/knightssword/supplies.js';
import type { QuestSnapshot, QuestStep } from '#/bot/quests/engine/types.js';

const COINS = 995;

export function snap(invIds: [number, number][] = [], options: {
    bankIds?: [number, number][];
    bankKnown?: boolean;
    tile?: QuestSnapshot['tile'];
} = {}): QuestSnapshot {
    return {
        journal: 'inProgress',
        inv: new Map(),
        // Every case that is not about the float carries one, so the coin top-up
        // never masks the step under test.
        invIds: new Map([[COINS, COIN_LOW * 2], ...invIds]),
        worn: new Set(),
        wornIds: new Set(),
        noProgress: 0,
        bankCoins: 2_000_000,
        bank: new Map(),
        bankIds: new Map(options.bankIds ?? []),
        bankKnown: options.bankKnown ?? true,
        tile: options.tile ?? { x: 2946, z: 3369, level: 0 },
        freeSlots: 20
    };
}

const withdrawn = (step: QuestStep): number[] =>
    step.kind === 'withdraw' ? step.items.map(i => i.id ?? -1) : [];

const lobsters = (held: number) => ({ name: 'Lobster', held, target: 14, low: 4 });

describe('kit', () => {
    test('scans the bank before withdrawing anything it has not seen', () => {
        expect(kit(snap([[COINS, 3]], { bankKnown: false }))?.kind).toBe('scanBank');
    });

    test('withdraws a coin float when the pack is nearly empty', () => {
        expect(withdrawn(kit(snap([[COINS, 3]]))!)).toContain(COINS);
    });

    test('does not re-withdraw after a small purchase', () => {
        // The float is a threshold, not a target: topping up to an exact balance
        // sends the bot back to a booth after every single item bought.
        expect(kit(snap([[COINS, COIN_LOW + 1]]))).toBeNull();
    });

    test('withdraws food up to target when the pack is short', () => {
        const step = kit(snap(), lobsters(0));
        expect(step).toMatchObject({ kind: 'withdraw' });
        expect(step!.kind === 'withdraw' && step.items).toContainEqual({ name: 'Lobster', qty: 14 });
    });

    test('leaves a stocked pack alone', () => {
        expect(kit(snap(), lobsters(14))).toBeNull();
    });

    test('does not top up on every bite eaten', () => {
        expect(kit(snap(), lobsters(5))).toBeNull();
    });

    test('never re-banks for food from underground', () => {
        // Preparation stops at the door: a top-up that fires mid-dungeon walks
        // the bot back out of it.
        const below = snap([], { tile: { x: 3049, z: 9566, level: 0 } });
        expect(kit(below, lobsters(0))).toBeNull();
    });
});

describe('redberry pie chain', () => {
    test('scans the bank before buying anything', () => {
        expect(pie(snap([], { bankKnown: false })).kind).toBe('scanBank');
    });

    test('withdraws a banked pie rather than baking one', () => {
        const step = pie(snap([], { bankIds: [[KS_ID.REDBERRY_PIE, 1]] }));
        expect(withdrawn(step)).toContain(KS_ID.REDBERRY_PIE);
    });

    test('grabs the pie dish from the Varrock kitchen when none is held', () => {
        const step = pie(snap([[KS_ID.POT_OF_FLOUR, 1], [KS_ID.REDBERRIES, 1], [KS_ID.BUCKET_OF_WATER, 1]]));
        expect(step).toMatchObject({ kind: 'grabGround', item: 'Pie dish' });
    });

    test('withdraws a banked pie dish instead of walking to Varrock', () => {
        const step = pie(snap([[KS_ID.POT_OF_FLOUR, 1]], { bankIds: [[KS_ID.PIE_DISH, 1]] }));
        expect(withdrawn(step)).toContain(KS_ID.PIE_DISH);
    });

    test('buys flour at Wydin when the dish and water are in hand', () => {
        const step = pie(snap([[KS_ID.PIE_DISH, 1], [KS_ID.BUCKET_OF_WATER, 1], [KS_ID.REDBERRIES, 1]]));
        expect(step).toMatchObject({ kind: 'buy', item: 'Pot of flour' });
    });

    test('buys redberries when everything else is in hand', () => {
        const step = pie(snap([[KS_ID.PIE_DISH, 1], [KS_ID.BUCKET_OF_WATER, 1], [KS_ID.POT_OF_FLOUR, 1]]));
        expect(step).toMatchObject({ kind: 'buy', item: 'Redberries' });
    });

    test('buys a bucket before trying to fill one', () => {
        const step = pie(snap([[KS_ID.PIE_DISH, 1], [KS_ID.POT_OF_FLOUR, 1], [KS_ID.REDBERRIES, 1]]));
        expect(step).toMatchObject({ kind: 'buy', item: 'Bucket' });
    });

    test('fills a held bucket at the fountain', () => {
        const step = pie(snap([
            [KS_ID.PIE_DISH, 1], [KS_ID.POT_OF_FLOUR, 1], [KS_ID.REDBERRIES, 1], [KS_ID.BUCKET, 1]
        ]));
        expect(step).toMatchObject({ kind: 'custom', name: 'fill the bucket' });
    });

    test('mixes dough once flour and water are both held', () => {
        const step = pie(snap([
            [KS_ID.PIE_DISH, 1], [KS_ID.POT_OF_FLOUR, 1], [KS_ID.REDBERRIES, 1], [KS_ID.BUCKET_OF_WATER, 1]
        ]));
        expect(step).toMatchObject({ kind: 'custom', name: 'mix pastry dough' });
    });

    test('makes the shell from dough and dish', () => {
        const step = pie(snap([[KS_ID.PASTRY_DOUGH, 1], [KS_ID.PIE_DISH, 1], [KS_ID.REDBERRIES, 1]]));
        expect(step).toMatchObject({ kind: 'useOn', product: 'Pie shell' });
    });

    test('fills the shell with redberries', () => {
        const step = pie(snap([[KS_ID.PIE_SHELL, 1], [KS_ID.REDBERRIES, 1]]));
        expect(step).toMatchObject({ kind: 'useOn', product: 'Uncooked berry pie' });
    });

    test('buys more redberries when the shell is made but the berries are gone', () => {
        const step = pie(snap([[KS_ID.PIE_SHELL, 1]]));
        expect(step).toMatchObject({ kind: 'buy', item: 'Redberries' });
    });

    test('cooks the uncooked pie on a range', () => {
        const step = pie(snap([[KS_ID.UNCOOKED_PIE, 1]]));
        expect(step).toMatchObject({ kind: 'custom', name: 'cook the redberry pie' });
    });

    test('a held pie ends the chain', () => {
        expect(pie(snap([[KS_ID.REDBERRY_PIE, 1]])).kind).toBe('wait');
    });
});
