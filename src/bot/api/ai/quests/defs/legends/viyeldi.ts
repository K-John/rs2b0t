import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import type { Npc } from '../../../../model/Npc.js';
import { Traversal } from '../../../../walking/Traversal.js';
import Tile from '../../../../../geometry/Tile.js';
import { HEROES, LQ_ID, LQ_LOC, LQ_LOC_ID, LQ_NPC, LQ_TILE, legendsArea } from './areas.js';
import { fight } from './fight.js';
import { legendsPocket, type LegendsPocket } from './pockets.js';
import { clearBoxes, driveUntil, heldId, locNear, modalText, offerTo, promptLoc, settleScene, useOnLoc } from './scene.js';
import { climbOutOfTrials, leaveOctagram, leaveShamanCave, pocket } from './trials.js';

interface Ledge {
    /** Exact loc id; every one of them renders "Rocks" or "Rocky Ledge". */
    id: number;
    name: string;
    /** Stand on the upper side, and the pocket the climb lands in. */
    down: { stand: Tile; to: LegendsPocket };
    /** Stand on the lower side, and the pocket the climb-back lands in. */
    up: { stand: Tile; to: LegendsPocket };
}

// Why: six one-way climbs separate the rope landing from the cave floor, and every one of them rolls `stat_random(agility, 110, 250)` downward and none at all upward.
// Why: the pockets between them are four to nineteen tiles, so a stand is exact rather than a radius.
const LEDGES: readonly Ledge[] = [
    {
        id: LQ_LOC_ID.ROCKY_LEDGE_0, name: LQ_LOC.ROCKY_LEDGE,
        down: { stand: new Tile(2378, 4717, 0), to: 'descentOne' },
        up: { stand: new Tile(2376, 4717, 0), to: 'viyeldiLedge' }
    },
    {
        id: LQ_LOC_ID.ROCKY_LEDGE_1, name: LQ_LOC.ROCKY_LEDGE,
        down: { stand: new Tile(2377, 4727, 0), to: 'descentTwo' },
        up: { stand: new Tile(2378, 4728, 0), to: 'descentOne' }
    },
    {
        id: LQ_LOC_ID.ROCKY_LEDGE_2, name: LQ_LOC.ROCKY_LEDGE,
        down: { stand: new Tile(2382, 4730, 0), to: 'descentThree' },
        up: { stand: new Tile(2382, 4728, 0), to: 'descentTwo' }
    },
    {
        id: LQ_LOC_ID.CLIMB_ROCK_1, name: LQ_LOC.ROCKS,
        down: { stand: new Tile(2386, 4727, 0), to: 'descentFour' },
        up: { stand: new Tile(2388, 4728, 0), to: 'descentThree' }
    },
    {
        id: LQ_LOC_ID.CLIMB_ROCK_2, name: LQ_LOC.ROCKS,
        down: { stand: new Tile(2390, 4725, 0), to: 'descentFive' },
        up: { stand: new Tile(2390, 4723, 0), to: 'descentFour' }
    },
    {
        id: LQ_LOC_ID.CLIMB_ROCK_3, name: LQ_LOC.ROCKS,
        down: { stand: new Tile(2390, 4719, 0), to: 'viyeldiMain' },
        up: { stand: new Tile(2390, 4717, 0), to: 'descentFive' }
    }
];

const CLIMB_ATTEMPTS = 8;

async function climb(ledge: Ledge, dir: 'down' | 'up', log: (m: string) => void): Promise<boolean> {
    const leg = ledge[dir];
    if (pocket() === leg.to) {
        return true;
    }
    // Why: a climb that overshoots lands on the cave floor rather than the next ledge, and from there the stand above is behind the rock already climbed.
    const at = pocket();
    if (dir === 'down' && (at === 'viyeldiMain' || at === 'viyeldiSource')) {
        return true;
    }
    if (dir === 'up' && at === 'viyeldiLedge') {
        return true;
    }
    if (!(await Traversal.walkResilient(leg.stand, { radius: 1, attempts: 4, timeoutMs: 60_000, log }))) {
        return false;
    }
    await settleScene();
    for (let i = 0; i < CLIMB_ATTEMPTS; i++) {
        if (pocket() === leg.to) {
            await settleScene();
            return true;
        }
        const ok = await promptLoc(
            {
                name: ledge.name,
                op: 'Climb-over',
                near: leg.stand,
                within: 6,
                id: ledge.id,
                prefer: ['Yes, I can think of nothing more exciting!', 'Yes, I want to climb over the rocks.'],
                expect: () => pocket() === leg.to,
                expectMs: 25_000
            },
            log
        );
        if (ok) {
            await settleScene();
            return true;
        }
        await Traversal.walkResilient(leg.stand, { radius: 0, attempts: 2, timeoutMs: 30_000, log });
    }
    log(`eight tries and ledge ${ledge.id} would not let us ${dir}`);
    return false;
}

