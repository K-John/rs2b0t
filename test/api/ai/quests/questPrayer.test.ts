import { describe, expect, test } from 'bun:test';
import { PRAYER_FLOOR, PROTECTION_NAME, prayerUpkeepAction } from '#/bot/api/ai/quests/prayer.js';

const base = {
    inCombat: true,
    protectActive: false,
    protectAvailable: true,
    points: 70,
    doses: 2
};

describe('PROTECTION_NAME', () => {
    test('names the three protection prayers the Prayer API knows', () => {
        expect(PROTECTION_NAME.melee).toBe('Protect from Melee');
        expect(PROTECTION_NAME.magic).toBe('Protect from Magic');
        expect(PROTECTION_NAME.missiles).toBe('Protect from Missiles');
    });
});

describe('prayerUpkeepAction', () => {
    test('raises protection on entering a fight', () => {
        expect(prayerUpkeepAction(base)).toBe('protect');
    });

    test('does nothing once protection is up and points are healthy', () => {
        expect(prayerUpkeepAction({ ...base, protectActive: true })).toBe('none');
    });

    test('drops protection the moment the fight ends, so the walk out does not drain it', () => {
        expect(prayerUpkeepAction({ ...base, inCombat: false, protectActive: true })).toBe('drop');
    });

    test('stays quiet out of combat with nothing lit', () => {
        expect(prayerUpkeepAction({ ...base, inCombat: false })).toBe('none');
    });

    test('drinks at the floor before topping the prayer back up', () => {
        expect(prayerUpkeepAction({ ...base, protectActive: true, points: PRAYER_FLOOR })).toBe('drink');
        expect(prayerUpkeepAction({ ...base, points: PRAYER_FLOOR })).toBe('drink');
    });

    test('with no doses left it holds what protection it can rather than idling', () => {
        expect(prayerUpkeepAction({ ...base, points: PRAYER_FLOOR, doses: 0 })).toBe('protect');
        expect(prayerUpkeepAction({ ...base, points: PRAYER_FLOOR, doses: 0, protectActive: true })).toBe('none');
    });

    test('an unavailable prayer never asks for a toggle that cannot land', () => {
        expect(prayerUpkeepAction({ ...base, protectAvailable: false })).toBe('none');
        expect(prayerUpkeepAction({ ...base, protectAvailable: false, points: 0 })).toBe('drink');
    });

    test('an empty bar out of combat is left alone', () => {
        expect(prayerUpkeepAction({ ...base, inCombat: false, points: 0 })).toBe('none');
    });
});
