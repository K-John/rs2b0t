import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { EventSignal } from '../../../../execution/EventSignal.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Npcs, type Npc } from '../../../../npcs/Npcs.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { Modals } from '../../../../ui/widgets/Modals.js';
import type Tile from '../../../../../geometry/Tile.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { promptLoc, settleScene, useOnLoc } from '../../exec/prompts.js';
import { KATRINE_HANDIN, KATRINE_JOIN, SOA_ID, SOA_LOC, SOA_TILE, TRAMP, inWeaponStore } from './areas.js';
import { climb, enterBlackArmUpper, leaveBlackArmUpper, leaveWeaponStore } from './hideout.js';
import { SOA_STAGE } from './journal.js';
import { heldId } from './state.js';

const WEAPONSMASTER_NPC = 643;
const KILL_MS = 90_000;
const WALK_MS = 120_000;
/** `opobj3,phoenix_crossbow` refuses inside ten tiles of the Weaponsmaster, gang member or not. */
const MASTER_BLOCK = 10;

const FOUND_HALF = /you find half a shield/i;
const CUPBOARD_BARE = /the cupboard is bare/i;
const UNLOCKED = /you unlock the door/i;

function weaponsmaster(): Npc | null {
    return Npcs.query().where(n => n.id === WEAPONSMASTER_NPC).nearest();
}

/** The store door answers Open with "securely locked"; only an oplocu with the key opens it, and it teleports you through. */
async function unlockStore(log: (m: string) => void): Promise<boolean> {
    if (inWeaponStore(Game.tile())) {
        return true;
    }
    const mark = GameMessages.mark();
    const inside = () => {
        const t = Game.tile();
        return t !== null && t.level === 0 && t.x >= 3249 && t.x <= 3254 && t.z >= 3381 && t.z <= 3385;
    };
    if (inside()) {
        return true;
    }
    if (!(await useOnLoc(
        SOA_ID.STORE_KEY,
        { name: 'Door', near: SOA_TILE.STORE_DOOR, within: 4, id: SOA_LOC.STORE_DOOR },
        [],
        () => inside() || GameMessages.sawSince(mark, UNLOCKED),
        log
    ))) {
        log(`store door refused the key: ${GameMessages.since(mark).map(m => m.text).join(' · ')}`);
        return false;
    }
    await settleScene();
    return inside();
}

/** Not aggressive, so nothing happens until we attack; his respawn is 700 ticks, which covers both takes. */
async function clearWeaponsmaster(log: (m: string) => void): Promise<boolean> {
    const target = weaponsmaster();
    if (!target || target.distance() > MASTER_BLOCK) {
        return true;
    }
    Game.setCombatStyle('strength');
    if (!(await target.interact('Attack'))) {
        return false;
    }
    const deadline = performance.now() + KILL_MS;
    while (performance.now() < deadline) {
        await Sustain.run();
        if (EventSignal.pending()) {
            return false;
        }
        const live = weaponsmaster();
        if (!live || live.distance() > MASTER_BLOCK) {
            log('the Weaponsmaster is down');
            return true;
        }
        await Execution.delayTicks(1);
    }
    log(`the Weaponsmaster outlived ${KILL_MS / 1000}s of combat`);
    return false;
}

async function takeCrossbow(spawn: Tile, log: (m: string) => void): Promise<boolean> {
    const before = Inventory.countById(SOA_ID.CROSSBOW);
    // Why: the fight walks the character off the take tile, so every take re-walks to its own spawn first.
    if (!(await Traversal.walkResilient(spawn, { radius: 1, attempts: 3, timeoutMs: 30_000, log }))) {
        return false;
    }
    const drop = GroundItems.query().where(g => g.id === SOA_ID.CROSSBOW).within(3).nearest();
    if (!drop) {
        log(`no crossbow on the floor at (${spawn.x},${spawn.z})`);
        return false;
    }
    if (!(await drop.interact('Take'))) {
        return false;
    }
    await Execution.delayUntil(() => Inventory.countById(SOA_ID.CROSSBOW) > before, 6000);
    return Inventory.countById(SOA_ID.CROSSBOW) > before;
}

