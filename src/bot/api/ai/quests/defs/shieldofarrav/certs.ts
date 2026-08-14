import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { CURATOR, ROALD, SOA_ID } from './areas.js';
import { ArravConfig, type ArravGang } from './config.js';
import { bankedId, heldId, otherHalf, ownHalf } from './state.js';

/** `ownsInventory` skips the engine's food provisioning, so the module's own deposits have to spare it. */
export const SUSTAIN_KEEP: readonly string[] = ['lobster', 'swordfish', 'tuna', 'trout', 'salmon'];

/** Everything the module keeps out of a deposit while it is minting. */
export const CERT_KEEP_IDS: readonly number[] = [
    SOA_ID.CERTIFICATE,
    SOA_ID.SHIELD_PHOENIX,
    SOA_ID.SHIELD_BLACKARM,
    SOA_ID.STORE_KEY,
    SOA_ID.COINS
];

export function certsHeld(snap: QuestSnapshot): number {
    return heldId(snap, SOA_ID.CERTIFICATE);
}

export function certsBanked(snap: QuestSnapshot): number {
    return snap.bankKnown ? bankedId(snap, SOA_ID.CERTIFICATE) : 0;
}

/**
 * Everything certificate-shaped, in priority order. Returns null when nothing is
 * due, so the caller falls through to the gang legs.
 */
export function certStep(snap: QuestSnapshot, gang: ArravGang): QuestStep | null {
    const mine = heldId(snap, ownHalf(gang));
    const theirs = heldId(snap, otherHalf(gang));
    // Why: the curator wants both halves in one pack and mints two, and he stops the moment either varp goes complete.
    if (mine > 0 && theirs > 0) {
        return { kind: 'talk', stop: CURATOR };
    }

    const held = certsHeld(snap);
    const total = held + certsBanked(snap);
    const target = Math.max(1, ArravConfig.certTarget);

    if (total >= target) {
        if (held > 0) {
            return { kind: 'talk', stop: ROALD };
        }
        return {
            kind: 'withdraw',
            items: [{ name: 'Certificate', qty: 1, id: SOA_ID.CERTIFICATE }]
        };
    }

    // Why: a spare half cannot be banked — the chest and cupboard re-check the bank — so only the certificate stockpiles.
    if (held >= 2) {
        return {
            kind: 'deposit',
            keep: [...SUSTAIN_KEEP],
            keepIds: CERT_KEEP_IDS.filter(id => id !== SOA_ID.CERTIFICATE)
        };
    }

    return null;
}
