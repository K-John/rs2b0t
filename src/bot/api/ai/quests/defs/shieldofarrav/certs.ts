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
    return bankedId(snap, SOA_ID.CERTIFICATE);
}

/** Both halves in one pack, the only thing the curator answers to; runs before any handoff. */
export function curatorStep(snap: QuestSnapshot, gang: ArravGang): QuestStep | null {
    const mine = heldId(snap, ownHalf(gang));
    const theirs = heldId(snap, otherHalf(gang));
    // Why: he mints two per pair and stops the moment either varp goes complete, so this is the only window.
    return mine > 0 && theirs > 0 ? { kind: 'talk', stop: CURATOR } : null;
}

// Why: this runs after the handoffs, so the partner is paid before this bot spends the last certificate it holds.

/** Redeeming, withdrawing and banking the surplus; null when nothing is due. */
export function certStep(snap: QuestSnapshot, gang: ArravGang): QuestStep | null {
    const held = certsHeld(snap);
    const banked = certsBanked(snap);
    const target = Math.max(1, ArravConfig.certTarget);
    // Why: only the phoenix bot mints — it is the one that reaches Straven and the curator unaided — so only it is held to the stockpile target.
    const minting = gang === 'phoenix';
    // Why: `target` counts certificates minted, and one of every pair goes to the partner, so the bank is two short at the end.
    const doneMinting = !minting || held + banked >= target || banked >= Math.max(0, target - 2);

    if (doneMinting) {
        if (held > 0) {
            return { kind: 'talk', stop: ROALD };
        }
        if (banked > 0) {
            return {
                kind: 'withdraw',
                items: [{ name: 'Certificate', qty: 1, id: SOA_ID.CERTIFICATE }]
            };
        }
        return null;
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
