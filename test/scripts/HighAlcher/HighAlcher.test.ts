import { describe, expect, test } from 'bun:test';
import { UNSTRUNG_BOW_IDS } from '#/bot/scripts/HighAlcher/HighAlcher.js';

describe('HighAlcher Unstrung Bow Protection', () => {
    test('contains all known unstrung bow IDs', () => {
        expect(UNSTRUNG_BOW_IDS.has(70)).toBe(true); // Magic longbow (u)
        expect(UNSTRUNG_BOW_IDS.has(66)).toBe(true); // Yew longbow (u)
        expect(UNSTRUNG_BOW_IDS.has(62)).toBe(true); // Maple longbow (u)
        expect(UNSTRUNG_BOW_IDS.has(58)).toBe(true); // Willow longbow (u)
        expect(UNSTRUNG_BOW_IDS.has(56)).toBe(true); // Oak longbow (u)
        expect(UNSTRUNG_BOW_IDS.has(48)).toBe(true); // Longbow (u)
    });

    test('does not blacklist strung bow IDs', () => {
        expect(UNSTRUNG_BOW_IDS.has(859)).toBe(false); // Magic longbow (strung)
        expect(UNSTRUNG_BOW_IDS.has(855)).toBe(false); // Yew longbow (strung)
        expect(UNSTRUNG_BOW_IDS.has(851)).toBe(false); // Maple longbow (strung)
        expect(UNSTRUNG_BOW_IDS.has(847)).toBe(false); // Willow longbow (strung)
        expect(UNSTRUNG_BOW_IDS.has(845)).toBe(false); // Oak longbow (strung)
        expect(UNSTRUNG_BOW_IDS.has(839)).toBe(false); // Longbow (strung)
    });
});