export async function raidWeaponStore(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(SOA_ID.CROSSBOW) >= 2) {
        return leaveWeaponStore(log);
    }
    if (!inWeaponStore(Game.tile())) {
        if (!(await unlockStore(log))) {
            return false;
        }
        if (!(await climb(SOA_LOC.STORE_LADDER, 'Climb-up', SOA_TILE.STORE_LADDER, SOA_TILE.STORE_LADDER_TOP, log))) {
            return false;
        }
    }
    if (!(await clearWeaponsmaster(log))) {
        return false;
    }
    for (const spawn of [SOA_TILE.CROSSBOW_WEST, SOA_TILE.CROSSBOW_EAST]) {
        if (Inventory.countById(SOA_ID.CROSSBOW) >= 2) {
            break;
        }
        if (!(await takeCrossbow(spawn, log))) {
            // Why: one spawn may still be on its 100-tick respawn, which is a retry rather than a failure.
            log(`crossbow at (${spawn.x},${spawn.z}) not taken this pass`);
        }
        await clearWeaponsmaster(log);
    }
    if (Inventory.countById(SOA_ID.CROSSBOW) < 2) {
        return false;
    }
    return leaveWeaponStore(log);
}

const cupboardOpen = () => Locs.query().within(6).where(l => l.id === SOA_LOC.CUPBOARD_OPEN).nearest();

export async function takeBlackArmHalf(log: (m: string) => void): Promise<boolean> {
    if (Inventory.countById(SOA_ID.SHIELD_BLACKARM) > 0) {
        return leaveBlackArmUpper(log);
    }
    if (!(await enterBlackArmUpper(log))) {
        return false;
    }
    // Why: the cupboard renders as two locs, and Search is op2 of the open one — op1 is Shut.
    if (!cupboardOpen() && !(await promptLoc({
        name: 'Cupboard',
        op: 'Open',
        near: SOA_TILE.CUPBOARD_STAND,
        id: SOA_LOC.CUPBOARD_SHUT,
        within: 6,
        expect: () => cupboardOpen() !== null
    }, log))) {
        return false;
    }

    const mark = GameMessages.mark();
    await promptLoc({
        name: 'Cupboard',
        op: 'Search',
        near: SOA_TILE.CUPBOARD_STAND,
        id: SOA_LOC.CUPBOARD_OPEN,
        within: 6,
        expect: () => Inventory.countById(SOA_ID.SHIELD_BLACKARM) > 0 || GameMessages.sawSince(mark, CUPBOARD_BARE)
    }, log);
    await Modals.close();

    if (Inventory.countById(SOA_ID.SHIELD_BLACKARM) === 0) {
        if (GameMessages.sawSince(mark, CUPBOARD_BARE)) {
            log('the cupboard is bare — a half is already held or banked, or the quest is complete');
        } else {
            log(`cupboard search landed nothing: ${GameMessages.since(mark).map(m => m.text).join(' · ')}`);
        }
        await leaveBlackArmUpper(log);
        return false;
    }
    if (!GameMessages.sawSince(mark, FOUND_HALF)) {
        log('half is held but the find line never printed');
    }
    return leaveBlackArmUpper(log);
}

export function blackarmStep(snap: QuestSnapshot): QuestStep {
    const stage = snap.progress?.stage ?? snap.stage ?? SOA_STAGE.NOT_STARTED;

    switch (stage) {
        case SOA_STAGE.NOT_STARTED:
            return { kind: 'talk', stop: TRAMP };

        case SOA_STAGE.TRAMP_TOLD:
            return { kind: 'talk', stop: KATRINE_JOIN };

        case SOA_STAGE.KATRINE_TASK:
            if (heldId(snap, SOA_ID.CROSSBOW) >= 2) {
                return { kind: 'talk', stop: KATRINE_HANDIN };
            }
            if (heldId(snap, SOA_ID.STORE_KEY) > 0) {
                return { kind: 'custom', name: 'steal two crossbows from the weapon store', run: raidWeaponStore };
            }
            // Why: the store door yields only to phoenixkey2, which only Straven issues, so a keyless bot has to be given one.
            return { kind: 'wait', reason: 'needs a Phoenix weapon-store key from a partner' };

        case SOA_STAGE.BLACKARM_JOINED:
            if (heldId(snap, SOA_ID.SHIELD_BLACKARM) > 0) {
                return { kind: 'wait', reason: 'black arm half held — the other half is not this leg' };
            }
            return { kind: 'custom', name: 'search the Black Arm cupboard', run: takeBlackArmHalf };

        default:
            return { kind: 'wait', reason: `black arm leg has nothing for stage ${stage}` };
    }
}
