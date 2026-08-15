import { Equipment } from '../../../../equipment/Equipment.js';
import { Execution } from '../../../../execution/Execution.js';
import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import type { Loc } from '../../../../model/Loc.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { Reach } from '../../../../walking/Reach.js';
import type Tile from '../../../../../geometry/Tile.js';
import { talkStrict } from '../../exec/primitives.js';
import { driveUntil, heldId, settleScene } from '../../exec/prompts.js';
import { UP_ITEM, UP_LOC, UP_NPC, UP_TILE, upassArea } from './areas.js';
import { travelTo } from './pass.js';

const KOFTIK = 'Koftik';

// Why: inside the pass every destination past an obstacle is "unreachable" to the navigator, so the shared
// mover is the pocket-crossing one. Above ground it degrades to a plain resilient walk on its first round.
export async function walkTo(to: Tile, radius: number, log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && here.level === to.level && to.distanceTo(here) <= radius) {
        return true;
    }
    return travelTo(to, radius, log);
}

export function locById(id: number, op: string | null, within = 12): Loc | null {
    const base = Locs.query().where(loc => loc.id === id);
    return (op === null ? base : base.action(op)).within(within).nearest();
}

async function talkAt(npcId: number, near: Tile, prefer: string[], log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(near, 2, log))) {
        return false;
    }
    await settleScene();
    // Why: five separate NPCs all render as "Koftik", so the guide is found by id and only then talked to by name.
    const guide = Npcs.query().where(npc => npc.id === npcId).within(12).nearest();
    if (!guide) {
        log(`no npc ${npcId} near (${near.x},${near.z})`);
        return false;
    }
    if ((await Reach.npcDialog({ name: guide.name ?? KOFTIK, near, log })) !== 'done') {
        log(`no dialogue with npc ${npcId} near (${near.x},${near.z})`);
        return false;
    }
    return talkStrict(guide.name ?? KOFTIK, prefer, log);
}

// Why: neither of Plague City's or Biohazard's crossings survives into this quest. The garden dig is
// refused the moment Biohazard starts ("the ground's been filled in and packed hard"), and Omart will not
// re-hang the rope ladder once Biohazard is finished. What a completed Biohazard leaves behind is the city
// gates themselves: `west_ardougne_open_city_doors` opens them outright at `%biohazard = complete`.
// Why: the navigator has no edge through them, so the crossing is walked and opened by hand.

async function openWallGate(from: Tile, to: Tile, log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(from, 1, log))) {
        return false;
    }
    await settleScene();
    const gate = locById(UP_LOC.WALL_DOOR_L, 'Open', 8) ?? locById(UP_LOC.WALL_DOOR_R, 'Open', 8);
    if (!gate) {
        log(`no Ardougne wall gate within reach of (${from.x},${from.z})`);
        return false;
    }
    if (!(await gate.interact('Open'))) {
        return false;
    }
    return driveUntil(() => {
        const now = Game.tile();
        return now !== null && Math.abs(now.x - to.x) <= 3 && Math.abs(now.z - to.z) <= 4;
    }, [], log, 12_000);
}

// Why: the gate teleport lands one tile short of the stand on either side, so "am I across yet" cannot be
// a comparison against the stand's own x — it is the region test, which is what the rest of the module uses.

/** Through the Ardougne wall gates into West Ardougne. */
export async function crossToWest(log: (m: string) => void): Promise<boolean> {
    if (upassArea(Game.tile()) === 'westardougne') {
        return true;
    }
    return openWallGate(UP_TILE.WALL_GATE_EAST, UP_TILE.WALL_GATE_WEST, log);
}

/** Back out through the same gates. */
export async function crossToEast(log: (m: string) => void): Promise<boolean> {
    if (upassArea(Game.tile()) === 'mainland') {
        return true;
    }
    return openWallGate(UP_TILE.WALL_GATE_WEST, UP_TILE.WALL_GATE_EAST, log);
}

/** King Lathas starts the quest; his branch needs Biohazard complete and base Ranged 25. */
export async function startQuest(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(UP_TILE.LATHAS, 2, log))) {
        return false;
    }
    await settleScene();
    return talkStrict('King Lathas', [], log);
}

/** Koftik at the cave mouth — the "I'll take my chances" branch moves the stage without the lore detour. */
export function meetKoftik(log: (m: string) => void): Promise<boolean> {
    return talkAt(UP_NPC.KOFTIK_SURFACE, UP_TILE.CAVE_MOUTH, ["I'll take my chances"], log);
}

