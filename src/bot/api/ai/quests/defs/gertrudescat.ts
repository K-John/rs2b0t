// docs/QUESTS.md
import { actions, reader } from '../../../../adapter/ClientAdapter.js';
import Tile from '../../../../geometry/Tile.js';
import { Execution } from '../../../execution/Execution.js';
import { Game } from '../../../game/Game.js';
import { GameMessages } from '../../../chatbox/gameMessages.js';
import { Inventory } from '../../../inventory/Inventory.js';
import { Locs } from '../../../locs/Locs.js';
import { Npcs, type Npc } from '../../../npcs/Npcs.js';
import { Quests } from '../../../ui/questlog/Quests.js';
import { Traversal } from '../../../walking/Traversal.js';
import { QUESTS } from '../data/quests.js';
import type { QuestModule, QuestProgress, QuestSnapshot, QuestStep } from '../engine/types.js';
import { talkStrict, type NpcStop } from '../exec/primitives.js';
import { driveUntil, heldId, settleScene } from '../exec/prompts.js';
import { gatherMilk } from './cooksassistant.js';

const QUEST = "Gertrude's Cat";

/** `%fluffs`. */
export const FLUFFS_STAGE = {
    NOT_STARTED: 0,
    STARTED: 1,
    PAID_BOY: 2,
    GAVE_MILK: 3,
    GAVE_SARDINE: 4,
    RESCUED: 5,
    COMPLETE: 6
} as const;

export const FLUFFS_OBJ = {
    doogleLeaves: 1573,
    rawSardine: 327,
    seasonedSardine: 1552,
    bucketOfMilk: 1927,
    kitten: 1554
} as const;

/** Fluffs herself, and the six crates that might hold her kitten. */
const CAT_NPC = 759;
const CRATE_NPC = 767;

const BOY_PAYMENT = 100;
/** Enough for the boy plus the sardine, with change. */
const COIN_TOPUP = 1000;
const SARDINE_GP = 100;

const BANK = new Tile(3185, 3440, 0);

const GERTRUDE: NpcStop = {
    npc: 'Gertrude',
    anchor: new Tile(3151, 3410, 0),
    leash: 8,
    prefer: ['Well, I suppose I could']
};

const MARKET = new Tile(3221, 3434, 0);
// Why: option 2 buys the location; option 1 threatens the boy and option 3 walks away, both of which end the dialogue with nothing spent and nothing learnt.
const PAY_PREFER = ['What will make you tell me?', "I'll pay"];

const DOOGLE_WOODS = new Tile(3153, 3400, 0);
const SARDINE_SHOP = { npc: 'Gerrant', anchor: new Tile(3016, 3223, 0) };

const LADDER_BASE = new Tile(3310, 3509, 0);
const LADDER_TOP = new Tile(3310, 3509, 1);
const CAT_STAND = new Tile(3306, 3512, 1);

/** `%fluffs_crate` picks one of these six at random when the sardine is eaten. */
const CRATES: Tile[] = [
    new Tile(3307, 3507, 0),
    new Tile(3311, 3511, 0),
    new Tile(3303, 3506, 0),
    new Tile(3305, 3500, 0),
    new Tile(3310, 3499, 0),
    new Tile(3298, 3514, 0)
];

/** The wrong crate answers with a chat line and no modal, so waiting on the kitten alone costs a timeout per crate. */
const FOUND_NOTHING = /you find nothing/i;

// Why: `npc_find` measures the brothers against each other, not against us, and both wander two tiles from their own spawn.
/** How close the brothers must stand before the dialogue offers anything; the script's own limit is 3. */
const BROTHER_GAP = 2;

const PAY_ATTEMPTS = 3;

function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

// Why: the pages are cumulative, so the newest sentence has to be tested before the ones it was appended to.
export function parseGertrudesCatJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
    const at = (stage: number): QuestProgress => ({ stage, flags: new Set() });
    if (text.includes('quest complete!')) {
        return at(FLUFFS_STAGE.COMPLETE);
    }
    if (text.includes('i gave fluffs her kitten back')) {
        return at(FLUFFS_STAGE.RESCUED);
    }
    if (text.includes('i gave the cat milk and sardines')) {
        return at(FLUFFS_STAGE.GAVE_SARDINE);
    }
    if (text.includes('i found the lost cat but it')) {
        return at(FLUFFS_STAGE.GAVE_MILK);
    }
    if (text.includes('go to their play area')) {
        return at(FLUFFS_STAGE.PAID_BOY);
    }
    if (text.includes('i accepted the challenge of finding')) {
        return at(FLUFFS_STAGE.STARTED);
    }
    if (text.includes('i can start this quest by talking to')) {
        return at(FLUFFS_STAGE.NOT_STARTED);
    }
    return undefined;
}

