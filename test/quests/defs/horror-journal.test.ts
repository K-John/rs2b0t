import { describe, expect, test } from 'bun:test';

import { HD_STAGE } from '#/bot/quests/defs/horror/areas.js';
import { BARS } from '#/bot/quests/defs/horror/areas.js';
import { parseCard } from '#/bot/quests/defs/horror/barcrawl.js';
import { HD_FLAG, parseHorrorJournal } from '#/bot/quests/defs/horror/journal.js';

/** Every page here is verbatim from a live client — see `tools/horror-journal-dump.ts`. */
const NOT_STARTED = [
    'Close Window',
    '@dre@Horror from the Deep',
    '@dbl@I can start this quest by speaking to @dre@Larrissa@dbl@ at the',
    '@dbl@@dre@Lighthouse@dbl@ to the @dre@North@dbl@ of the @dre@Barbarian Outpost@dbl@.',
    '@dbl@@dbl@To complete this quest I need:',
    '@dbl@@dre@Level 35 agility',
    '@dre@Level 13 or higher magic will be an advantage',
    '@dre@I must also be able to defeat strong level 100 enemies'
];

// Verbatim from a live client, not from horror_journal.rs2: `~quest_journal`
// word-wraps the page through `split_init` and re-emits the active tags at the
// head of every line it produces, which is where `@str@@bla@` comes from.
const STARTED_NOTHING_DONE = [
    'Close Window',
    '@dre@Horror from the Deep',
    '@dbl@Larrissa is very worried about her boyfriend Jossik.',
    '@dbl@I need to @dre@repair the bridge@dbl@ leading to Rellekka.',
    '@dbl@I also need to get the @dre@lighthouse key@dbl@ from her cousin',
    '@dre@@dre@Gunnjorn@dbl@.'
];

const STARTED_BRIDGE_AND_KEY = [
    'Close Window',
    '@dre@Horror from the Deep',
    '@dbl@Larrissa is very worried about her boyfriend Jossik.',
    '@str@@bla@I need to repair the bridge leading to Rellekka.',
    '@dbl@I also need to use the key I got from Gunnjorn to enter',
    '@dbl@@dbl@the lighthouse.'
];

const BRIDGE_AND_KEY_DONE = [
    'Close Window',
    '@dre@Horror from the Deep',
    '@str@I repaired the bridge leading to Rellekka and got a key',
    '@str@from Gunnjorn so I could enter the lighthouse.'
];

const INSIDE_LIGHTHOUSE = [
    ...BRIDGE_AND_KEY_DONE,
    '@dbl@Now I need to find some way of @dre@fixing@dbl@ the @dre@lighthouse @dre@lamp@dbl@.'
];

const INSIDE_PART_REPAIRED = [
    ...BRIDGE_AND_KEY_DONE,
    '@str@I have fixed the lighthouse lens.',
    '@str@I have re-tarred the lighthouse torch.',
    '@dbl@Now I need to find some way of @dre@fixing@dbl@ the @dre@lighthouse @dre@lamp@dbl@.'
];

const LIGHT_REPAIRED = [
    ...BRIDGE_AND_KEY_DONE,
    '@str@I managed to repair the lighthouse light with some molten',
    '@str@glass, some swamp tar and a tinderbox.',
    '@dbl@I must @dre@search this place@dbl@ and find out what has happened to',
    "@dbl@@dbl@Larrissa's boyfriend @dre@Jossik@dbl@!"
];

const FOUND_JOSSIK = [
    ...BRIDGE_AND_KEY_DONE,
    '@str@I managed to repair the lighthouse light with some molten',
    '@str@glass, some swamp tar and a tinderbox.',
    '@str@I found Jossik in an underground cavern, behind a strange',
    '@str@wall where he had been attacked by some sea @str@creatures.',
    '@dbl@I must defeat these sea monsters to save him!'
];

const COMPLETE = [
    '@str@I travelled to an isolated lighthouse north of the Barbarian|',
    '@str@outpost, to find a Fremennik girl called Larrissa locked|',
    '@str@outside, and worried about her boyfriend Jossik.|',
    "@str@I recovered a spare key from Larrissa's cousin Gunnjorn and ",
    '@str@repaired the bridge to Rellekka with some planks.|',
    '@str@After I killed some strange sea monsters, I managed to|',
    '@str@get Jossik out of the cavern and back to the lighthouse.|||',
    '@red@QUEST COMPLETE!'
];

