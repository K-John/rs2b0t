import { expect, test } from 'bun:test';

import { blessPrayerFloor, needsDose } from '#/bot/api/ai/quests/defs/legends/shaman.js';

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

// Why: the stat block lags the server by a tick or two, so a throw made straight after a miss reads a bar that has not fallen yet — Gujuo refuses on his own gate and the throw is spent learning what the miss had already said. At forty-two that doubled every miss: eighteen throws to land nine rolls, against a budget of twenty.
test('a miss is counted rather than waited for', () => {
    expect(needsDose('missed', 42)).toBe(true);
    expect(needsDose('missed', 37)).toBe(true);
});

// Why: his refusal is the server's own word on the prayer bar, so it is believed whatever the stat block has caught up to.
test('a refusal is believed over the stat block', () => {
    expect(needsDose('refused', 99)).toBe(true);
});

// Why: a bar with room to spare after the five points does not want a dose — every one above the gate buys worse odds.
test('a miss with room to spare does not drink', () => {
    expect(needsDose('missed', 99)).toBe(false);
    expect(needsDose('quiet', 20)).toBe(false);
});
