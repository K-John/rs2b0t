import { QUESTS } from '../../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import { UP_ITEM, UP_TILE, carried, held, pastGridTile, upassArea, worn, type UpassArea } from './areas.js';
import { UP_FLAG, UP_STAGE, readUpassProgress } from './journal.js';
import {
    armFireArrow,
    crossToWest,
    enterCave,
    getDampCloth,
    makeFireArrow,
    meetKoftik,
    shootGuiderope,
    startQuest
} from './bridge.js';
import { ORB_SITES, burnOrbs, enterWell, orbsHeld, takeGroundOrb, takeTrappedOrb } from './area1.js';
import { crossGrid } from './grid.js';
import {
    badgesHeld,
    climbToPaladins,
    dropBoulder,
    enterMainCavern,
    feedBloodWell,
    killPaladin,
    takeRailing,
    takeUnicornHorn
} from './area2.js';
import {
    ascendFromDwarves,
    askKlank,
    askNilhoof,
    catchCat,
    descendToDwarves,
    descendToKalrag,
    distractWitch,
    lootWitchChest,
    wearGauntlets
} from './cavern.js';
import {
    amuletsHeld,
    burnTomb,
    fillBrew,
    killDemon,
    killKalrag,
    openIbanDoor,
    openSealedChest,
    rubAshes,
    rubDove,
    rubShadow,
    searchCages,
    throwDoll
} from './doll.js';
import { kitShortfall, sourceKit } from './supplies.js';

