import { expect, test } from 'bun:test';

import { waterTalkAnswer } from '#/bot/api/ai/quests/defs/legends/shaman.js';

// Why: the caves set `asked_ungadulu_where`, which is what `gujuo_pure_water` gates on — so they are the answer to a menu without the topic on it, and the only such answer.
test('a menu without the topic sends the run to Ungadulu', () => {
    expect(waterTalkAnswer('nogoal')).toBe('caves');
});

// Why: a shaman who never opened his mouth says nothing about the bit. Reading that as a missing topic walked a live leg to the caves and back four times over six minutes, setting a bit that `ungadulu_who` had already set on the first trip.
test('a shaman who never spoke is asked again, not answered with a walk', () => {
    expect(waterTalkAnswer('nodialog')).toBe('retry');
});

test('the sketch in the pack ends the step', () => {
    expect(waterTalkAnswer('goal')).toBe('done');
});
