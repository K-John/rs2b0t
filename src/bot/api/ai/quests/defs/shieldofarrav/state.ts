import { Inventory, type InvItem } from '../../../../inventory/Inventory.js';
import type { QuestSnapshot } from '../../engine/types.js';
import { SOA_ID } from './areas.js';
import type { ArravGang } from './config.js';

// Why: Broken shield, Key, Scroll and Certificate each name more than one object, so a name lookup silently accepts the wrong one.

export function heldId(snap: QuestSnapshot, id: number): number {
    return snap.invIds?.get(id) ?? 0;
}

export function bankedId(snap: QuestSnapshot, id: number): number {
    return snap.bankIds?.get(id) ?? 0;
}

/** The half this gang can take for itself. */
export function ownHalf(gang: ArravGang): number {
    return gang === 'phoenix' ? SOA_ID.SHIELD_PHOENIX : SOA_ID.SHIELD_BLACKARM;
}

/** The half only the other gang can reach. */
export function otherHalf(gang: ArravGang): number {
    return gang === 'phoenix' ? SOA_ID.SHIELD_BLACKARM : SOA_ID.SHIELD_PHOENIX;
}

export function liveItem(id: number): InvItem | null {
    return Inventory.items().find(item => item.id === id) ?? null;
}