export async function enterCave(log: (m: string) => void): Promise<boolean> {
    if ((Game.tile()?.z ?? 0) > 9000) {
        return true;
    }
    // Why: the cave mouth is a 4x2 loc, so its own origin tile sits inside the footprint and cannot be
    // walked to — the walk fails outright. Koftik's tile is the stand, and the op-click closes the gap.
    if (!(await walkTo(UP_TILE.CAVE_MOUTH, 3, log))) {
        return false;
    }
    await settleScene();
    const mouth = locById(UP_LOC.CAVE_ENTRANCE, 'Enter', 16);
    if (!mouth) {
        log('no cave entrance at the far west of West Ardougne');
        return false;
    }
    if (!(await mouth.interact('Enter'))) {
        return false;
    }
    return driveUntil(() => (Game.tile()?.z ?? 0) > 9000, [], log, 20_000);
}

/** Koftik by the bridge hands over the damp cloth. */
export function getDampCloth(log: (m: string) => void): Promise<boolean> {
    return talkAt(UP_NPC.KOFTIK_BRIDGE, UP_TILE.KOFTIK_BRIDGE, ['Not to worry'], log);
}

/** Damp cloth on a bronze arrow, then the tinderbox on the result. */
export async function makeFireArrow(log: (m: string) => void): Promise<boolean> {
    if (heldId(UP_ITEM.LIT_ARROW.id) > 0) {
        return true;
    }
    if (heldId(UP_ITEM.UNLIT_ARROW.id) === 0) {
        const cloth = Inventory.items().find(item => item.id === UP_ITEM.DAMP_CLOTH.id);
        const arrow = Inventory.items().find(item => item.id === UP_ITEM.BRONZE_ARROW.id);
        if (!cloth || !arrow) {
            log(`missing ${cloth ? 'a bronze arrow' : 'the damp cloth'} for the fire arrow`);
            return false;
        }
        if (!(await cloth.useOn(arrow))) {
            return false;
        }
        if (!(await driveUntil(() => heldId(UP_ITEM.UNLIT_ARROW.id) > 0, [], log, 10_000))) {
            log('the damp cloth would not wrap an arrow');
            return false;
        }
    }
    const unlit = Inventory.items().find(item => item.id === UP_ITEM.UNLIT_ARROW.id);
    const tinderbox = Inventory.items().find(item => item.id === UP_ITEM.TINDERBOX.id);
    if (!unlit || !tinderbox) {
        log(`missing ${unlit ? 'the tinderbox' : 'the unlit arrow'} to light the fire arrow`);
        return false;
    }
    // Why: `[opheldu,tinderbox]` fires off the TARGET, so the arrow is the item used and the tinderbox is the target.
    if (!(await unlit.useOn(tinderbox))) {
        return false;
    }
    return driveUntil(() => heldId(UP_ITEM.LIT_ARROW.id) > 0, [], log, 10_000);
}

/** Bow in hand, lit arrow in the quiver — the rope shot reads both off `worn`. */
export async function armFireArrow(log: (m: string) => void): Promise<boolean> {
    if (heldId(UP_ITEM.SHORTBOW.id) > 0 && !(await Equipment.equip(UP_ITEM.SHORTBOW.name))) {
        log('could not wield the shortbow');
        return false;
    }
    if (heldId(UP_ITEM.LIT_ARROW.id) > 0) {
        const lit = Inventory.items().find(item => item.id === UP_ITEM.LIT_ARROW.id);
        if (!lit || !(await lit.interact('Wield'))) {
            log('could not equip the lit arrow');
            return false;
        }
        await Execution.delayTicks(2);
    }
    return true;
}

// Why: the shot spends the arrow whether or not it lands — `inv_del(worn, $worn_ammo, 1)` runs before the
// `stat_random(ranged, 160, 300)` roll — and one damp cloth makes exactly one. Firing in a loop therefore
// spends seven attempts on an empty quiver. Koftik hands over another cloth whenever the pack holds none,
// so the retry is the decide() cycle rebuilding the arrow, and this step fires once.

/** Fire the lit arrow at the bridge stay rope; the script walks the player across on a hit. */
export async function shootGuiderope(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(UP_TILE.GUIDEROPE_SHOT, 1, log))) {
        return false;
    }
    await settleScene();
    const rope = locById(UP_LOC.GUIDEROPE, null, 12);
    if (!rope) {
        log('no bridge guide rope in range of the shooting stand');
        return false;
    }
    // Why: the script answers with one of five distinct `mes` lines — wrong side, no clear shot, no bow, no
    // lit ammo, or the shot itself — and the tile alone cannot tell a miss from a refusal that spent nothing.
    const mark = GameMessages.mark();
    if (!(await rope.interact('Fire-at'))) {
        log(`the guide rope refused Fire-at (ops: ${rope.actions().join(' | ')})`);
        return false;
    }
    const crossed = await driveUntil(() => (Game.tile()?.x ?? 9999) < UP_TILE.GUIDEROPE_SHOT.x - 3, [], log, 12_000);
    const said = GameMessages.since(mark).map(m => m.text).join(' | ');
    log(crossed ? 'the arrow impaled the rope' : `the shot did not carry — server said: ${said || '(nothing)'}`);
    return crossed;
}
