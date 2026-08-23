import { describe, expect, test } from 'bun:test';

import { QUEST_DEFS } from '#/bot/api/ai/quests/defs/index.js';
import { witchshouse } from '#/bot/api/ai/quests/defs/witchshouse/index.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

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