export async function readGertrudesCatProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(QUEST);
    if (status === 'complete') {
        return { stage: FLUFFS_STAGE.COMPLETE, flags: new Set() };
    }
    if (status === 'notStarted') {
        return { stage: FLUFFS_STAGE.NOT_STARTED, flags: new Set() };
    }
    if (status !== 'inProgress') {
        return undefined;
    }
    const progress = parseGertrudesCatJournal(await Quests.journal(QUEST));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return progress;
}

function onPlatform(): boolean {
    const here = Game.tile();
    return here !== null && here.level === LADDER_TOP.level;
}

async function climbToCat(log: (m: string) => void): Promise<boolean> {
    if (onPlatform()) {
        return true;
    }
    if (!(await Traversal.walkResilient(LADDER_BASE, { radius: 1, attempts: 3, timeoutMs: 180_000, log }))) {
        return false;
    }
    await settleScene();
    const ladder = Locs.query().name('Ladder').action('Climb-up').within(4).nearest();
    if (!ladder) {
        log(`gertrudescat: no ladder up to Fluffs at (${LADDER_BASE.x},${LADDER_BASE.z})`);
        return false;
    }
    if (!(await ladder.interact('Climb-up'))) {
        return false;
    }
    const up = await Execution.delayUntil(onPlatform, 10_000);
    if (up) {
        await settleScene();
    }
    return up;
}

