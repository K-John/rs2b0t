import { beforeEach, describe, expect, test } from 'bun:test';

import { SM_ID, SM_STAGE } from '#/bot/api/ai/quests/defs/mortton/areas.js';
import { forgetCures } from '#/bot/api/ai/quests/defs/mortton/supplies.js';
import { decide, mortton } from '#/bot/api/ai/quests/defs/mortton/index.js';
import { SM_FLAG } from '#/bot/api/ai/quests/defs/mortton/journal.js';
import { QUEST_DEFS } from '#/bot/api/ai/quests/defs/index.js';
import { QuestFood } from '#/bot/api/ai/quests/food.js';
import { FOOD_TARGET } from '#/bot/api/ai/quests/defs/mortton/supplies.js';
import {
    BUILD_SETS,
    buildersOrder,
    generalOrder,
    PASTE_PER_SET,
    setsThatFit
} from '#/bot/api/ai/quests/defs/mortton/town.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

const MORTTON = { x: 3490, z: 3290, level: 0 };
const FOOD = QuestFood.name ?? 'Trout';

/** Coins, food, a tinderbox, the ashes and the pyre log — everything the approach kit asks for. */
function snap(options: {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    flags?: string[];
    invIds?: [number, number][];
    bankIds?: [number, number][];
    food?: number;
} = {}): QuestSnapshot {
    const stage = options.stage ?? SM_STAGE.NOT_STARTED;
    const inv = new Map<string, number>([[FOOD.toLowerCase(), options.food ?? 6]]);
    return {
        journal: options.journal ?? (stage === SM_STAGE.NOT_STARTED ? 'notStarted' : 'inProgress'),
        inv,
        invIds: new Map([
            [SM_ID.COINS, 30_000],
            [SM_ID.TINDERBOX, 1],
            [SM_ID.ASHES, 2],
            [SM_ID.LOGS, 1],
            ...(options.invIds ?? [])
        ]),
        worn: new Set(),
        wornIds: new Set(),
        noProgress: 0,
        bankCoins: 2_000_000,
        stage,
        progress: { stage, flags: new Set(options.flags ?? []) },
        bank: new Map([['coins', 2_000_000], [FOOD.toLowerCase(), 100]]),
        bankIds: new Map(options.bankIds ?? []),
        bankKnown: true,
        tile: MORTTON,
        freeSlots: 14
    };
}

const step = (options: Parameters<typeof snap>[0] = {}): QuestStep => decide(snap(options));
const named = (s: QuestStep): string => (s.kind === 'custom' ? s.name : s.kind);

/** Two brewed serums, the state the quest carries from stage 10 on. */
const SERUMS: [number, number][] = [[SM_ID.SERUM3, 2]];

describe('shades of mortton decide', () => {
    test('an unloaded journal waits rather than restarting the quest', () => {
        expect(step({ journal: 'unknown' })).toEqual({ kind: 'wait', reason: 'quest journal not loaded' });
    });

    test('a complete journal is done', () => {
        expect(step({ journal: 'complete', stage: SM_STAGE.COMPLETE })).toEqual({ kind: 'done' });
    });

    test('an unreadable stage waits', () => {
        const s = decide({ ...snap({ journal: 'inProgress' }), stage: undefined, progress: undefined });
        expect(s).toEqual({ kind: 'wait', reason: 'quest stage not readable' });
    });

    test('the diary is taken before it is read', () => {
        expect(named(step())).toBe("take Herbi Flax's diary");
        expect(named(step({ invIds: [[SM_ID.DIARY, 1]] }))).toBe("read Herbi Flax's diary");
    });
});

