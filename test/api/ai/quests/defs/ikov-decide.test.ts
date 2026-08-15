import { describe, expect, test } from 'bun:test';

import { ARROWS_WANTED, IKOV_NAME, IKOV_OBJ, ROOTS_WANTED } from '#/bot/api/ai/quests/defs/ikov/areas.js';
import { decide } from '#/bot/api/ai/quests/defs/ikov/index.js';
import { IKOV_STAGE } from '#/bot/api/ai/quests/defs/ikov/journal.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

const ARROWS = IKOV_NAME.ICE_ARROWS.toLowerCase();

interface Held {
    inv?: [number, number][];
    bank?: [number, number][];
    invNames?: [string, number][];
    bankNames?: [string, number][];
    worn?: string[];
    tile?: { x: number; z: number; level: number };
    bankKnown?: boolean;
}

function snap(stage: number, held: Held = {}): QuestSnapshot {
    const invIds = new Map(held.inv ?? []);
    const bankIds = new Map(held.bank ?? []);
    return {
        journal: stage === IKOV_STAGE.COMPLETE ? 'complete' : stage === IKOV_STAGE.NOT_STARTED ? 'notStarted' : 'inProgress',
        inv: new Map(held.invNames ?? []),
        invIds,
        worn: new Set(held.worn ?? []),
        wornIds: new Set<number>(),
        noProgress: 0,
        bankCoins: 5000,
        stage,
        bank: new Map(held.bankNames ?? []),
        bankIds,
        bankKnown: held.bankKnown ?? true,
        tile: held.tile ?? { x: 2677, z: 3406, level: 0 },
        freeSlots: 20
    };
}

/** Everything the surface legs produce, so a snapshot can start past them. */
const KIT: [number, number][] = [
    [IKOV_OBJ.LIT_CANDLE, 1],
    [IKOV_OBJ.TINDERBOX, 1],
    [IKOV_OBJ.KNIFE, 1],
    [IKOV_OBJ.YEW_SHORTBOW, 1],
    [IKOV_OBJ.PENDANT_LUCIEN, 1]
];

function label(step: QuestStep): string {
    return step.kind === 'custom' ? `custom:${step.name}` : step.kind;
}

