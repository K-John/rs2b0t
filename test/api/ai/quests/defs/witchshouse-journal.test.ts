import { describe, expect, test } from 'bun:test';
import { WH_STAGE, parseWitchsHouseJournal } from '#/bot/api/ai/quests/defs/witchshouse/journal.js';

// Pages copied from content `ball_journal.rs2`, struck-through history and all.
const INTRO =
    '@str@A small boy has kicked his ball over the fence into the|@str@nearby garden, and I have agreed to retrieve it for him.|';
const MAGNET_DONE = '@str@I have found a magnet in a cupboard in the basement.|';

describe('parseWitchsHouseJournal', () => {
    test('an empty page is unreadable rather than not started', () => {
        expect(parseWitchsHouseJournal('')).toBeUndefined();
    });

    test('a page from another quest is unreadable', () => {
        expect(parseWitchsHouseJournal('@dbl@I should speak to Duke Horacio.')).toBeUndefined();
    });

    test('not started', () => {
        const text =
            '@dbl@I can start this quest by speaking to the @dre@little boy|@dbl@standing by the long garden just @dre@north of taverley|'
            + '@dbl@I must be able to defeat a @dre@level 53 enemy';
        expect(parseWitchsHouseJournal(text)?.stage).toBe(WH_STAGE.NOT_STARTED);
    });

    test('started', () => {
        const text = INTRO + '@dbl@I should find a way into the @dre@garden@dbl@ where the @dre@ball@dbl@ is';
        expect(parseWitchsHouseJournal(text)?.stage).toBe(WH_STAGE.STARTED);
    });

    test('magnet found', () => {
        const text = INTRO + '@dbl@I have found a @dre@magnet@dbl@ in a cupboard in the basement';
        expect(parseWitchsHouseJournal(text)?.stage).toBe(WH_STAGE.FOUND_MAGNET);
    });

    test('the back door outranks the magnet line it still carries', () => {
        const text =
            INTRO + MAGNET_DONE + '@dbl@I have worked out how to unlock the back door to the|@dre@garden';
        expect(parseWitchsHouseJournal(text)?.stage).toBe(WH_STAGE.UNLOCKED_DOOR);
    });

    test('the experiment is dead', () => {
        const text = INTRO + "@dbl@Now the @dre@shapeshifter@dbl@ is dead I should return the boy's @dre@ball";
        expect(parseWitchsHouseJournal(text)?.stage).toBe(WH_STAGE.DEFEATED);
    });

    test('complete', () => {
        const text =
            INTRO
            + '@str@After puzzling through the strangely elaborate security|@str@system, and defeating a very strange monster, I returned|'
            + "@str@the child's ball to him, and he thanked me for my help.||@red@QUEST COMPLETE!";
        expect(parseWitchsHouseJournal(text)?.stage).toBe(WH_STAGE.COMPLETE);
    });

    test('the journal arrives as separate lines as well as one string', () => {
        const lines = [
            '@str@A small boy has kicked his ball over the fence into the',
            'nearby garden, and I have agreed to retrieve it for him.',
            '@dbl@I have found a @dre@magnet@dbl@ in a cupboard in the basement'
        ];
        expect(parseWitchsHouseJournal(lines)?.stage).toBe(WH_STAGE.FOUND_MAGNET);
    });

    // Why: `witches_diary.rs2` moves the varp 3 → 5 and `ball_journal.rs2` renders both cases from the
    // same branch, so the read is invisible to the client and the module tracks it itself.
    test('reading the diary leaves the page identical to stage 3', () => {
        const text =
            INTRO + MAGNET_DONE + '@dbl@I have worked out how to unlock the back door to the|@dre@garden';
        expect(parseWitchsHouseJournal(text)?.stage).toBe(WH_STAGE.UNLOCKED_DOOR);
        expect(WH_STAGE.READ_DIARY).toBeGreaterThan(WH_STAGE.UNLOCKED_DOOR);
    });

    test('a colour tag inside a needle still matches once normalized', () => {
        const spliced = INTRO + '@dbl@I have worked out how to@dre@ unlock the back door to the|@dre@garden';
        expect(parseWitchsHouseJournal(spliced)?.stage).toBe(WH_STAGE.UNLOCKED_DOOR);
    });
});