async function climbDownToYard(log: (m: string) => void): Promise<boolean> {
    if (!onPlatform()) {
        return true;
    }
    if (!(await Traversal.walkResilient(LADDER_TOP, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const ladder = Locs.query().name('Ladder').action('Climb-down').within(4).nearest();
    if (!ladder) {
        log(`gertrudescat: no ladder down off the platform at (${LADDER_TOP.x},${LADDER_TOP.z})`);
        return false;
    }
    if (!(await ladder.interact('Climb-down'))) {
        return false;
    }
    const down = await Execution.delayUntil(() => !onPlatform(), 10_000);
    if (down) {
        await settleScene();
    }
    return down;
}

// Why: Pick-up and Stroke both make Fluffs claw for 3 damage and give nothing, so every interaction here is a use-on.
function offerToCat(objId: number, what: string): (log: (m: string) => void) => Promise<boolean> {
    return async log => {
        const gone = (): boolean => heldId(objId) === 0;
        if (gone()) {
            return true;
        }
        if (!(await climbToCat(log))) {
            return false;
        }
        const findCat = (): Npc | null => Npcs.query().where(n => n.id === CAT_NPC).nearest();
        if (!findCat()) {
            await Traversal.walkResilient(CAT_STAND, { radius: 2, attempts: 2, timeoutMs: 30_000, log });
            await settleScene();
        }
        const cat = findCat();
        const held = Inventory.items().find(item => item.id === objId);
        if (!cat || !held) {
            log(`gertrudescat: no Fluffs in reach, or no ${what} to offer her`);
            return false;
        }
        log(`gertrudescat: offering Fluffs the ${what}`);
        if (!(await held.useOn(cat))) {
            return false;
        }
        return driveUntil(gone, [], log, 20_000);
    };
}

// Why: which crate holds the kitten is a server-side coord the client never sees, so the only way through is to search them all.
async function searchCratesForKitten(log: (m: string) => void): Promise<boolean> {
    const found = (): boolean => heldId(FLUFFS_OBJ.kitten) > 0;
    if (found()) {
        return true;
    }
    if (!(await climbDownToYard(log))) {
        return false;
    }
    for (const spot of CRATES) {
        if (!(await Traversal.walkResilient(spot, { radius: 1, attempts: 3, timeoutMs: 120_000, log }))) {
            continue;
        }
        await settleScene();
        const crate = Npcs.query().where(n => n.id === CRATE_NPC).withinOf(spot, 0).nearest();
        if (!crate) {
            log(`gertrudescat: no crate standing at (${spot.x},${spot.z})`);
            continue;
        }
        log(`gertrudescat: searching the crate at (${spot.x},${spot.z})`);
        const mark = GameMessages.mark();
        if (!(await crate.interact('Search'))) {
            continue;
        }
        await driveUntil(() => found() || GameMessages.sawSince(mark, FOUND_NOTHING), [], log, 12_000);
        if (found()) {
            return true;
        }
    }
    log('gertrudescat: none of the six crates held the kitten');
    return false;
}

async function payBrothers(log: (m: string) => void): Promise<boolean> {
    const paired = (): Npc | null => {
        const shilop = Npcs.query().name('Shilop').nearest();
        const wilough = Npcs.query().name('Wilough').nearest();
        if (!shilop || !wilough) {
            return null;
        }
        return shilop.tile().distanceTo(wilough.tile()) <= BROTHER_GAP ? shilop : null;
    };
    for (let attempt = 0; attempt < PAY_ATTEMPTS; attempt++) {
        if (!(await Traversal.walkResilient(MARKET, { radius: 3, attempts: 3, timeoutMs: 180_000, log }))) {
            return false;
        }
        await settleScene();
        if (!(await Execution.delayUntil(() => paired() !== null, 60_000))) {
            log('gertrudescat: Shilop and Wilough never wandered within earshot of each other');
            continue;
        }
        const before = Inventory.count('Coins');
        if (!(await talkStrict('Shilop', PAY_PREFER, log))) {
            continue;
        }
        // Why: the brothers drift apart mid-dialogue and the far-apart branch ends with no options at all, so only the payment proves the location was bought.
        if (await Execution.delayUntil(() => Inventory.count('Coins') <= before - BOY_PAYMENT, 5000)) {
            return true;
        }
        log('gertrudescat: the dialogue ended without paying — the brothers had drifted apart');
    }
    return false;
}

/** Doogle leaves first: they grow behind Gertrude's house, and the sardine is a walk to Port Sarim. */
function gatherSeasonedSardine(snap: QuestSnapshot): QuestStep | null {
    if ((snap.invIds?.get(FLUFFS_OBJ.seasonedSardine) ?? 0) > 0) {
        return null;
    }
    if ((snap.invIds?.get(FLUFFS_OBJ.doogleLeaves) ?? 0) === 0) {
        return { kind: 'grabGround', item: 'Doogle leaves', anchor: DOOGLE_WOODS, waitIfMissing: true };
    }
    if ((snap.invIds?.get(FLUFFS_OBJ.rawSardine) ?? 0) === 0) {
        return { kind: 'buy', item: 'Raw sardine', qty: 1, shop: SARDINE_SHOP, estGp: SARDINE_GP };
    }
    return {
        kind: 'useOn',
        item: 'Doogle leaves',
        targetKind: 'item',
        target: 'Raw sardine',
        anchor: DOOGLE_WOODS,
        product: 'Seasoned sardine'
    };
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: GERTRUDE }; }

    const progress = snap.progress;
    if (progress === undefined) { return { kind: 'wait', reason: `${QUEST} journal stage unavailable` }; }

    switch (progress.stage) {
        case FLUFFS_STAGE.STARTED: {
            if ((snap.inv.get('coins') ?? 0) < BOY_PAYMENT) {
                return { kind: 'withdraw', items: [{ name: 'Coins', qty: COIN_TOPUP }], bank: BANK };
            }
            return { kind: 'custom', name: 'buy the play area out of Shilop', run: payBrothers };
        }
        // Why: the sardine is fetched on the milk leg too — its shop and its herb are both on the way out, and coming back for them is a second lap of the map.
        case FLUFFS_STAGE.PAID_BOY: {
            const sardine = gatherSeasonedSardine(snap);
            if (sardine !== null) { return sardine; }
            if (!snap.inv.has('bucket of milk')) { return gatherMilk(snap); }
            return { kind: 'custom', name: 'give Fluffs the milk', run: offerToCat(FLUFFS_OBJ.bucketOfMilk, 'bucket of milk') };
        }
        case FLUFFS_STAGE.GAVE_MILK: {
            const sardine = gatherSeasonedSardine(snap);
            if (sardine !== null) { return sardine; }
            return { kind: 'custom', name: 'give Fluffs the doogle sardine', run: offerToCat(FLUFFS_OBJ.seasonedSardine, 'seasoned sardine') };
        }
        case FLUFFS_STAGE.GAVE_SARDINE: {
            if ((snap.invIds?.get(FLUFFS_OBJ.kitten) ?? 0) === 0) {
                return { kind: 'custom', name: 'search the crates for the kitten', run: searchCratesForKitten };
            }
            return { kind: 'custom', name: 'give Fluffs her kitten', run: offerToCat(FLUFFS_OBJ.kitten, 'kitten') };
        }
        case FLUFFS_STAGE.RESCUED:
            return { kind: 'talk', stop: GERTRUDE };
        default:
            return { kind: 'wait', reason: `unexpected ${QUEST} stage ${progress.stage}` };
    }
}

export const gertrudescat: QuestModule = {
    record: QUESTS.find(r => r.id === 'fluffs')!,
    bank: BANK,
    // Why: the milk, the herb and the sardine are all consumed mid-quest, so the module fetches each on the leg that needs it rather than the provisioner refetching all three on every resume.
    tools: ['coins', 'bucket', 'doogle leaves', 'sardine', "fluffs' kitten"],
    readProgress: readGertrudesCatProgress,
    decide
};
