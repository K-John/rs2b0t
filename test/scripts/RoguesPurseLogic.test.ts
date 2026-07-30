import { describe, expect, test } from 'bun:test';

import {
    COINS,
    FARE,
    FARE_FLOAT,
    IDENTIFY_LEVEL,
    WALL_STAGE,
    checkGates,
    isLevelRefusal,
    isStageRefusal,
    planCycle
} from '#/bot/scripts/RoguesPurseLogic.js';
import { JP_STAGE } from '#/bot/quests/defs/junglepotion.js';
import { SPECIAL_CROSSINGS } from '#/bot/nav/data/specialCrossings.js';

describe('planCycle (one tick of packets)', () => {
    test('an empty pack only searches', () => {
        expect(planCycle({ continuePending: false, unids: 0, identified: 0, freeSlots: 28 })).toEqual(['search']);
    });

    test('a carried unid identifies before the next search', () => {
        expect(planCycle({ continuePending: false, unids: 1, identified: 0, freeSlots: 27 })).toEqual([
            'identify',
            'search'
        ]);
    });

    test('steady state is identify, drop, search — three user events plus a continue', () => {
        expect(planCycle({ continuePending: true, unids: 1, identified: 1, freeSlots: 26 })).toEqual([
            'continue',
            'identify',
            'drop',
            'search'
        ]);
    });

    test('four events at most, so the engine never defers part of the burst to the next tick', () => {
        const worst = planCycle({ continuePending: true, unids: 5, identified: 5, freeSlots: 10 });
        expect(worst.length).toBeLessThanOrEqual(4);
    });

    test('the continue always leads — the objbox is what suspended the last search', () => {
        expect(planCycle({ continuePending: true, unids: 0, identified: 0, freeSlots: 28 })[0]).toBe('continue');
    });

    test('a full pack stops searching (the engine would find a herb and bin it)', () => {
        expect(planCycle({ continuePending: false, unids: 2, identified: 1, freeSlots: 0 })).toEqual([
            'identify',
            'drop'
        ]);
    });

    test('a full pack of identified herbs still drains itself', () => {
        expect(planCycle({ continuePending: false, unids: 0, identified: 28, freeSlots: 0 })).toEqual(['drop']);
    });
});

describe('checkGates (both engine gates, before the walk to Karamja)', () => {
    test('a completed quest with the quest xp behind it passes', () => {
        expect(checkGates({ herbloreLevel: 8, stage: JP_STAGE.COMPLETE })).toEqual({ ok: true });
    });

    test('the stage the wall actually wants is get_rogues_purse, not started', () => {
        expect(WALL_STAGE).toBe(JP_STAGE.GET_ROGUES_PURSE);
        expect(checkGates({ herbloreLevel: 3, stage: WALL_STAGE }).ok).toBe(true);
        expect(checkGates({ herbloreLevel: 3, stage: JP_STAGE.FOUND_ROGUES_PURSE }).ok).toBe(true);
        expect(checkGates({ herbloreLevel: 3, stage: WALL_STAGE - 1 }).ok).toBe(false);
        expect(checkGates({ herbloreLevel: 3, stage: JP_STAGE.GET_SNAKE_WEED }).ok).toBe(false);
    });

    test('Herblore below 3 fails first, whatever the quest says', () => {
        for (const level of [0, 1, 2]) {
            const gate = checkGates({ herbloreLevel: level, stage: JP_STAGE.COMPLETE });
            expect(gate.ok).toBe(false);
            expect(gate.ok === false && gate.reason).toContain(`Herblore ${IDENTIFY_LEVEL}`);
        }
        expect(checkGates({ herbloreLevel: IDENTIFY_LEVEL, stage: JP_STAGE.COMPLETE }).ok).toBe(true);
    });

    test('an unstarted quest names the fix', () => {
        const gate = checkGates({ herbloreLevel: 8, stage: JP_STAGE.NOT_STARTED });
        expect(gate.ok).toBe(false);
        expect(gate.ok === false && gate.reason).toContain('AIOQuester');
    });

    test('a mid-quest stage says which stage it saw', () => {
        const gate = checkGates({ herbloreLevel: 8, stage: JP_STAGE.FOUND_SITO_FOIL });
        expect(gate.ok).toBe(false);
        expect(gate.ok === false && gate.reason).toContain(`stage ${JP_STAGE.FOUND_SITO_FOIL}`);
    });

    test('an unreadable journal is not treated as eligible', () => {
        expect(checkGates({ herbloreLevel: 8, stage: undefined }).ok).toBe(false);
    });
});

describe('boat fare (the navigator prunes crossings it cannot pay for)', () => {
    test('FARE matches what the Karamja ship crossings actually charge', () => {
        const ships = SPECIAL_CROSSINGS.filter(sc => /ship/i.test(sc.label ?? ''));
        expect(ships.length).toBeGreaterThan(0);
        for (const ship of ships) {
            expect(ship.requires?.item).toBe(COINS);
            expect(ship.requires?.count).toBe(FARE);
        }
    });

    test('the float covers the fare and leaves change for the Al Kharid gate', () => {
        const gate = SPECIAL_CROSSINGS.find(sc => /al kharid/i.test(sc.label ?? ''));
        expect(FARE_FLOAT).toBeGreaterThanOrEqual(FARE + (gate?.requires?.count ?? 0));
    });
});

describe('refusal messages (the authoritative gate check at runtime)', () => {
    test('the wall refusal is recognised as written by the engine', () => {
        expect(isStageRefusal('Unfortunately, you find nothing of interest.')).toBe(true);
        expect(isStageRefusal('unfortunately you find nothing of interest')).toBe(true);
    });

    test('the identify refusal is recognised', () => {
        expect(isLevelRefusal('You cannot identify this herb.')).toBe(true);
    });

    test('a successful search or identify is not a refusal', () => {
        for (const line of [
            'You search the wall...',
            'You find a herb.',
            'You identify the herb. It is Rogues Purse.',
            'You need a higher Herblore level.'
        ]) {
            expect(isStageRefusal(line)).toBe(false);
            expect(isLevelRefusal(line)).toBe(false);
        }
    });
});
