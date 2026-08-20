import { describe, expect, test } from 'bun:test';

import { QUEST_DEFS } from '#/bot/api/ai/quests/defs/index.js';
import { witchshouse } from '#/bot/api/ai/quests/defs/witchshouse.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';
import { decide } from '#/bot/api/ai/quests/defs/witchshouse.js';

// Why: the engine reaches `gather` only when the bank cannot cover an acquirable item, so a def
// missing one runs fine on a stocked account and blocks outright on a fresh one.

const snap = {} as QuestSnapshot;

describe('acquirable items have somewhere to come from', () => {
    test('every acquirable the records name has a gather fn, or the module owns its inventory', () => {
        const missing: string[] = [];
        for (const def of QUEST_DEFS) {
            if (def.ownsInventory) {
                continue;
            }
            for (const item of def.record.items) {
                if (item.kind === 'acquirable' && !def.gather?.[item.name.toLowerCase()]) {
                    missing.push(`${def.record.name}: ${item.name}`);
                }
            }
        }
        expect(missing).toEqual([]);
    });
});

describe("Witch's House gathers what the record calls acquirable", () => {
    test('cheese is bought from Wydin in Port Sarim', () => {
        const step = witchshouse.gather?.['cheese']?.(snap, 1);
        expect(step?.kind).toBe('buy');
        expect(step).toMatchObject({ item: 'Cheese', qty: 1, shop: { npc: 'Wydin' } });
    });

    test('leather gloves are bought from Thessalia in Varrock', () => {
        const step = witchshouse.gather?.['leather gloves']?.(snap, 1);
        expect(step?.kind).toBe('buy');
        expect(step).toMatchObject({ item: 'Leather gloves', qty: 1, shop: { npc: 'Thessalia' } });
    });

    test('the shortfall the engine reports is what gets bought', () => {
        expect(witchshouse.gather?.['cheese']?.(snap, 3)).toMatchObject({ qty: 3 });
    });
});

describe("Witch's House replaces a cheese it has already spent", () => {
    // Why: the cheese is consumed luring the mouse. Thrown out of the house before the magnet lands, the
    // leg came back holding the magnet and no cheese, and looped on "no Cheese or Mouse hole".
    const snap = (inv: [string, number][]): QuestSnapshot => ({
        journal: 'inProgress',
        inv: new Map(inv),
        worn: new Set(['leather gloves']),
        noProgress: 0,
        bankCoins: 5000,
        bankKnown: true,
        bank: new Map(),
        freeSlots: 20
    });

    test('holding the magnet with no cheese buys another before the mouse hole', () => {
        const step = decide(snap([['magnet', 1]]));
        expect(step.kind).toBe('buy');
        expect(step).toMatchObject({ item: 'Cheese', shop: { npc: 'Wydin' } });
    });

    test('holding both goes to the mouse, not the shop', () => {
        expect(decide(snap([['magnet', 1], ['cheese', 1]])).kind).toBe('custom');
    });

    test('past the mouse, a missing cheese is nobody business', () => {
        expect(decide(snap([['key', 1]])).kind).toBe('custom');
    });
});
