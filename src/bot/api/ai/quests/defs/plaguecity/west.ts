import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import type Tile from '../../../../../geometry/Tile.js';
import { driveChoice, heldId, settleScene } from '../../exec/prompts.js';
import { PC_ITEM, PC_LOC, PC_NPC, PC_TILE } from './areas.js';
import { talkAt } from './east.js';
import { area, goCellar, goUpstairs, locById, walkTo } from './travel.js';

const JETHICK_PREFER = ["I'm looking for a woman from East Ardougne."];
const MOURNER_PREFER = ['I fear not a mere plague.', 'How do I get clearance?'];
const CLERK_PREFER = ['I need permission to enter a plague house.', 'This is urgent though!'];
const BRAVEK_RECIPE_PREFER = ['This is really important though!', 'Do you know what is in the cure?'];
const BRAVEK_WARRANT_PREFER = ["They won't listen to me!"];

async function answerPrompt(prefer: string[], log: (m: string) => void): Promise<boolean> {
    if (!(await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 8000))) {
        return true;
    }
    const answered = await driveChoice(prefer, log);
    await Execution.delayTicks(2);
    return answered;
}

async function openDoor(id: number, near: Tile, prefer: string[], log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(near, 1, log))) {
        return false;
    }
    await settleScene();
    const door = locById(id, 'Open', 6);
    if (!door) {
        log(`no shut door ${id} near (${near.x},${near.z}) — already open`);
        return true;
    }
    if (!(await door.interact('Open'))) {
        return false;
    }
    return answerPrompt(prefer, log);
}

export const showPicture = (log: (m: string) => void): Promise<boolean> =>
    talkAt(PC_NPC.JETHICK, PC_TILE.JETHICK, JETHICK_PREFER, log);

export async function returnBook(log: (m: string) => void): Promise<boolean> {
    if (!(await openDoor(PC_LOC.REHNISON_DOOR, PC_TILE.REHNISON_DOOR, [], log))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(PC_ITEM.TURNIP_BOOK.id) === 0, 10_000);
}

export const askParents = (log: (m: string) => void): Promise<boolean> =>
    talkAt(PC_NPC.TED, PC_TILE.REHNISON_TED, [], log);

export async function askMilli(log: (m: string) => void): Promise<boolean> {
    if (!(await goUpstairs(log))) {
        return false;
    }
    return talkAt(PC_NPC.MILLI, PC_TILE.MILLI, [], log);
}

export const askAboutClearance = (log: (m: string) => void): Promise<boolean> =>
    openDoor(PC_LOC.PLAGUE_DOOR, PC_TILE.PLAGUE_DOOR, MOURNER_PREFER, log);

export const askClerk = (log: (m: string) => void): Promise<boolean> =>
    talkAt(PC_NPC.CLERK, PC_TILE.CLERK, CLERK_PREFER, log);

async function reachBravek(log: (m: string) => void): Promise<boolean> {
    return openDoor(PC_LOC.BRAVEK_DOOR, PC_TILE.BRAVEK_DOOR, [], log);
}

export async function askBravekForRecipe(log: (m: string) => void): Promise<boolean> {
    if (!(await reachBravek(log))) {
        return false;
    }
    return talkAt(PC_NPC.BRAVEK, PC_TILE.BRAVEK, BRAVEK_RECIPE_PREFER, log);
}

export async function giveHangoverCure(log: (m: string) => void): Promise<boolean> {
    if (!(await reachBravek(log))) {
        return false;
    }
    return talkAt(PC_NPC.BRAVEK, PC_TILE.BRAVEK, BRAVEK_WARRANT_PREFER, log);
}

// Why: stages 24 and 25 render the same journal line, and the clerk's stage-25 answer is a single harmless line, so one leg covers both.
export async function getAudience(log: (m: string) => void): Promise<boolean> {
    if (!(await askClerk(log))) {
        return false;
    }
    return askBravekForRecipe(log);
}

export const enterPlagueHouse = (log: (m: string) => void): Promise<boolean> =>
    openDoor(PC_LOC.PLAGUE_DOOR, PC_TILE.PLAGUE_DOOR, [], log);

function insidePlagueHouse(): boolean {
    const here = Game.tile();
    return here !== null && here.level === 0 && here.x >= 2530 && here.x <= 2541 && here.z >= 3266 && here.z <= 3271;
}

export async function rescueElena(log: (m: string) => void): Promise<boolean> {
    if (area() !== 'cellar' && !insidePlagueHouse() && !(await enterPlagueHouse(log))) {
        return false;
    }
    if (area() !== 'cellar' && heldId(PC_ITEM.ELENA_KEY.id) === 0 && !(await searchBarrel(log))) {
        return false;
    }
    return freeElena(log);
}

export async function searchBarrel(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(PC_TILE.BARREL, 1, log))) {
        return false;
    }
    await settleScene();
    const barrel = locById(PC_LOC.BARREL, 'Search', 6);
    if (!barrel || !(await barrel.interact('Search'))) {
        log('no Barrel offering Search on the plague house floor');
        return false;
    }
    return Execution.delayUntil(() => heldId(PC_ITEM.ELENA_KEY.id) > 0, 10_000);
}

export async function freeElena(log: (m: string) => void): Promise<boolean> {
    if (!(await goCellar(log))) {
        return false;
    }
    if (!(await walkTo(PC_TILE.ELENA_GATE, 1, log))) {
        return false;
    }
    await settleScene();
    const gate = locById(PC_LOC.ELENA_GATE, 'Open', 6);
    if (gate) {
        const key = Inventory.items().find(item => item.id === PC_ITEM.ELENA_KEY.id);
        if (!key) {
            log("no key for Elena's cell door");
            return false;
        }
        if (!(await key.useOn(gate))) {
            return false;
        }
        await answerPrompt([], log);
    }
    return talkAt(PC_NPC.ELENA, PC_TILE.ELENA, [], log);
}
