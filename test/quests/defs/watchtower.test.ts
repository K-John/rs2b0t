import { describe, expect, test } from 'bun:test';
import { CRYSTALS, WT_ITEM, watchtowerArea } from '#/bot/quests/defs/watchtower/areas.js';
import { WATCHTOWER_STAGE, parseWatchtowerJournal } from '#/bot/quests/defs/watchtower/journal.js';
import { flagValue, hasFlag } from '#/bot/quests/engine/types.js';
import type { QuestSnapshot } from '#/bot/quests/engine/types.js';
import { decide, watchtower } from '#/bot/quests/defs/watchtower/index.js';

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

describe('parseWatchtowerJournal', () => {
    test('not started', () => {
        const p = parseWatchtowerJournal('@dbl@I can start this quest by speaking to the @dre@Watchtower wizard');
        expect(p?.stage).toBe(WATCHTOWER_STAGE.NOT_STARTED);
    });

    test('started, before and after the fingernails are found', () => {
        expect(parseWatchtowerJournal([
            '@dbl@I accepted the challenge of finding the lost @dre@crystals.',
            '@dbl@I need to @dre@find evidence@dbl@ of what has happened.'
        ])?.stage).toBe(WATCHTOWER_STAGE.STARTED);
        expect(parseWatchtowerJournal([
            '@dbl@I accepted the challenge of finding the lost @dre@crystals.',
            '@dbl@I found some @dre@fingernails@dbl@ as evidence.'
        ])?.stage).toBe(WATCHTOWER_STAGE.STARTED);
    });

    test('the tribal block reports which tribes are helped', () => {
        const p = parseWatchtowerJournal([
            '@str@I found some fingernails as evidence.',
            '|@dbl@Now I need to @dre@deal with the tribal ogres.||',
            "@str@I returned Og's stolen gold.",
            "@dbl@Grew wants me to give him @dre@one of Gorad's teeth.",
            '@dbl@Toban wants the @dre@bones of an adult dragon.'
        ]);
        expect(p?.stage).toBe(WATCHTOWER_STAGE.GIVEN_FINGERNAILS);
        expect(hasFlag(p, 'helped-og')).toBe(true);
        expect(hasFlag(p, 'spoken-og')).toBe(true);
        expect(hasFlag(p, 'spoken-grew')).toBe(true);
        expect(hasFlag(p, 'helped-grew')).toBe(false);
        expect(hasFlag(p, 'spoken-toban')).toBe(true);
        expect(hasFlag(p, 'helped-toban')).toBe(false);
    });

    test('newest entry wins: the riddle line outranks the tribal block', () => {
        const p = parseWatchtowerJournal([
            '@str@I found some fingernails as evidence.',
            '|@dbl@Now I need to @dre@deal with the tribal ogres.||',
            "@str@I returned Og's stolen gold.",
            '@dbl@Some guards gave me a @dre@puzzle to solve.'
        ]);
        expect(p?.stage).toBe(WATCHTOWER_STAGE.GIVEN_RIDDLE);
    });

    test('the map block reports whether the map is carried and which words are known', () => {
        const p = parseWatchtowerJournal([
            '|@str@I was given a map by the guard.|',
            '@dbl@I have it with me now, so I can navigate the skavid caves.|',
            '|@dbl@I have been taught a few words of the skavid language:|',
            "|@dre@'Cur bidith' - 'Ig'|",
            "|@dre@'Gor cur' - 'Ar'|"
        ]);
        expect(p?.stage).toBe(WATCHTOWER_STAGE.SOLVED_RIDDLE);
        expect(hasFlag(p, 'has-map')).toBe(true);
        expect(hasFlag(p, 'learning-skavid')).toBe(true);
        expect(hasFlag(p, 'learned-ig')).toBe(true);
        expect(hasFlag(p, 'learned-ar')).toBe(true);
        expect(hasFlag(p, 'learned-cur')).toBe(false);
        expect(hasFlag(p, 'learned-nod')).toBe(false);
    });

    test('a map left in the bank is reported as not carried', () => {
        const p = parseWatchtowerJournal([
            '|@str@I was given a map by the guard.|',
            '@dbl@I do not have the map with me now, so I cannot navigate the caves.|'
        ]);
        expect(p?.stage).toBe(WATCHTOWER_STAGE.SOLVED_RIDDLE);
        expect(hasFlag(p, 'has-map')).toBe(false);
    });

    test('the potion block counts the shamans still standing', () => {
        const p = parseWatchtowerJournal([
            '|@str@I have made the ogre potion.|',
            '@str@I gave the potion to the wizard.|',
            '@str@He infused it into a magic ogre potion.|',
            '@str@I need to defeat the ogre shamans.|',
            '|@dbl@Now I need to @dre@kill 4 ogre shaman(s).|'
        ]);
        expect(p?.stage).toBe(WATCHTOWER_STAGE.MADE_POTION);
        expect(flagValue(p, 'shamans-left')).toBe(4);
    });

    test('all shamans dead reports zero left, and the mined rock', () => {
        const p = parseWatchtowerJournal([
            '|@str@I have made the ogre potion.|',
            '@str@He infused it into a magic ogre potion.|',
            '|@str@I killed all the ogre shamans.||',
            '@dbl@I have @dre@mined the sacred rock@dbl@ and have taken the last @dre@crystal.|'
        ]);
        expect(flagValue(p, 'shamans-left')).toBe(0);
        expect(hasFlag(p, 'mined-rock')).toBe(true);
    });

    test('stage 11 is reported once the crystals are handed over', () => {
        const p = parseWatchtowerJournal([
            '|@str@I need to return all the crystals to the Watchtower wizard.|',
            '|@dbl@I have taken the crystals to the Watchtower wizard. Now I need to throw the @dre@lever@dbl@ to @dre@activate the shield@dbl@.'
        ]);
        expect(p?.stage).toBe(WATCHTOWER_STAGE.FOUND_ALL_CRYSTALS);
    });

    test('complete', () => {
        const p = parseWatchtowerJournal(['@str@My task here is done.|', '|@dre@QUEST COMPLETE!|']);
        expect(p?.stage).toBe(WATCHTOWER_STAGE.COMPLETE);
    });

    test('unrecognised journal text yields undefined, never a default stage', () => {
        expect(parseWatchtowerJournal(['something else entirely'])).toBeUndefined();
    });
});

