import Tile from '../../../../../geometry/Tile.js';
import type { QuestSnapshot } from '../../engine/types.js';

export interface UpassItem {
    id: number;
    name: string;
}

// Why: the four orbs all display as "Orb of light" and two of the three badges as "Paladin's badge", so every lookup goes through the id.
export const UP_ITEM = {
    COINS: { id: 995, name: 'Coins' },
    LOBSTER: { id: 379, name: 'Lobster' },
    TINDERBOX: { id: 590, name: 'Tinderbox' },
    BUCKET: { id: 1925, name: 'Bucket' },
    ROPE: { id: 954, name: 'Rope' },
    SPADE: { id: 952, name: 'Spade' },
    GAS_MASK: { id: 1506, name: 'Gas mask' },
    SHORTBOW: { id: 841, name: 'Shortbow' },
    BRONZE_ARROW: { id: 882, name: 'Bronze arrow' },
    DAMP_CLOTH: { id: 1485, name: 'Damp cloth' },
    UNLIT_ARROW: { id: 598, name: 'Unlit arrows' },
    LIT_ARROW: { id: 942, name: 'Lit arrows' },
    ORB1: { id: 1481, name: 'Orb of light' },
    ORB2: { id: 1482, name: 'Orb of light' },
    ORB3: { id: 1483, name: 'Orb of light' },
    ORB4: { id: 1484, name: 'Orb of light' },
    RAILING: { id: 1486, name: 'Piece of railing' },
    UNICORN_HORN: { id: 1487, name: 'Unicorn horn' },
    BADGE_JERRO: { id: 1488, name: "Paladin's badge" },
    BADGE_CARL: { id: 1489, name: "Paladin's badge" },
    BADGE_HARRY: { id: 1490, name: "Paladin's badge" },
    WITCH_CAT: { id: 1491, name: 'Witches cat' },
    DOLL: { id: 1492, name: 'Doll of iban' },
    HISTORY: { id: 1494, name: 'History of iban' },
    GAUNTLETS: { id: 1495, name: "Klank's gauntlets" },
    DOVE: { id: 1496, name: "Iban's dove" },
    AMULET_OTHAINIAN: { id: 1497, name: 'Amulet of othanian' },
    AMULET_DOOMION: { id: 1498, name: 'Amulet of doomion' },
    AMULET_HOLTHION: { id: 1499, name: 'Amulet of holthion' },
    SHADOW: { id: 1500, name: "Iban's shadow" },
    DWARF_BREW: { id: 1501, name: 'Dwarf brew' },
    ASHES: { id: 1502, name: "Iban's ashes" },
    IBAN_STAFF: { id: 1409, name: "Iban's staff" }
} as const satisfies Record<string, UpassItem>;

export const UP_ORBS: readonly UpassItem[] = [UP_ITEM.ORB1, UP_ITEM.ORB2, UP_ITEM.ORB3, UP_ITEM.ORB4];
export const UP_BADGES: readonly UpassItem[] = [UP_ITEM.BADGE_JERRO, UP_ITEM.BADGE_CARL, UP_ITEM.BADGE_HARRY];
export const UP_AMULETS: readonly UpassItem[] = [UP_ITEM.AMULET_DOOMION, UP_ITEM.AMULET_OTHAINIAN, UP_ITEM.AMULET_HOLTHION];

// Why: five distinct NPCs all render as "Koftik", so the guide is matched by id and never by name.
export const UP_NPC = {
    KOFTIK_SURFACE: 972,
    KOFTIK_BRIDGE: 973,
    KOFTIK_GRID: 974,
    KOFTIK_INSANE: 975,
    KOFTIK_LAST: 976,
    BOULDER: 986,
    PALADIN_JERRO: 988,
    PALADIN_CARL: 989,
    PALADIN_HARRY: 990,
    WITCH: 992,
    WITCH_CAT: 993,
    NILHOOF: 994,
    KLANK: 995,
    KAMEN: 996,
    KALRAG: 997,
    OTHAINIAN: 998,
    DOOMION: 999,
    HOLTHION: 1000,
    IBAN: 1003
} as const;

