import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { Equipment } from '../../../api/hud/Equipment.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { Locs } from '../../../api/queries/Locs.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import { Traversal } from '../../../api/Traversal.js';
import Tile from '../../../api/Tile.js';
import { hasFlag } from '../../engine/types.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import { QUESTS } from '../../data/quests.js';
import { gotoNpc, talkThrough, type NpcStop } from '../../exec/primitives.js';
import { DS_ID, DS_ITEM, DS_LOC, DS_NPC, SHIP_PRICE, WORMBRAIN_PRICE } from './areas.js';
import { DRAGON_STAGE, readDragonProgress } from './journal.js';
import { MAZE_CHEST, MAZE_LEGS, MAZE_TO_BASEMENT, heldById, mazeSceneLoaded, mazeWalk, pastLeg, runMazeLeg } from './maze.js';

const FALADOR_BANK = new Tile(3013, 3355, 0);

const GUILDMASTER: NpcStop = {
    npc: 'Guild master', anchor: DS_NPC.GUILDMASTER, leash: 8,
    prefer: ['Do you know where I could get a Rune Plate mail body?']
};
/** At stage 1 Oziach opens with small talk; only the rune plate line starts him off. */
const OZIACH_FIRST: NpcStop = {
    npc: 'Oziach', anchor: DS_NPC.OZIACH, leash: 6,
    prefer: [
        'Can you sell me some Rune plate mail?',
        "The guildmaster of the Champions' Guild told me.",
        'So how am I meant to prove that?',
        'A dragon, that sounds like fun!',
        'And will I need anything to defeat this dragon?'
    ]
};
const OZIACH: NpcStop = {
    npc: 'Oziach', anchor: DS_NPC.OZIACH, leash: 6,
    prefer: [
        'So where can I find this dragon?',
        'Where can I get an antidragon shield?',
        "Ok I'll try and get everything together."
    ]
};
const DUKE: NpcStop = {
    npc: 'Duke Horacio', anchor: DS_NPC.DUKE, leash: 6,
    prefer: ["I seek a shield that will protect me from the dragon's breath."]
};
const ORACLE: NpcStop = {
    npc: 'Oracle', anchor: DS_NPC.ORACLE, leash: 6,
    prefer: ['I seek a piece of the map to the island of Crandor.']
};
const WORMBRAIN: NpcStop = {
    npc: 'Wormbrain', anchor: DS_NPC.WORMBRAIN, leash: 8,
    prefer: [
        "I believe you've got a piece of map that I need.",
        'I suppose I could pay you for the map piece...',
        'Alright then, 10,000 it is.'
    ]
};
const KLARENSE: NpcStop = {
    npc: 'Klarense', anchor: DS_NPC.KLARENSE, leash: 6,
    prefer: ["I don't suppose I could buy it?", 'Yep, sounds good.']
};
const NED: NpcStop = {
    npc: 'Ned', anchor: DS_NPC.NED, leash: 6,
    prefer: [
        "You're a sailor? Could you take me to the island of Crandor?",
        'So are you going to take me to Crandor Island now then?'
    ]
};
const NED_ABOARD: NpcStop = {
    npc: 'Ned', anchor: DS_NPC.NED_ABOARD, leash: 6,
    prefer: ['Yep lets go!']
};

const ORACLE_DOOR_ITEMS = [DS_ID.MIND_BOMB, DS_ID.UNFIRED_BOWL, DS_ID.LOBSTER_POT, DS_ID.SILK];

const FIND_DRAGON = 'So where can I find this dragon?';
/**
 * Oziach hands out the briefing one branch at a time, and each branch loops back
 * to the same menu. One pass per branch, so the whole briefing is a single step
 * the engine can see succeed rather than the same talk repeated until it parks.
 */
const OZIACH_BRANCHES: readonly string[][] = [
    [FIND_DRAGON, 'Where is the first piece of the map?'],
    [FIND_DRAGON, 'Where is the second piece of the map?'],
    [FIND_DRAGON, 'Where is the third piece of the map?'],
    ['Where can I get an antidragon shield?']
];

async function briefOziach(log: (m: string) => void): Promise<boolean> {
    if (!(await gotoNpc(OZIACH, [], log))) {
        return false;
    }
    for (const prefer of OZIACH_BRANCHES) {
        log(`asking Oziach: ${prefer[prefer.length - 1]}`);
        if (!(await talkThrough(OZIACH.npc, prefer, log))) {
            return false;
        }
        await Execution.delayTicks(1);
    }
    return heldById(DS_ID.MAZE_KEY);
}

const walk = (to: Tile, log: (m: string) => void, radius = 2): Promise<boolean> =>
    Traversal.walkResilient(to, { radius, attempts: 3, timeoutMs: 180_000, log });

