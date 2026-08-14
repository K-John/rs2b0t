import { describe, expect, test } from 'bun:test';

import { SOA_STAGE } from '#/bot/api/ai/quests/defs/shieldofarrav/journal.js';
import { decideHandoff, type HandoffInput } from '#/bot/api/ai/quests/defs/shieldofarrav/partner.js';

function input(over: Partial<HandoffInput>): HandoffInput {
    return {
        gang: 'phoenix',
        stage: SOA_STAGE.PHOENIX_JOINED,
        hasKey: false,
        hasOwnHalf: false,
        hasOtherHalf: false,
        certs: 0,
        certTarget: 2,
        partnerConfigured: true,
        gaveHalf: false,
        ...over
    };
}

describe('arrav handoffs', () => {
    test('no partner means no handoff at all', () => {
        expect(decideHandoff(input({ partnerConfigured: false, hasKey: true }))).toBeNull();
        expect(decideHandoff(input({
            gang: 'blackarm', stage: SOA_STAGE.KATRINE_TASK, partnerConfigured: false
        }))).toBeNull();
    });

    test('a joined phoenix bot hands its spare key over', () => {
        expect(decideHandoff(input({ hasKey: true }))).toBe('give-key');
    });

    test('a phoenix bot below the join has no key to give', () => {
        expect(decideHandoff(input({ stage: SOA_STAGE.KILL_JONNY, hasKey: true }))).toBeNull();
    });

    test('a keyless black arm bot on the crossbow task asks for one', () => {
        expect(decideHandoff(input({ gang: 'blackarm', stage: SOA_STAGE.KATRINE_TASK }))).toBe('take-key');
    });

    test('a black arm bot that already holds the key asks for nothing', () => {
        expect(decideHandoff(input({
            gang: 'blackarm', stage: SOA_STAGE.KATRINE_TASK, hasKey: true
        }))).toBeNull();
    });

    test('a black arm bot holding its half gives it to the minter', () => {
        expect(decideHandoff(input({
            gang: 'blackarm', stage: SOA_STAGE.BLACKARM_JOINED, hasOwnHalf: true
        }))).toBe('give-half');
    });

    test('a phoenix bot holding only its own half waits to receive the other', () => {
        expect(decideHandoff(input({ hasOwnHalf: true }))).toBe('take-half');
    });

    test('a phoenix bot with both halves does not trade — it mints', () => {
        expect(decideHandoff(input({ hasOwnHalf: true, hasOtherHalf: true }))).toBeNull();
    });

    test('two certificates at target are split with the partner', () => {
        expect(decideHandoff(input({ certs: 2, certTarget: 2 }))).toBe('give-cert');
    });

    test('two certificates below target are not split yet', () => {
        expect(decideHandoff(input({ certs: 2, certTarget: 10 }))).toBeNull();
    });

    test('ten certificates at a target of ten are split', () => {
        expect(decideHandoff(input({ certs: 10, certTarget: 10 }))).toBe('give-cert');
    });

    test('a black arm bot that gave its half away collects a certificate', () => {
        expect(decideHandoff(input({
            gang: 'blackarm', stage: SOA_STAGE.BLACKARM_JOINED, hasOwnHalf: false, certs: 0, gaveHalf: true
        }))).toBe('take-cert');
    });

    // Why: the two states look identical in the snapshot, and asking first leaves the bot waiting for a certificate only its own half can buy.
    test('a black arm bot that has never farmed a half is left to the cupboard leg', () => {
        expect(decideHandoff(input({
            gang: 'blackarm', stage: SOA_STAGE.BLACKARM_JOINED, hasOwnHalf: false, certs: 0, gaveHalf: false
        }))).toBeNull();
    });

    test('a black arm bot that already holds a certificate is done trading', () => {
        expect(decideHandoff(input({
            gang: 'blackarm', stage: SOA_STAGE.BLACKARM_JOINED, certs: 1
        }))).toBeNull();
    });

    test('the key hand-over stops once the quest is complete', () => {
        expect(decideHandoff(input({ stage: SOA_STAGE.COMPLETE, hasKey: true }))).toBeNull();
    });
});