export const UP_LOC = {
    CAVE_ENTRANCE: 3213,
    CAVE_EXIT: 3214,
    GUIDEROPE: 3340,
    BRIDGE_LEVER: 3241,
    LOGTRAP_TRIGGER: 3339,
    ORB_VIS: 3361,
    SPEARTRAP: 3234,
    SPRINGTRAP: 3230,
    FURNACE: 3294,
    WELL: 3264,
    // Why: `Read` on a stone tablet only prints a plaque, which makes it the one op-click in the orb
    // corridor with no cost — the walk to it is what the stall is for. The west tablet is the only loc
    // within one loaded scene of every orb, the furnace and the well at once.
    TABLET_WEST: 3298,
    TABLET_EAST: 3297,
    PORTCULLIS_LEVER: 3337,
    PORTCULLIS: 3303,
    GRID_HANDHOLDS: 3365,
    RAILINGS_LOCKED: 3266,
    RAILINGS_LOOSE: 3267,
    RAILINGS_HARD: 3268,
    MUDPILE: 3307,
    UNICORN_CAGE: 3308,
    UNICORN_DOOR_R: 3218,
    UNICORN_DOOR_L: 3219,
    BLOODWELL: 3305,
    TEMPLE_DOOR_L: 3220,
    TEMPLE_DOOR_R: 3221,
    TUNNEL_DOWN: 3222,
    TUNNEL_UP: 3223,
    LEDGE: 3238,
    ROCK_BRIDGE: 3276,
    ROCKSWING: 2275,
    ROCKSWING_ANCHOR: 2276,
    ROCKSWING_BACK: 2274,
    ROCKSLIDE: 3309,
    COLLAPSED_A: 3254,
    COLLAPSED_B: 3255,
    WITCH_DOOR: 3270,
    WITCH_CHEST: 3272,
    SEALED_CHEST: 3274,
    CAGE_DOVE: 3351,
    CAGE_EMPTY: 3352,
    BREW_BARREL: 3344,
    IBAN_TOMB_L: 3353,
    IBAN_TOMB_R: 3354,
    IBAN_DOOR_R: 3333,
    IBAN_DOOR_L: 3334,
    IBAN_ALTAR: 3359,
    LAST_OUT: 3224,
    FOOD_CRATE: 3360,
    PIPE_AREA1: 3235,
    PIPE_AREA2: 3237,
    SWAMP: 3263,
    ROCKPILE: 3265,
    MUD_DIG: 3216,
    WALL_DOOR_L: 2048,
    WALL_DOOR_R: 2049
} as const;

// Why: every tile here that fronts a loc is a STAND, not the loc's own origin — a multi-tile loc covers
// its origin, so walking to it fails outright and the step reads as a missing loc.
export const UP_TILE = {
    ARDOUGNE_BANK: new Tile(2655, 3283, 0),
    LATHAS: new Tile(2578, 3293, 1),
    CASTLE_STAIRS: new Tile(2572, 3296, 0),
    WALL_GATE_EAST: new Tile(2559, 3300, 0),
    WALL_GATE_WEST: new Tile(2555, 3300, 0),
    CAVE_MOUTH: new Tile(2436, 3315, 0),
    CAVE_ENTRANCE: new Tile(2433, 3313, 0),

    AREA1_LANDING: new Tile(2494, 9716, 0),
    KOFTIK_BRIDGE: new Tile(2449, 9716, 0),
    GUIDEROPE_SHOT: new Tile(2448, 9721, 0),
    BRIDGE_WEST: new Tile(2442, 9716, 0),
    BRIDGE_LEVER: new Tile(2436, 9716, 0),

    ROCKSWING_WEST: new Tile(2462, 9699, 0),
    ROCKSWING_EAST: new Tile(2466, 9699, 0),
    GRID_EAST: new Tile(2477, 9677, 0),
    // Why: the stall is launched from Koftik's lip, not the handhold return tile — a tile further out is
    // needed so the journal is up before the player is on the trapped ground, and nothing east of here routes.
    GRID_APPROACH: new Tile(2479, 9679, 0),
    GRID_WEST: new Tile(2467, 9677, 0),
    PORTCULLIS_LEVER: new Tile(2466, 9672, 0),
    FURNACE: new Tile(2454, 9682, 0),
    ORB2: new Tile(2386, 9677, 0),
    ORB3: new Tile(2385, 9685, 0),
    ORB4: new Tile(2416, 9698, 0),
    LOGTRAP: new Tile(2382, 9668, 0),
    WELL: new Tile(2416, 9674, 0),
    CORRIDOR_HUB: new Tile(2422, 9671, 0),

    AREA2_LANDING: new Tile(2423, 9660, 0),
    RAILINGS_LOOSE: new Tile(2397, 9605, 0),
    BOULDER: new Tile(2396, 9595, 0),
    UNICORN_CAGE: new Tile(2371, 9603, 0),
    MUDPILE: new Tile(2423, 9661, 0),
    MUD_DIG: new Tile(2393, 9650, 0),

    PALADINS: new Tile(2424, 9719, 0),
    BLOODWELL: new Tile(2373, 9718, 0),
    TEMPLE_DOOR: new Tile(2371, 9718, 0),

    MAIN_LANDING: new Tile(2173, 4725, 1),
    CAGE_DOVE: new Tile(2134, 4702, 1),

    // Why: the dwarf camp and Kalrag's cave hang off two different level-1 tunnels, so each side keeps both ends.
    TUNNEL_TO_DWARVES: new Tile(2150, 4545, 1),
    TUNNEL_FROM_DWARVES: new Tile(2336, 9793, 0),
    TUNNEL_TO_KALRAG: new Tile(2112, 4729, 1),
    TUNNEL_FROM_KALRAG: new Tile(2304, 9915, 0),

    NILHOOF: new Tile(2315, 9806, 0),
    KLANK: new Tile(2323, 9804, 0),
    KAMEN: new Tile(2325, 9799, 0),
    BREW_BARREL: new Tile(2327, 9799, 0),
    IBAN_TOMB: new Tile(2357, 9800, 0),
    KALRAG: new Tile(2356, 9911, 0),

    WITCH_DOOR: new Tile(2158, 4566, 1),
    WITCH_CHEST: new Tile(2157, 4564, 1),
    WITCH_CAT: new Tile(2131, 4602, 1),
    SEALED_CHEST: new Tile(2136, 4578, 1),
    DOOMION: new Tile(2134, 4565, 1),
    HOLTHION: new Tile(2132, 4554, 1),
    OTHAINIAN: new Tile(2122, 4562, 1),

    IBAN_DOOR: new Tile(2144, 4647, 1),
    IBAN_ALTAR: new Tile(2136, 4647, 1),
    IBAN_THROWN_OUT: new Tile(2482, 9607, 0),
    WELL_OF_VOYAGE: new Tile(2008, 4711, 1)
} as const;