// Why: every climb rolls `stat_random(agility, 110, 250)` and a miss drops the climber down the rock rather than stopping them, so a descent lands anywhere from the next pocket to the cave floor.
/** The pockets the six climbs pass through, in the order they are met. */
const DESCENT_ORDER: readonly LegendsPocket[] = [
    'viyeldiLedge', 'descentOne', 'descentTwo', 'descentThree', 'descentFour', 'descentFive', 'viyeldiMain'
];

/** Work down the six ledges from the rope landing to the cave floor. */
export async function descendLedges(log: (m: string) => void): Promise<boolean> {
    if (legendsArea(Game.tile()) !== 'viyeldiCaves') {
        log('the ledges are below the winch and we are not');
        return false;
    }
    for (const ledge of LEDGES) {
        const at = pocket();
        if (at === 'viyeldiMain' || at === 'viyeldiSource') {
            return true;
        }
        // Why: a fall past a ledge leaves its stand one-way behind us, and walking the list from the top sends the character at a tile the pocket it landed in cannot reach — which reads `no path to (2386,4727,0): unreachable` for as long as the leg is given.
        if (at !== null && DESCENT_ORDER.indexOf(at) >= DESCENT_ORDER.indexOf(ledge.down.to)) {
            continue;
        }
        if (!(await climb(ledge, 'down', log))) {
            return false;
        }
    }
    return pocket() === 'viyeldiMain';
}

/** Work back up the six ledges to the rope landing. */
export async function climbLedges(log: (m: string) => void): Promise<boolean> {
    // Why: the ledges only exist below the winch, so a leg that has already climbed the rope is done rather than one climb short.
    if (legendsArea(Game.tile()) !== 'viyeldiCaves') {
        return true;
    }
    // Why: the source sits past the barrier and the ledges are north of it, so the way up starts with a step back through the field.
    if (!(await recrossBarrier(log))) {
        return false;
    }
    for (const ledge of [...LEDGES].reverse()) {
        if (pocket() === 'viyeldiLedge') {
            return true;
        }
        if (!(await climb(ledge, 'up', log))) {
            return false;
        }
    }
    return pocket() === 'viyeldiLedge';
}

const HERO_FIGHT_MS = 300_000;

// Why: each guardian yields its own third of the dragon heart and nothing at all once that third is accounted for, and which thirds are already in the furnace is `%legends_bits` — invisible.
// Why: the loop therefore visits all three in turn and lets a guardian that owes nothing drop nothing.

/** Kill one Viyeldi guardian, if it still owes its crystal. */
// Why: the three of them stand sixty tiles apart in a cave the scene only half covers, so a query from the rope landing finds none of them and the leg fails in no time at all.
const HERO_SWEEP: readonly Tile[] = [
    new Tile(2410, 4700, 0),
    new Tile(2385, 4710, 0),
    new Tile(2400, 4725, 0)
];

// Why: `nearest` picks by straight line and the descent pockets are sealed one-way, so a guardian standing three tiles up a ledge already climbed past beats the one on the cave floor — and the walk to it answers `no path to (2386,4727,0): unreachable` for as long as the leg is given.
// Why: the pocket the character is standing in is the test, since every guardian worth fighting shares it.

/** The named guardian, if one is standing somewhere this pocket can walk to. */
function guardianHere(name: string): Npc | null {
    const at = pocket();
    return Npcs.query()
        .name(name)
        .where(npc => at === null || legendsPocket(npc.tile()) === at)
        .within(48)
        .nearest();
}

