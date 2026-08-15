// docs/QUESTS.md
import { Game } from '../../../../game/Game.js';
import { QUESTS } from '../../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import { talkStrict } from '../../exec/primitives.js';
import {
    ARROWS_WANTED,
    IKOV_NAME,
    IKOV_OBJ,
    IKOV_TILE,
    LUCIEN_START,
    ROOTS_WANTED,
    WINELDA_STOP
} from './areas.js';
import { arrowsSecured, dungeonPrepStep, escapePocket, pullTrapLever, templeWalk, wearFearPendant, wearingBoots } from './dungeon.js';
import { fightFireWarrior, killLucien } from './fight.js';
import { IKOV_STAGE, readIkovStage } from './journal.js';
import { heldOrBanked, sourcingShortfall, suppliesStep } from './supplies.js';
import { joinTheGuardians, leaveTheFarSide } from './temple.js';

const IKOV_ID = 'ikov';

/** Names the one spillover deposit must not bin; `depositPlan` matches on substrings. */
const IKOV_TOOLS = [
    'coins',
    'candle',
    'tinderbox',
    'knife',
    'iron axe',
    'yew logs',
    'flax',
    'bow string',
    'yew shortbow',
    'ice arrows',
    'boots of lightness',
    'pendant',
    'limpwurt root',
    'lever',
    'shiny key'
];

/** Foods this quest eats; the trim keeps them, and `sustain` declares the same list. */
const IKOV_FOODS = ['lobster', 'swordfish', 'tuna'];

// Why: the lava bridge weighs the pack, and stackables are free — so the trim is about the non-stackables the surface legs leave behind, the yew shortbow (3lb) and the iron axe most of all.
const BRIDGE_KEEP = ['coins', 'candle', 'tinderbox', 'knife', 'pendant', 'boots of lightness', 'ice arrows', 'lever', ...IKOV_FOODS];

function held(snap: QuestSnapshot, id: number): number {
    return snap.invIds?.get(id) ?? 0;
}

/** Bank whatever the crossing cannot afford to carry, before the bot is underground with no booth. */
function bridgeTrimStep(snap: QuestSnapshot): QuestStep | null {
    const heavy = [...snap.inv.keys()].filter(name => !BRIDGE_KEEP.some(keep => name.includes(keep)));
    if (heavy.length === 0) {
        return null;
    }
    return { kind: 'deposit', keep: BRIDGE_KEEP };
}

/** Withdraw anything the next leg needs that the pack does not already hold. */
function withdrawFor(snap: QuestSnapshot, wanted: { name: string; id: number; qty: number }[]): QuestStep | null {
    const missing = wanted.filter(item => held(snap, item.id) < item.qty);
    if (missing.length === 0) {
        return null;
    }
    if (!snap.bankKnown) {
        return { kind: 'scanBank' };
    }
    const available = missing.filter(item => (snap.bankIds?.get(item.id) ?? 0) > 0);
    if (available.length === 0) {
        return null;
    }
    return { kind: 'withdraw', items: available.map(item => ({ name: item.name, id: item.id, qty: item.qty })) };
}

// Why: the lava bridge fails at any non-negative weight, so the bow and the arrows stay in the bank until the ice-arrow leg is done.
function dungeonKitStep(snap: QuestSnapshot): QuestStep | null {
    const wanted: { name: string; id: number; qty: number }[] = [{ name: IKOV_NAME.KNIFE, id: IKOV_OBJ.KNIFE, qty: 1 }];
    if (held(snap, IKOV_OBJ.LIT_CANDLE) === 0) {
        wanted.push(
            { name: IKOV_NAME.CANDLE, id: IKOV_OBJ.UNLIT_CANDLE, qty: 1 },
            { name: IKOV_NAME.TINDERBOX, id: IKOV_OBJ.TINDERBOX, qty: 1 }
        );
    }
    return withdrawFor(snap, wanted);
}

function warKitStep(snap: QuestSnapshot): QuestStep | null {
    const bow = withdrawFor(snap, [{ name: IKOV_NAME.YEW_SHORTBOW, id: IKOV_OBJ.YEW_SHORTBOW, qty: 1 }]);
    if (bow) {
        return bow;
    }
    const key = IKOV_NAME.ICE_ARROWS.toLowerCase();
    if (snap.worn.has(key) || (snap.inv.get(key) ?? 0) > 0) {
        return null;
    }
    const banked = snap.bank?.get(key) ?? 0;
    if (banked === 0) {
        return null;
    }
    return { kind: 'withdraw', items: [{ name: IKOV_NAME.ICE_ARROWS, qty: Math.min(banked, ARROWS_WANTED) }] };
}

// Why: Lucien re-issues only when `obj_gettotal` reads zero, and that counts the bank — so a banked pendant is one he refuses to replace.
function haveFearPendant(snap: QuestSnapshot): boolean {
    return heldOrBanked(snap, IKOV_OBJ.PENDANT_LUCIEN) > 0 || snap.wornIds?.has(IKOV_OBJ.PENDANT_LUCIEN) === true;
}