export type UpassArea =
    | 'mainland'
    | 'westardougne'
    | 'area1'
    | 'area2'
    | 'gridpit'
    | 'main'
    | 'witch'
    | 'temple'
    | 'dwarves'
    | 'kalrag'
    | 'voyage'
    | 'unknown';

/**
 * Which sealed pocket of the pass the player is standing in.
 * Why: the pass is a chain of one-way `p_teleport` hops between map squares the
 * navigator cannot route across, so every leg first asks where it already is.
 */
export function upassArea(tile: QuestSnapshot['tile']): UpassArea {
    if (!tile) {
        return 'unknown';
    }
    const { x, z, level } = tile;
    // Why: the cavern platforms sit at level 1 under z 5000, which is the same band as the surface — the x window is what separates them.
    if (level === 1 && x >= 2112 && x <= 2175) {
        if (z >= 4672 && z <= 4735) return 'main';
        if (z >= 4608 && z <= 4671) return 'temple';
        if (z >= 4544 && z <= 4607) return 'witch';
    }
    if (level === 1 && x >= 1984 && x <= 2047 && z >= 4672 && z <= 4735) {
        return 'voyage';
    }
    if (x >= 2304 && x <= 2367) {
        if (z >= 9856 && z <= 9919) return 'kalrag';
        if (z >= 9792 && z <= 9855) return 'dwarves';
    }
    if (z >= 9536 && z <= 9599) return 'gridpit';
    if (z >= 9600 && z <= 9663) return 'area2';
    if (z >= 9664 && z <= 9727) return 'area1';
    if (z >= 5000) {
        return 'unknown';
    }
    // Why: West Ardougne is sealed behind the wall — the only way in is the Plague City sewer pipe, so it
    // is its own region rather than part of the mainland the navigator can route across.
    return level === 0 && x >= 2433 && x <= 2556 && z >= 3266 && z <= 3334 ? 'westardougne' : 'mainland';
}

export function held(snap: QuestSnapshot, item: UpassItem): number {
    return snap.invIds?.get(item.id) ?? 0;
}

export function banked(snap: QuestSnapshot, item: UpassItem): number {
    return snap.bankIds?.get(item.id) ?? 0;
}

export function owned(snap: QuestSnapshot, item: UpassItem): number {
    return held(snap, item) + banked(snap, item);
}

export function worn(snap: QuestSnapshot, item: UpassItem): boolean {
    return snap.wornIds?.has(item.id) ?? false;
}

export function carried(snap: QuestSnapshot, item: UpassItem): number {
    return held(snap, item) + (worn(snap, item) ? 1 : 0);
}

/** How many of a set the pack holds — the orbs, the badges and the amulets all share a display name. */
export function countHeld(snap: QuestSnapshot, items: readonly UpassItem[]): number {
    return items.filter(item => held(snap, item) > 0).length;
}

/** The trapped rectangle of the spiked grid: `inzone(upass_grid_col5, upass_grid_col1 + (1,0,9))`. */
export const GRID_ZONE = { minX: 2467, maxX: 2476, minZ: 9673, maxZ: 9682 } as const;

// Why: the corridor the grid opens onto runs from the furnace down to the orbs, well past the grid's own
// z band — a window of a few tiles around the rectangle reads the orb sweep as "not through yet" and sends
// the bot back to cross a grid it is already west of. The bridge shelf is also west of the grid, so the
// upper bound is what keeps it out.
const PAST_GRID = { maxX: GRID_ZONE.minX, minZ: 9640, maxZ: 9705 } as const;

/** West of the spiked grid, in the corridor it opens onto — the crossing is behind the character. */
export function pastGridTile(tile: QuestSnapshot['tile']): boolean {
    return tile !== null
        && tile !== undefined
        && tile.x < PAST_GRID.maxX
        && tile.z >= PAST_GRID.minZ
        && tile.z <= PAST_GRID.maxZ;
}
