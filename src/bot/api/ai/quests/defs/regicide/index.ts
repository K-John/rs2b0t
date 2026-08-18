import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { Skills } from '../../../../skills/Skills.js';
import { QUESTS } from '../../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import { formatTile } from '../../engine/trace.js';
import { drawGear, meleeCarried, wearGear } from '../upass/supplies.js';
import {
    RG_ITEM,
    RG_MIXES,
    RG_TILE,
    carried,
    countHeld,
    held,
    regicideArea,
    type RegicideArea,
    type RegicideItem
} from './areas.js';
import {
    catchRabbit,
    cookRabbit,
    distilNaphtha,
    fillTar,
    fuseBomb,
    grindQuicklime,
    grindSulphur,
    heatQuicklime,
    mixBomb,
    takeBarrel,
    takePot,
    takeSulphur,
    weaveCloth
} from './bomb.js';
import { feedLazyGuard, fireCatapult, meetArianwyn, reportToIorwerth, reportToLathas } from './finish.js';
import { pocketAt } from './pockets.js';
import {
    askIorwerth,
    askTracker,
    briefFromLathas,
    enterCamp,
    followTracks,
    killSoldier,
    meetScouts,
    takeSummons
} from './isafdar.js';
import { RG_FLAG, RG_STAGE, readRegicideProgress } from './journal.js';
import { enterTirannwn, leaveTirannwn } from './pass.js';
import { COAL_TARGET, KEEP_IDS, kitShortfall, sourceCoal, sourceKit } from './supplies.js';

