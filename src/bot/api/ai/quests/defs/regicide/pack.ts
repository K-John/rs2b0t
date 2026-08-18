import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { RG_ITEM, RG_TILE, banked, carried, type RegicideItem } from './areas.js';

// Why: this quest spends its middle out of reach of a bank, and every leg of it wants the pack shaped differently — the kit is twenty-four slots, the bomb chain grows to six, and the still burns twelve coal that do not stack. Deciding that at each site is what produced a mining step swinging at a full inventory, a fire arrow with nowhere to go and a distillation lost to a full pack.
// Why: a plan is a whitelist plus a set of counts, because the deposit step cannot keep a partial stack. An item with a target is left out of the deposit and drawn back, which settles in three cycles: shed, draw, done.

// Why: a plan is a whitelist, so anything it forgets to name goes to the bank — and some of what this quest carries cannot be bought, drawn or made twice. The scroll comes from a messenger who spawns once, the pendant from a conversation that does not repeat, and every barrel state is a one-way step along a chain that starts back at the elf camp on the far side of the pass. Banking one of those does not cost a walk, it ends the run.
const NEVER_BANK: readonly number[] = [
    RG_ITEM.SUMMONS.id, RG_ITEM.MESSAGE.id, RG_ITEM.PENDANT.id,
    RG_ITEM.BARREL.id, RG_ITEM.BARREL_TAR.id, RG_ITEM.BARREL_NAPHTHA.id,
    RG_ITEM.BARREL_LID.id, RG_ITEM.BARREL_FUSED.id,
    RG_ITEM.MIX_QUICKLIME.id, RG_ITEM.MIX_SULPHUR.id,
    RG_ITEM.CLOTH.id, RG_ITEM.SULPHUR_DUST.id, RG_ITEM.QUICKLIME_DUST.id
];

/** What the pack should hold for one leg, and the room the next step needs. */
export interface PackPlan {
    /** Named in the log, so a bank trip says which leg asked for it. */
    what: string;
    /** Everything allowed to stay. Anything else is banked. */
    allow: readonly number[];
    /** Items held to a count rather than kept outright. */
    caps?: readonly { item: RegicideItem; qty: number }[];
    /** Free slots the next step needs before it starts. */
    freeNeeded?: number;
}

const capped = (plan: PackPlan, id: number): boolean =>
    (plan.caps ?? []).some(cap => cap.item.id === id);

/** Everything the plan allows, plus what no plan may bank. */
const allowed = (plan: PackPlan): number[] => [...plan.allow, ...NEVER_BANK];

/** True when the pack holds something this leg has no use for. */
function holdsJunk(snap: QuestSnapshot, plan: PackPlan): boolean {
    const allow = new Set(allowed(plan));
    for (const [id, count] of snap.invIds ?? []) {
        if (count > 0 && !allow.has(id) && !capped(plan, id)) {
            return true;
        }
    }
    return false;
}

/** The first item held above its target, or null when every count is at or under it. */
function overCap(snap: QuestSnapshot, plan: PackPlan): RegicideItem | null {
    return (plan.caps ?? []).find(cap => carried(snap, cap.item) > cap.qty)?.item ?? null;
}

/** The first item held below its target that the bank can still supply. */
function underCap(snap: QuestSnapshot, plan: PackPlan): { item: RegicideItem; qty: number } | null {
    for (const cap of plan.caps ?? []) {
        const have = carried(snap, cap.item);
        if (have < cap.qty && banked(snap, cap.item) > 0) {
            return { item: cap.item, qty: Math.min(cap.qty - have, banked(snap, cap.item)) };
        }
    }
    return null;
}

/**
 * Shape the pack to `plan`, or null once it already fits.
 * Why: shed first, then draw. Doing it the other way round asks the bank for slots the pack has not freed yet, and a withdraw into a full pack is silent.
 */
export function managePack(snap: QuestSnapshot, plan: PackPlan): QuestStep | null {
    if (!snap.bankKnown) {
        return { kind: 'scanBank', bank: RG_TILE.ARDOUGNE_BANK };
    }
    const shedding = overCap(snap, plan);
    if (holdsJunk(snap, plan) || shedding !== null) {
        // Why: the item being trimmed is left out of the keep list entirely, because the deposit is all-or-nothing per item — it goes to the bank in full and comes back at its target on the next cycle.
        const keepIds = shedding === null
            ? [...allowed(plan), ...(plan.caps ?? []).map(cap => cap.item.id)]
            : [...allowed(plan), ...(plan.caps ?? []).filter(cap => cap.item.id !== shedding.id).map(cap => cap.item.id)];
        return { kind: 'deposit', keep: [], keepIds, bank: RG_TILE.ARDOUGNE_BANK };
    }
    const drawing = underCap(snap, plan);
    if (drawing !== null) {
        return {
            kind: 'withdraw',
            items: [{ name: drawing.item.name, id: drawing.item.id, qty: drawing.qty }],
            bank: RG_TILE.ARDOUGNE_BANK
        };
    }
    const free = snap.freeSlots ?? 28;
    if (plan.freeNeeded !== undefined && free < plan.freeNeeded) {
        return { kind: 'wait', reason: `${plan.what} needs ${plan.freeNeeded} free slot(s) and the pack has ${free} — nothing left to bank` };
    }
    return null;
}
