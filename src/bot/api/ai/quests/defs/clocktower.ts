// docs/QUESTS.md
import { actions, reader } from '../../../../adapter/ClientAdapter.js';
import { DirectNavigator } from '../../../../event/webwalk/DirectNavigator.js';
import Tile from '../../../../geometry/Tile.js';
import { Execution } from '../../../execution/Execution.js';
import { Game } from '../../../game/Game.js';
import { GroundItems, type GroundItem } from '../../../grounditems/GroundItems.js';
import { Inventory } from '../../../inventory/Inventory.js';
import { Locs, type Loc } from '../../../locs/Locs.js';
import { Npcs } from '../../../npcs/Npcs.js';
import { Quests } from '../../../ui/questlog/Quests.js';
import { Traversal } from '../../../walking/Traversal.js';
import { QUESTS } from '../data/quests.js';
import { hasFlag, type QuestModule, type QuestProgress, type QuestSnapshot, type QuestStep } from '../engine/types.js';
import { isUnderground, walkWithHops, type LadderHop, type NpcStop } from '../exec/primitives.js';
import { driveUntil, heldId, useOnLoc } from '../exec/prompts.js';

type Colour = 'black' | 'red' | 'blue' | 'white';

const QUEST = 'Clock Tower';

/** `~get_cog_progress`; the journal cannot separate the four in-progress steps, so only its endpoints are named. */
export const COG_STAGE = { NOT_STARTED: 0, STARTED: 1, ALL_PLACED: 5, COMPLETE: 6 } as const;

/** All four render "Cog", so every lookup is by object id. */
export const COG_OBJ: Record<Colour, number> = { white: 20, black: 21, blue: 22, red: 23 };

const RAT_POISON_OBJ = 24;
const CLOCKTOWER_RAT_NPC = 224;

// Why: every spindle renders "Clock spindle" and all four colours stand within three tiles on tower level 0, so only the id separates the working one from a decoy.
const SPINDLE_LOC: Record<Colour, number> = { red: 29, black: 30, white: 31, blue: 32 };
const LEVER_SHUT = 33;
const LEVER_OPEN = 35;
const RAT_GATE = 39;
const FOOD_TROUGH = 40;
const SECRET_WALL = 1586;

const COLOURS: Colour[] = ['blue', 'black', 'white', 'red'];
// Why: black is the only cog whose spindle is underground, so its round trip never climbs; white is last because its leg has to poison the rats first.
const FETCH_ORDER: Colour[] = ['black', 'red', 'blue', 'white'];

const BUCKET = 'Bucket';
const WATER = 'Bucket of water';

const KOJO: NpcStop = {
    npc: 'Brother Kojo',
    anchor: new Tile(2569, 3249, 0),
    leash: 6,
    prefer: ['OK old monk, what can I do?', 'Yes']
};

const CELLAR_TOP = new Tile(2566, 3243, 0);
const CELLAR_FOOT = new Tile(2566, 9643, 0);
const WHITE_ROOM_LADDER = new Tile(2575, 9656, 0);
const BLUE_ROOM_LADDER = new Tile(2572, 9632, 0);

const SPINDLE_STAND: Record<Colour, Tile> = {
    red: new Tile(2569, 3243, 0),
    blue: new Tile(2570, 3240, 1),
    white: new Tile(2567, 3242, 2),
    black: new Tile(2571, 9642, 0)
};

const COG_SPAWN: Record<Colour, Tile> = {
    black: new Tile(2613, 9639, 0),
    red: new Tile(2583, 9613, 0),
    blue: new Tile(2574, 9633, 0),
    white: new Tile(2577, 9655, 0)
};

const POISON_SPAWN = new Tile(2564, 9662, 0);
const LEVER_STAND = new Tile(2591, 9660, 0);
const PEN_GATE_OUTSIDE = new Tile(2596, 9657, 0);
const PEN_GATE_INSIDE = new Tile(2595, 9657, 0);
const TROUGH_STAND = new Tile(2585, 9654, 0);
const RAT_GATE_STAND = new Tile(2579, 9656, 0);
const SECRET_WALL_STAND = new Tile(2576, 9631, 0);
const WELL_STAND = new Tile(2611, 3254, 0);
const BUCKET_SPAWN = new Tile(2616, 3255, 0);
const BANK = new Tile(2655, 3283, 0);

