/* eslint-disable @typescript-eslint/no-explicit-any -- API singletons are monkey-patched
   to test quest step routing without a live client. */
import { afterEach, expect, test } from 'bun:test';

import Tile from '#/bot/geometry/Tile.js';
import { Banking } from '#/bot/api/bank/Banking.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { executeStep } from '#/bot/api/ai/quests/exec/steps.js';

const originals = {
    bankingOpen: Banking.open,
    bankWithdrawX: Bank.withdrawX,
    bankWithdrawXById: Bank.withdrawXById,
    bankDepositAllMatching: Bank.depositAllMatching,
    inventoryCount: Inventory.count
};

afterEach(() => {
    (Banking as any).open = originals.bankingOpen;
    (Bank as any).withdrawX = originals.bankWithdrawX;
    (Bank as any).withdrawXById = originals.bankWithdrawXById;
    (Bank as any).depositAllMatching = originals.bankDepositAllMatching;
    (Inventory as any).count = originals.inventoryCount;
});

function bankOpens(): void {
    // openBankLeg uses Banking.open (Shantay chest + booths), not Bank.openNearest.
    (Banking as any).open = async () => true;
}

test('withdraw steps route exact item specs through the ID-aware helper', async () => {
    bankOpens();
    const calls: Array<{ type: 'name' | 'id'; value: string | number; qty: number }> = [];
    (Bank as any).withdrawX = async (name: string, qty: number) => {
        calls.push({ type: 'name', value: name, qty });
        return true;
    };
    (Bank as any).withdrawXById = async (id: number, qty: number) => {
        calls.push({ type: 'id', value: id, qty });
        return true;
    };

    const ok = await executeStep({
        kind: 'withdraw',
        bank: new Tile(2616, 3332, 0),
        leaveOpen: true,
        items: [
            { name: 'A key', id: 298, qty: 1 },
            { name: 'Rope', qty: 2 }
        ]
    }, [], () => {});

    expect(ok).toBe(true);
    expect(calls).toEqual([
        { type: 'id', value: 298, qty: 1 },
        { type: 'name', value: 'Rope', qty: 2 }
    ]);
});

test('deposit keepIds preserves one exact object while same-named objects are deposited', async () => {
    bankOpens();
    const decisions = new Map<number, boolean>();
    (Bank as any).depositAllMatching = async (match: (name: string, id: number) => boolean) => {
        decisions.set(293, match('A key', 293));
        decisions.set(298, match('A key', 298));
        decisions.set(954, match('Rope', 954));
        decisions.set(1, match('Pot', 1));
    };

    const ok = await executeStep({
        kind: 'deposit',
        bank: new Tile(2616, 3332, 0),
        leaveOpen: true,
        keep: ['rope'],
        keepIds: [293],
        exactKeep: true
    }, [], () => {});

    expect(ok).toBe(true);
    expect(decisions).toEqual(new Map([
        [293, false],
        [298, true],
        [954, false],
        [1, true]
    ]));
});

// Why: `Bank.withdrawX` takes its count ON TOP of the pack, so asking for `estGp` over a float draws the estimate twice — 50k plus the guild's 60k estimate walked 110k into the jungle.
test('a buy step draws only the shortfall when the pack already holds a float', async () => {
    bankOpens();
    const calls: Array<{ name: string; qty: number }> = [];
    (Bank as any).withdrawX = async (name: string, qty: number) => {
        calls.push({ name, qty });
        return true;
    };
    (Inventory as any).count = (name: string) => (name === 'Coins' ? 50_000 : 0);

    await executeStep({
        kind: 'buy',
        item: 'Unpowered orb',
        qty: 1,
        shop: { npc: 'Magic store', anchor: new Tile(2591, 3089, 0) },
        estGp: 60_000,
        bank: new Tile(2616, 3332, 0)
    }, [], () => {});

    expect(calls).toEqual([{ name: 'Coins', qty: 10_000 }]);
});
