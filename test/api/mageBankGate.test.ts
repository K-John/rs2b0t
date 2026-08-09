import { afterEach, describe, expect, test } from 'bun:test';

import { BANK_LOCATIONS, USE_MAGE_BANK, bankUnlocked, nearestBank } from '#/bot/api/BankLocations.js';

const MAGE = BANK_LOCATIONS.find(b => b.name === 'Mage Arena')!;
const KEY = `rs2b0t:set:Global:${USE_MAGE_BANK}`;

/** Standing at Kolodion's entrance, deep Wilderness — the Mage bank is nearest by far. */
const DEEP_WILDERNESS = { x: 3105, z: 3934, level: 0 };

function setSetting(on: boolean | null): void {
    if (on === null) {
        localStorage.removeItem(KEY);
        sessionStorage.removeItem(KEY);
        return;
    }
    localStorage.setItem(KEY, String(on));
}

afterEach(() => setSetting(null));

describe('Mage Arena bank gate', () => {
    test('is in the bank list at the chamber coord', () => {
        // mage_arena.constant ^mage_arena_finish_coord = 0_39_73_44_44
        expect(MAGE.tile.x).toBe(2540);
        expect(MAGE.tile.z).toBe(4716);
        expect(MAGE.npcAccess?.name).toBe('Gundai');
    });

    test('off by default, so nothing routes through the Wilderness to bank', () => {
        expect(bankUnlocked(MAGE)).toBe(false);
        const near = nearestBank(DEEP_WILDERNESS);
        expect(near?.name).not.toBe('Mage Arena');
    });

    test('stays off when the setting is explicitly false', () => {
        setSetting(false);
        expect(bankUnlocked(MAGE)).toBe(false);
        expect(nearestBank(DEEP_WILDERNESS)?.name).not.toBe('Mage Arena');
    });

    test('opting in makes it selectable, and it wins from inside the Wilderness', () => {
        setSetting(true);
        expect(bankUnlocked(MAGE)).toBe(true);
        expect(nearestBank(DEEP_WILDERNESS)?.name).toBe('Mage Arena');
    });

    test('even opted in, an Ardougne bot still banks in Ardougne', () => {
        setSetting(true);
        const ardy = nearestBank({ x: 2616, z: 3332, level: 0 });
        expect(ardy?.name).toBe('Ardougne West');
    });
});