describe('the serum chain', () => {
    test('a started quest with no herb searches the smashed table', () => {
        expect(named(step({ stage: SM_STAGE.READ_DIARY }))).toBe('search the smashed table for herbs');
    });

    test('an unidentified herb is identified', () => {
        const s = step({ stage: SM_STAGE.READ_DIARY, invIds: [[SM_ID.UNID_TARROMIN, 2]] });
        expect(named(s)).toBe('identify the tarromin');
    });

    test('a clean tarromin with no glass fetches an empty vial', () => {
        const s = step({ stage: SM_STAGE.READ_DIARY, invIds: [[SM_ID.TARROMIN, 1]] });
        expect(named(s)).toBe('take an empty vial');
    });

    test('an empty vial is filled at the sink', () => {
        const s = step({ stage: SM_STAGE.READ_DIARY, invIds: [[SM_ID.TARROMIN, 1], [SM_ID.VIAL_EMPTY, 1]] });
        expect(named(s)).toBe('fill a vial at the sink');
    });

    test('a herb and water make the unfinished potion', () => {
        const s = step({ stage: SM_STAGE.READ_DIARY, invIds: [[SM_ID.TARROMIN, 1], [SM_ID.VIAL_WATER, 1]] });
        expect(named(s)).toBe('mix the unfinished potion');
    });

    test('the unfinished potion takes the ashes', () => {
        const s = step({ stage: SM_STAGE.READ_DIARY, invIds: [[SM_ID.TARROMIN_UNF, 1]] });
        expect(named(s)).toBe('mix serum 207');
    });

    test('two vials of serum are enough for the whole quest, so the chain stops', () => {
        expect(named(step({ stage: SM_STAGE.MADE_SERUM, invIds: SERUMS }))).toBe('talk to Razmire');
    });

    test('one vial past the shade hunt still covers what is left', () => {
        const s = step({ stage: SM_STAGE.SHADES_TO_ULSQUIRE, invIds: [[SM_ID.SERUM2, 1]] });
        expect(named(s)).toBe('talk to Ulsquire');
    });
});

describe('sourcing', () => {
    test('an empty pack scans the bank before anything else', () => {
        const bare = snap();
        bare.invIds = new Map();
        bare.bankKnown = false;
        expect(decide(bare).kind).toBe('scanBank');
    });

    test('a missing tinderbox with an empty bank is bought in Varrock', () => {
        const bare = snap();
        bare.invIds = new Map([[SM_ID.COINS, 30_000], [SM_ID.ASHES, 2], [SM_ID.LOGS, 1]]);
        const s = decide(bare);
        expect(s.kind).toBe('buy');
        expect(s.kind === 'buy' && s.item).toBe('Tinderbox');
    });

    test('a banked tinderbox is withdrawn rather than bought', () => {
        const bare = snap({ bankIds: [[SM_ID.TINDERBOX, 1]] });
        bare.invIds = new Map([[SM_ID.COINS, 30_000], [SM_ID.ASHES, 2], [SM_ID.LOGS, 1]]);
        const s = decide(bare);
        expect(s.kind).toBe('withdraw');
    });

    test('a banked melee kit is drawn before the swamp crossing', () => {
        const bare = snap();
        bare.bank = new Map([['coins', 2_000_000], ['rune scimitar', 1], ['rune chainbody', 1]]);
        const s = decide(bare);
        expect(s.kind).toBe('withdraw');
        expect(s.kind === 'withdraw' && s.items.map(i => i.name)).toEqual(['Rune scimitar', 'Rune chainbody']);
    });

    test('a carried kit is worn rather than withdrawn again', () => {
        const bare = snap();
        bare.inv = new Map([[FOOD.toLowerCase(), 6], ['rune scimitar', 1]]);
        bare.bank = new Map([['coins', 2_000_000], ['rune scimitar', 1]]);
        expect(named(decide(bare))).toBe('wear Rune scimitar');
    });

    test('no ashes means a trip to the logs, once an axe is in hand', () => {
        const bare = snap();
        bare.invIds = new Map([[SM_ID.COINS, 30_000], [SM_ID.TINDERBOX, 1], [SM_ID.LOGS, 1]]);
        bare.inv = new Map([[FOOD.toLowerCase(), 6], ['bronze axe', 1]]);
        expect(named(decide(bare))).toBe('burn logs for ashes');
    });

    test('pyre logs in the pack retire the spare log', () => {
        const bare = snap({ invIds: [[SM_ID.PYRE_LOGS, 1]], stage: SM_STAGE.CREATED_PYRE_LOGS });
        bare.invIds = new Map([
            [SM_ID.COINS, 30_000], [SM_ID.TINDERBOX, 1], [SM_ID.PYRE_LOGS, 1], [SM_ID.SERUM3, 1]
        ]);
        expect(named(decide(bare))).toBe('stack the pyre logs');
    });
});

