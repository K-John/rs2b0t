import { describe, expect, test } from 'bun:test';

import { shouldWaitOut, vyvinTooClose } from '#/bot/quests/defs/knightssword/portrait.js';

const CUPBOARD_STAND = { x: 2983, z: 3337, level: 2 };
const VYVIN_SPAWN = { x: 2983, z: 3335, level: 2 };

describe('Sir Vyvin proximity guard', () => {
    test('catches you from one tile away, in any direction', () => {
        for (const [dx, dz] of [[0, 1], [1, 0], [1, 1], [-1, -1], [0, -1], [-1, 0]]) {
            const beside = { x: CUPBOARD_STAND.x + dx, z: CUPBOARD_STAND.z + dz, level: 2 };
            expect(vyvinTooClose(CUPBOARD_STAND, beside)).toBe(true);
        }
    });

    test('standing on the same tile counts as too close', () => {
        expect(vyvinTooClose(CUPBOARD_STAND, CUPBOARD_STAND)).toBe(true);
    });

    test('two tiles away is clear', () => {
        expect(vyvinTooClose(CUPBOARD_STAND, { x: 2986, z: 3337, level: 2 })).toBe(false);
        expect(vyvinTooClose(CUPBOARD_STAND, { x: 2984, z: 3339, level: 2 })).toBe(false);
    });

    test('the guard is a square, not a circle', () => {
        // npc_find takes a square radius, so a diagonal neighbour is as close as
        // an orthogonal one. Euclidean distance would call (1,1) 1.41 and let it
        // through.
        const diagonal = { x: CUPBOARD_STAND.x + 1, z: CUPBOARD_STAND.z + 1, level: 2 };
        expect(vyvinTooClose(CUPBOARD_STAND, diagonal)).toBe(true);
    });

    test('his spawn tile is already clear of the stand', () => {
        // The stand is picked so an unmoved Vyvin does not block the first try.
        expect(vyvinTooClose(CUPBOARD_STAND, VYVIN_SPAWN)).toBe(false);
    });

    test('an absent Vyvin never blocks', () => {
        expect(vyvinTooClose(CUPBOARD_STAND, null)).toBe(false);
        expect(vyvinTooClose(null, VYVIN_SPAWN)).toBe(false);
    });
});

describe('the guard is a hint, not a gate', () => {
    const adjacent = { x: CUPBOARD_STAND.x, z: CUPBOARD_STAND.z + 1, level: 2 };

    test('waits out an adjacent Vyvin for a few passes', () => {
        expect(shouldWaitOut(0, CUPBOARD_STAND, adjacent)).toBe(true);
    });

    test('but searches anyway once the skips run out', () => {
        // Sir Vyvin has wanderrange=8 in a room barely wider than that, so he is
        // adjacent most of the time. Treating proximity as a blocker spun every
        // pass without ever clicking, and the quest parked without one attempt.
        const forced = Array.from({ length: 40 }, (_, i) => shouldWaitOut(i, CUPBOARD_STAND, adjacent));
        expect(forced.some(wait => !wait)).toBe(true);
    });

    test('never waits when he is already clear', () => {
        expect(shouldWaitOut(0, CUPBOARD_STAND, VYVIN_SPAWN)).toBe(false);
    });
});
