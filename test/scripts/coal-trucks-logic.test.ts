import { describe, expect, test } from 'bun:test';
import {
    COAL_MINING_LEVEL,
    MINE_TRUCK,
    MINE_TRUCK_STAND,
    SEERS_TRUCK,
    SEERS_TRUCK_STAND,
    TRUCK_MAX,
    classifyDeposit,
    classifyRemove,
    decide,
    phaseAfterDeposit,
    truckEmptyAfterRemove,
    type WorldView
} from '#/bot/scripts/CoalTrucksLogic.js';

describe('classifyDeposit', () => {
    test('whole stack accepted', () => {
        expect(classifyDeposit(['You put the coal in the truck.'])).toBe('all');
    });
    test('partial accept means the truck just hit the cap', () => {
        expect(classifyDeposit(['You put some of the coal in the truck.'])).toBe('partial');
    });
    test('"some" is not misread as "all" — the prefixes overlap', () => {
        expect(classifyDeposit(['You put some of the coal in the truck.'])).not.toBe('all');
    });
    test('already full', () => {
        expect(classifyDeposit(['The coal truck is full.'])).toBe('full');
    });
    test('wrong item is our bug, not a game state', () => {
        expect(classifyDeposit(["The coal truck isn't meant to transport that."])).toBe('wrong-item');
    });
    test('unrelated chatter classifies as none', () => {
        expect(classifyDeposit(['You manage to mine some coal.', 'Oh dear, you are dead!'])).toBe('none');
    });
    test('empty window classifies as none', () => {
        expect(classifyDeposit([])).toBe('none');
    });
    test('the truck line wins even when buried in unrelated chatter', () => {
        expect(classifyDeposit(['You manage to mine some coal.', 'The coal truck is full.'])).toBe('full');
    });
});

describe('classifyRemove', () => {
    test('took the remainder', () => {
        expect(classifyRemove(['You remove the coal from the truck.'])).toBe('all');
    });
    test('pack filled, truck still loaded', () => {
        expect(classifyRemove(['You remove some of the coal from the truck.'])).toBe('partial');
    });
    test('"some" is not misread as "all"', () => {
        expect(classifyRemove(['You remove some of the coal from the truck.'])).not.toBe('all');
    });
    test('truck empty', () => {
        expect(classifyRemove(['There is no coal left in the truck.'])).toBe('empty');
    });
    test('no free slots', () => {
        expect(classifyRemove(['You do not have enough inventory space!'])).toBe('no-space');
    });
    test('unrelated chatter classifies as none', () => {
        expect(classifyRemove(['You manage to mine some coal.'])).toBe('none');
    });
});

describe('phaseAfterDeposit', () => {
    test('a full or partial accept ends the fill phase', () => {
        expect(phaseAfterDeposit('partial')).toBe('run');
        expect(phaseAfterDeposit('full')).toBe('run');
    });
    test('a clean accept keeps filling', () => {
        expect(phaseAfterDeposit('all')).toBe('fill');
    });
    test('an unread or malformed outcome keeps filling — never advance on doubt', () => {
        expect(phaseAfterDeposit('none')).toBe('fill');
        expect(phaseAfterDeposit('wrong-item')).toBe('fill');
    });
});

describe('truckEmptyAfterRemove', () => {
    test('both drained outcomes mean the truck is spent', () => {
        expect(truckEmptyAfterRemove('all')).toBe(true);
        expect(truckEmptyAfterRemove('empty')).toBe(true);
    });
    test('a partial pull leaves coal behind', () => {
        expect(truckEmptyAfterRemove('partial')).toBe(false);
    });
    test('no-space and none are not evidence of an empty truck', () => {
        expect(truckEmptyAfterRemove('no-space')).toBe(false);
        expect(truckEmptyAfterRemove('none')).toBe(false);
    });
});

const view = (over: Partial<WorldView> = {}): WorldView => ({
    phase: 'fill',
    packFull: false,
    coalHeld: 0,
    rockAvailable: true,
    truckEmpty: false,
    hasPickaxe: true,
    atMine: true,
    ...over
});

