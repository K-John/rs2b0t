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
import { MazeRun, heldById, inMaze, leaveMaze, lootChest, mazeSceneLoaded } from './maze.js';
import { SUPPLY_GATHERS, SUPPLY_LOADOUT, SUPPLY_TOOLS } from './supplies.js';

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
        'And will I need anything to defeat this dragon?',
        // The varp flips to stage 2 partway through, so the briefing menu can
        // appear before this step ends.
        'So where can I find this dragon?',
        'Where is the first piece of the map?',
        'Where is the second piece of the map?',
        'Where is the third piece of the map?',
        'Where can I get an antidragon shield?'
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
const KLARENSE: NpcStop = {
    npc: 'Klarense', anchor: DS_NPC.KLARENSE, leash: 6,
    prefer: ["I don't suppose I could buy it?", 'Yep, sounds good.']
};
/** Hires Ned. He only takes the map on a second visit, once the hull is patched. */
const NED_HIRE: NpcStop = {
    npc: 'Ned', anchor: DS_NPC.NED, leash: 6,
    prefer: [
        "You're a sailor? Could you take me to the island of Crandor?",
        'So are you going to take me to Crandor Island now then?'
    ]
};
const NED_MAP: NpcStop = {
    npc: 'Ned', anchor: DS_NPC.NED, leash: 6,
    prefer: ['So are you going to take me to Crandor Island now then?']
};
const NED_ABOARD: NpcStop = {
    npc: 'Ned', anchor: DS_NPC.NED_ABOARD, leash: 8,
    prefer: ['Yep lets go!']
};

const ORACLE_DOOR_ITEMS = [DS_ID.MIND_BOMB, DS_ID.UNFIRED_BOWL, DS_ID.LOBSTER_POT, DS_ID.SILK];

const FIND_DRAGON = 'So where can I find this dragon?';
/**
 * One dialogue covers the whole briefing: each answer drops its own question
 * from the menu, so the next preferred line down is the next branch. Asking as
 * a plain talk step instead re-opens the dialogue per branch, and the repeated
 * step reads to the engine as no progress.
 */
const OZIACH_BRIEFING = [
    FIND_DRAGON,
    'Where is the first piece of the map?',
    'Where is the second piece of the map?',
    'Where is the third piece of the map?',
    'Where can I get an antidragon shield?',
    "Ok I'll try and get everything together."
];

async function briefOziach(log: (m: string) => void): Promise<boolean> {
    if (!(await gotoNpc(OZIACH, [], log))) {
        return false;
    }
    log('getting the full briefing from Oziach');
    return talkThrough(OZIACH.npc, OZIACH_BRIEFING, log);
}

const walk = (to: Tile, log: (m: string) => void, radius = 2): Promise<boolean> =>
    Traversal.walkResilient(to, { radius, attempts: 3, timeoutMs: 180_000, log });

const maze = new MazeRun();

/** Wormbrain is caged: the talk is an ap-op, taken from outside through the bars. */
async function buyMapFromWormbrain(log: (m: string) => void): Promise<boolean> {
    if (heldById(DS_ID.MAP_WORMBRAIN)) {
        return true;
    }
    if (Inventory.count('Coins') < WORMBRAIN_PRICE) {
        log(`Wormbrain wants ${WORMBRAIN_PRICE} coins and the pack is short`);
        return false;
    }
    if (!(await walk(DS_NPC.WORMBRAIN_STAND, log, 1))) {
        return false;
    }
    // gotoNpc would try to stand next to him; the bars make that impossible and
    // the server answers the click from three tiles out on line of sight alone.
    const ok = await talkThrough('Wormbrain', [
        "I believe you've got a piece of map that I need.",
        'I suppose I could pay you for the map piece',
        'Alright then, 10,000 it is.'
    ], log);
    if (!ok) {
        return false;
    }
    return Execution.delayUntil(() => heldById(DS_ID.MAP_WORMBRAIN), 6000);
}

