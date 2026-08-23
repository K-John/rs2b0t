import Tile from '../../geometry/Tile.js';
import type { Npc } from '../model/Npc.js';
import type { GroundItem } from '../model/GroundItem.js';

export interface CombatProfile {
    /** Target monster in-game name(s) */
    monsterNames: string[];

    /** Monster-specific death animation IDs (optional, fallback to generic 836) */
    deathAnimations?: number[];

    /** Fighting anchor / center tile and leash radius */
    anchorTile: Tile;
    leashRadius: number;

    /** HP percent threshold to eat food (defaults to 50%) */
    eatAtPercent?: number;

    /** Ground item names to loot after kills (case-insensitive substring/exact match) */
    lootNames?: string[];

    /** Custom loot validator (e.g. herbs, runes, seeds) */
    isWantedLoot?: (item: GroundItem) => boolean;

    /** Whether to bury regular bones on-tick during combat gaps */
    buryBones?: boolean;

    /** Optional custom safespot tile (for ranged/magic) */
    getSafespotTile?: (target: Npc) => Tile | null;

    /** Optional pre-attack check (e.g. anti-dragon shield, prayer, gear check) */
    beforeAttack?: (target: Npc) => Promise<boolean> | boolean;

    /** Optional on-kill hook */
    onKill?: (npc: Npc) => void;
}
