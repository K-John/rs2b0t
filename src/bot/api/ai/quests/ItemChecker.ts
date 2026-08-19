import type { QuestRecord, BankInventorySnapshot, ItemResult } from './types.js';

function have(snapshot: BankInventorySnapshot, name: string): number {
    const wanted = name.toLowerCase();
    for (const [k, v] of snapshot.counts) {
        if (k.toLowerCase() === wanted) {
            return v;
        }
    }
    return 0;
}

export function checkItems(record: QuestRecord, snapshot: BankInventorySnapshot): ItemResult[] {
    return record.items.map(item => {
        const present = have(snapshot, item.name);
        if (item.kind === 'mustHave') {
            // Why: the bank is read only after a quest starts, so blocking on an unread one stopped the queue before it ever opened a booth.
            const ok = present >= item.qty || snapshot.bankKnown === false;
            return { name: item.name, qty: item.qty, kind: item.kind, present, ok, willGather: false };
        }
        return { name: item.name, qty: item.qty, kind: item.kind, present, ok: true, willGather: present < item.qty };
    });
}
