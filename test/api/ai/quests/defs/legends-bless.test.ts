import { expect, test } from 'bun:test';

import { blessPrayerFloor } from '#/bot/api/ai/quests/defs/legends/shaman.js';

/** `gujuo_bless_bowl`'s roll: `stat_random(prayer, 80, 250)`, where true is the miss. */
function missChance(points: number): number {
    const value = Math.floor((80 * (99 - points)) / 98) + Math.floor((250 * (points - 1)) / 98) + 1;
    return value / 256;
}

// Why: the roll rises about 1.73 for every point of prayer, so the trance is likelier to fail the more devout you are — a dose above the gate buys worse odds, and topping up to a margin was paying for them.
test('the trance only gets harder as prayer rises', () => {
    expect(missChance(42)).toBeLessThan(missChance(70));
    expect(missChance(70)).toBeLessThan(missChance(99));
});

// Why: Gujuo refuses below forty-two and the odds are best at exactly forty-two, so the gate is both the floor and the target however high the bar goes.
test('the floor is the gate itself, whatever the bar can hold', () => {
    expect(blessPrayerFloor()).toBe(42);
    expect(missChance(blessPrayerFloor())).toBeLessThan(missChance(43));
});
