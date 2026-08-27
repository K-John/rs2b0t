import { describe, expect, test } from 'bun:test';
import { offerMatchesExactly, parseTradeSpecs } from '../src/bot/scripts/MuleTrader/MuleTraderLogic.js';

describe('MuleTrader configuration', () => {
    test('parses and merges case-insensitive item quantities', () => {
        expect(parseTradeSpecs('Rune essence:5000, Lobster:1_000; lobster:25')).toEqual([
            { name: 'Rune essence', quantity: 5000 },
            { name: 'Lobster', quantity: 1025 }
        ]);
    });

    test('rejects malformed or non-positive quantities', () => {
        expect(() => parseTradeSpecs('Lobster')).toThrow();
        expect(() => parseTradeSpecs('Lobster:0')).toThrow();
    });
});

describe('MuleTrader offer safety', () => {
    const specs = parseTradeSpecs('Rune essence:5000, Lobster:1000');

    test('requires the exact configured bundle', () => {
        expect(offerMatchesExactly([
            { id: 1, name: 'Rune essence', count: 5000 },
            { id: 2, name: 'Lobster', count: 1000 }
        ], specs)).toBe(true);
        expect(offerMatchesExactly([{ id: 1, name: 'Rune essence', count: 4999 }], specs)).toBe(false);
    });

    test('rejects unexpected extra items', () => {
        expect(offerMatchesExactly([
            { id: 1, name: 'Rune essence', count: 5000 },
            { id: 2, name: 'Lobster', count: 1000 },
            { id: 3, name: 'Coins', count: 1 }
        ], specs)).toBe(false);
    });
});
