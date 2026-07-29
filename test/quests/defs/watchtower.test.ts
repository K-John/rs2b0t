import { describe, expect, test } from 'bun:test';
import { CRYSTALS, WT_ITEM, watchtowerArea } from '#/bot/quests/defs/watchtower/areas.js';

const at = (x: number, z: number, level = 0) => ({ x, z, level });

describe('watchtowerArea', () => {
    test('classifies each sealed pocket by a tile inside it', () => {
        expect(watchtowerArea(at(2544, 3112, 2))).toBe('towerFloor');
        expect(watchtowerArea(at(2513, 3084))).toBe('grewIsland');
        expect(watchtowerArea(at(2576, 3027))).toBe('tobanCamp');
        expect(watchtowerArea(at(2526, 3018))).toBe('lowerCity');
        expect(watchtowerArea(at(2541, 3029))).toBe('cityGuard');
        expect(watchtowerArea(at(2504, 9441))).toBe('skavidCaves');
        expect(watchtowerArea(at(2588, 9410))).toBe('enclave');
        expect(watchtowerArea(at(2928, 4715, 2))).toBe('mirrorTower');
    });

    test('the city-guard pocket is not swallowed by the lower city', () => {
        expect(watchtowerArea(at(2530, 3029))).toBe('cityGuard');
        expect(watchtowerArea(at(2531, 3026))).toBe('lowerCity');
    });

    test('the tower floor is level 2 only — the ground below it is Yanille', () => {
        expect(watchtowerArea(at(2544, 3112, 0))).toBe('yanille');
        expect(watchtowerArea(at(2544, 3112, 1))).toBe('yanille');
    });

    test('everything else on the surface is yanille', () => {
        expect(watchtowerArea(at(2612, 3092))).toBe('yanille');
        expect(watchtowerArea(at(2544, 3134))).toBe('yanille');
        expect(watchtowerArea(at(2505, 3023))).toBe('yanille');
        expect(watchtowerArea(at(2506, 3116))).toBe('yanille');
    });

    test('a null tile is unknown, never a default area', () => {
        expect(watchtowerArea(null)).toBe('unknown');
        expect(watchtowerArea(undefined)).toBe('unknown');
    });
});

describe('watchtower items', () => {
    test('all four crystals share one display name, so ids are the only safe key', () => {
        expect(new Set(CRYSTALS.map(c => c.name)).size).toBe(1);
        expect(new Set(CRYSTALS.map(c => c.id)).size).toBe(4);
    });

    test('the engine names that differ from the wiki are recorded exactly', () => {
        expect(WT_ITEM.FINGERNAILS.name).toBe('Finger nails');
        expect(WT_ITEM.STOLEN_GOLD.name).toBe('Gold');
        expect(WT_ITEM.OGRE_POTION.name).toBe('Potion');
        expect(WT_ITEM.GUAM_VIAL.name).toBe('Unfinished potion');
        expect(WT_ITEM.GUAM_JANGER_VIAL.name).toBe('Vial');
    });
});