describe('Temple of Ikov decide', () => {
    test('an unloaded journal waits rather than restarting the quest', () => {
        const s = snap(IKOV_STAGE.NOT_STARTED);
        s.journal = 'unknown';
        expect(decide(s).kind).toBe('wait');
    });

    test('a complete journal is done', () => {
        expect(decide(snap(IKOV_STAGE.COMPLETE)).kind).toBe('done');
    });

    test('not started walks to Lucien at the inn', () => {
        const step = decide(snap(IKOV_STAGE.NOT_STARTED));
        expect(step.kind).toBe('talk');
        expect(step.kind === 'talk' && step.stop.npc).toBe('Lucien');
    });

    test('an unread bank is scanned before anything is judged missing', () => {
        expect(decide(snap(IKOV_STAGE.STARTED, { bankKnown: false })).kind).toBe('scanBank');
    });

    test('a lost pendant sends the bot back to Lucien for another', () => {
        const step = decide(snap(IKOV_STAGE.STARTED, { bank: KIT.filter(([id]) => id !== IKOV_OBJ.PENDANT_LUCIEN) }));
        expect(step.kind).toBe('talk');
    });

    test('the tinderbox comes before the candle', () => {
        const step = decide(snap(IKOV_STAGE.STARTED, { inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1]] }));
        expect(step.kind).toBe('buy');
        expect(step.kind === 'buy' && step.item).toBe(IKOV_NAME.TINDERBOX);
    });

    test('with a tinderbox banked the candle is next', () => {
        const step = decide(snap(IKOV_STAGE.STARTED, {
            inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1]],
            bank: [[IKOV_OBJ.TINDERBOX, 1]]
        }));
        expect(step.kind === 'buy' && step.item).toBe(IKOV_NAME.CANDLE);
    });

    test('the bow chain starts at the flax once the candle is covered', () => {
        const step = decide(snap(IKOV_STAGE.STARTED, {
            inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1]],
            bank: [[IKOV_OBJ.TINDERBOX, 1], [IKOV_OBJ.UNLIT_CANDLE, 1]]
        }));
        expect(label(step)).toBe('custom:pick flax');
    });

    test('with the bow string spun the chain moves on to the knife', () => {
        const step = decide(snap(IKOV_STAGE.STARTED, {
            inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1]],
            bank: [[IKOV_OBJ.TINDERBOX, 1], [IKOV_OBJ.UNLIT_CANDLE, 1], [IKOV_OBJ.BOW_STRING, 1]]
        }));
        expect(step.kind).toBe('grabGround');
        expect(step.kind === 'grabGround' && step.item).toBe(IKOV_NAME.KNIFE);
    });

    test('with a knife but no logs the axe is bought first', () => {
        const step = decide(snap(IKOV_STAGE.STARTED, {
            inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1]],
            bank: [[IKOV_OBJ.TINDERBOX, 1], [IKOV_OBJ.UNLIT_CANDLE, 1], [IKOV_OBJ.BOW_STRING, 1], [IKOV_OBJ.KNIFE, 1]]
        }));
        expect(step.kind === 'buy' && step.item).toBe(IKOV_NAME.IRON_AXE);
    });

    test('the whole kit banked sends the bot down for the boots', () => {
        const step = decide(snap(IKOV_STAGE.STARTED, { inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1]], bank: KIT }));
        // Why: the pack is empty, so the candle and the knife are withdrawn before the descent.
        expect(step.kind).toBe('withdraw');
    });

    test('kit in the pack, boots unfound: the boots leg runs', () => {
        const step = decide(snap(IKOV_STAGE.STARTED, { inv: KIT }));
        expect(label(step)).toBe('custom:fetch the boots of lightness');
    });

    test('boots banked but no arrows: the ice-arrow leg runs', () => {
        const step = decide(snap(IKOV_STAGE.STARTED, { inv: [...KIT, [IKOV_OBJ.BOOTS, 1]] }));
        expect(label(step)).toBe('custom:stock ice arrows from the temple chests');
    });

    test('arrows in hand at stage 10: the trap lever is next', () => {
        const step = decide(snap(IKOV_STAGE.STARTED, {
            inv: [...KIT, [IKOV_OBJ.BOOTS, 1]],
            invNames: [[ARROWS, ARROWS_WANTED]]
        }));
        expect(label(step)).toBe('custom:disarm and pull the trap lever');
    });

    test('arrows in hand past the lever: the Fire Warrior is next', () => {
        const step = decide(snap(IKOV_STAGE.PULLED_LEVER, {
            inv: [...KIT, [IKOV_OBJ.BOOTS, 1]],
            invNames: [[ARROWS, ARROWS_WANTED]]
        }));
        expect(label(step)).toBe('custom:shoot the Fire Warrior of Lesarkus');
    });

    test('a banked bow is withdrawn before the Fire Warrior', () => {
        const step = decide(snap(IKOV_STAGE.PULLED_LEVER, {
            inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1], [IKOV_OBJ.BOOTS, 1]],
            bank: [[IKOV_OBJ.YEW_SHORTBOW, 1]],
            invNames: [[ARROWS, ARROWS_WANTED]]
        }));
        expect(step.kind).toBe('withdraw');
    });

    // Why: the candle only lights the stairs to the boots, so demanding one after they are found sends the bot shopping mid-dungeon.
    test('boots in hand stop the candle being part of the kit', () => {
        const step = decide(snap(IKOV_STAGE.PULLED_LEVER, {
            inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1], [IKOV_OBJ.BOOTS, 1], [IKOV_OBJ.YEW_SHORTBOW, 1]],
            invNames: [[ARROWS, ARROWS_WANTED]]
        }));
        expect(label(step)).toBe('custom:shoot the Fire Warrior of Lesarkus');
    });

    test('the warrior down sends the bot to Winelda', () => {
        const step = decide(snap(IKOV_STAGE.KILLED_WARRIOR, { inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1]] }));
        expect(label(step)).toBe('custom:ask Winelda for the ferry across the lava');
    });

    test('Winelda asked and no roots: the hobgoblin farm runs', () => {
        const step = decide(snap(IKOV_STAGE.SPOKEN_WINELDA, { inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1]] }));
        expect(label(step)).toBe(`custom:farm limpwurt roots (0/${ROOTS_WANTED})`);
    });

    test('roots banked are withdrawn before the hand-over', () => {
        const step = decide(snap(IKOV_STAGE.SPOKEN_WINELDA, {
            inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1]],
            bank: [[IKOV_OBJ.LIMPWURT_ROOT, ROOTS_WANTED]]
        }));
        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items[0].qty).toBe(ROOTS_WANTED);
    });

    test('roots in the pack pay Winelda', () => {
        const step = decide(snap(IKOV_STAGE.SPOKEN_WINELDA, {
            inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1], [IKOV_OBJ.LIMPWURT_ROOT, ROOTS_WANTED]]
        }));
        expect(label(step)).toBe('custom:pay Winelda her twenty limpwurt roots');
    });

    // Why: past the ferry the roots are gone, and re-reading them as missing would send the bot back to the hobgoblins forever.
    test('the spent roots never re-open the farm', () => {
        const step = decide(snap(IKOV_STAGE.PAID_WINELDA, { inv: [] }));
        expect(label(step)).toBe('custom:join the Guardians of Armadyl');
    });

    test('the guardians joined ends in Lucien', () => {
        const step = decide(snap(IKOV_STAGE.HELPING_ARMADYL, { inv: [[IKOV_OBJ.PENDANT_ARMADYL, 1]] }));
        expect(label(step)).toBe('custom:leave the temple and banish Lucien');
    });

    // Why: past the ferry there is no walking back to Lucien, so a missing pendant must not become a talk step.
    test('a missing pendant on the far side of the lava does not walk back to Lucien', () => {
        const step = decide(snap(IKOV_STAGE.PAID_WINELDA, { tile: { x: 2664, z: 9876, level: 0 } }));
        expect(label(step)).toBe('custom:join the Guardians of Armadyl');
    });

    test('worn arrows count as secured', () => {
        const step = decide(snap(IKOV_STAGE.PULLED_LEVER, {
            inv: [...KIT, [IKOV_OBJ.BOOTS, 1]],
            worn: [ARROWS]
        }));
        expect(label(step)).toBe('custom:shoot the Fire Warrior of Lesarkus');
    });
});
