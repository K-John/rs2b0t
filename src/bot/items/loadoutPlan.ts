import type { SettingsBag } from '../runtime/Settings.js';
import { ITEM_DB } from './data/itemdb.js';
import { selectedLoadout } from './loadoutSetting.js';
import type { CarryEntry, Loadout } from './loadouts.js';

/**
 * Every accessor here takes the caller's own fallback.
 *
 * A loadout that names nothing for an aspect — no loadout at all, or an empty
 * one, which is what opening the panel and closing it leaves behind — means the
 * player has not chosen, not that they chose nothing. The script then behaves as
 * it did before loadouts existed, so an account that never opens the panel still
 * runs. There is deliberately no house default: the old per-script ones differed
 * (Trout, Lobster, cakes, foodless), and one global value would silently change
 * what half the scripts eat.
 */
export function foodOf(loadout: Loadout | null, fallback: string): string {
    for (const entry of loadout?.carry ?? []) {
        const wanted = entry.item.toLowerCase();
        const record = ITEM_DB.find(r => r.name.toLowerCase() === wanted);
        if (record?.consumable === 'eat') {
            return record.name;
        }
    }
    return fallback;
}

export function gearOf(loadout: Loadout | null): string[] {
    return Object.values(loadout?.worn ?? {});
}

export function suppliesOf(loadout: Loadout | null): CarryEntry[] {
    return [...(loadout?.carry ?? [])];
}

/** The declared weapon, for the fights that need to know they have one. */
export function weaponOf(loadout: Loadout | null, fallback: string | null = null): string | null {
    return loadout?.worn.righthand ?? fallback;
}

/** What this script should eat, from its own loadout setting. */
export function scriptFood(bag: SettingsBag, fallback: string): string {
    return foodOf(selectedLoadout(bag), fallback);
}

/** As {@link scriptFood}, for the scripts that match food by a list of names. */
export function scriptFoods(bag: SettingsBag, fallback: readonly string[]): string[] {
    const chosen = foodOf(selectedLoadout(bag), '');
    return chosen.length > 0 ? [chosen] : [...fallback];
}