/**
 * Both map chests are two-stage locs: Open lifts the lid and swaps the loc for
 * one whose first option is Search, and only the Search hands over the piece.
 */
async function lootChest(mapId: number, log: (m: string) => void): Promise<boolean> {
    const shut = Locs.query().name('Chest').action('Open').within(5).nearest();
    if (shut) {
        log('opening the chest');
        if (!(await shut.interact('Open'))) {
            return false;
        }
        await Execution.delayUntil(() => Locs.query().name('Chest').action('Search').within(5).exists(), 6000);
    }
    const open = Locs.query().name('Chest').action('Search').within(5).nearest();
    if (!open || !(await open.interact('Search'))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.countById(mapId) > 0, 10_000);
}

const inMaze = (t: QuestSnapshot['tile']): boolean =>
    !!t && ((t.x >= 2920 && t.x <= 2945 && t.z >= 3238 && t.z <= 3262) || (t.x >= 2915 && t.x <= 2945 && t.z >= 9630 && t.z <= 9665));
const inBasement = (t: { z: number }): boolean => t.z >= 9600;

/** Walks the maze legs in order and loots the chest at the end. */
async function melzarMaze(log: (m: string) => void): Promise<boolean> {
    if (heldById(DS_ID.MAP_MELZAR)) {
        return true;
    }
    const here = Game.tile();
    if (!here) {
        return false;
    }
    for (const leg of MAZE_LEGS) {
        if (pastLeg(leg, here)) {
            continue;
        }
        // The ground-floor ladder is the only way into the basement.
        if (leg.keyId === DS_ID.BLUE_KEY && !inBasement(here)) {
            log('heading down to the maze basement');
            if (!(await mazeWalk(MAZE_TO_BASEMENT, log, 1))) {
                return false;
            }
            const ladder = Locs.query().name('Ladder').action('Climb-down').within(3).nearest();
            return ladder ? ladder.interact('Climb-down') !== false : false;
        }
        return runMazeLeg(leg, log);
    }
    if (!(await mazeWalk(MAZE_CHEST, log, 2)) || !(await mazeSceneLoaded())) {
        return false;
    }
    return lootChest(DS_ID.MAP_MELZAR, log);
}

/** The Oracle's door eats a mind bomb, unfired bowl, lobster pot and silk. */
async function oracleChest(log: (m: string) => void): Promise<boolean> {
    if (heldById(DS_ID.MAP_ORACLE)) {
        return true;
    }
    if (!(await walk(DS_LOC.ORACLE_DOOR, log, 3)) || !(await mazeSceneLoaded())) {
        return false;
    }
    const door = Locs.query().name('Door').within(4).nearest();
    if (door && !heldById(DS_ID.MAP_ORACLE) && ORACLE_DOOR_ITEMS.every(id => Inventory.countById(id) > 0)) {
        log('opening the magic door with the four charms');
        await door.interact('Open');
        await Execution.delayTicks(3);
    }
    if (!(await walk(DS_LOC.ORACLE_CHEST, log, 2)) || !(await mazeSceneLoaded())) {
        return false;
    }
    return lootChest(DS_ID.MAP_ORACLE, log);
}

async function combineMap(log: (m: string) => void): Promise<boolean> {
    const first = Inventory.items().find(i => i.id === DS_ID.MAP_MELZAR);
    const second = Inventory.items().find(i => i.id === DS_ID.MAP_WORMBRAIN);
    if (!first || !second) {
        return false;
    }
    log('joining the three map pieces');
    if (!(await first.useOn(second))) {
        return false;
    }
    return Execution.delayUntil(() => heldById(DS_ID.MAP), 8000);
}

/** Three planks, four nails each, driven in with a hammer. */
async function repairShip(log: (m: string) => void): Promise<boolean> {
    if (!(await walk(DS_LOC.SHIP_HOLE, log, 3)) || !(await mazeSceneLoaded())) {
        return false;
    }
    const hole = Locs.query().name('Hole').within(5).nearest();
    const plank = Inventory.items().find(i => i.id === DS_ID.PLANK);
    if (!hole || !plank) {
        log('no hole or no plank to patch it with');
        return false;
    }
    const before = Inventory.countById(DS_ID.PLANK);
    log('patching a hole in the hull');
    if (!(await plank.useOn(hole))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.countById(DS_ID.PLANK) < before, 10_000);
}

async function boardShip(log: (m: string) => void): Promise<boolean> {
    if (!(await walk(DS_LOC.GANGPLANK, log, 3)) || !(await mazeSceneLoaded())) {
        return false;
    }
    const plank = Locs.query().name('Gangplank').within(5).nearest();
    return plank ? plank.interact('Cross') !== false : false;
}