// Why: `gotoNpc` walks without the bridge exclusion, and the ledge is four stage-gated doors deep, so the approach is the module's own walk.
async function talkToWinelda(log: (m: string) => void): Promise<boolean> {
    if (!(await escapePocket(log))) {
        return false;
    }
    if (!(await wearFearPendant(log))) {
        return false;
    }
    if (!(await templeWalk(IKOV_TILE.WINELDA, 2, log))) {
        return false;
    }
    return talkStrict(WINELDA_STOP.npc, WINELDA_STOP.prefer, log);
}

async function finishForArmadyl(log: (m: string) => void): Promise<boolean> {
    if (!(await leaveTheFarSide(log))) {
        return false;
    }
    return killLucien(log);
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') {
        return { kind: 'done' };
    }
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    const stage = snap.stage;
    if (stage === undefined) {
        return { kind: 'wait', reason: 'Temple of Ikov journal stage unavailable' };
    }
    if (stage === IKOV_STAGE.NOT_STARTED) {
        return { kind: 'talk', stop: LUCIEN_START };
    }
    if (!snap.bankKnown) {
        return { kind: 'scanBank' };
    }

    if (stage >= IKOV_STAGE.HELPING_ARMADYL) {
        return { kind: 'custom', name: 'leave the temple and banish Lucien', run: finishForArmadyl };
    }

    if (stage >= IKOV_STAGE.PAID_WINELDA) {
        return { kind: 'custom', name: 'join the Guardians of Armadyl', run: joinTheGuardians };
    }

    // Why: Lucien re-issues the pendant to anyone who lost it, and the Door of Fear is shut without it.
    // Why: this branch sits below the stage-60 return, so it can never fire on the far side of the lava, which has no walk back to him.
    if (!haveFearPendant(snap)) {
        return { kind: 'talk', stop: LUCIEN_START };
    }
    const pendant = withdrawFor(snap, [{ name: IKOV_NAME.PENDANT_LUCIEN, id: IKOV_OBJ.PENDANT_LUCIEN, qty: 1 }]);
    if (pendant && snap.wornIds?.has(IKOV_OBJ.PENDANT_LUCIEN) !== true) {
        return pendant;
    }

    if (stage >= IKOV_STAGE.SPOKEN_WINELDA) {
        if (heldOrBanked(snap, IKOV_OBJ.LIMPWURT_ROOT) < ROOTS_WANTED) {
            const roots = suppliesStep(snap, { candle: false, bow: false, roots: true });
            if (roots) {
                return roots;
            }
        }
        const carry = withdrawFor(snap, [{ name: IKOV_NAME.LIMPWURT_ROOT, id: IKOV_OBJ.LIMPWURT_ROOT, qty: ROOTS_WANTED }]);
        if (carry) {
            return carry;
        }
        return { kind: 'custom', name: 'pay Winelda her twenty limpwurt roots', run: talkToWinelda };
    }

    if (stage >= IKOV_STAGE.KILLED_WARRIOR) {
        return { kind: 'custom', name: 'ask Winelda for the ferry across the lava', run: talkToWinelda };
    }

    // Why: the candle exists to light the stairs down to the boots, so once the boots are had it stops being part of the kit.
    const needBoots = !wearingBoots() && heldOrBanked(snap, IKOV_OBJ.BOOTS) === 0;
    const supplies = suppliesStep(snap, { candle: needBoots, bow: true, roots: false });
    if (supplies) {
        return supplies;
    }

    if (!arrowsSecured(snap) || needBoots) {
        const trim = bridgeTrimStep(snap);
        if (trim) {
            return trim;
        }
        const kit = dungeonKitStep(snap);
        if (kit) {
            return kit;
        }
        const prep = dungeonPrepStep(snap);
        if (prep) {
            return prep;
        }
    }

    if (stage < IKOV_STAGE.PULLED_LEVER) {
        return { kind: 'custom', name: 'disarm and pull the trap lever', run: pullTrapLever };
    }

    const war = warKitStep(snap);
    if (war) {
        return war;
    }
    return { kind: 'custom', name: 'shoot the Fire Warrior of Lesarkus', run: fightFireWarrior };
}

export const ikov: QuestModule = {
    record: QUESTS.find(r => r.id === IKOV_ID)!,
    // Why: the quest touches Ardougne, Catherby, Seers and the temple, so no one booth is close to every leg.
    bank: 'nearest',
    food: 8,
    grind: ['Hobgoblin', 'Fire Warrior of Lesarkus', 'Lucien'],
    tools: IKOV_TOOLS,
    sustain: { foods: ['Lobster', 'Swordfish', 'Tuna'], eatBelowHp: 0.55 },
    readStage: readIkovStage,
    warnReadiness: sourcingShortfall,
    observe: (snap, step) => {
        const t = snap.tile;
        const where = t ? `(${t.x},${t.z},${t.level})` : '(?)';
        return [
            `ikov: stage=${snap.stage ?? '?'} at ${where} step=${step.kind}`,
            `ikov: boots=${wearingBoots() ? 'worn' : 'no'} arrows=${snap.inv.get(IKOV_NAME.ICE_ARROWS.toLowerCase()) ?? 0}`
                + ` roots=${held(snap, IKOV_OBJ.LIMPWURT_ROOT)} pendant=${haveFearPendant(snap) ? 'yes' : 'no'}`
                + ` weight=${Game.weight()}kg`
        ];
    },
    decide
};

export { IKOV_STAGE };
