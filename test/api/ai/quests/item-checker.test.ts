import { expect, test } from 'bun:test';

import { checkItems } from '#/bot/api/ai/quests/ItemChecker.js';
import type { QuestRecord, BankInventorySnapshot } from '#/bot/api/ai/quests/types.js';

function rec(items: QuestRecord['items']): QuestRecord {
    return { id: 't', name: 'T', questPoints: 1, requirements: {}, items };
}
function snap(entries: [string, number][] = []): BankInventorySnapshot {
    return { counts: new Map(entries) };
}

test('no items yields no results', () => {
    expect(checkItems(rec([]), snap())).toEqual([]);
});

test('mustHave present in sufficient qty is ok', () => {
    const r = rec([{ name: 'Iron bar', qty: 2, kind: 'mustHave' }]);
    const res = checkItems(r, snap([['Iron bar', 2]]));
    expect(res[0]).toEqual({ name: 'Iron bar', qty: 2, kind: 'mustHave', present: 2, ok: true, willGather: false });
});

test('mustHave with insufficient qty fails', () => {
    const r = rec([{ name: 'Iron bar', qty: 2, kind: 'mustHave' }]);
    const res = checkItems(r, snap([['Iron bar', 1]]));
    expect(res[0].ok).toBe(false);
    expect(res[0].present).toBe(1);
});

test('mustHave absent fails with present 0', () => {
    const res = checkItems(rec([{ name: 'Redberry pie', qty: 1, kind: 'mustHave' }]), snap());
    expect(res[0].ok).toBe(false);
    expect(res[0].present).toBe(0);
});

test('acquirable never blocks and flags willGather when absent', () => {
    const r = rec([{ name: 'Egg', qty: 1, kind: 'acquirable' }]);
    const absent = checkItems(r, snap());
    expect(absent[0].ok).toBe(true);
    expect(absent[0].willGather).toBe(true);
    const present = checkItems(r, snap([['Egg', 1]]));
    expect(present[0].ok).toBe(true);
    expect(present[0].willGather).toBe(false);
});

test('name match is case-insensitive', () => {
    const r = rec([{ name: 'Iron bar', qty: 1, kind: 'mustHave' }]);
    expect(checkItems(r, snap([['iron bar', 3]]))[0].ok).toBe(true);
});

// Why: the engine reads the bank only after a quest starts, so blocking on an unread one stopped the
// queue before it ever opened a booth, Watch Tower reported four missing items it had two of each.

test('an unread bank does not block a mustHave item', () => {
    const r = rec([{ name: 'Gold bar', qty: 1, kind: 'mustHave' }]);
    const res = checkItems(r, { counts: new Map(), bankKnown: false });
    expect(res[0].ok).toBe(true);
    expect(res[0].present).toBe(0);
});

test('a read bank that really lacks the item still blocks', () => {
    const r = rec([{ name: 'Gold bar', qty: 1, kind: 'mustHave' }]);
    expect(checkItems(r, { counts: new Map(), bankKnown: true })[0].ok).toBe(false);
});

test('a read bank holding the item is ok', () => {
    const r = rec([{ name: 'Gold bar', qty: 1, kind: 'mustHave' }]);
    expect(checkItems(r, { counts: new Map([['gold bar', 2]]), bankKnown: true })[0].ok).toBe(true);
});

test('acquirable items are unaffected by whether the bank has been read', () => {
    const r = rec([{ name: 'Clay', qty: 6, kind: 'acquirable' }]);
    for (const bankKnown of [true, false]) {
        const res = checkItems(r, { counts: new Map(), bankKnown });
        expect(res[0].ok).toBe(true);
        expect(res[0].willGather).toBe(true);
    }
});
