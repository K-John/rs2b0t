import { describe, expect, test } from 'bun:test';

import { SOA_ID } from '#/bot/api/ai/quests/defs/shieldofarrav/areas.js';
import { blackarmStep } from '#/bot/api/ai/quests/defs/shieldofarrav/blackarm.js';
import { SOA_STAGE } from '#/bot/api/ai/quests/defs/shieldofarrav/journal.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

const ALLEY = { x: 3208, z: 3391, level: 0 };

function at(
    stage: number,
    flags: string[] = [],
    ids: [number, number][] = [],
    bankIds: [number, number][] = [],
    bankKnown = true
): QuestSnapshot {
    return {
        journal: 'inProgress',
        inv: new Map(),
        invIds: new Map(ids),
        worn: new Set(),
        wornIds: new Set(),
        noProgress: 0,
        bankCoins: 2_000_000,
        bank: new Map(),
        bankIds: new Map(bankIds),
        bankKnown,
        tile: ALLEY as QuestSnapshot['tile'],
        freeSlots: 20,
        stage,
        progress: { stage, flags: new Set(flags) }
    };
}

describe('black arm leg', () => {
    test('an unstarted quest talks to the Tramp', () => {
        expect(blackarmStep(at(SOA_STAGE.NOT_STARTED))).toMatchObject({ kind: 'talk', stop: { npc: 'Tramp' } });
    });

    test('after the Tramp, Katrine is approached', () => {
        expect(blackarmStep(at(SOA_STAGE.TRAMP_TOLD))).toMatchObject({ kind: 'talk', stop: { npc: 'Katrine' } });
    });

    test('without the store key the leg waits rather than walking at a locked door', () => {
        const step = blackarmStep(at(SOA_STAGE.KATRINE_TASK));
        expect(step.kind).toBe('wait');
        expect((step as { reason: string }).reason).toContain('key');
    });

    test('a banked key is withdrawn rather than waited on', () => {
        const step = blackarmStep(at(SOA_STAGE.KATRINE_TASK, [], [], [[SOA_ID.STORE_KEY, 1]]));
        expect(step).toMatchObject({ kind: 'withdraw' });
        expect((step as { items: { id: number }[] }).items[0].id).toBe(SOA_ID.STORE_KEY);
    });

    test('an unread bank does not count as a banked key', () => {
        const step = blackarmStep(at(SOA_STAGE.KATRINE_TASK, [], [], [[SOA_ID.STORE_KEY, 1]], false));
        expect(step.kind).toBe('wait');
    });

    test('a held key outranks a banked one', () => {
        const step = blackarmStep(at(SOA_STAGE.KATRINE_TASK, [], [[SOA_ID.STORE_KEY, 1]], [[SOA_ID.STORE_KEY, 1]]));
        expect(step).toMatchObject({ kind: 'custom' });
    });

    test('with the store key the weapon store is raided', () => {
        expect(blackarmStep(at(SOA_STAGE.KATRINE_TASK, ['key-held'], [[SOA_ID.STORE_KEY, 1]])))
            .toMatchObject({ kind: 'custom' });
    });

    test('two crossbows go back to Katrine', () => {
        expect(blackarmStep(at(SOA_STAGE.KATRINE_TASK, ['crossbows-held'], [[SOA_ID.CROSSBOW, 2]])))
            .toMatchObject({ kind: 'talk', stop: { npc: 'Katrine' } });
    });

    test('one crossbow is not two — the raid continues', () => {
        const half = at(SOA_STAGE.KATRINE_TASK, ['key-held'], [[SOA_ID.STORE_KEY, 1], [SOA_ID.CROSSBOW, 1]]);
        expect(blackarmStep(half)).toMatchObject({ kind: 'custom' });
    });

    test('crossbows outrank the key: a hand-in never re-enters the store', () => {
        const both = at(SOA_STAGE.KATRINE_TASK, [], [[SOA_ID.STORE_KEY, 1], [SOA_ID.CROSSBOW, 2]]);
        expect(blackarmStep(both)).toMatchObject({ kind: 'talk', stop: { npc: 'Katrine' } });
    });

    test('a joined member without the half searches the cupboard', () => {
        expect(blackarmStep(at(SOA_STAGE.BLACKARM_JOINED))).toMatchObject({ kind: 'custom' });
    });

    test('a joined member holding the half asks for nothing more from this leg', () => {
        const step = blackarmStep(at(SOA_STAGE.BLACKARM_JOINED, ['own-half-only'], [[SOA_ID.SHIELD_BLACKARM, 1]]));
        expect(step.kind).toBe('wait');
    });

    test('a phoenix stage is not this leg and says so', () => {
        const step = blackarmStep(at(SOA_STAGE.KILL_JONNY));
        expect(step.kind).toBe('wait');
        expect((step as { reason: string }).reason).toContain('black arm leg');
    });
});