// Why: Mort'ton has 29 dead trees and the Varrock spawn is a swamp crossing away, so the leg chops locally — which needs an axe the quest never carried before.
describe('the axe', () => {
    /** A pack that owes ashes: a tinderbox and the pyre log, nothing to burn for the serum. */
    function needsAshes(): QuestSnapshot {
        const bare = snap();
        bare.invIds = new Map([[SM_ID.COINS, 30_000], [SM_ID.TINDERBOX, 1], [SM_ID.LOGS, 1]]);
        return bare;
    }

    test('a banked axe is drawn before the burn', () => {
        const bare = needsAshes();
        bare.bank = new Map([['coins', 2_000_000], ['steel axe', 1]]);
        const s = decide(bare);
        expect(s.kind).toBe('withdraw');
        expect(s.kind === 'withdraw' && s.items.map(i => i.name)).toEqual(['Steel axe']);
    });

    test('the best banked axe wins', () => {
        const bare = needsAshes();
        bare.bank = new Map([['coins', 2_000_000], ['bronze axe', 1], ['rune axe', 1]]);
        const s = decide(bare);
        expect(s.kind === 'withdraw' && s.items.map(i => i.name)).toEqual(['Rune axe']);
    });

    test('no axe anywhere is bought from Bob in Lumbridge', () => {
        const s = decide(needsAshes());
        expect(s.kind).toBe('buy');
        expect(s.kind === 'buy' && s.item).toBe('Bronze axe');
        expect(s.kind === 'buy' && s.shop?.npc).toBe('Bob');
    });

    test('a worn axe counts, so nothing is bought', () => {
        const bare = needsAshes();
        bare.worn = new Set(['bronze axe']);
        expect(named(decide(bare))).toBe('burn logs for ashes');
    });

    // Why: the axe is only wanted for the logs — a pack that owes none should not detour to Lumbridge.
    test('a pack with its ashes already burnt wants no axe', () => {
        expect(named(step({ stage: SM_STAGE.READ_DIARY }))).toBe('search the smashed table for herbs');
    });
});

describe('the shade hunt', () => {
    for (const stage of [SM_STAGE.KILL_SHADES, SM_STAGE.KILLED_1, SM_STAGE.KILLED_4]) {
        test(`stage ${stage} hunts`, () => {
            expect(named(step({ stage, invIds: SERUMS }))).toBe('hunt a Loar Shade');
        });
    }

    test('the fifth kill still hunts while the pack is short of remains', () => {
        const s = step({ stage: SM_STAGE.KILLED_5, invIds: [...SERUMS, [SM_ID.REMAINS, 4]] });
        expect(named(s)).toBe('hunt a Loar Shade');
    });

    test('five sets of remains go to Razmire with the shopping list', () => {
        const s = step({ stage: SM_STAGE.KILLED_5, invIds: [...SERUMS, [SM_ID.REMAINS, 5]] });
        expect(named(s)).toBe('hand Razmire the remains and stock up');
    });
});

describe('the temple', () => {
    const stocked: [number, number][] = [
        [SM_ID.HAMMER, 1], [SM_ID.OLIVE_OIL3, 1],
        [SM_ID.PLANK, 5], [SM_ID.LIMESTONE_BRICK, 5], [SM_ID.SWAMP_PASTE, 30]
    ];

    // Why: the oil has nowhere to land beside eleven slots of plank, brick and paste, so it waits for the rebuild to spend them.
    test('the handover trip buys building material and leaves the oil for later', () => {
        const s = step({ stage: SM_STAGE.SHADES_TO_RAZMIRE, invIds: [...SERUMS, [SM_ID.HAMMER, 1], [SM_ID.REMAINS, 3]] });
        expect(named(s)).toBe('buy temple materials from Razmire');
    });

    test('a stocked pack past the handover shows the remains to Ulsquire', () => {
        const s = step({ stage: SM_STAGE.SHADES_TO_RAZMIRE, invIds: [...SERUMS, ...stocked, [SM_ID.REMAINS, 3]] });
        expect(named(s)).toBe('talk to Ulsquire');
    });

    test('a missing hammer sends the bot to the general counter', () => {
        const s = step({ stage: SM_STAGE.ULSQUIRE_TEMPLE, invIds: [...SERUMS, [SM_ID.OLIVE_OIL3, 1]] });
        expect(named(s)).toBe("buy from Razmire's general store");
    });

    test('an empty material pool sends the bot to the builders counter', () => {
        const s = step({ stage: SM_STAGE.ULSQUIRE_TEMPLE, invIds: [...SERUMS, [SM_ID.HAMMER, 1], [SM_ID.OLIVE_OIL3, 1]] });
        expect(named(s)).toBe('buy temple materials from Razmire');
    });

    test('a pool that still has resources builds without shopping', () => {
        const s = step({
            stage: SM_STAGE.REBUILD_TEMPLE,
            invIds: [...SERUMS, [SM_ID.HAMMER, 1], [SM_ID.OLIVE_OIL3, 1]],
            flags: [`${SM_FLAG.RESOURCES}:40`]
        });
        expect(named(s)).toBe('rebuild the Flamtaer temple');
    });

    test('carried materials build without shopping', () => {
        const s = step({ stage: SM_STAGE.ULSQUIRE_TEMPLE, invIds: [...SERUMS, ...stocked] });
        expect(named(s)).toBe('rebuild the Flamtaer temple');
    });

    test('the rebuilt temple lights the altar', () => {
        const s = step({ stage: SM_STAGE.CAN_LIGHT_ALTAR, invIds: [...SERUMS, ...stocked] });
        expect(named(s)).toBe('light the altar and sanctify the oil');
    });

    test('an altar with nothing to sanctify buys oil first, and the hammer is no longer wanted', () => {
        const s = step({ stage: SM_STAGE.CAN_LIGHT_ALTAR, invIds: SERUMS });
        expect(named(s)).toBe("buy from Razmire's general store");
    });

    test('pyre logs already made count as oil, so the altar leg runs', () => {
        const s = step({
            stage: SM_STAGE.CAN_LIGHT_ALTAR,
            invIds: [...SERUMS, [SM_ID.PYRE_LOGS, 1]],
            flags: [`${SM_FLAG.SANCTITY}:40`, `${SM_FLAG.REPAIRED}:100`]
        });
        expect(named(s)).toBe('light the altar and sanctify the oil');
    });

    // Why: sanctity is a player varp, so a temple another run left finished still owes this character a load of material before the flame answers.
    test('a rebuilt temple with no sanctity of its own buys material first', () => {
        const s = step({ stage: SM_STAGE.CAN_LIGHT_ALTAR, invIds: [...SERUMS, [SM_ID.HAMMER, 1], [SM_ID.OLIVE_OIL3, 1]] });
        expect(named(s)).toBe('buy temple materials from Razmire');
    });
});

