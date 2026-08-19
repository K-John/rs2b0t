import { expect, test } from 'bun:test';

import { blessPrayerFloor } from '#/bot/api/ai/quests/defs/legends/shaman.js';

// Why: the quest asks for prayer 42 and the bar cannot hold more than the level, so a flat fifty-point target is unreachable on the account the requirement describes — it drank a dose before every throw at a full bar and emptied the flask on nothing.
test('the floor never asks for more points than the bar can hold', () => {
    expect(blessPrayerFloor(42)).toBe(42);
    expect(blessPrayerFloor(43)).toBe(43);
});

// Why: Gujuo refuses below forty-two and takes five on a miss, so a bar with room to spare keeps a margin over his gate rather than sitting on it.
test('a bar with room to spare keeps a margin over the gate', () => {
    expect(blessPrayerFloor(60)).toBe(50);
    expect(blessPrayerFloor(99)).toBe(50);
});