describe('Horror from the Deep journal', () => {
    test('reads the not-started page', () => {
        expect(parseHorrorJournal(NOT_STARTED)?.stage).toBe(HD_STAGE.NOT_STARTED);
    });

    test('reads a freshly started quest', () => {
        const progress = parseHorrorJournal(STARTED_NOTHING_DONE);
        expect(progress?.stage).toBe(HD_STAGE.STARTED);
        expect(progress?.flags.has(HD_FLAG.BRIDGE)).toBe(false);
        expect(progress?.flags.has(HD_FLAG.KEY)).toBe(false);
    });

    test('reads the bridge off the colour tag, not the words', () => {
        // Both branches print the same sentence; only @str@ against @dbl@ says
        // whether it is struck out, so this flag is read before tags are stripped.
        const progress = parseHorrorJournal(STARTED_BRIDGE_AND_KEY);
        expect(progress?.stage).toBe(HD_STAGE.STARTED);
        expect(progress?.flags.has(HD_FLAG.BRIDGE)).toBe(true);
        expect(progress?.flags.has(HD_FLAG.KEY)).toBe(true);
    });

    test('reads the lighthouse stage', () => {
        const progress = parseHorrorJournal(INSIDE_LIGHTHOUSE);
        expect(progress?.stage).toBe(HD_STAGE.ENTERED_LIGHTHOUSE);
        // The bridge line is gone by now, folded into one struck-out summary —
        // re-asserting it is what stops later stages reading it as unbuilt.
        expect(progress?.flags.has(HD_FLAG.BRIDGE)).toBe(true);
    });

    test('reads part-finished lamp work', () => {
        const progress = parseHorrorJournal(INSIDE_PART_REPAIRED);
        expect(progress?.stage).toBe(HD_STAGE.ENTERED_LIGHTHOUSE);
        expect(progress?.flags.has(HD_FLAG.GLASS)).toBe(true);
        expect(progress?.flags.has(HD_FLAG.TAR)).toBe(true);
        expect(progress?.flags.has(HD_FLAG.LIGHT)).toBe(false);
    });

    test('reads the repaired lighthouse', () => {
        const progress = parseHorrorJournal(LIGHT_REPAIRED);
        expect(progress?.stage).toBe(HD_STAGE.REPAIRED_LIGHTHOUSE);
        expect(progress?.flags.has(HD_FLAG.LIGHT)).toBe(true);
    });

    test('reads the stage after the junior dies', () => {
        expect(parseHorrorJournal(FOUND_JOSSIK)?.stage).toBe(HD_STAGE.DEFEATED_DAGJR);
    });

    test('reads the completed page', () => {
        expect(parseHorrorJournal(COMPLETE)?.stage).toBe(HD_STAGE.COMPLETE);
    });

    test('returns undefined for a page it does not recognise', () => {
        expect(parseHorrorJournal(['@dbl@Something else entirely.'])).toBeUndefined();
    });
});

/** Verbatim from scroll.rs2's `scroll_barcrawl_card`. */
function card(done: readonly string[]): string[] {
    const label: Record<string, string> = {
        bluemoon: 'BlueMoon Inn',
        blurberry: "Blurberry's Bar",
        deadman: "Dead Man's Chest",
        dragoninn: 'Dragon Inn',
        flyinghorse: 'Flying Horse Inn',
        forestersarms: 'Foresters Arms',
        jollyboar: 'Jolly Boar Inn',
        karamjaspirits: 'Karamja Spirits Bar',
        risingsun: 'Rising Sun Inn',
        rustyanchor: 'Rusty Anchor Inn'
    };
    return [
        '@blu@The Official Alfred Grimhand Barcrawl!',
        ...Object.entries(label).map(([key, name]) =>
            done.includes(key) ? `@gre@${name} - Completed!` : `@red@${name} - Not Completed...`)
    ];
}

describe('barcrawl card', () => {
    test('an untouched card leaves every bar outstanding', () => {
        const progress = parseCard(card([]));
        expect(progress?.remaining.length).toBe(BARS.length);
        expect(progress?.done).toBe(false);
    });

    test('a fully signed card is done', () => {
        const progress = parseCard(card(Object.keys({
            bluemoon: 0, blurberry: 0, deadman: 0, dragoninn: 0, flyinghorse: 0,
            forestersarms: 0, jollyboar: 0, karamjaspirits: 0, risingsun: 0, rustyanchor: 0
        })));
        expect(progress?.done).toBe(true);
        expect(progress?.remaining).toEqual([]);
    });

    test('signed bars drop out one at a time', () => {
        // "Completed!" is a substring of "Not Completed...", so a naive match
        // reads every red line as green and the tour stops after one bar.
        const progress = parseCard(card(['jollyboar', 'risingsun']));
        expect(progress?.remaining.map(b => b.line)).not.toContain('jolly boar');
        expect(progress?.remaining.map(b => b.line)).not.toContain('rising sun');
        expect(progress?.remaining.length).toBe(BARS.length - 2);
    });

    test('a page that is not the card reads as nothing', () => {
        expect(parseCard(['@dbl@Some other scroll.'])).toBeNull();
    });
});