describe('the permanent cure', () => {
    const late: [number, number][] = [[SM_ID.REMAINS, 2], [SM_ID.HAMMER, 1], [SM_ID.SACRED_OIL3, 1]];
    const sanctified = [`${SM_FLAG.SANCTITY}:40`, `${SM_FLAG.REPAIRED}:100`];

    beforeEach(() => forgetCures());

    // Why: past the altar the quest visits Razmire only if a restock is owed, so a leg of its own is what guarantees both shopkeepers get the dose.
    test('a sanctified vial sends the bot back to both shopkeepers', () => {
        const s = step({ stage: SM_STAGE.CREATED_SACRED_OIL, invIds: [...late, [SM_ID.SERUM_PERM3, 1]], flags: sanctified });
        expect(named(s)).toBe('cure Razmire and Ulsquire for good');
    });

    test('a plain serum 207 is not the permanent cure, so the pyre leg runs', () => {
        const s = step({ stage: SM_STAGE.CREATED_SACRED_OIL, invIds: [...late, [SM_ID.SERUM3, 1]], flags: sanctified });
        expect(named(s)).toBe('soak the logs in sacred oil');
    });

    // Why: the flame is the earliest the cure can happen at all, so a run holding a sanctified vial at stage 60 should spend it before the oil trip pays Razmire another dose.
    test('a vial made at the flame is spent before the stage-60 oil trip', () => {
        const s = step({ stage: SM_STAGE.CAN_LIGHT_ALTAR, invIds: [[SM_ID.HAMMER, 1], [SM_ID.SERUM_PERM3, 1]], flags: sanctified });
        expect(named(s)).toBe('cure Razmire and Ulsquire for good');
    });

    // Why: the cure leg walks to Razmire itself, so it goes in front of the restock rather than after it.
    test('the cure comes before a restock at the same stage', () => {
        const bare: [number, number][] = [[SM_ID.REMAINS, 2], [SM_ID.HAMMER, 1], [SM_ID.SERUM3, 1]];
        expect(named(step({ stage: SM_STAGE.CREATED_SACRED_OIL, invIds: bare, flags: sanctified })))
            .toBe("buy from Razmire's general store");
        expect(named(step({ stage: SM_STAGE.CREATED_SACRED_OIL, invIds: [...bare, [SM_ID.SERUM_PERM3, 1]], flags: sanctified })))
            .toBe('cure Razmire and Ulsquire for good');
    });
});

