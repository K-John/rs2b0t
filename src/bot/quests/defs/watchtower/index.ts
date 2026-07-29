import { QUESTS } from '../../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import { WT_TILE, watchtowerArea } from './areas.js';
import { WATCHTOWER_STAGE, readWatchtowerProgress } from './journal.js';

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
    if (watchtowerArea(snap.tile) === 'unknown') {
        return { kind: 'wait', reason: 'player location unavailable' };
    }
    return { kind: 'wait', reason: 'Watch Tower stage ' + snap.stage + ' is not implemented yet' };
}

export const watchtower: QuestModule = {
    record: QUESTS.find(record => record.id === 'itwatchtower')!,
    bank: WT_TILE.YANILLE_BANK,
    ownsInventory: true,
    readProgress: readWatchtowerProgress,
    sustain: { foods: ['Lobster', 'Swordfish', 'Tuna'], eatBelowHp: 0.6 },
    decide
};
