import { beforeEach, describe, expect, test } from 'bun:test';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import { DEFAULT_FOOD, foodOf, gearOf, scriptFood, suppliesOf } from '#/bot/items/loadoutPlan.js';
import { Loadouts } from '#/bot/items/loadoutStore.js';
import type { Loadout } from '#/bot/items/loadouts.js';

const melee: Loadout = {
    name: 'melee',
    worn: { righthand: 'Rune scimitar', torso: 'Rune chainbody' },
    carry: [{ item: 'Prayer potion(4)', qty: 2 }, { item: 'Lobster', qty: 16 }]
};

beforeEach(() => {
    Loadouts.save([]);
});

describe('foodOf', () => {
    test('is the first carried item the catalog calls edible', () => {
        expect(foodOf(melee)).toBe('Lobster');
    });

    test('ignores drinkables', () => {
        expect(foodOf({ name: 'a', worn: {}, carry: [{ item: 'Prayer potion(4)', qty: 2 }] }))
            .toBe(DEFAULT_FOOD);
    });

    test('falls back when nothing edible is carried', () => {
        expect(foodOf({ name: 'a', worn: {}, carry: [] })).toBe(DEFAULT_FOOD);
    });

    test('falls back when there is no loadout at all', () => {
        expect(foodOf(null)).toBe(DEFAULT_FOOD);
    });
});

describe('gearOf', () => {
    test('lists everything worn', () => {
        expect(gearOf(melee).sort()).toEqual(['Rune chainbody', 'Rune scimitar']);
    });

    test('no loadout is no gear, not a throw', () => {
        expect(gearOf(null)).toEqual([]);
    });
});

describe('suppliesOf', () => {
    test('is the carry list', () => {
        expect(suppliesOf(melee)).toEqual(melee.carry);
    });

    test('no loadout is no supplies', () => {
        expect(suppliesOf(null)).toEqual([]);
    });
});

describe('scriptFood', () => {
    test('is the selected loadout food', () => {
        Loadouts.save([{ name: 'melee', worn: {}, carry: [{ item: 'Shark', qty: 10 }] }]);
        expect(scriptFood(new SettingsBag({ loadout: 'melee' }))).toBe('Shark');
    });

    test('falls back with no loadout so nobody ends up foodless', () => {
        expect(scriptFood(new SettingsBag({}))).toBe(DEFAULT_FOOD);
    });
});