/** The Oracle's door eats a mind bomb, unfired bowl, lobster pot and silk. */
async function oracleChest(log: (m: string) => void): Promise<boolean> {
    if (heldById(DS_ID.MAP_ORACLE)) {
        return true;
    }
    const here = Game.tile();
    const pastDoor = here !== null && here.z >= 9800 && here.x >= 3051;
    if (!pastDoor) {
        if (!(await walk(DS_LOC.ORACLE_DOOR_STAND, log, 0)) || !(await mazeSceneLoaded())) {
            return false;
        }
        if (!ORACLE_DOOR_ITEMS.every(id => Inventory.countById(id) > 0)) {
            log('missing one of the four charms the door wants');
            return false;
        }
        const door = Locs.query().name('Door').where(l => {
            const t = l.tile();
            return t.x === DS_LOC.ORACLE_DOOR.x && t.z === DS_LOC.ORACLE_DOOR.z;
        }).first();
        if (!door) {
            log('the magic door is not in the scene yet');
            return false;
        }
        log('opening the magic door with the four charms');
        if (!(await door.interact('Open'))) {
            return false;
        }
        // Like every scripted door here, it teleports the player through.
        return Execution.delayUntil(() => {
            const t = Game.tile();
            return t !== null && t.x >= 3051;
        }, 8000);
    }
    if (!(await walk(DS_LOC.ORACLE_CHEST_STAND, log, 1)) || !(await mazeSceneLoaded())) {
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

/** True while below decks on the Lady Lumbridge, at any of its three holds. */
const inShipHold = (t: { x: number; z: number } | null | undefined): boolean =>
    !!t && t.x >= 3040 && t.x <= 3055 && t.z >= 9630 && t.z <= 9650;

/** Boards the ship and drops into the hold. Both hops are scripted teleports. */
async function goBelowDecks(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (inShipHold(here)) {
        return true;
    }
    if (here && here.level >= 1 && here.x >= 3044 && here.x <= 3052 && here.z >= 3204 && here.z <= 3212) {
        const ladder = Locs.query().name('Ladder').action('Climb-down').within(6).nearest();
        if (!ladder) {
            log('no ladder down on deck yet');
            return false;
        }
        log('climbing down into the hold');
        if (!(await ladder.interact('Climb-down'))) {
            return false;
        }
        return Execution.delayUntil(() => inShipHold(Game.tile()), 8000);
    }
    if (!(await walk(DS_LOC.GANGPLANK_STAND, log, 0)) || !(await mazeSceneLoaded())) {
        return false;
    }
    const plank = Locs.query().name('Gangplank').action('Cross').within(5).nearest();
    if (!plank) {
        log('no gangplank beside the dock');
        return false;
    }
    log('boarding the Lady Lumbridge');
    if (!(await plank.interact('Cross'))) {
        return false;
    }
    return Execution.delayUntil(() => (Game.tile()?.level ?? 0) >= 1, 8000);
}

/** Three planks, four nails each, driven in with a hammer. */
async function repairShip(log: (m: string) => void): Promise<boolean> {
    if (!(await goBelowDecks(log))) {
        return false;
    }
    await mazeSceneLoaded();
    const hole = Locs.query().name('Hole').within(8).nearest();
    const plank = Inventory.items().find(i => i.id === DS_ID.PLANK);
    if (!hole) {
        log('no hole in reach — walking along the hull');
        return walk(DS_LOC.SHIP_HOLE, log, 2);
    }
    if (!plank) {
        log('out of planks with the hull still open');
        return false;
    }
    const before = Inventory.countById(DS_ID.PLANK);
    log('patching a hole in the hull');
    if (!(await plank.useOn(hole))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.countById(DS_ID.PLANK) < before, 10_000);
}

/** Ned waits on the top deck once he has the map; the hold ladder now goes there. */
async function boardForCrandor(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && here.level >= 3) {
        return true;
    }
    return goBelowDecks(log);
}

const onDeck = (t: { x: number; z: number; level: number } | null | undefined): boolean =>
    !!t && t.level >= 1 && t.x >= 3044 && t.x <= 3052 && t.z >= 3204 && t.z <= 3212;

/** Anywhere aboard the Lady Lumbridge, deck or hold. */
const aboard = (t: { x: number; z: number; level: number } | null | undefined): boolean =>
    onDeck(t) || inShipHold(t);

/**
 * The ship is not on the navigation graph — its gangplank and ladders are all
 * scripted teleports — so every leg that starts ashore has to walk off first.
 */
async function leaveShip(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (!aboard(here)) {
        return true;
    }
    if (inShipHold(here)) {
        const ladder = Locs.query().name('Ladder').action('Climb-up').within(6).nearest();
        if (!ladder) {
            log('no ladder up out of the hold');
            return false;
        }
        log('climbing out of the hold');
        if (!(await ladder.interact('Climb-up'))) {
            return false;
        }
        return Execution.delayUntil(() => onDeck(Game.tile()), 8000);
    }
    const plank = Locs.query().name('Gangplank').action('Cross').within(6).nearest();
    if (!plank) {
        log('no gangplank off the deck');
        return false;
    }
    log('going ashore');
    if (!(await plank.interact('Cross'))) {
        return false;
    }
    return Execution.delayUntil(() => !aboard(Game.tile()), 8000);
}

const inElvargLair = (t: { x: number; z: number } | null | undefined): boolean =>
    !!t && t.x >= 2847 && t.x <= 2863 && t.z >= 9628 && t.z <= 9646;

/** Crandor's surface only connects to the lair through the rock opening. */
async function reachElvarg(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (!here) {
        return false;
    }
    if (inElvargLair(here)) {
        return true;
    }
    if (here.z < 9000) {
        if (!(await walk(DS_LOC.CRANDOR_ROCK, log, 1)) || !(await mazeSceneLoaded())) {
            return false;
        }
        const opening = Locs.query().name('Rock opening').action('Climb-down').within(5).nearest();
        if (!opening) {
            log('no rock opening in reach');
            return false;
        }
        log('climbing down into Crandor');
        if (!(await opening.interact('Climb-down'))) {
            return false;
        }
        return Execution.delayUntil(() => (Game.tile()?.z ?? 0) >= 9000, 8000);
    }
    if (!(await walk(DS_LOC.ELVARG_GATE_STAND, log, 0)) || !(await mazeSceneLoaded())) {
        return false;
    }
    const gate = Locs.query().name('Gate').action('Open').within(4).nearest();
    if (!gate) {
        log('no gate into the lair in reach');
        return false;
    }
    log('opening the lair gate');
    if (!(await gate.interact('Open'))) {
        return false;
    }
    return Execution.delayUntil(() => inElvargLair(Game.tile()), 8000);
}

async function killElvarg(log: (m: string) => void): Promise<boolean> {
    // Her breath maxes 70 without the shield and 10 with it worn.
    if (!Equipment.contains(DS_ITEM.SHIELD)) {
        if (!Inventory.contains(DS_ITEM.SHIELD)) {
            log('no anti-dragonbreath shield — she will burn straight through');
            return false;
        }
        log('wearing the shield before going in');
        await Equipment.equip(DS_ITEM.SHIELD);
        return false;
    }
    if (!(await reachElvarg(log))) {
        return false;
    }
    if (Game.inCombat()) {
        await Execution.delayTicks(2);
        return false;
    }
    const elvarg = Npcs.query().name('Elvarg').action('Attack').within(16).nearest();
    if (!elvarg) {
        log('no Elvarg in the lair yet');
        await Execution.delayTicks(3);
        return false;
    }
    log('attacking Elvarg');
    if (!(await elvarg.interact('Attack'))) {
        return false;
    }
    await Execution.delayUntil(() => Game.inCombat() || !elvarg.valid(), 4000);
    return false;
}

const custom = (name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep =>
    ({ kind: 'custom', name, run });

/** Inventory, worn or bank — the quest is resumable from any of the three. */
function anywhere(snap: QuestSnapshot, id: number): boolean {
    return (snap.invIds?.get(id) ?? 0) > 0
        || (snap.bankIds?.get(id) ?? 0) > 0
        || (snap.wornIds?.has(id) ?? false);
}

const MAP_PIECES = [DS_ID.MAP_MELZAR, DS_ID.MAP_WORMBRAIN, DS_ID.MAP_ORACLE];

/** Carried melee kit goes on before the maze, not once a demon is already hitting. */
function wearKit(snap: QuestSnapshot): QuestStep | null {
    for (const item of SUPPLY_LOADOUT) {
        const key = item.toLowerCase();
        if (!snap.worn.has(key) && (snap.inv.get(key) ?? 0) > 0) {
            return { kind: 'equip', item };
        }
    }
    return null;
}

/** A piece left in the bank reads to the journal as never found; fetch it back. */
function bankedPieces(snap: QuestSnapshot): { name: string; qty: number; id: number }[] {
    const want = [...MAP_PIECES, DS_ID.MAP].filter(id => (snap.bankIds?.get(id) ?? 0) > 0 && (snap.invIds?.get(id) ?? 0) === 0);
    return want.map(id => ({ name: id === DS_ID.MAP ? DS_ITEM.MAP : DS_ITEM.MAP_PART, qty: 1, id }));
}

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
        if (aboard(snap.tile)) {
            return custom('go ashore', leaveShip);
        }
        // The maze is one-way in; with the piece in hand nothing else can start
        // until the bot has walked itself back out.
        if (inMaze(snap.tile) && anywhere(snap, DS_ID.MAP_MELZAR)) {
            return custom("walk out of Melzar's Maze", leaveMaze);
        }
        // Oziach sets the three briefing flags and hands over the maze key across
        // several dialogue branches, so keep returning until they are all set.
        if (hasFlag(snap.progress, 'needs-briefing') || !anywhere(snap, DS_ID.MAZE_KEY)) {
            return custom('get the briefing from Oziach', briefOziach);
        }
        if (!hasFlag(snap.progress, 'has-shield') && !anywhere(snap, DS_ID.SHIELD)) {
            return { kind: 'talk', stop: DUKE };
        }
        const kit = wearKit(snap);
        if (kit) {
            return kit;
        }
        const banked = bankedPieces(snap);
        if (banked.length > 0 && !heldById(DS_ID.MAP)) {
            return { kind: 'withdraw', items: banked, bank: FALADOR_BANK };
        }
        if (!anywhere(snap, DS_ID.MAP)) {
            if (!anywhere(snap, DS_ID.MAP_MELZAR)) {
                return custom("Melzar's Maze", log => maze.step(log));
            }
            if (!hasFlag(snap.progress, 'asked-oracle') && !anywhere(snap, DS_ID.MAP_ORACLE)) {
                return { kind: 'talk', stop: ORACLE };
            }
            if (!anywhere(snap, DS_ID.MAP_ORACLE)) {
                return custom('the chest under Ice Mountain', oracleChest);
            }
            if (!anywhere(snap, DS_ID.MAP_WORMBRAIN)) {
                return custom('buy the map piece from Wormbrain', buyMapFromWormbrain);
            }
            return custom('join the map pieces', combineMap);
        }
        return { kind: 'talk', stop: KLARENSE };
    }

    if (stage === DRAGON_STAGE.BOUGHT_SHIP) {
        // Hiring Ned leaves no journal trace, so it is done first and the repair
        // is what the journal can actually confirm.
        if (!hasFlag(snap.progress, 'ship-repaired')) {
            return custom('patch the Lady Lumbridge', repairShip);
        }
        return { kind: 'talk', stop: NED_HIRE };
    }
    if (stage === DRAGON_STAGE.REPAIRED_SHIP) {
        // The patch leaves the bot a deck below where it boarded, and nothing on
        // the ship is on the navigation graph.
        if (aboard(snap.tile)) {
            return custom('go ashore', leaveShip);
        }
        // Hire and hand-over are two separate dialogues with the same NPC: the
        // first visit only gets his promise, the second takes the map.
        return { kind: 'talk', stop: NED_HIRE };
    }
    if (stage === DRAGON_STAGE.NED_GIVEN_MAP) {
        const here = snap.tile;
        if (here && here.level >= 3) {
            return { kind: 'talk', stop: NED_ABOARD };
        }
        return custom('board the Lady Lumbridge', boardForCrandor);
    }
    return custom('kill Elvarg', killElvarg);
}

export const dragonslayer: QuestModule = {
    record: QUESTS.find(r => r.id === 'dragon')!,
    bank: FALADOR_BANK,
    grind: ['Giant rat', 'Ghost', 'Skeleton', 'Zombie', 'Melzar the mad', 'Lesser demon', 'Elvarg'],
    food: 12,
    tools: [
        'coins', 'maze key', 'key', 'map part', 'crandor map', 'plank', 'nails', 'hammer',
        'dragonfire shield', "wizard's mind bomb", 'unfired bowl', 'lobster pot', 'silk',
        ...SUPPLY_TOOLS
    ],
    sustain: { foods: ['Shark', 'Lobster', 'Swordfish', 'Tuna', 'Salmon', 'Trout'], eatBelowHp: 0.65 },
    readProgress: readDragonProgress,
    gather: {
        'dragonfire shield': () => ({ kind: 'talk', stop: DUKE }),
        ...SUPPLY_GATHERS
    },
    decide
};

export { SHIP_PRICE, WORMBRAIN_PRICE, inMaze, NED_MAP };