// Why: both cog rooms are one-way in the baked graph — the obstacle is the only way in and the room's own ladder the only way out, so each needs its own hop or `crossHops` sends the walker at a stand it cannot reach.
const HOPS: LadderHop[] = [
    { stand: CELLAR_TOP, locName: 'Ladder', op: 'Climb-down', arrive: CELLAR_FOOT },
    { stand: CELLAR_FOOT, locName: 'Ladder', op: 'Climb-up', arrive: CELLAR_TOP },
    { stand: WHITE_ROOM_LADDER, locName: 'Ladder', op: 'Climb-up', arrive: new Tile(2575, 3256, 0) },
    { stand: BLUE_ROOM_LADDER, locName: 'Ladder', op: 'Climb-up', arrive: new Tile(2572, 3232, 0) }
];

function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

function allPlaced(): Set<string> {
    return new Set(COLOURS.map(c => `placed-${c}`));
}

export function parseClockTowerJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
    if (text.includes('quest complete!')) {
        return { stage: COG_STAGE.COMPLETE, flags: allPlaced() };
    }
    // Why: the reward page drops the four per-cog lines, so its own line is the only evidence they are all in.
    if (text.includes('i have placed all four cogs successfully')) {
        return { stage: COG_STAGE.ALL_PLACED, flags: allPlaced() };
    }
    if (text.includes('agreed to help him repair the clock')) {
        const flags = new Set<string>();
        for (const colour of COLOURS) {
            if (text.includes(`successfully placed the ${colour} cog`)) {
                flags.add(`placed-${colour}`);
            }
        }
        return { stage: COG_STAGE.STARTED, flags };
    }
    if (text.includes('i can start this quest by talking to brother kojo')) {
        return { stage: COG_STAGE.NOT_STARTED, flags: new Set() };
    }
    return undefined;
}

export async function readClockTowerProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(QUEST);
    if (status === 'complete') {
        return { stage: COG_STAGE.COMPLETE, flags: allPlaced() };
    }
    if (status === 'notStarted') {
        return { stage: COG_STAGE.NOT_STARTED, flags: new Set() };
    }
    if (status !== 'inProgress') {
        return undefined;
    }
    const progress = parseClockTowerJournal(await Quests.journal(QUEST));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return progress;
}

function inWhiteRoom(t: { x: number; z: number }): boolean {
    return isUnderground(t) && t.x >= 2574 && t.x <= 2578 && t.z >= 9655 && t.z <= 9658;
}

function inPen(t: { x: number; z: number }): boolean {
    return isUnderground(t) && t.x >= 2579 && t.x <= 2595 && t.z >= 9652 && t.z <= 9660;
}

function inBlueRoom(t: { x: number; z: number }): boolean {
    return isUnderground(t) && t.x >= 2571 && t.x <= 2575 && t.z >= 9630 && t.z <= 9633;
}

function locById(id: number, within = 6): Loc | null {
    return Locs.query().where(l => l.id === id).within(within).nearest();
}

function cogOnFloor(colour: Colour): GroundItem | null {
    return GroundItems.query().where(g => g.id === COG_OBJ[colour]).within(8).nearest();
}

function ratsAlive(): boolean {
    return Npcs.query().where(n => n.id === CLOCKTOWER_RAT_NPC).within(12).nearest() !== null;
}

async function takeCog(colour: Colour, log: (m: string) => void): Promise<boolean> {
    if (heldId(COG_OBJ[colour]) > 0) {
        return true;
    }
    const cog = cogOnFloor(colour);
    if (!cog) {
        log(`clocktower: no ${colour} cog on the floor at (${COG_SPAWN[colour].x},${COG_SPAWN[colour].z})`);
        return false;
    }
    if (!(await cog.interact('Take'))) {
        return false;
    }
    // Why: a refusal arrives as a mesbox rather than a chat line, so the wait has to drive the box shut before anything else can act.
    return driveUntil(() => heldId(COG_OBJ[colour]) > 0, [], log, 8000);
}