describe('decide — pickaxe outranks every phase', () => {
    // Live regression: ~maxme grants stats and never gear, so the bot stood in the
    // mine clicking rocks for three minutes with no pickaxe, no message and no xp.
    test('no pickaxe banks instead of mining', () => {
        expect(decide(view({ hasPickaxe: false }))).toEqual({ kind: 'bank' });
    });
    test('no pickaxe banks even mid-run', () => {
        expect(decide(view({ phase: 'run', hasPickaxe: false }))).toEqual({ kind: 'bank' });
    });
    test('no pickaxe banks even with a full pack', () => {
        expect(decide(view({ packFull: true, hasPickaxe: false }))).toEqual({ kind: 'bank' });
    });
});

describe('decide — getting back to the mine', () => {
    // Without this the bot idles at the bank forever after fetching a pickaxe:
    // findRock is leashed to the mine, so rockAvailable is false and it just waits.
    test('walks to the mine when the fill phase starts away from it', () => {
        expect(decide(view({ atMine: false }))).toEqual({ kind: 'travel-to-mine' });
    });
    test('a full pack away from the mine still walks back first', () => {
        expect(decide(view({ atMine: false, packFull: true }))).toEqual({ kind: 'travel-to-mine' });
    });
    test('being away from the mine does not disturb the drain phase', () => {
        expect(decide(view({ phase: 'drain', atMine: false }))).toEqual({ kind: 'remove' });
    });
});

describe('decide — fill', () => {
    test('mines while there is room and a rock', () => {
        expect(decide(view())).toEqual({ kind: 'mine' });
    });
    test('deposits once the pack is full', () => {
        expect(decide(view({ packFull: true }))).toEqual({ kind: 'deposit' });
    });
    test('a full pack deposits even with no rock left', () => {
        expect(decide(view({ packFull: true, rockAvailable: false }))).toEqual({ kind: 'deposit' });
    });
    test('waits for respawn rather than depositing a part load', () => {
        expect(decide(view({ rockAvailable: false, coalHeld: 12 }))).toEqual({ kind: 'await-rocks' });
    });
});

describe('decide — run', () => {
    test('travels to Seers regardless of what is carried', () => {
        expect(decide(view({ phase: 'run', coalHeld: 20 }))).toEqual({ kind: 'travel-to-seers' });
    });
});

describe('decide — drain', () => {
    test('banks what is carried before pulling more', () => {
        expect(decide(view({ phase: 'drain', coalHeld: 28 }))).toEqual({ kind: 'bank' });
    });
    test('banks leftovers carried in from the fill phase', () => {
        expect(decide(view({ phase: 'drain', coalHeld: 20, packFull: false }))).toEqual({ kind: 'bank' });
    });
    test('never removes with a full pack — the engine refuses it', () => {
        expect(decide(view({ phase: 'drain', packFull: true, coalHeld: 28 }))).toEqual({ kind: 'bank' });
    });
    test('removes when empty-handed and the truck still holds coal', () => {
        expect(decide(view({ phase: 'drain' }))).toEqual({ kind: 'remove' });
    });
    test('heads back once the truck is spent and nothing is carried', () => {
        expect(decide(view({ phase: 'drain', truckEmpty: true }))).toEqual({ kind: 'travel-to-mine' });
    });
    test('banks the last load before heading back', () => {
        expect(decide(view({ phase: 'drain', truckEmpty: true, coalHeld: 14 }))).toEqual({ kind: 'bank' });
    });
});

describe('constants match the engine content', () => {
    test('truck cap and coal level come from coal_truck.constant and mine.dbrow', () => {
        expect(TRUCK_MAX).toBe(120);
        expect(COAL_MINING_LEVEL).toBe(30);
    });
    test('each stand is adjacent to its truck', () => {
        expect(MINE_TRUCK_STAND.distanceTo(MINE_TRUCK)).toBe(1);
        expect(SEERS_TRUCK_STAND.distanceTo(SEERS_TRUCK)).toBe(1);
    });
});
