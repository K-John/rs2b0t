import { QUESTS } from '../../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import { UP_ITEM, UP_TILE, carried, held, pastGridTile, upassArea, worn, type UpassArea } from './areas.js';
import { UP_FLAG, UP_STAGE, readUpassProgress } from './journal.js';
import {
    armFireArrow,
    crossToWest,
    enterCave,
    getDampCloth,
    crossToEast,
    leavePass,
    leaveWithKoftik,
    reportToLathas,
    makeFireArrow,
    meetKoftik,
    shootGuiderope,
    startQuest
} from './bridge.js';
import { sweepOrbs } from './area1.js';
import { crossGrid } from './grid.js';
import {
    badgesHeld,
    crossTheTemple,
    crushUnicorn,
    takeRailing
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
import { drawGear, kitShortfall, meleeCarried, sourceKit, wearGear } from './supplies.js';

const custom = (name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep =>
    ({ kind: 'custom', name, run });

function flag(snap: QuestSnapshot, name: string): boolean {
    return snap.progress?.flags.has(name) ?? false;
}

/** Everything the pass needs, drawn and worn while a bank is still reachable. */
function outfit(snap: QuestSnapshot, area: UpassArea): QuestStep | null {
    return area === 'mainland' ? sourceKit(snap) ?? wearGear(snap) : null;
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
    // Why: three paladins at level 62, three demons and Kalrag stand between the bridge and the end of the
    // quest, and there is no bank past the cave mouth — descending with only the fire arrow's bow is a
    // one-way trip to a fight that cannot be won.
    if (!meleeCarried(snap)) {
        missing.push('a melee weapon (the paladins, the demons and Kalrag), have none');
    }
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
        // Why: the crossing walks itself to the grid lip first, and the rope swing onto that shelf is part of
        // travelTo's vocabulary — a caller choosing seams here is what drifted the route before.
        return custom('cross the spiked grid with the journal held open', crossGrid);
    }
    // Why: one step for the whole sweep. A burned orb has left the pack and reads as never collected, and
    // neither the trap nor the ground spawns will hand over a second one — so a per-site decide cycle picks
    // the same site forever. The step keeps its own tally and ends on the well.
    return custom('take and burn the four orbs, then climb the well', sweepOrbs);
}

// Why: stages three and four are one leg, because the journal cannot tell them apart — both print
// "I must work my way deeper into these caverns" and differ only in which line is struck through. What the
// snapshot can see is the horn, so the crushing and the taking are one step and the horn is what ends it.
function unicornLeg(snap: QuestSnapshot, area: UpassArea): QuestStep {
    if (held(snap, UP_ITEM.UNICORN_HORN) > 0 || badgesHeld(snap) > 0 || area !== 'area2') {
        return paladinLeg();
    }
    if (held(snap, UP_ITEM.RAILING) === 0) {
        return custom('search the cage bars for a loose railing', takeRailing);
    }
    return custom('crush the unicorn and take its horn', crushUnicorn);
}

// Why: the way back up to the paladins' shelf is the unicorn tunnel at the south end of the second cavern,
// not the mud pile — the pile climbs into the orb corridor, on the far side of the well and behind every
// trap already crossed. The tunnel is one of travelTo's seams, so walking is enough.
// Why: and the crests, the well and the doors are one step, because the well eats the crests and the journal
// never says it did — a snapshot cannot tell "not killed yet" from "already fed", and a run killed three
// respawned paladins after feeding the first three.
function paladinLeg(): QuestStep {
    return custom('take the crests, feed the well and pass the temple doors', crossTheTemple);
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
    // Why: a flood of the collision pack puts the dwarf camp, Iban's tomb, Kalrag and both wall-tunnel exits
    // in one pocket, so the blood is taken while the character is already down here rather than after two
    // more tunnel trips. Kalrag only gives it while the doll is in the pack and the stage is still `found`.
    if (!flag(snap, UP_FLAG.BLOOD_ON_DOLL) && (area === 'dwarves' || area === 'kalrag')) {
        return custom('kill Kalrag with the doll in hand', killKalrag);
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
        return area === 'kalrag' || area === 'dwarves'
            ? custom('kill Kalrag with the doll in hand', killKalrag)
            : custom("climb down the wall tunnel to Kalrag's cave", descendToKalrag);
    }
    return custom("open Iban's temple doors", openIbanDoor);
}

// Why: the temple throws the player into the second cavern, which has no walkable way back up — Koftik's
// own dialogue is the transport, so the walk out is four steps keyed on where the last one landed.
function finishLeg(area: UpassArea): QuestStep {
    switch (area) {
        case 'area2':
            return custom('find Koftik and let him lead the way out', leaveWithKoftik);
        case 'area1':
            return custom('leave the underground pass', leavePass);
        case 'westardougne':
            return custom('cross the wall back into East Ardougne', crossToEast);
        case 'mainland':
            return custom('report to King Lathas', reportToLathas);
        default:
            return { kind: 'wait', reason: `thrown out of Iban's temple into ${area}` };
    }
}

function stageStep(snap: QuestSnapshot, area: UpassArea, stage: number): QuestStep {
    // Why: the bow owns the right hand until the stay rope is shot, so the melee kit only goes on past the
    // bridge — and it goes on before the orb sweep, which needs the five slots the armour would otherwise sit in.
    const gear = stage >= UP_STAGE.PASSED_BRIDGE ? drawGear(snap) : null;
    if (gear) {
        return gear;
    }
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
        case UP_STAGE.KILLED_UNICORN:
            return unicornLeg(snap, area);
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
            return finishLeg(area);
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
    // Why: the corridor traps are timer damage taken while standing on a chokepoint tile, not a fight — a
    // component probe shows avoiding those tiles deletes four of the six routes through the orb corridor,
    // because the traps sit in the only walkable squares. Surviving them is the only option, so the eat
    // threshold is high rather than the usual half.
    sustain: { foods: [UP_ITEM.LOBSTER.name], eatBelowHp: 0.8 },
    decide
};