describe('the cremation', () => {
    const late: [number, number][] = [[SM_ID.SERUM3, 1], [SM_ID.REMAINS, 2], [SM_ID.HAMMER, 1]];
    /** A standing temple and the sanctity it left behind, which the flame legs no longer have to earn. */
    const sanctified = [`${SM_FLAG.SANCTITY}:40`, `${SM_FLAG.REPAIRED}:100`];

    test('sacred oil goes onto the logs', () => {
        const s = step({ stage: SM_STAGE.CREATED_SACRED_OIL, invIds: [...late, [SM_ID.SACRED_OIL3, 1]], flags: sanctified });
        expect(named(s)).toBe('soak the logs in sacred oil');
    });

    test('a sacred-oil stage with no oil left goes back to the flame', () => {
        const s = step({ stage: SM_STAGE.CREATED_SACRED_OIL, invIds: [...late, [SM_ID.OLIVE_OIL3, 1]], flags: sanctified });
        expect(named(s)).toBe('sanctify more oil in the flame');
    });

    test('pyre logs are stacked', () => {
        const s = step({ stage: SM_STAGE.CREATED_PYRE_LOGS, invIds: [...late, [SM_ID.PYRE_LOGS, 1]] });
        expect(named(s)).toBe('stack the pyre logs');
    });

    test('a stacked pyre takes the remains and the flame', () => {
        const s = step({ stage: SM_STAGE.LOGS_ON_PYRE, invIds: late });
        expect(named(s)).toBe('cremate the shade');
    });

    test('a lit pyre is reported to Ulsquire', () => {
        const s = step({ stage: SM_STAGE.LIT_PYRE, invIds: late });
        expect(named(s)).toBe('talk to Ulsquire');
    });
});

describe('the shopping list', () => {
    test('the builders order is five sets of material', () => {
        expect(buildersOrder().items.map(i => [i.name, i.qty])).toEqual([
            ['Swamp paste', BUILD_SETS * PASTE_PER_SET],
            ['Plank', BUILD_SETS],
            ['Limestone brick', BUILD_SETS]
        ]);
        // Paste is one stack whatever the count, so the order carries more than the five-per-set the build spends.
        expect(PASTE_PER_SET).toBeGreaterThanOrEqual(5);
    });

    // Why: eleven slots is what five sets need, and a pack with less room buys fewer sets rather than parking on a refusal.
    test('the order shrinks to the room the pack has', () => {
        expect(setsThatFit(14)).toBe(BUILD_SETS);
        expect(setsThatFit(11)).toBe(5);
        expect(setsThatFit(9)).toBe(4);
        expect(setsThatFit(3)).toBe(1);
        expect(setsThatFit(2)).toBe(0);
        expect(buildersOrder(2).items.map(i => i.qty)).toEqual([2 * PASTE_PER_SET, 2, 2]);
    });

    test('each counter is named by a line from both shapes of Razmire menu', () => {
        expect(buildersOrder().asks).toContain('I keep running out of building materials');
        expect(buildersOrder().asks).toContain('Can I see the building store');
        expect(generalOrder({ hammer: true, oil: true }).asks).toContain('Can you open a store for me');
        expect(generalOrder({ hammer: true, oil: true }).asks).toContain('Can I see the general store');
    });

    // Why: Morytania has no bank to trim against, so the stage-45 pack has to hold every purchase at once.
    test('the stage-45 loadout and both counters fit one pack', () => {
        const carried = 1 + 1 + 2 + 3 + 1 + FOOD_TARGET;   // coins, tinderbox, two serums, three remains, logs, food
        const shopped = 1 + 1 + 2 * BUILD_SETS;            // hammer, the paste stack, planks and bricks
        expect(carried + shopped).toBeLessThanOrEqual(28);
    });
});

describe('module wiring', () => {
    test('the module is registered after Nature Spirit', () => {
        const ids = QUEST_DEFS.map(d => d.record.id);
        expect(ids).toContain('mortton');
        expect(ids.indexOf('mortton')).toBeGreaterThan(ids.indexOf('druidspirit'));
    });

    test('the record carries the official gates', () => {
        expect(mortton.record.questPoints).toBe(3);
        expect(mortton.record.requirements.quests).toEqual(['priestperil']);
        expect(mortton.record.requirements.skills).toEqual([
            { skill: 'crafting', level: 20 },
            { skill: 'herblore', level: 15 },
            { skill: 'firemaking', level: 5 }
        ]);
    });

    test('the module owns its own loadout and reads its own progress', () => {
        expect(mortton.ownsInventory).toBe(true);
        expect(typeof mortton.readProgress).toBe('function');
        expect(mortton.sustain?.foods).toContain('Lobster');
    });
});
