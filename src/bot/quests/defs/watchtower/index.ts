import { QUESTS } from '../../data/quests.js';
import { hasFlag, type QuestModule, type QuestSnapshot, type QuestStep } from '../../engine/types.js';
import { RELIC_PARTS, WT_ITEM, WT_TILE, watchtowerArea, type WatchtowerArea } from './areas.js';
import {
    CHASM_TOLL,
    answerRiddle,
    askRiddle,
    crossBattlement,
    jumpBack,
    showRelicToGuard,
    stealRockCake
} from './gutanoth.js';
import { WATCHTOWER_STAGE, readWatchtowerProgress } from './journal.js';
import {
    askWizardForRelic,
    giveRelicPart,
    handInFingernails,
    leaveWizardFloor,
    searchEvidenceBush,
    startQuest
} from './tower.js';
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
import { banked, bankOnly, held, owned, scanBank, sourceCoins, sourceDeathRune, sourceRope, withdrawFrom } from './supplies.js';

// Enough for both chasm tolls, a death rune and the odd shop trip.
const CITY_PURSE = 2000;

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
        case 'cityGuard':
            return { kind: 'custom', name: 'jump back out of the city-guard pocket', run: jumpBack };
        default:
            return null;
    }
}

/** Each trip onto Grew's island consumes one rope; the swing back out is free. */
function needRope(snap: QuestSnapshot, area: WatchtowerArea): QuestStep | null {
    return area === 'grewIsland' ? null : sourceRope(snap);
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
        return bankOnly(snap, WT_ITEM.DRAGON_BONES) ?? { kind: 'custom', name: 'talk to Toban', run: talkToToban };
    }

    if (!hasFlag(progress, 'helped-grew')) {
        if (held(snap, WT_ITEM.OGRE_TOOTH.id) > 0 || !hasFlag(progress, 'spoken-grew')) {
            return needRope(snap, area) ?? { kind: 'custom', name: 'talk to Grew', run: talkToGrew };
        }
        return { kind: 'custom', name: "knock out one of Gorad's teeth", run: killGorad };
    }

    for (const part of RELIC_PARTS) {
        if (held(snap, part.id) > 0) {
            return { kind: 'custom', name: `give ${part.name} to the wizard`, run: log => giveRelicPart(part.id, log) };
        }
    }

    if (owned(snap, WT_ITEM.JANGERBERRIES.id) < JANGERBERRY_TARGET) {
        return needRope(snap, area) ?? { kind: 'custom', name: 'pick jangerberries on Grew island', run: pickJangerberries };
    }

    return escapePocket(area, 'yanille')
        ?? { kind: 'wait', reason: 'every tribe is helped but no relic part is in the pack' };
}

function stageRelicGate(snap: QuestSnapshot, area: WatchtowerArea): QuestStep {
    if (held(snap, WT_ITEM.OGRE_RELIC.id) > 0) {
        return escapePocket(area, 'yanille')
            ?? { kind: 'custom', name: 'show the relic to the north-west ogre guard', run: showRelicToGuard };
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    if (banked(snap, WT_ITEM.OGRE_RELIC.id) > 0) {
        return withdrawFrom([{ name: WT_ITEM.OGRE_RELIC.name, id: WT_ITEM.OGRE_RELIC.id, qty: 1 }]);
    }
    return { kind: 'custom', name: 'ask the wizard for another relic', run: askWizardForRelic };
}

function stageCityEntry(snap: QuestSnapshot, area: WatchtowerArea): QuestStep {
    if (area === 'cityGuard') {
        return { kind: 'custom', name: 'ask the city guard for passage', run: askRiddle };
    }
    if (!hasFlag(snap.progress, 'market-paid')) {
        if (held(snap, WT_ITEM.ROCK_CAKE.id) === 0) {
            return { kind: 'custom', name: 'steal a rock cake from the ogre stall', run: stealRockCake };
        }
        return { kind: 'custom', name: 'give the rock cake to the battlement guard', run: crossBattlement };
    }
    const purse = held(snap, WT_ITEM.COINS.id) < CHASM_TOLL * 2 ? sourceCoins(snap, CITY_PURSE) : null;
    return purse ?? { kind: 'custom', name: 'pay the ogre guard, jump the chasm, ask the riddle', run: askRiddle };
}

function stageRiddle(snap: QuestSnapshot): QuestStep {
    const rune = sourceDeathRune(snap);
    if (rune) {
        return rune;
    }
    const purse = held(snap, WT_ITEM.COINS.id) < CHASM_TOLL * 2 ? sourceCoins(snap, CITY_PURSE) : null;
    return purse ?? { kind: 'custom', name: 'answer the riddle with a death rune', run: answerRiddle };
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
            return escapePocket(area, 'yanille')
                ?? { kind: 'custom', name: 'search the bush by the Watchtower for evidence', run: searchEvidenceBush };
        }

        case WATCHTOWER_STAGE.GIVEN_FINGERNAILS:
            return stageTribes(snap, area);

        case WATCHTOWER_STAGE.MADE_RELIC:
            return stageRelicGate(snap, area);

        case WATCHTOWER_STAGE.GIVEN_RELIC:
            return stageCityEntry(snap, area);

        case WATCHTOWER_STAGE.GIVEN_RIDDLE:
            return stageRiddle(snap);

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
