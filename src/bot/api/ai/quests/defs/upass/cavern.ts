import { Equipment } from '../../../../equipment/Equipment.js';
import { Game } from '../../../../game/Game.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { Reach } from '../../../../walking/Reach.js';
import type Tile from '../../../../../geometry/Tile.js';
import { talkStrict } from '../../exec/primitives.js';
import { driveUntil, heldId, settleScene } from '../../exec/prompts.js';
import { UP_ITEM, UP_LOC, UP_NPC, UP_TILE } from './areas.js';
import { driveThroughBoxes, locById, walkTo } from './bridge.js';

async function talkTo(npcId: number, name: string, near: Tile, prefer: string[], log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(near, 2, log))) {
        return false;
    }
    await settleScene();
    const npc = Npcs.query().where(n => n.id === npcId).within(12).nearest();
    if (!npc) {
        log(`no ${name} near (${near.x},${near.z})`);
        return false;
    }
    if ((await Reach.npcDialog({ name: npc.name ?? name, near, log })) !== 'done') {
        log(`no dialogue with ${name}`);
        return false;
    }
    return talkStrict(npc.name ?? name, prefer, log);
}

/** Down the wall tunnel into the dwarves' cave. */
export async function descendToDwarves(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(UP_TILE.TUNNEL_TO_DWARVES, 3, log))) {
        return false;
    }
    await settleScene();
    const tunnel = locById(UP_LOC.TUNNEL_DOWN, null, 8);
    const op = tunnel?.actions()[0];
    if (!tunnel || !op || !(await tunnel.interact(op))) {
        log('no wall tunnel down to the dwarves');
        return false;
    }
    // Why: the first descent adds Koftik and opens his `~mesbox` greeting, which a chat driver cannot dismiss.
    return driveThroughBoxes(() => (Game.tile()?.z ?? 0) > 9700, [], log, 20_000);
}

/** Down the other wall tunnel, into Kalrag's cave. */
export async function descendToKalrag(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(UP_TILE.TUNNEL_TO_KALRAG, 3, log))) {
        return false;
    }
    await settleScene();
    const tunnel = locById(UP_LOC.TUNNEL_DOWN, null, 8);
    const op = tunnel?.actions()[0];
    if (!tunnel || !op || !(await tunnel.interact(op))) {
        log("no wall tunnel down to Kalrag's cave");
        return false;
    }
    return driveUntil(() => (Game.tile()?.z ?? 0) > 9850, [], log, 15_000);
}

/** Back up the tunnel to the level-1 platforms. */
export async function ascendFromDwarves(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(UP_TILE.TUNNEL_FROM_DWARVES, 3, log))) {
        return false;
    }
    await settleScene();
    const tunnel = locById(UP_LOC.TUNNEL_UP, null, 8);
    const op = tunnel?.actions()[0];
    if (!tunnel || !op || !(await tunnel.interact(op))) {
        log('no wall tunnel up out of the dwarves cave');
        return false;
    }
    return driveUntil(() => (Game.tile()?.level ?? 0) === 1, [], log, 15_000);
}

/** Nilhoof points at the witch and moves the stage on. */
export const askNilhoof = (log: (m: string) => void): Promise<boolean> =>
    talkTo(UP_NPC.NILHOOF, 'Nilhoof', UP_TILE.NILHOOF, [], log);

/** Klank hands over a tinderbox, and the gauntlets once the doll is found. */
export const askKlank = (log: (m: string) => void): Promise<boolean> =>
    talkTo(UP_NPC.KLANK, 'Klank', UP_TILE.KLANK, ['What happened to them?', 'Take care Klank'], log);

/** The soulless bite for 10 unless the gauntlets are on. */
export async function wearGauntlets(log: (m: string) => void): Promise<boolean> {
    if (heldId(UP_ITEM.GAUNTLETS.id) === 0) {
        return true;
    }
    if (!(await Equipment.equip(UP_ITEM.GAUNTLETS.name))) {
        log("could not wear Klank's gauntlets");
        return false;
    }
    return true;
}

/** Bag the witch's cat from the platform below her house. */
export async function catchCat(log: (m: string) => void): Promise<boolean> {
    if (heldId(UP_ITEM.WITCH_CAT.id) > 0) {
        return true;
    }
    if (!(await walkTo(UP_TILE.WITCH_CAT, 2, log))) {
        return false;
    }
    await settleScene();
    const cat = Npcs.query().where(n => n.id === UP_NPC.WITCH_CAT).within(10).nearest();
    const op = cat?.actions()[0];
    if (!cat || !op || !(await cat.interact(op))) {
        log('no witches cat on the platform');
        return false;
    }
    return driveUntil(() => heldId(UP_ITEM.WITCH_CAT.id) > 0, [], log, 12_000);
}

// Why: knocking is what draws Kardia out, and she only comes if the cat is already by the door — the
// door's op1 answers with 25% damage while she is still inside.
// Why: and the knock takes the cat, which the journal never records — so a snapshot reads "no cat, no doll"
// after the knock exactly as it reads it before the cat is caught, and the run went back for a cat that was
// already at the witch's door. Catching it, knocking, and opening the chest are therefore one step, ending
// on the doll, which the journal does record.

/** Take the cat to Kardia's door, knock, and lift the doll from her chest while she is outside. */
export async function stealTheDoll(log: (m: string) => void): Promise<boolean> {
    for (let round = 0; round < 3; round++) {
        if (heldId(UP_ITEM.DOLL.id) > 0) {
            return true;
        }
        if (await lootWitchChest(log)) {
            return true;
        }
        if (heldId(UP_ITEM.WITCH_CAT.id) === 0 && !(await catchCat(log))) {
            log('no cat to draw Kardia out with');
            return false;
        }
        if (!(await distractWitch(log))) {
            log('Kardia would not come to the door');
        }
    }
    return heldId(UP_ITEM.DOLL.id) > 0;
}

/** Knock with the cat in the pack, which puts it down and takes her away from the chest. */
export async function distractWitch(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(UP_TILE.WITCH_DOOR, 3, log))) {
        return false;
    }
    await settleScene();
    const door = locById(UP_LOC.WITCH_DOOR, 'Knock', 8);
    if (!door || !(await door.interact('Knock'))) {
        log("no knockable door on Kardia's house");
        return false;
    }
    return driveUntil(() => heldId(UP_ITEM.WITCH_CAT.id) === 0, [], log, 20_000);
}

/** Open the house and take the doll out of the chest. */
export async function lootWitchChest(log: (m: string) => void): Promise<boolean> {
    if (heldId(UP_ITEM.DOLL.id) > 0) {
        return true;
    }
    if (!(await walkTo(UP_TILE.WITCH_CHEST, 3, log))) {
        const door = locById(UP_LOC.WITCH_DOOR, 'Open', 8);
        if (door && (await door.interact('Open'))) {
            await driveUntil(() => locById(UP_LOC.WITCH_CHEST, null, 8) !== null, [], log, 8_000);
        }
        if (!(await walkTo(UP_TILE.WITCH_CHEST, 3, log))) {
            return false;
        }
    }
    await settleScene();
    const chest = locById(UP_LOC.WITCH_CHEST, null, 8);
    const op = chest?.actions()[0];
    if (!chest || !op || !(await chest.interact(op))) {
        log("no chest inside Kardia's house");
        return false;
    }
    return driveThroughBoxes(() => heldId(UP_ITEM.DOLL.id) > 0, [], log, 25_000);
}
