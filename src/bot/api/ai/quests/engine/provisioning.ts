// docs/reference/quest-provisioning.md
import type { QuestStatus } from '../../../ui/questlog/Quests.js';
import type { QuestItem } from '../types.js';

interface ProvisionPlan {
    withdraw: { name: string; qty: number }[];
    gather: { name: string; need: number }[];
    blocked: string[];
    satisfied: boolean;
}

export function planProvisioning(
    items: QuestItem[],
    inv: Map<string, number>,
    bank: Map<string, number>
): ProvisionPlan {
    const plan: ProvisionPlan = { withdraw: [], gather: [], blocked: [], satisfied: true };
    for (const item of items) {
        const key = item.name.toLowerCase();
        const have = inv.get(key) ?? 0;
        if (have >= item.qty) {
            continue;
        }
        plan.satisfied = false;
        let short = item.qty - have;
        const banked = bank.get(key) ?? 0;
        if (banked > 0) {
            const take = Math.min(short, banked);
            plan.withdraw.push({ name: item.name, qty: take });
            short -= take;
        }
        if (short > 0) {
            if (item.kind === 'mustHave') {
                plan.blocked.push(`${item.name} x${item.qty}`);
            } else {
                plan.gather.push({ name: item.name, need: short });
            }
        }
    }
    return plan;
}

/**
 * Why: the bot starts carrying anything and the quest before this one leaves anything behind, so every quest provisions from empty.
 * Why: after the session's first quest, only before the journal opens — a resumed quest can be standing past its last bank.
 */
export function shouldFreshenPack(
    journal: QuestStatus,
    usedSlots: number,
    alreadyFresh: boolean,
    sessionStart: boolean
): boolean {
    if (usedSlots === 0 || alreadyFresh) {
        return false;
    }
    return sessionStart || journal === 'notStarted';
}

/**
 * Why: the provisioning block re-runs every tick while a quest is still gathering, so topping a float up sent the bot back to the bank each time it ate a lobster or drank a dose.
 * Why: `drawn` closes the float for the quest once the pack has held it, and an empty bank leaves it open so a restock is still honoured.
 */
export function floatDrawPlan(
    held: number,
    banked: number,
    target: number,
    alreadyDrawn: boolean
): { qty: number; drawn: boolean } {
    if (alreadyDrawn || held >= target) {
        return { qty: 0, drawn: true };
    }
    return { qty: Math.max(0, Math.min(target - held, banked)), drawn: false };
}

export function depositPlan(inv: Map<string, number>, keep: string[]): string[] {
    return [...inv.keys()].filter(name => !keep.some(k => name.includes(k)));
}

export function gpShort(snap: { inv: Map<string, number>; bankCoins: number }, estGp: number): number {
    const have = (snap.inv.get('coins') ?? 0) + snap.bankCoins;
    return Math.max(0, estGp - have);
}

export function floatWithdraw(
    inv: Map<string, number>,
    bank: Map<string, number>,
    name: string,
    target: number
): { name: string; qty: number } | null {
    const key = name.toLowerCase();
    const pack = inv.get(key) ?? 0;
    const banked = bank.get(key) ?? 0;
    const want = Math.min(target - pack, banked);
    return want > 0 ? { name, qty: want } : null;
}

export function coinFloatWithdraw(
    inv: Map<string, number>,
    bank: Map<string, number>,
    float: number
): { name: string; qty: number } | null {
    return floatWithdraw(inv, bank, 'Coins', float);
}
