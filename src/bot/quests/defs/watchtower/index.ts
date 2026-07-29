import Tile from '../../../api/Tile.js';
import { QUESTS } from '../../data/quests.js';
import { hasFlag, type QuestModule, type QuestSnapshot, type QuestStep } from '../../engine/types.js';
import { RELIC_PARTS, WT_ITEM, WT_TILE, watchtowerArea, type WatchtowerArea } from './areas.js';
import { WATCHTOWER_STAGE, readWatchtowerProgress } from './journal.js';
import { giveRelicPart, handInFingernails, leaveWizardFloor, searchEvidenceBush, startQuest } from './tower.js';
import {
    JANGERBERRY_TARGET,
    killGorad,
    leaveGrewIsland,
    leaveTobanCamp,
    openTobanChest,
    pickJangerberries,
    talkToGrew,
    talkToOg,
    talkToToban
} from './tribes.js';

const ARDOUGNE_GENERAL = { npc: 'Shop keeper', anchor: new Tile(2615, 3294, 0) };
const ROPE_PRICE = 25;

function held(snap: QuestSnapshot, id: number): number {
    return snap.invIds?.get(id) ?? 0;
}

function banked(snap: QuestSnapshot, id: number): number {
    return snap.bankIds?.get(id) ?? 0;
}

function owned(snap: QuestSnapshot, id: number): number {
    return held(snap, id) + banked(snap, id);
}

function withdrawFrom(items: { name: string; id: number; qty: number }[]): QuestStep {
    return { kind: 'withdraw', items, bank: WT_TILE.YANILLE_BANK };
}

/** Bank first, then shop. Null once the pack already holds enough. */
function source(
    snap: QuestSnapshot,
    item: { id: number; name: string },
    qty: number,
    shop: { npc: string; anchor: Tile },
    unitGp: number
): QuestStep | null {
    if (held(snap, item.id) >= qty) {
        return null;
    }
    if (!snap.bankKnown) {
        return { kind: 'scanBank', bank: WT_TILE.YANILLE_BANK };
    }
    const missing = qty - held(snap, item.id);
    const inBank = banked(snap, item.id);
    if (inBank > 0) {
        return withdrawFrom([{ name: item.name, id: item.id, qty: Math.min(missing, inBank) }]);
    }
    return { kind: 'buy', item: item.name, qty: missing, shop, estGp: missing * unitGp };
}

/** Each trip onto Grew's island consumes one rope; the swing back out is free. */
function needRope(snap: QuestSnapshot, area: WatchtowerArea): QuestStep | null {
    return area === 'grewIsland' ? null : source(snap, WT_ITEM.ROPE, 1, ARDOUGNE_GENERAL, ROPE_PRICE);
}

function stageTribes(snap: QuestSnapshot, area: WatchtowerArea): QuestStep {
    const progress = snap.progress;

    if (!hasFlag(progress, 'helped-og')) {
        if (held(snap, WT_ITEM.STOLEN_GOLD.id) > 0 || !hasFlag(progress, 'spoken-og')) {
            return { kind: 'custom', name: 'talk to Og', run: talkToOg };
        }
        if (held(snap, WT_ITEM.TOBAN_KEY.id) > 0) {
            return { kind: 'custom', name: "take the stolen gold from Toban's chest", run: openTobanChest };
        }
        return { kind: 'custom', name: 'ask Og for another chest key', run: talkToOg };
    }

    if (!hasFlag(progress, 'helped-toban')) {
        if (held(snap, WT_ITEM.DRAGON_BONES.id) > 0 || !hasFlag(progress, 'spoken-toban')) {
            return { kind: 'custom', name: 'talk to Toban', run: talkToToban };
        }
        if (!snap.bankKnown) {
            return { kind: 'scanBank', bank: WT_TILE.YANILLE_BANK };
        }
        if (banked(snap, WT_ITEM.DRAGON_BONES.id) > 0) {
            return withdrawFrom([{ name: WT_ITEM.DRAGON_BONES.name, id: WT_ITEM.DRAGON_BONES.id, qty: 1 }]);
        }
        return { kind: 'wait', reason: 'no Dragon bones in the bank for Toban' };
    }

    if (!hasFlag(progress, 'helped-grew')) {
        if (held(snap, WT_ITEM.OGRE_TOOTH.id) > 0 || !hasFlag(progress, 'spoken-grew')) {
            const rope = needRope(snap, area);
            return rope ?? { kind: 'custom', name: 'talk to Grew', run: talkToGrew };
        }
        return { kind: 'custom', name: "knock out one of Gorad's teeth", run: killGorad };
    }

    for (const part of RELIC_PARTS) {
        if (held(snap, part.id) > 0) {
            return {
                kind: 'custom',
                name: `give ${part.name} to the wizard`,
                run: log => giveRelicPart(part.id, log)
            };
        }
    }

    if (owned(snap, WT_ITEM.JANGERBERRIES.id) < JANGERBERRY_TARGET) {
        const rope = needRope(snap, area);
        return rope ?? { kind: 'custom', name: 'pick jangerberries on Grew island', run: pickJangerberries };
    }

    const escape = escapePocket(area, 'yanille');
    if (escape) {
        return escape;
    }
    return { kind: 'wait', reason: 'every tribe is helped but no relic part is in the pack' };
}

function escapePocket(area: WatchtowerArea, wanted: WatchtowerArea): QuestStep | null {
    if (area === wanted) {
        return null;
    }
    switch (area) {
        case 'towerFloor':
        case 'mirrorTower':
            return { kind: 'custom', name: 'climb down from the wizard floor', run: leaveWizardFloor };
        case 'grewIsland':
            return { kind: 'custom', name: 'swing back off Grew island', run: leaveGrewIsland };
        case 'tobanCamp':
            return { kind: 'custom', name: "leave Toban's camp", run: leaveTobanCamp };
        default:
            return null;
    }
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete' || (snap.stage ?? -1) >= WATCHTOWER_STAGE.COMPLETE) {
        return { kind: 'done' };
    }
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    if (snap.stage === undefined) {
        return { kind: 'wait', reason: 'Watch Tower journal stage unavailable' };
    }
    const area = watchtowerArea(snap.tile);
    if (area === 'unknown') {
        return { kind: 'wait', reason: 'player location unavailable' };
    }

    switch (snap.stage) {
        case WATCHTOWER_STAGE.NOT_STARTED:
            return { kind: 'custom', name: 'climb the Watchtower and ask the wizard for work', run: startQuest };

        case WATCHTOWER_STAGE.STARTED: {
            if (held(snap, WT_ITEM.FINGERNAILS.id) > 0) {
                return { kind: 'custom', name: 'give the fingernails to the wizard', run: handInFingernails };
            }
            const escape = escapePocket(area, 'yanille');
            return escape ?? { kind: 'custom', name: 'search the bush by the Watchtower for evidence', run: searchEvidenceBush };
        }

        case WATCHTOWER_STAGE.GIVEN_FINGERNAILS:
            return stageTribes(snap, area);

        default:
            return { kind: 'wait', reason: 'Watch Tower stage ' + snap.stage + ' is not implemented yet' };
    }
}

export const watchtower: QuestModule = {
    record: QUESTS.find(record => record.id === 'itwatchtower')!,
    bank: WT_TILE.YANILLE_BANK,
    ownsInventory: true,
    readProgress: readWatchtowerProgress,
    sustain: { foods: ['Lobster', 'Swordfish', 'Tuna'], eatBelowHp: 0.6 },
    decide
};