function snapshot(o: Partial<QuestSnapshot> = {}): QuestSnapshot {
    return {
        journal: o.journal ?? 'inProgress',
        inv: o.inv ?? new Map(),
        invIds: o.invIds ?? new Map(),
        worn: o.worn ?? new Set(),
        wornIds: o.wornIds ?? new Set(),
        noProgress: 0,
        bankCoins: o.bankCoins ?? 0,
        stage: o.stage ?? o.progress?.stage,
        progress: o.progress,
        bank: o.bank ?? new Map(),
        bankIds: o.bankIds ?? new Map(),
        bankKnown: o.bankKnown ?? true,
        tile: o.tile === undefined ? { x: 2612, z: 3092, level: 0 } : o.tile,
        freeSlots: o.freeSlots ?? 28
    };
}

describe('watchtower decide — terminal cases', () => {
    test('a complete journal is done', () => {
        expect(decide(snapshot({ journal: 'complete' })).kind).toBe('done');
    });

    test('stage 13 is done even before the journal colour catches up', () => {
        expect(decide(snapshot({ stage: WATCHTOWER_STAGE.COMPLETE })).kind).toBe('done');
    });

    test('an unloaded journal waits — it is not notStarted', () => {
        expect(decide(snapshot({ journal: 'unknown' })).kind).toBe('wait');
    });

    test('a missing stage waits rather than guessing', () => {
        expect(decide(snapshot({ stage: undefined })).kind).toBe('wait');
    });

    test('an unknown location waits rather than acting on a guess', () => {
        expect(decide(snapshot({ stage: 2, tile: null })).kind).toBe('wait');
    });

    test('the module owns its inventory and reads progress, not a bare stage', () => {
        expect(watchtower.ownsInventory).toBe(true);
        expect(watchtower.readProgress).toBeDefined();
        expect(watchtower.record.id).toBe('itwatchtower');
        expect(watchtower.record.name).toBe('Watch Tower');
    });

    test('the record demands exactly the three drop-only items from the bank', () => {
        expect(watchtower.record.items.map(i => i.name).sort()).toEqual(['Bat bones', 'Dragon bones', 'Guam leaf']);
        expect(watchtower.record.items.every(i => i.kind === 'mustHave')).toBe(true);
    });
});
