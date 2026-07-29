import { QUESTS } from '../../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import { WT_ITEM, WT_TILE, watchtowerArea, type WatchtowerArea } from './areas.js';
import { WATCHTOWER_STAGE, readWatchtowerProgress } from './journal.js';
import { handInFingernails, leaveWizardFloor, searchEvidenceBush, startQuest } from './tower.js';

function held(snap: QuestSnapshot, id: number): number {
    return snap.invIds?.get(id) ?? 0;
}

function escapePocket(area: WatchtowerArea, wanted: WatchtowerArea): QuestStep | null {
    if (area === wanted) {
        return null;
    }
    if (area === 'towerFloor' || area === 'mirrorTower') {
        return { kind: 'custom', name: 'climb down from the wizard floor', run: leaveWizardFloor };
    }
    return null;
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