/** Walk the cave until the named guardian is in the scene. */
async function findGuardian(name: string, log: (m: string) => void): Promise<Npc | null> {
    for (const anchor of HERO_SWEEP) {
        const seen = guardianHere(name);
        if (seen) {
            return seen;
        }
        if (await Traversal.walkResilient(anchor, { radius: 4, attempts: 2, timeoutMs: 90_000, log })) {
            await settleScene();
        }
    }
    return guardianHere(name);
}

async function fightGuardian(name: string, section: number, log: (m: string) => void): Promise<boolean> {
    if (heldId(section) > 0) {
        return true;
    }
    const guardian = await findGuardian(name, log);
    if (!guardian) {
        log(`${name} is nowhere in the Viyeldi caves`);
        return false;
    }
    if (!(await Traversal.walkResilient(guardian.tile(), { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    return fight(
        { npc: name, done: () => heldId(section) > 0 || Npcs.query().name(name).within(14).nearest() === null, ms: HERO_FIGHT_MS },
        log
    );
}

/** Fuse one crystal section into the lava furnace. */
async function smeltSection(section: number, log: (m: string) => void): Promise<boolean> {
    if (heldId(section) === 0) {
        return true;
    }
    return useOnLoc(
        section,
        { name: LQ_LOC.FURNACE, near: LQ_TILE.LAVA_FURNACE, within: 8, id: LQ_LOC_ID.FURNACE },
        [],
        () => heldId(section) === 0,
        log
    );
}

// Why: the third section fuses the heart on the spot, so a heart crystal in the pack is the end of the leg rather than a stage read.

/** Take all three guardians apart and fuse the dragon heart out of them. */
export async function forgeHeartCrystal(log: (m: string) => void): Promise<boolean> {
    if (heldId(LQ_ID.HEART_CRYSTAL) > 0 || heldId(LQ_ID.HEART_CRYSTAL_GLOW) > 0) {
        return true;
    }
    if (!(await descendLedges(log))) {
        return false;
    }
    for (const hero of HEROES) {
        if (heldId(LQ_ID.HEART_CRYSTAL) > 0) {
            return true;
        }
        if (heldId(hero.section) === 0) {
            await fightGuardian(hero.npc, hero.section, log);
        }
        if (heldId(hero.section) > 0 && !(await smeltSection(hero.section, log))) {
            return false;
        }
    }
    return heldId(LQ_ID.HEART_CRYSTAL) > 0;
}

/** Charge the heart on the dragon's eye, which is what makes it glow. */
export async function chargeHeartCrystal(log: (m: string) => void): Promise<boolean> {
    if (heldId(LQ_ID.HEART_CRYSTAL_GLOW) > 0) {
        return true;
    }
    if (!(await descendLedges(log))) {
        return false;
    }
    return useOnLoc(
        LQ_ID.HEART_CRYSTAL,
        { name: LQ_LOC.MOSSY_ROCK, near: LQ_TILE.DRAGONS_EYE, within: 8, id: LQ_LOC_ID.DRAGONS_EYE_ROCK },
        [],
        () => heldId(LQ_ID.HEART_CRYSTAL_GLOW) > 0,
        log
    );
}

/** Slot the glowing heart into the recess, which drops the barrier. */
export async function fillRecess(log: (m: string) => void): Promise<boolean> {
    if (locNear(LQ_LOC.RECESS_FULL, 'Look', 8)) {
        return true;
    }
    if (!(await descendLedges(log))) {
        return false;
    }
    return useOnLoc(
        LQ_ID.HEART_CRYSTAL_GLOW,
        { name: LQ_LOC.RECESS, near: LQ_TILE.HEART_RECESS, within: 8, id: LQ_LOC_ID.RECESS_EMPTY },
        [],
        () => heldId(LQ_ID.HEART_CRYSTAL_GLOW) === 0,
        log
    );
}

/** Walk through the shimmering field into the half of the cave that holds the source. */
export async function crossBarrier(log: (m: string) => void): Promise<boolean> {
    if (pocket() === 'viyeldiSource') {
        return true;
    }
    // Why: the rope drops us on the top ledge and the barrier is six climbs below it, so a leg that starts at the landing has to fall the rest of the way first.
    if (!(await descendLedges(log))) {
        return false;
    }
    const ok = await promptLoc(
        {
            name: LQ_LOC.BARRIER,
            op: 'Walk-through',
            near: LQ_TILE.BARRIER_NORTH,
            within: 6,
            expect: () => pocket() === 'viyeldiSource',
            expectMs: 20_000
        },
        log
    );
    if (ok) {
        await settleScene();
    }
    return ok;
}

/** Walk back north through the shimmering field. */
export async function recrossBarrier(log: (m: string) => void): Promise<boolean> {
    if (pocket() !== 'viyeldiSource') {
        return true;
    }
    const ok = await promptLoc(
        {
            name: LQ_LOC.BARRIER,
            op: 'Walk-through',
            near: LQ_TILE.BARRIER_SOUTH,
            within: 6,
            expect: () => pocket() === 'viyeldiMain',
            expectMs: 20_000
        },
        log
    );
    if (ok) {
        await settleScene();
    }
    return ok;
}

const ECHNED_PREFER = [
    "I'll do what I must to get the water.",
    "Ok, I'll do it.",
    'Er... me?',
    'Yes, I need it for my quest.',
    'What can I do about that?',
    "Who's asking?"
];

// Why: the boulder is an NPC rather than a loc, it only shifts when pushed from its east side, and before the demon is dealt with pushing it summons Echned Zekin instead of moving.

/** Push the source boulder; before stage 22 this is what conjures the spirit. */
async function pushSourceBoulder(log: (m: string) => void): Promise<boolean> {
    if (!(await crossBarrier(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(LQ_TILE.SOURCE_STAND, { radius: 0, attempts: 4, timeoutMs: 120_000, log }))) {
        return false;
    }
    await settleScene();
    const boulder = Npcs.query().name(LQ_NPC.BOULDER).within(8).nearest();
    if (!boulder) {
        log('no boulder within reach of the source stand');
        return false;
    }
    return boulder.interact('Push');
}

/** Take the black dagger from Echned Zekin. */
export async function takeBlackDagger(log: (m: string) => void): Promise<boolean> {
    if (heldId(LQ_ID.DEATH_DAGGER) > 0 || heldId(LQ_ID.HOLY_FORCE) > 0) {
        return true;
    }
    const spirit = (): boolean => Npcs.query().name(LQ_NPC.ECHNED).within(10).exists();
    if (!spirit() && !(await pushSourceBoulder(log))) {
        return false;
    }
    await Execution.delayUntil(() => spirit(), 12_000);
    return driveUntil(() => heldId(LQ_ID.DEATH_DAGGER) > 0, ECHNED_PREFER, log, 120_000);
}

// Why: Ungadulu is the only source of the Holy Force spell and he wants the dagger for it, which is what makes the climb back up the trials part of the quest rather than an accident.

/** Hand the black dagger to Ungadulu for the Holy Force spell. */
export async function tradeDaggerForSpell(log: (m: string) => void): Promise<boolean> {
    if (heldId(LQ_ID.HOLY_FORCE) > 0) {
        return true;
    }
    // Why: the climb out lands at the cave mouth twenty tiles from the octagram, so the shaman is out of range until this walk has run.
    if (!Npcs.query().name(LQ_NPC.UNGADULU).within(12).exists()
        && !(await Traversal.walkResilient(LQ_TILE.FIRE_WALL_WEST, { radius: 1, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    await settleScene();
    const shaman = Npcs.query().name(LQ_NPC.UNGADULU).within(12).nearest();
    if (!shaman) {
        log('no Ungadulu in range for the black dagger');
        return false;
    }
    if (!(await offerTo(LQ_ID.DEATH_DAGGER, shaman, log))) {
        return false;
    }
    return driveUntil(() => heldId(LQ_ID.HOLY_FORCE) > 0, [], log, 60_000);
}

// Why: every one of these ends the conversation without `npc_del` — the goodbye is what dismisses him.
const ECHNED_STAY = ["I don't have the dagger.", "I haven't slayed Viyeldi yet.", 'I have something else in mind!'];

const SOURCE_FIGHT_MS = 420_000;

/** Read the Holy Force at the spirit, then kill what it turns into. */
export async function banishSourceDemon(log: (m: string) => void): Promise<boolean> {
    const demon = (): boolean => Npcs.query().name(LQ_NPC.NEZIKCHENED).within(14).exists();
    const spirit = (): boolean => Npcs.query().name(LQ_NPC.ECHNED).within(10).exists();
    // Why: the cast is one op with no dialogue and no message the client can read, so the demon appearing is the only oracle — and a miss is worth another go rather than a fresh leg.
    for (let i = 0; i < 4 && !demon(); i++) {
        if (!(await crossBarrier(log))) {
            return false;
        }
        if (!spirit() && !(await pushSourceBoulder(log))) {
            return false;
        }
        await Execution.delayUntil(spirit, 12_000);
        // Why: the push opens a conversation and its only polite exit is "I have to be going...", which `npc_del`s the spirit — so the rude answers are the ones that leave him standing there to be cast at.
        // Why: he spawns within three tiles of whoever pushed the boulder, so no walk is wanted either; walking off would close the chat and take him with it.
        await driveUntil(() => modalText() === '', ECHNED_STAY, log, 30_000);
        const scroll = Inventory.items().find(item => item.id === LQ_ID.HOLY_FORCE);
        if (!scroll) {
            log('no Holy Force spell in the pack');
            return false;
        }
        // Why: the scroll's own op is "Cast Spell" — Read is what the Book of Binding takes, and an op that is not there fails in a tick without a word.
        if (await scroll.interact('Cast Spell')) {
            await driveUntil(demon, [], log, 25_000);
        }
    }
    if (!demon()) {
        log('four casts of the Holy Force and the spirit never showed its face');
        return false;
    }
    return fight({ npc: LQ_NPC.NEZIKCHENED, done: () => !demon(), ms: SOURCE_FIGHT_MS }, log);
}

// Why: pushing the boulder adds the pool as a thirty-tick loc, so the push and the fill are one step or the water is gone before the next decide.

/** Shift the boulder off the spring and fill the blessed bowl from it. */
export async function collectSacredWater(log: (m: string) => void): Promise<boolean> {
    if (heldId(LQ_ID.GOLD_BOWL_BLESSED_PURE) > 0) {
        return true;
    }
    if (heldId(LQ_ID.GOLD_BOWL_BLESSED) === 0) {
        log('no empty blessed bowl to fill at the source');
        return false;
    }
    if (!(await crossBarrier(log))) {
        return false;
    }
    for (let i = 0; i < 4; i++) {
        if (!locNear(LQ_LOC.SOURCE_POOL, 'Look', 8)) {
            if (!(await pushSourceBoulder(log))) {
                return false;
            }
            await Execution.delayUntil(() => locNear(LQ_LOC.SOURCE_POOL, 'Look', 8) !== null, 8000);
        }
        const filled = await useOnLoc(
            LQ_ID.GOLD_BOWL_BLESSED,
            { name: LQ_LOC.SOURCE_POOL, near: LQ_TILE.SOURCE_STAND, within: 8, id: LQ_LOC_ID.WATER_POOL_SOURCE },
            [],
            () => heldId(LQ_ID.GOLD_BOWL_BLESSED_PURE) > 0,
            log
        );
        if (filled) {
            await clearBoxes();
            return true;
        }
    }
    log('the spring would not fill the bowl');
    return false;
}

export { LEDGES };

// Why: every leg that starts on the mainland walks to a mainland tile, so a run resumed anywhere under Karamja has to climb all the way out before the walker has a path at all.

/** Climb, crawl and squeeze out of the cave complex onto open jungle. */
export async function leaveCaves(log: (m: string) => void): Promise<boolean> {
    if (legendsPocket(Game.tile()) === null && legendsArea(Game.tile()) !== 'viyeldiCaves') {
        return true;
    }
    if (legendsArea(Game.tile()) === 'viyeldiCaves' && !(await climbLedges(log))) {
        return false;
    }
    if (!(await leaveOctagram(log))) {
        return false;
    }
    if (!(await climbOutOfTrials(log))) {
        return false;
    }
    return leaveShamanCave(log);
}
