import { describe, expect, test } from 'bun:test';

import { HERO_STAGE } from '#/bot/api/ai/quests/defs/heroquest/journal.js';
import { decideHeroHandoff, type HeroHandoffInput } from '#/bot/api/ai/quests/defs/heroquest/partner.js';

function input(over: Partial<HeroHandoffInput> = {}): HeroHandoffInput {
    return {
        gang: 'blackarm',
        stage: HERO_STAGE.STARTED,
        hasKey: false,
        candlesticks: 0,
        partnerConfigured: true,
        ...over
    };
}

describe('decideHeroHandoff', () => {
    test('nothing is owed while no partner is configured', () => {
        expect(decideHeroHandoff(input({
            partnerConfigured: false,
            stage: HERO_STAGE.BLACKARM_PAPERS_GIVEN,
            hasKey: true
        }))).toBeNull();
    });

    // Why: `open_and_close_door` teleports the actor and re-shuts in three ticks, so the Black Arm bot
    // cannot hold the side door open — the tradeable spare key is the only way the rival gets in.
    test('the Black Arm bot gives the spare key the moment Grip issues it', () => {
        expect(decideHeroHandoff(input({
            stage: HERO_STAGE.BLACKARM_PAPERS_GIVEN,
            hasKey: true
        }))).toBe('give-key');
    });

    test('it does not give a key it has not been handed', () => {
        expect(decideHeroHandoff(input({ stage: HERO_STAGE.BLACKARM_PAPERS_GIVEN }))).toBeNull();
    });

    test('it does not give the key before Grip has taken the papers', () => {
        expect(decideHeroHandoff(input({ stage: HERO_STAGE.BLACKARM_MANSION, hasKey: true }))).toBeNull();
    });

    // Why: the chest hands over exactly two, one of which is the rival's payment for the kill.
    test('two candlesticks owes the rival one', () => {
        expect(decideHeroHandoff(input({
            stage: HERO_STAGE.BLACKARM_LOOTED,
            candlesticks: 2
        }))).toBe('give-candlestick');
    });

    test('the last candlestick is Katrine’s, not the rival’s', () => {
        expect(decideHeroHandoff(input({
            stage: HERO_STAGE.BLACKARM_LOOTED,
            candlesticks: 1
        }))).toBeNull();
    });

    test('the Phoenix bot asks for the key once Charlie has shown the door', () => {
        expect(decideHeroHandoff(input({
            gang: 'phoenix',
            stage: HERO_STAGE.PHOENIX_CHARLIE
        }))).toBe('take-key');
    });

    test('it stops asking once it holds one', () => {
        expect(decideHeroHandoff(input({
            gang: 'phoenix',
            stage: HERO_STAGE.PHOENIX_CHARLIE,
            hasKey: true
        }))).toBeNull();
    });

    test('after the kill the Phoenix bot waits on its candlestick', () => {
        expect(decideHeroHandoff(input({
            gang: 'phoenix',
            stage: HERO_STAGE.PHOENIX_KILLED_GRIP
        }))).toBe('take-candlestick');
    });

    test('and stops once it has one', () => {
        expect(decideHeroHandoff(input({
            gang: 'phoenix',
            stage: HERO_STAGE.PHOENIX_KILLED_GRIP,
            candlesticks: 1
        }))).toBeNull();
    });

    test('an armbanded bot on either side owes nothing', () => {
        expect(decideHeroHandoff(input({
            stage: HERO_STAGE.BLACKARM_ARMBAND,
            hasKey: true,
            candlesticks: 2
        }))).toBeNull();
        expect(decideHeroHandoff(input({
            gang: 'phoenix',
            stage: HERO_STAGE.PHOENIX_ARMBAND,
            candlesticks: 0
        }))).toBeNull();
    });
});
