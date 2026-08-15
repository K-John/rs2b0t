import { describe, expect, test } from 'bun:test';

import {
    ICE_CHESTS,
    IKOV_TILE,
    acrossTheLava,
    inChamberOfFear,
    inDarkRoom,
    inGuardianTemple,
    inIceCavern,
    inTemple,
    inTrapPit,
    onWineldaLedge,
    westOfBridge
} from '#/bot/api/ai/quests/defs/ikov/areas.js';

type Region = (t: { x: number; z: number }) => boolean;

const REGIONS: [string, Region][] = [
    ['dark room', inDarkRoom],
    ['west of the bridge', westOfBridge],
    ['trap pit', inTrapPit],
    ["Winelda's ledge", onWineldaLedge],
    ['across the lava', acrossTheLava],
    ["guardians' temple", inGuardianTemple]
];

/** One tile inside each pocket the module has to recognise it woke up in. */
const INSIDE: [string, { x: number; z: number }][] = [
    ['dark room', IKOV_TILE.DARK_LANDING],
    ['west of the bridge', IKOV_TILE.BRIDGE_WEST],
    ['trap pit', { x: 2682, z: 9854 }],
    ["Winelda's ledge", IKOV_TILE.WINELDA],
    ['across the lava', IKOV_TILE.WINELDA_LANDING],
    ["guardians' temple", IKOV_TILE.GUARDIANS]
];

describe('Temple of Ikov regions', () => {
    // Why: `escapePocket` picks its climb off these, so two that overlap send the bot up the wrong ladder.
    test('each pocket tile matches its own region and no other', () => {
        for (const [name, tile] of INSIDE) {
            const matched = REGIONS.filter(([, inside]) => inside(tile)).map(([label]) => label);
            expect([name, matched]).toEqual([name, [name]]);
        }
    });

    test('the entrance corridor is in none of the pockets', () => {
        const matched = REGIONS.filter(([, inside]) => inside(IKOV_TILE.ENTRANCE)).map(([label]) => label);
        expect(matched).toEqual([]);
    });

    test('the chamber of fear holds the trap lever and the east bank of the bridge', () => {
        expect(inChamberOfFear(IKOV_TILE.TRAP_LEVER)).toBe(true);
        expect(inChamberOfFear(IKOV_TILE.BRIDGE_EAST)).toBe(true);
        expect(inChamberOfFear(IKOV_TILE.ENTRANCE)).toBe(false);
    });

    test('every ice chest is inside the ice cavern and none is in the chamber of fear', () => {
        for (const chest of ICE_CHESTS) {
            expect(inIceCavern(chest)).toBe(true);
            expect(inChamberOfFear(chest)).toBe(false);
        }
    });

    test('the ice cavern excludes the corridor the south gate opens from', () => {
        expect(inIceCavern(IKOV_TILE.SOUTH_GATE_NORTH)).toBe(false);
        expect(inIceCavern(IKOV_TILE.SOUTH_GATE_SOUTH)).toBe(true);
    });

    test('every temple tile reads as inside the temple, and the surface does not', () => {
        expect(inTemple(IKOV_TILE.ENTRANCE)).toBe(true);
        expect(inTemple(IKOV_TILE.GUARDIANS)).toBe(true);
        expect(inTemple(IKOV_TILE.DARK_LANDING)).toBe(true);
        expect(inTemple(IKOV_TILE.TEMPLE_LADDER)).toBe(false);
        expect(inTemple(IKOV_TILE.LUCIEN_HUT)).toBe(false);
    });
});
