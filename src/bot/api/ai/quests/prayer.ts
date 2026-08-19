// docs/reference/quest-provisioning.md
import type { QuestPrayer, ProtectionKind } from './engine/types.js';

/** Points at which a dose is worth more than the swing it costs. */
export const PRAYER_FLOOR = 25;

/** Level 43 gates Protect from Melee, the highest of the three. */
export const PROTECT_LEVEL: Record<ProtectionKind, number> = {
    magic: 37,
    missiles: 40,
    melee: 43
};

export const PROTECTION_NAME: Record<ProtectionKind, string> = {
    melee: 'Protect from Melee',
    magic: 'Protect from Magic',
    missiles: 'Protect from Missiles'
};

/** The dose the engine draws into the float; the smaller flasks are drunk if the bank only has those. */
export const PRAYER_POTION = 'Prayer potion(4)';

/** Every dose form, so a half-used flask still counts as a dose in the pack. */
export const PRAYER_POTION_IDS: readonly number[] = [2434, 139, 141, 143];

export type PrayerAction = 'none' | 'protect' | 'drink' | 'drop';

export interface PrayerUpkeepInput {
    inCombat: boolean;
    protectActive: boolean;
    protectAvailable: boolean;
    points: number;
    doses: number;
}

/**
 * Why: the server runs one op per tick and drops the rest, so upkeep names a single action and the caller spends the tick on it.
 * Why: protection is dropped the instant a fight ends — held through the walk out it empties the flask the next fight was carrying.
 */
export function prayerUpkeepAction(input: PrayerUpkeepInput): PrayerAction {
    if (!input.inCombat) {
        return input.protectActive ? 'drop' : 'none';
    }
    if (input.points <= PRAYER_FLOOR && input.doses > 0) {
        return 'drink';
    }
    if (!input.protectActive && input.protectAvailable) {
        return 'protect';
    }
    return 'none';
}

export function protectionName(pray: QuestPrayer): string {
    return PROTECTION_NAME[pray.protect];
}

export function protectionLevel(pray: QuestPrayer): number {
    return PROTECT_LEVEL[pray.protect];
}