// Why: the cog is red hot until it is cooled, and pouring is what spends the bucket — so try the Take first and let the refusal, not a guess, ask for the water.
async function takeBlackCog(log: (m: string) => void): Promise<boolean> {
    if (await takeCog('black', log)) {
        return true;
    }
    const cog = cogOnFloor('black');
    const water = Inventory.first(WATER);
    if (!cog || !water) {
        log(`clocktower: black cog still hot and no ${WATER} to cool it`);
        return false;
    }
    log('clocktower: pouring water over the black cog');
    if (!(await water.useOn(cog))) {
        return false;
    }
    if (!(await driveUntil(() => !Inventory.contains(WATER), [], log, 8000))) {
        log('clocktower: the water never poured');
        return false;
    }
    return takeCog('black', log);
}

async function openPenGate(log: (m: string) => void): Promise<boolean> {
    if (locById(LEVER_OPEN, 8)) {
        return true;
    }
    if (!(await walkWithHops(LEVER_STAND, 2, HOPS, log))) {
        return false;
    }
    if (locById(LEVER_OPEN, 8)) {
        return true;
    }
    const lever = locById(LEVER_SHUT, 8);
    if (!lever) {
        log(`clocktower: no rat-cage lever at (${LEVER_STAND.x},${LEVER_STAND.z})`);
        return false;
    }
    log('clocktower: pulling the rat-cage lever');
    if (!(await lever.interact('Pull'))) {
        return false;
    }
    return Execution.delayUntil(() => locById(LEVER_OPEN, 8) !== null, 6000);
}

// Why: the gate is not a baked edge — the lever opens it at runtime, so the last tile is a scene step the pathfinder never sees.
async function enterPen(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && inPen(here)) {
        return true;
    }
    if (!(await openPenGate(log))) {
        return false;
    }
    if (!(await walkWithHops(PEN_GATE_OUTSIDE, 0, HOPS, log))) {
        return false;
    }
    await DirectNavigator.walkTo(PEN_GATE_INSIDE, 0, 6000);
    const landed = Game.tile();
    if (!landed || !inPen(landed)) {
        log('clocktower: the rat-cage gate did not let us through');
        return false;
    }
    return true;
}