const custom = (name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep =>
    ({ kind: 'custom', name, run });

function flag(snap: QuestSnapshot, name: string): boolean {
    return snap.progress?.flags.has(name) ?? false;
}

// Why: the pack has to have room before it crosses. `[if_close,regicide_still]` adds the naphtha BEFORE it deletes the empty barrel, so a full pack loses the distillation outright, and the forest hands over a barrel, a pot, a lump of sulphur and a rock of limestone with nowhere to put any of them.
// Why: gated on there being something to deposit, not on the count alone. The kit is twenty slots of its own — eleven Sharks, four balls of wool, three ropes, a pestle and a pickaxe — so a bare "fewer than N free" test asks for room the quest can never have, and the step banks nothing and repeats until the watchdog parks the run.
const SLOTS_NEEDED = 6;

/** Everything Tirannwn consumes, drawn and worn while a bank is still reachable. */
function outfit(snap: QuestSnapshot, area: RegicideArea): QuestStep | null {
    if (area !== 'mainland') {
        return null;
    }
    const junk = [...(snap.invIds ?? [])].some(([id]) => !KEEP_IDS.includes(id));
    if (junk && (snap.freeSlots ?? SLOTS_NEEDED) < SLOTS_NEEDED) {
        return { kind: 'deposit', keep: [RG_ITEM.SHARK.name], keepIds: KEEP_IDS, bank: RG_TILE.ARDOUGNE_BANK };
    }
    // Why: the armour goes on before the kit comes out. The kit is 24 of the pack's 28 slots — four wool, three ropes and eleven sharks among them — and `wearGear` draws the set five pieces at a time, so sourcing first leaves three free slots and the withdraw never fits. Worn armour costs no slot at all.
    return wearGear(snap) ?? sourceKit(snap);
}

// Why: past the Arandar palisade there is one shop and no bank, and the way back in is the Underground Pass walked end to end — so a pack short of the kit stops on the mainland and says what is missing rather than crossing and parking at a loom it has no wool for.
function readyForTirannwn(snap: QuestSnapshot): QuestStep | null {
    const missing = kitShortfall(snap);
    // Why: the forest is fought through — two of Tyras's soldiers, the elf warriors that patrol the camp and a grizzly bear on the road to the loom — and there is nothing to fight them with past the gate.
    if (!meleeCarried(snap)) {
        missing.push('a melee weapon (the soldiers and the elf warriors), have none');
    }
    return missing.length === 0 ? null : { kind: 'wait', reason: `not equipped for Tirannwn: ${missing.join('; ')}` };
}

/** Into Tirannwn the only way it opens before the deed is done: the pass, and the Well of Voyage. */
function crossIn(snap: QuestSnapshot): QuestStep {
    // Why: the kit was banked for the coal, so it is drawn again here rather than waited for. Only on the mainland — from inside the pass a withdraw step aims the walk at Ardougne, which is the wrong side of every crossing already made.
    if (regicideArea(snap.tile) === 'mainland') {
        const kit = sourceKit(snap);
        if (kit) {
            return kit;
        }
    }
    return readyForTirannwn(snap) ?? custom('walk the Underground Pass to the Well of Voyage', enterTirannwn);
}

function inTirannwn(snap: QuestSnapshot, area: RegicideArea, step: QuestStep): QuestStep {
    return area === 'tirannwn' ? step : crossIn(snap);
}

// The bomb

/** True once the barrel is somewhere along the naphtha chain, so a second one is not fetched. */
function barrelInPlay(snap: QuestSnapshot): boolean {
    return held(snap, RG_ITEM.BARREL_TAR) > 0
        || held(snap, RG_ITEM.BARREL_NAPHTHA) > 0
        || countHeld(snap, RG_MIXES) > 0
        || held(snap, RG_ITEM.BARREL_LID) > 0
        || held(snap, RG_ITEM.BARREL_FUSED) > 0;
}

function quicklimeDone(snap: QuestSnapshot): boolean {
    return held(snap, RG_ITEM.QUICKLIME_DUST) > 0
        || held(snap, RG_ITEM.MIX_QUICKLIME) > 0
        || held(snap, RG_ITEM.BARREL_LID) > 0
        || held(snap, RG_ITEM.BARREL_FUSED) > 0;
}

function sulphurDone(snap: QuestSnapshot): boolean {
    return held(snap, RG_ITEM.SULPHUR_DUST) > 0
        || held(snap, RG_ITEM.MIX_SULPHUR) > 0
        || held(snap, RG_ITEM.BARREL_LID) > 0
        || held(snap, RG_ITEM.BARREL_FUSED) > 0;
}

function clothDone(snap: QuestSnapshot): boolean {
    return held(snap, RG_ITEM.CLOTH) > 0 || held(snap, RG_ITEM.BARREL_FUSED) > 0;
}

function rabbitDone(snap: QuestSnapshot): boolean {
    return held(snap, RG_ITEM.RAW_RABBIT) > 0 || held(snap, RG_ITEM.COOKED_RABBIT) > 0;
}

// Why: every raw ingredient is inside Tirannwn and the still that turns tar into naphtha is in Rimmington, so the gathering is finished in one pass through the forest before the palisade is opened — the way back in is the Underground Pass, and nobody wants to walk it twice for a forgotten ball of wool.

// Why: ordered by where each thing is rather than by the recipe — the loom, the barrel and the pot are all in the elf camp, the tar and the sulphur are both in the old camp's swamp, and the quarry sits on the way out to the palisade. What the forest cannot finish is left for the mainland leg.

/** True once the quarry is close enough that the generic mining step can walk the rest itself. */
function nearQuarry(tile: QuestSnapshot['tile']): boolean {
    return tile !== null && tile !== undefined
        && Math.max(Math.abs(tile.x - RG_TILE.QUARRY.x), Math.abs(tile.z - RG_TILE.QUARRY.z)) <= 12;
}

/** The next thing the forest still owes the bomb, or null once the pack can leave. */
function gatherLeg(snap: QuestSnapshot): QuestStep | null {
    if (!clothDone(snap)) {
        return custom('weave the balls of wool into cloth', weaveCloth);
    }
    if (!quicklimeDone(snap) && held(snap, RG_ITEM.POT) === 0) {
        return custom('take a pot from the elf camp', takePot);
    }
    if (!barrelInPlay(snap)) {
        return held(snap, RG_ITEM.BARREL) === 0
            ? custom('take an empty barrel from the elf camp', takeBarrel)
            : custom('fill the barrel from the coal-tar seep', fillTar);
    }
    if (!rabbitDone(snap)) {
        return custom('catch a rabbit for the catapult guard', catchRabbit);
    }
    if (!sulphurDone(snap)) {
        return held(snap, RG_ITEM.SULPHUR) === 0
            ? custom('break a lump off a sulphur formation', takeSulphur)
            : custom('grind the sulphur to dust', grindSulphur);
    }
    if (!quicklimeDone(snap) && held(snap, RG_ITEM.QUICKLIME) === 0 && held(snap, RG_ITEM.LIMESTONE) === 0) {
        // Why: the quarry is on the ARANDAR side of the palisade, and `regicideArea` still calls that Tirannwn — so the gathering leg owns it, but the walk to it crosses a seam. A bare `mineRock` anchors a plain `walkResilient`, which from any pocket inside the forest answers "no path to (2323,3269): unreachable" and mines nothing, thirty-four times over fifteen minutes.
        return nearQuarry(snap.tile)
            ? { kind: 'mineRock', rock: 'Limestone', item: RG_ITEM.LIMESTONE.name, qty: 1, anchor: RG_TILE.QUARRY }
            : custom('cross out to the Arandar quarry', log => leaveTirannwn(RG_TILE.QUARRY, snap.stage ?? RG_STAGE.SPOKEN_IORWERTH2, log));
    }
    return null;
}

// Why: the pass kit is dead weight for the chemistry and the still wants coal by the slot — a spade, three ropes, a bow, a stack of arrows and a tinderbox are seven slots the coal needs and the walk back in does not need yet. They go to the bank here and `crossIn` draws them again before the pass is walked a second time.
const PASS_ONLY: readonly RegicideItem[] = [RG_ITEM.SPADE, RG_ITEM.ROPE, RG_ITEM.SHORTBOW, RG_ITEM.BRONZE_ARROW, RG_ITEM.TINDERBOX];
const CHEMISTRY_IDS: readonly number[] = KEEP_IDS.filter(id => !PASS_ONLY.some(item => item.id === id));

/** Bank the pass kit to make room for the coal. */
function stowPassKit(snap: QuestSnapshot): QuestStep | null {
    if (countHeld(snap, PASS_ONLY) === 0) {
        return null;
    }
    return { kind: 'deposit', keep: [RG_ITEM.SHARK.name], keepIds: CHEMISTRY_IDS, bank: RG_TILE.ARDOUGNE_BANK };
}

/** The chemistry the forest cannot do: a furnace, a range, coal, and Rimmington's still. */
function mainlandLeg(snap: QuestSnapshot): QuestStep {
    if (held(snap, RG_ITEM.RAW_RABBIT) > 0) {
        return custom('cook the rabbit on the Ardougne range', cookRabbit);
    }
    if (!quicklimeDone(snap)) {
        return held(snap, RG_ITEM.QUICKLIME) === 0
            ? custom('burn the limestone to quicklime', heatQuicklime)
            : custom('grind the quicklime into a pot', grindQuicklime);
    }
    if (held(snap, RG_ITEM.BARREL_LID) > 0 || held(snap, RG_ITEM.BARREL_FUSED) > 0) {
        return held(snap, RG_ITEM.BARREL_FUSED) > 0
            ? crossIn(snap)
            : custom('stuff the cloth through the barrel as a fuse', fuseBomb);
    }
    if (held(snap, RG_ITEM.BARREL_NAPHTHA) > 0 || countHeld(snap, RG_MIXES) > 0) {
        return custom('mix the powders into the naphtha', mixBomb);
    }
    if (carried(snap, RG_ITEM.COAL) < COAL_TARGET) {
        const stow = stowPassKit(snap);
        if (stow) {
            return stow;
        }
    }
    return sourceCoal(snap) ?? custom('distil the coal tar into naphtha', distilNaphtha);
}

function bombLeg(snap: QuestSnapshot, area: RegicideArea): QuestStep {
    if (held(snap, RG_ITEM.BARREL_FUSED) > 0) {
        if (area !== 'tirannwn') {
            return crossIn(snap);
        }
        // Why: `regicide_cross_over3` clears `^regicide_given_rabbit` whenever it is taken inside mapsquare 34_49, and the walk from the Isafdar entry to the catapult takes that crossing — so the rabbit is handed over after arriving beside the catapult, never before setting out.
        return held(snap, RG_ITEM.COOKED_RABBIT) > 0
            ? custom('give the cooked rabbit to the catapult guard', feedLazyGuard)
            : custom('fire the barrel bomb over the trees', fireCatapult);
    }
    if (area === 'tirannwn') {
        const gather = gatherLeg(snap);
        if (gather) {
            return gather;
        }
        return custom('leave Tirannwn through the Arandar palisade', log => leaveTirannwn(RG_TILE.ARDOUGNE_BANK, RG_STAGE.SPOKEN_IORWERTH2, log));
    }
    if (area === 'mainland') {
        return mainlandLeg(snap);
    }
    return crossIn(snap);
}

function stageStep(snap: QuestSnapshot, area: RegicideArea, stage: number): QuestStep {
    // Why: armour in the pack is five slots the bomb needs and a soldier fought in what the walk left on, so anything wearable goes on wherever it is found — the forest has no bank to shed it into either.
    const gear = drawGear(snap);
    if (gear) {
        return gear;
    }
    switch (stage) {
        case RG_STAGE.NOT_STARTED:
            return outfit(snap, area) ?? custom("wait for the King's messenger", takeSummons);
        case RG_STAGE.RECEIVED_MESSAGE:
            return outfit(snap, area) ?? custom('take the commission from King Lathas', briefFromLathas);
        case RG_STAGE.SPOKEN_LATHAS:
            return outfit(snap, area)
                ?? inTirannwn(snap, area, custom('stand still for the elf scouts', meetScouts));
        case RG_STAGE.SPOKEN_SCOUTS:
            return inTirannwn(snap, area, custom('report to Lord Iorwerth', log => askIorwerth(stage, log)));
        case RG_STAGE.SPOKEN_IORWERTH:
            return inTirannwn(snap, area, custom('find the tracker at the old camp', log => askTracker(stage, log)));
        case RG_STAGE.SPOKEN_TRACKER:
            // Why: the tracker wants proof, and Iorwerth only hands the pendant over once he has been asked.
            return inTirannwn(
                snap,
                area,
                carried(snap, RG_ITEM.PENDANT) > 0 || flag(snap, RG_FLAG.PENDANT)
                    ? custom('show the tracker the crystal pendant', log => askTracker(stage, log))
                    : custom('ask Lord Iorwerth for a token of his trust', log => askIorwerth(stage, log))
            );
        case RG_STAGE.SHOWN_PENDANT:
            return inTirannwn(snap, area, custom('search the west end of the old camp', followTracks));
        case RG_STAGE.FOUND_FOOTPRINTS:
            return inTirannwn(snap, area, custom('ask the tracker how to follow the tracks', log => askTracker(stage, log)));
        case RG_STAGE.SPOKEN_TRACKER2:
            return inTirannwn(snap, area, custom('kill the soldier in the dense wood', killSoldier));
        case RG_STAGE.DEFEATED_GUARD:
            return inTirannwn(snap, area, custom("squeeze into King Tyras's camp", enterCamp));
        case RG_STAGE.ENTERED_CAMP:
            return inTirannwn(snap, area, custom('tell Lord Iorwerth where the camp is', log => askIorwerth(stage, log)));
        case RG_STAGE.SPOKEN_IORWERTH2:
            return bombLeg(snap, area);
        case RG_STAGE.KILLED_TYRAS:
            return inTirannwn(snap, area, custom('tell Lord Iorwerth the deed is done', reportToIorwerth));
        case RG_STAGE.REPORTED_IORWERTH:
            return area === 'tirannwn'
                ? custom('leave Tirannwn through the Arandar palisade', log => leaveTirannwn(RG_TILE.ARDOUGNE_BANK, stage, log))
                : custom('take the Ardougne road past Arianwyn', meetArianwyn);
        case RG_STAGE.SPOKEN_ARIANWYN:
            return area === 'tirannwn'
                ? custom('leave Tirannwn through the Arandar palisade', log => leaveTirannwn(RG_TILE.ARDOUGNE_BANK, stage, log))
                : custom('hand King Lathas the letter', reportToLathas);
        default:
            return { kind: 'wait', reason: `Regicide stage ${stage} is not implemented` };
    }
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    const area = regicideArea(snap.tile);
    if (area === 'unknown') {
        return { kind: 'wait', reason: 'player location unavailable' };
    }
    if (snap.journal === 'complete' || (snap.stage ?? -1) >= RG_STAGE.COMPLETE) {
        return { kind: 'done' };
    }
    if (snap.stage === undefined) {
        return { kind: 'wait', reason: 'Regicide journal stage unavailable' };
    }
    return stageStep(snap, area, snap.stage);
}

export const regicide: QuestModule = {
    record: QUESTS.find(record => record.id === 'regicide')!,
    bank: RG_TILE.ARDOUGNE_BANK,
    ownsInventory: true,
    readProgress: readRegicideProgress,
    // Why: the forest's traps are timer damage taken while crossing a chokepoint rather than a fight — a failed pitfall jump is a flat 15 and the tripwires poison — so the eat threshold is high rather than the usual half.
    sustain: { foods: [RG_ITEM.SHARK.name], eatBelowHp: 0.7 },
    warnReadiness: () =>
        `Regicide needs Underground Pass complete, Agility 56 and Crafting 10, and burns about ${COAL_TARGET} coal at the still.`,
    // Why: a failed step used to print `no inventory change` and nothing else, and that one line hid a ground-decor refusal for forty-five minutes and a missing letter across two legs. What a parked leg needs to say is where it is, what it is carrying that the step is keyed on, and what the server last said — the refusal is almost always already in the chat.
    // Why: three lines, joined. The live harness surfaces a bounded number of log lines per poll, so a diagnostic that prints one line per item arrives as the last line and reads as silence.
    observe: (snap, step) => {
        const at = snap.tile;
        const pocket = at && at.level === 0 ? pocketAt(at) : null;
        const kit = (item: RegicideItem): string => `${item.name.split(' ')[0]!.toLowerCase()}=${held(snap, item)}`;
        const said = GameMessages.recent(3).map(m => m.text).join(' / ');
        return [
            `regicide: stage=${snap.stage ?? '?'} ${formatTile(at)} area=${regicideArea(at)}${pocket ? `/${pocket}` : ''}`
                + ` step=${step.kind === 'custom' ? step.name : step.kind} free=${snap.freeSlots ?? '?'} hp=${Math.round(Skills.hpFraction() * 100)}%`,
            `regicide: ${[RG_ITEM.SUMMONS, RG_ITEM.MESSAGE, RG_ITEM.PENDANT, RG_ITEM.SPADE, RG_ITEM.ROPE, RG_ITEM.BRONZE_ARROW, RG_ITEM.SHARK].map(kit).join(' ')}`
                + ` | bomb: ${[RG_ITEM.BARREL, RG_ITEM.BARREL_TAR, RG_ITEM.BARREL_NAPHTHA, RG_ITEM.BARREL_LID, RG_ITEM.BARREL_FUSED, RG_ITEM.CLOTH].map(kit).join(' ')}`,
            said === '' ? 'regicide: the server has said nothing recently' : `regicide: last said — ${said}`
        ];
    },
    decide
};