async function killElvarg(log: (m: string) => void): Promise<boolean> {
    if (!Equipment.contains(DS_ITEM.SHIELD)) {
        log('wearing the dragonfire shield before going in');
        await Equipment.equip(DS_ITEM.SHIELD);
    }
    if (Game.inCombat()) {
        await Execution.delayTicks(2);
        return false;
    }
    const elvarg = Npcs.query().name('Elvarg').action('Attack').within(14).nearest();
    if (!elvarg) {
        if (!(await walk(DS_NPC.ELVARG, log, 4))) {
            return false;
        }
        const gate = Locs.query().name('Gate').within(4).nearest();
        if (gate) {
            await gate.interact('Open');
            await Execution.delayTicks(2);
        }
        return false;
    }
    if (!(await elvarg.interact('Attack'))) {
        return false;
    }
    await Execution.delayUntil(() => Game.inCombat() || !elvarg.valid(), 4000);
    return false;
}

const custom = (name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep =>
    ({ kind: 'custom', name, run });

export function decide(snap: QuestSnapshot): QuestStep {
    const stage = snap.progress?.stage;
    if (snap.journal === 'complete' || stage === DRAGON_STAGE.COMPLETE) {
        return { kind: 'done' };
    }
    if (stage === undefined) {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    if (stage === DRAGON_STAGE.NOT_STARTED) {
        return { kind: 'talk', stop: GUILDMASTER };
    }
    if (stage === DRAGON_STAGE.SPOKEN_GUILDMASTER) {
        return { kind: 'talk', stop: OZIACH_FIRST };
    }

    if (stage === DRAGON_STAGE.SPOKEN_OZIACH) {
        // Oziach sets the three briefing flags and hands over the maze key across
        // several dialogue branches, so keep returning until they are all set.
        if (hasFlag(snap.progress, 'needs-briefing') || !heldById(DS_ID.MAZE_KEY)) {
            return custom('get the briefing from Oziach', briefOziach);
        }
        if (!hasFlag(snap.progress, 'has-shield') && !snap.worn.has(DS_ITEM.SHIELD.toLowerCase())) {
            return { kind: 'talk', stop: DUKE };
        }
        if (!hasFlag(snap.progress, 'map-melzar') && !heldById(DS_ID.MAP)) {
            return custom("Melzar's Maze", melzarMaze);
        }
        if (!hasFlag(snap.progress, 'asked-oracle') && !hasFlag(snap.progress, 'map-ice')) {
            return { kind: 'talk', stop: ORACLE };
        }
        if (!hasFlag(snap.progress, 'map-ice') && !heldById(DS_ID.MAP)) {
            return custom('the chest under Ice Mountain', oracleChest);
        }
        if (!hasFlag(snap.progress, 'map-wormbrain') && !heldById(DS_ID.MAP)) {
            return { kind: 'talk', stop: WORMBRAIN };
        }
        if (!heldById(DS_ID.MAP)) {
            return custom('join the map pieces', combineMap);
        }
        return { kind: 'talk', stop: KLARENSE };
    }

    if (stage === DRAGON_STAGE.BOUGHT_SHIP) {
        return custom('patch the Lady Lumbridge', repairShip);
    }
    if (stage === DRAGON_STAGE.REPAIRED_SHIP) {
        return { kind: 'talk', stop: NED };
    }
    if (stage === DRAGON_STAGE.NED_GIVEN_MAP) {
        const here = snap.tile;
        if (here && here.level >= 1 && here.z >= 9600) {
            return { kind: 'talk', stop: NED_ABOARD };
        }
        return custom('board the Lady Lumbridge', boardShip);
    }
    return custom('kill Elvarg', killElvarg);
}

export const dragonslayer: QuestModule = {
    record: QUESTS.find(r => r.id === 'dragon')!,
    bank: FALADOR_BANK,
    grind: ['Giant rat', 'Ghost', 'Skeleton', 'Zombie', 'Melzar the mad', 'Lesser demon', 'Elvarg'],
    food: 8,
    tools: [
        'coins', 'maze key', 'key', 'map part', 'crandor map', 'plank', 'nails', 'hammer',
        'dragonfire shield', "wizard's mind bomb", 'unfired bowl', 'lobster pot', 'silk'
    ],
    sustain: { foods: ['Shark', 'Lobster', 'Swordfish', 'Tuna', 'Salmon', 'Trout'], eatBelowHp: 0.65 },
    readProgress: readDragonProgress,
    gather: {
        'dragonfire shield': () => ({ kind: 'talk', stop: DUKE })
    },
    decide
};

export { SHIP_PRICE, WORMBRAIN_PRICE, inMaze };
