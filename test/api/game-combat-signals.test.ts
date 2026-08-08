import { describe, expect, test } from 'bun:test';

import { RETALIATE_VARP, retaliateOnFromVarp } from '#/bot/api/Game.js';

describe('auto-retaliate varp', () => {
    test('reads option_nodef', () => {
        expect(RETALIATE_VARP).toBe(172);
    });

    test('is inverted — 0 means ON', () => {
        expect(retaliateOnFromVarp(0)).toBe(true);
        expect(retaliateOnFromVarp(1)).toBe(false);
    });
});
