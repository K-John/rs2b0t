import { afterEach, describe, expect, test } from 'bun:test';

import { SOA_ID } from '#/bot/api/ai/quests/defs/shieldofarrav/areas.js';
import { certStep, certsBanked, certsHeld, curatorStep } from '#/bot/api/ai/quests/defs/shieldofarrav/certs.js';
import { ArravConfig } from '#/bot/api/ai/quests/defs/shieldofarrav/config.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

const VARROCK = { x: 3253, z: 3420, level: 0 };

function snap(invIds: [number, number][] = [], bankIds: [number, number][] = [], bankKnown = true): QuestSnapshot {
    return {
        journal: 'inProgress',
        inv: new Map(),
        invIds: new Map(invIds),
        worn: new Set(),
        wornIds: new Set(),
        noProgress: 0,
        bankCoins: 0,
        bank: new Map(),
        bankIds: new Map(bankIds),
        bankKnown,
        tile: VARROCK as QuestSnapshot['tile'],
        freeSlots: 20
    };
}

afterEach(() => {
    ArravConfig.certTarget = 2;
});

describe('arrav certificates', () => {
    test('counts read inventory and bank by id', () => {
        const s = snap([[SOA_ID.CERTIFICATE, 2]], [[SOA_ID.CERTIFICATE, 3]]);
        expect(certsHeld(s)).toBe(2);
        expect(certsBanked(s)).toBe(3);
    });

    test('an unread bank counts as zero, not as empty', () => {
        const s = snap([], [[SOA_ID.CERTIFICATE, 3]], false);
        expect(certsBanked(s)).toBe(0);
    });

    test('both halves go to the curator, whichever gang holds them', () => {
        const s = snap([[SOA_ID.SHIELD_PHOENIX, 1], [SOA_ID.SHIELD_BLACKARM, 1]]);
        expect(curatorStep(s, 'phoenix')).toMatchObject({ kind: 'custom' });
        expect(curatorStep(s, 'blackarm')).toMatchObject({ kind: 'custom' });
    });

    test('the curator is due even with a certificate already held', () => {
        const s = snap([[SOA_ID.SHIELD_PHOENIX, 1], [SOA_ID.SHIELD_BLACKARM, 1], [SOA_ID.CERTIFICATE, 1]]);
        expect(curatorStep(s, 'phoenix')).toMatchObject({ kind: 'custom' });
    });

    test('one half alone is never a curator trip', () => {
        expect(curatorStep(snap([[SOA_ID.SHIELD_PHOENIX, 1]]), 'phoenix')).toBeNull();
        expect(curatorStep(snap([[SOA_ID.SHIELD_BLACKARM, 1]]), 'blackarm')).toBeNull();
    });

    test('a black arm bot redeems a received certificate whatever the mint target', () => {
        ArravConfig.certTarget = 10;
        expect(certStep(snap([[SOA_ID.CERTIFICATE, 1]]), 'blackarm'))
            .toMatchObject({ kind: 'custom' });
    });

    test('a phoenix bot mid-stockpile keeps farming rather than redeeming its last one', () => {
        ArravConfig.certTarget = 10;
        expect(certStep(snap([[SOA_ID.CERTIFICATE, 1]]), 'phoenix')).toBeNull();
    });

    test('a phoenix bot two short of target redeems, because one of each pair went to the partner', () => {
        ArravConfig.certTarget = 10;
        expect(certStep(snap([[SOA_ID.CERTIFICATE, 1]], [[SOA_ID.CERTIFICATE, 8]]), 'phoenix'))
            .toMatchObject({ kind: 'custom' });
    });

    test('a banked certificate at target is withdrawn', () => {
        const step = certStep(snap([], [[SOA_ID.CERTIFICATE, 2]]), 'phoenix');
        expect(step).toMatchObject({ kind: 'withdraw' });
        expect((step as { items: { id: number }[] }).items[0].id).toBe(SOA_ID.CERTIFICATE);
    });

    test('a held certificate at target is taken to the king', () => {
        const s = snap([[SOA_ID.CERTIFICATE, 1]], [[SOA_ID.CERTIFICATE, 1]]);
        expect(certStep(s, 'phoenix')).toMatchObject({ kind: 'custom' });
    });

    test('below target the surplus banks instead of being redeemed', () => {
        ArravConfig.certTarget = 10;
        const step = certStep(snap([[SOA_ID.CERTIFICATE, 2]]), 'phoenix');
        expect(step).toMatchObject({ kind: 'deposit' });
        expect((step as { keepIds: readonly number[] }).keepIds).not.toContain(SOA_ID.CERTIFICATE);
    });

    test('a banking deposit spares the halves, the key, coins and food', () => {
        ArravConfig.certTarget = 10;
        const step = certStep(snap([[SOA_ID.CERTIFICATE, 2]]), 'phoenix') as {
            keep: string[];
            keepIds: readonly number[];
        };
        expect(step.keepIds).toContain(SOA_ID.SHIELD_PHOENIX);
        expect(step.keepIds).toContain(SOA_ID.SHIELD_BLACKARM);
        expect(step.keepIds).toContain(SOA_ID.STORE_KEY);
        expect(step.keepIds).toContain(SOA_ID.COINS);
        expect(step.keep).toContain('lobster');
    });

    test('one certificate below target is left alone so the gang legs farm another half', () => {
        ArravConfig.certTarget = 10;
        expect(certStep(snap([[SOA_ID.CERTIFICATE, 1]]), 'phoenix')).toBeNull();
    });

    test('nothing certificate-shaped yields null so the gang legs run', () => {
        expect(certStep(snap(), 'phoenix')).toBeNull();
    });

    test('one half alone leaves the certificate step idle', () => {
        expect(certStep(snap([[SOA_ID.SHIELD_PHOENIX, 1]]), 'phoenix')).toBeNull();
        expect(certStep(snap([[SOA_ID.SHIELD_BLACKARM, 1]]), 'blackarm')).toBeNull();
    });

    test('an unread bank does not send the bot to a booth for a certificate it never saw', () => {
        expect(certStep(snap([], [[SOA_ID.CERTIFICATE, 5]], false), 'phoenix')).toBeNull();
    });

    test('a target below one is clamped, so a zero setting still redeems', () => {
        ArravConfig.certTarget = 0;
        expect(certStep(snap([[SOA_ID.CERTIFICATE, 1]]), 'phoenix')).toMatchObject({ kind: 'custom' });
    });
});
