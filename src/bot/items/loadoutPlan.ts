import type { SettingsBag } from '../runtime/Settings.js';
import { ITEM_DB } from './data/itemdb.js';
import { selectedLoadout } from './loadoutSetting.js';
import type { CarryEntry, Loadout } from './loadouts.js';

/** What a player with no loadout eats — the commonest of the old per-script defaults. */
export const DEFAULT_FOOD = 'Lobster';

export function foodOf(loadout: Loadout | null): string {
    for (const entry of loadout?.carry ?? []) {
        const wanted = entry.item.toLowerCase();
        const record = ITEM_DB.find(r => r.name.toLowerCase() === wanted);
        if (record?.consumable === 'eat') {
            return record.name;
        }
    }
    return DEFAULT_FOOD;
}

export function gearOf(loadout: Loadout | null): string[] {
    return Object.values(loadout?.worn ?? {});
}

export function suppliesOf(loadout: Loadout | null): CarryEntry[] {
    return [...(loadout?.carry ?? [])];
}

/** What this script should eat, from its own loadout setting. */
export function scriptFood(bag: SettingsBag): string {
    return foodOf(selectedLoadout(bag));
}