// Why: the gate opens only from inside — `check_axis` wants the player's x to equal the gate's — so a leg that cannot go on has a way out that does not depend on the rats.
async function leavePen(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(PEN_GATE_INSIDE, { radius: 0, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const gate = Locs.query().name('Gate').action('Open').within(4).nearest();
    if (!gate || !(await gate.interact('Open'))) {
        log('clocktower: no rat-cage gate to open from the inside');
        return false;
    }
    return Execution.delayUntil(() => {
        const t = Game.tile();
        return t !== null && !inPen(t);
    }, 6000);
}

async function poisonRats(log: (m: string) => void): Promise<boolean> {
    if (heldId(RAT_POISON_OBJ) === 0) {
        if (!(await walkWithHops(POISON_SPAWN, 2, HOPS, log))) {
            return false;
        }
        const poison = GroundItems.query().where(g => g.id === RAT_POISON_OBJ).within(8).nearest();
        if (!poison) {
            log(`clocktower: no Rat poison at (${POISON_SPAWN.x},${POISON_SPAWN.z})`);
            return false;
        }
        if (!(await poison.interact('Take'))) {
            return false;
        }
        if (!(await Execution.delayUntil(() => heldId(RAT_POISON_OBJ) > 0, 8000))) {
            return false;
        }
    }
    if (!(await enterPen(log))) {
        return false;
    }
    if (!ratsAlive()) {
        return true;
    }
    log('clocktower: poisoning the rats at the food trough');
    const poured = await useOnLoc(
        RAT_POISON_OBJ,
        { name: 'Food trough', near: TROUGH_STAND, id: FOOD_TROUGH },
        [],
        () => heldId(RAT_POISON_OBJ) === 0,
        log
    );
    if (!poured) {
        return false;
    }
    return Execution.delayUntil(() => !ratsAlive(), 40_000);
}

async function enterWhiteRoom(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && inWhiteRoom(here)) {
        return true;
    }
    if (here && inPen(here) && heldId(RAT_POISON_OBJ) === 0 && ratsAlive()) {
        log('clocktower: in the rat cage with no poison — leaving the way we came');
        await leavePen(log);
        return false;
    }
    if (!(await poisonRats(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(RAT_GATE_STAND, { radius: 0, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const gate = locById(RAT_GATE, 4);
    if (!gate) {
        log(`clocktower: no rat-room gate at (${RAT_GATE_STAND.x},${RAT_GATE_STAND.z})`);
        return false;
    }
    if (!(await gate.interact('Go-through'))) {
        return false;
    }
    return Execution.delayUntil(() => {
        const t = Game.tile();
        return t !== null && inWhiteRoom(t);
    }, 8000);
}

async function enterBlueRoom(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && inBlueRoom(here)) {
        return true;
    }
    if (!(await walkWithHops(SECRET_WALL_STAND, 1, HOPS, log))) {
        return false;
    }
    const wall = locById(SECRET_WALL, 4);
    if (!wall) {
        log(`clocktower: no secret wall at (${SECRET_WALL_STAND.x},${SECRET_WALL_STAND.z})`);
        return false;
    }
    log('clocktower: pushing the secret wall into the blue cog room');
    if (!(await wall.interact('Push'))) {
        return false;
    }
    return Execution.delayUntil(() => {
        const t = Game.tile();
        return t !== null && inBlueRoom(t);
    }, 8000);
}

function fetchLeg(colour: Colour): (log: (m: string) => void) => Promise<boolean> {
    return async log => {
        if (colour === 'white') {
            if (!(await enterWhiteRoom(log))) {
                return false;
            }
        } else if (colour === 'blue') {
            if (!(await enterBlueRoom(log))) {
                return false;
            }
        } else if (!(await walkWithHops(COG_SPAWN[colour], 2, HOPS, log))) {
            return false;
        }
        if (colour === 'white' || colour === 'blue') {
            if (!(await Traversal.walkResilient(COG_SPAWN[colour], { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
                return false;
            }
        }
        return colour === 'black' ? takeBlackCog(log) : takeCog(colour, log);
    };
}

function placeLeg(colour: Colour): (log: (m: string) => void) => Promise<boolean> {
    return async log => {
        if (!(await walkWithHops(SPINDLE_STAND[colour], 1, HOPS, log))) {
            return false;
        }
        log(`clocktower: fitting the ${colour} cog to its spindle`);
        return useOnLoc(
            COG_OBJ[colour],
            { name: 'Clock spindle', near: SPINDLE_STAND[colour], id: SPINDLE_LOC[colour], within: 4 },
            [],
            () => heldId(COG_OBJ[colour]) === 0,
            log
        );
    };
}

function heldCog(snap: QuestSnapshot): Colour | null {
    for (const colour of FETCH_ORDER) {
        if ((snap.invIds?.get(COG_OBJ[colour]) ?? 0) > 0) {
            return colour;
        }
    }
    return null;
}

export function gatherWater(snap: QuestSnapshot): QuestStep {
    if (!snap.inv.has(BUCKET.toLowerCase())) {
        return { kind: 'grabGround', item: BUCKET, anchor: BUCKET_SPAWN };
    }
    return { kind: 'useOn', item: BUCKET, targetKind: 'loc', target: 'Well', anchor: WELL_STAND, product: WATER };
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: KOJO }; }

    const progress = snap.progress;
    if (progress === undefined) { return { kind: 'wait', reason: 'Clock Tower journal stage unavailable' }; }

    const held = heldCog(snap);
    if (held !== null) {
        if (hasFlag(progress, `placed-${held}`)) {
            return { kind: 'wait', reason: `carrying a ${held} cog whose spindle is already filled` };
        }
        return { kind: 'custom', name: `place the ${held} cog`, run: placeLeg(held) };
    }

    const next = FETCH_ORDER.find(colour => !hasFlag(progress, `placed-${colour}`));
    if (next === undefined) { return { kind: 'talk', stop: KOJO }; }

    if (next === 'black' && !snap.inv.has(WATER.toLowerCase())) {
        return gatherWater(snap);
    }
    return { kind: 'custom', name: `fetch the ${next} cog`, run: fetchLeg(next) };
}

export const clocktower: QuestModule = {
    record: QUESTS.find(r => r.id === 'cog')!,
    bank: BANK,
    hops: HOPS,
    food: 6,
    tools: ['cog', 'rat poison', 'bucket', 'bucket of water'],
    gather: { 'bucket of water': gatherWater },
    readProgress: readClockTowerProgress,
    decide
};
