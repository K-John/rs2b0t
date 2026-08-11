import type { Loadout } from '../items/loadouts.js';

/**
 * The loadout the host selected, for quest modules to wear.
 *
 * Modules have no settings bag of their own, so AIOQuester resolves the
 * selection once at startup and parks it here — the same shape as QuestFood.
 * Nothing infers gear: what the player declared is what gets worn.
 */
export const QuestLoadout = { current: null as Loadout | null };