const custom = (name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep =>
    ({ kind: 'custom', name, run });

function flag(snap: QuestSnapshot, name: string): boolean {
    return snap.progress?.flags.has(name) ?? false;
}

/** Everything the pass needs, drawn while a bank is still reachable. */
function outfit(snap: QuestSnapshot, area: UpassArea): QuestStep | null {
    return area === 'mainland' ? sourceKit(snap) : null;
}

// Why: Koftik and the cave mouth are both inside West Ardougne, which the navigator has no edge into —
// the wall is only crossed through the Plague City sewer, and only with the kit already in the pack.
function inWest(snap: QuestSnapshot, area: UpassArea, step: QuestStep): QuestStep {
    if (area === 'westardougne') {
        return step;
    }
    return readyToDescend(snap) ?? custom('cross the wall into West Ardougne', crossToWest);
}

// Why: the cave mouth is the last point with a bank behind it, so a pack short of the kit stops here and
// says what is missing rather than walking a one-way dungeon and parking at an obstacle it cannot pass.
function readyToDescend(snap: QuestSnapshot): QuestStep | null {
    const missing = kitShortfall(snap);
    return missing.length === 0 ? null : { kind: 'wait', reason: `not equipped for the pass: ${missing.join('; ')}` };
}

function bridgeLeg(snap: QuestSnapshot, area: UpassArea): QuestStep {
    if (area === 'mainland' || area === 'westardougne') {
        // Why: the kit is checked here too, not only at the crossing — a pack that lost something inside
        // West Ardougne would otherwise walk into a one-way dungeon without it.
        return readyToDescend(snap) ?? inWest(snap, area, custom('enter the underground pass', enterCave));
    }
    if (area !== 'area1') {
        return { kind: 'wait', reason: `bridge leg reached from ${area}` };
    }
    if (carried(snap, UP_ITEM.LIT_ARROW) === 0) {
        if (held(snap, UP_ITEM.DAMP_CLOTH) === 0 && held(snap, UP_ITEM.UNLIT_ARROW) === 0) {
            return custom('take the damp cloth from Koftik', getDampCloth);
        }
        return custom('wrap and light a fire arrow', makeFireArrow);
    }
    if (!worn(snap, UP_ITEM.LIT_ARROW) || !worn(snap, UP_ITEM.SHORTBOW)) {
        return custom('wield the shortbow and the lit arrow', armFireArrow);
    }
    return custom('fire the lit arrow at the bridge stay rope', shootGuiderope);
}

// Why: the four orbs are gathered before any of them is burned, because the furnace sits between the grid
// and the well and a per-orb round trip crosses the spear-trap corridor four times over.
function orbLeg(snap: QuestSnapshot): QuestStep {
    if (!pastGridTile(snap.tile)) {
        // Why: the crossing walks itself to the grid lip first. The rope swing is only reached for when that
        // walk has no route, so the rope is not spent on a guess about a shelf the navigator may already reach.
        return custom('cross the spiked grid with the journal held open', crossGrid);
    }
    const missing = ORB_SITES.find(site => held(snap, site.orb) === 0);
    if (missing) {
        return missing.fromTrap
            ? custom('disarm the hanging-log trap for its orb', takeTrappedOrb)
            : custom(`take the orb of light at (${missing.tile.x},${missing.tile.z})`, log => takeGroundOrb(missing.orb, missing.tile, log));
    }
    if (orbsHeld(snap) > 0) {
        return custom('burn the orbs in the furnace', burnOrbs);
    }
    // Why: the well is the oracle for the sweep — it only takes the player down once all four orbs are
    // dark, and blasts them back out otherwise, which sends the leg round for whichever orb was missed.
    return custom('climb into the well', enterWell);
}

function unicornLeg(snap: QuestSnapshot): QuestStep {
    if (held(snap, UP_ITEM.RAILING) === 0) {
        return custom('search the cage bars for a loose railing', takeRailing);
    }
    return custom('lever the boulder onto the caged unicorn', dropBoulder);
}

function paladinLeg(snap: QuestSnapshot, area: UpassArea): QuestStep {
    if (held(snap, UP_ITEM.UNICORN_HORN) === 0 && badgesHeld(snap) === 0 && area === 'area2') {
        return custom('take the unicorn horn from the crushed cage', takeUnicornHorn);
    }
    if (area === 'area2') {
        return custom('climb the mud pile back up to the shelf', climbToPaladins);
    }
    if (badgesHeld(snap) < 3) {
        return custom('kill a paladin for its coat of arms', killPaladin);
    }
    if (held(snap, UP_ITEM.UNICORN_HORN) > 0 || badgesHeld(snap) > 0) {
        return custom('feed the crests and horn to the blood well', feedBloodWell);
    }
    return custom('pass the temple doors into the main cavern', enterMainCavern);
}

function dwarfLeg(area: UpassArea): QuestStep {
    if (area !== 'dwarves') {
        return custom('climb down the wall tunnel to the dwarves', descendToDwarves);
    }
    return custom('ask Nilhoof about the way through', askNilhoof);
}

function witchLeg(snap: QuestSnapshot, area: UpassArea): QuestStep {
    if (area === 'dwarves') {
        return held(snap, UP_ITEM.TINDERBOX) === 0
            ? custom('take a tinderbox from Klank', askKlank)
            : custom('climb back up out of the dwarves cave', ascendFromDwarves);
    }
    if (held(snap, UP_ITEM.WITCH_CAT) === 0 && held(snap, UP_ITEM.DOLL) === 0) {
        return custom("catch the witch's cat", catchCat);
    }
    if (held(snap, UP_ITEM.WITCH_CAT) > 0) {
        return custom('knock on the door to draw Kardia out', distractWitch);
    }
    return custom('take the doll of Iban from the chest', lootWitchChest);
}

// Why: the four elements are ordered by where they are rather than by the doll — ashes and blood hang off
// the two wall tunnels, shadow and conscience off the level-1 platforms, so each tunnel is used once.
function dollLeg(snap: QuestSnapshot, area: UpassArea): QuestStep {
    if (held(snap, UP_ITEM.ASHES) > 0) {
        return custom("rub Iban's ashes into the doll", rubAshes);
    }
    if (held(snap, UP_ITEM.SHADOW) > 0) {
        return custom("pour Iban's shadow over the doll", rubShadow);
    }
    if (held(snap, UP_ITEM.DOVE) > 0) {
        return custom("crumble Iban's dove into the doll", rubDove);
    }
    // Why: the four elements sit in four different pockets joined by one-way tunnels, so each one names the
    // pocket it needs and the step that gets there — asking for the item from the wrong side finds nothing.
    if (!flag(snap, UP_FLAG.ASHES_ON_DOLL)) {
        if (area !== 'dwarves') {
            return custom('climb down the wall tunnel to the dwarves', descendToDwarves);
        }
        if (held(snap, UP_ITEM.GAUNTLETS) === 0) {
            return custom("take Klank's gauntlets", askKlank);
        }
        return held(snap, UP_ITEM.DWARF_BREW) === 0
            ? custom('fill the bucket with dwarf brew', fillBrew)
            : custom("soak and burn Iban's tomb", burnTomb);
    }
    if (!flag(snap, UP_FLAG.DOVE_ON_DOLL)) {
        if (area === 'dwarves') {
            return custom('climb back up out of the dwarves cave', ascendFromDwarves);
        }
        if (area !== 'main') {
            return { kind: 'wait', reason: `the soulless cages are in the main cavern, standing in ${area}` };
        }
        return held(snap, UP_ITEM.GAUNTLETS) > 0 && !worn(snap, UP_ITEM.GAUNTLETS)
            ? custom("wear Klank's gauntlets", wearGauntlets)
            : custom('search the soulless cages for the dove', searchCages);
    }
    if (!flag(snap, UP_FLAG.SHADOW_ON_DOLL)) {
        if (area !== 'witch') {
            return { kind: 'wait', reason: `the demons are on the witch's platform, standing in ${area}` };
        }
        return amuletsHeld(snap) < 3
            ? custom('kill a demon for its amulet', killDemon)
            : custom('open the sealed chest for the shadow', openSealedChest);
    }
    if (!flag(snap, UP_FLAG.BLOOD_ON_DOLL)) {
        if (area === 'kalrag') {
            return custom('kill Kalrag with the doll in hand', killKalrag);
        }
        if (area === 'dwarves') {
            return custom('climb back up out of the dwarves cave', ascendFromDwarves);
        }
        return custom("climb down the wall tunnel to Kalrag's cave", descendToKalrag);
    }
    return custom("open Iban's temple doors", openIbanDoor);
}

function stageStep(snap: QuestSnapshot, area: UpassArea, stage: number): QuestStep {
    switch (stage) {
        case UP_STAGE.NOT_STARTED:
            return outfit(snap, area)
                ?? (flag(snap, UP_FLAG.STARTED)
                    ? inWest(snap, area, custom('meet Koftik at the cave mouth', meetKoftik))
                    : custom('ask King Lathas about the mountains', startQuest));
        case UP_STAGE.SPOKEN_KOFTIK:
            return outfit(snap, area) ?? bridgeLeg(snap, area);
        case UP_STAGE.PASSED_BRIDGE:
            return orbLeg(snap);
        case UP_STAGE.ENTERED_SECOND_AREA:
            return unicornLeg(snap);
        case UP_STAGE.KILLED_UNICORN:
            return paladinLeg(snap, area);
        case UP_STAGE.ENTERED_MAIN_AREA:
            return dwarfLeg(area);
        case UP_STAGE.SPOKEN_NILHOOF:
            return witchLeg(snap, area);
        case UP_STAGE.FOUND_DOLL:
        case UP_STAGE.CONFRONTED_IBAN:
            return stage === UP_STAGE.CONFRONTED_IBAN && flag(snap, UP_FLAG.DOLL_COMPLETE)
                ? custom('throw the doll into the pit of the damned', throwDoll)
                : dollLeg(snap, area);
        case UP_STAGE.DEFEATED_IBAN:
            return { kind: 'wait', reason: 'Iban is dead — the walk out and the report to Lathas are not implemented' };
        default:
            return { kind: 'wait', reason: `Underground Pass stage ${stage} is not implemented` };
    }
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    const area = upassArea(snap.tile);
    if (area === 'unknown') {
        return { kind: 'wait', reason: 'player location unavailable' };
    }
    if (snap.journal === 'complete' || (snap.stage ?? -1) >= UP_STAGE.COMPLETE) {
        return { kind: 'done' };
    }
    if (snap.stage === undefined) {
        return { kind: 'wait', reason: 'Underground Pass journal stage unavailable' };
    }
    return stageStep(snap, area, snap.stage);
}

export const upass: QuestModule = {
    record: QUESTS.find(record => record.id === 'upass')!,
    bank: UP_TILE.ARDOUGNE_BANK,
    ownsInventory: true,
    readProgress: readUpassProgress,
    sustain: { foods: [UP_ITEM.LOBSTER.name], eatBelowHp: 0.55 },
    decide
};
