import { describe, expect, test } from 'bun:test';

import { RG_TILE } from '#/bot/api/ai/quests/defs/regicide/areas.js';
import { ARDOUGNE, FOREST_STAGE, GATE_STAGE, planRoute, pocketAt } from '#/bot/api/ai/quests/defs/regicide/pockets.js';
import { REGICIDE_POCKETS, REGICIDE_SEAMS } from '#/bot/api/ai/quests/defs/regicide/seams.js';
import { RG_STAGE } from '#/bot/api/ai/quests/defs/regicide/journal.js';

// Why: the seam table is generated from the collision pack by `tools/nav/regicide-pockets.ts`, so these are
// the assertions that catch a regeneration that silently lost a crossing — a lost seam is not a compile
// error, it is a leg that walks into a wall thirty minutes into a run.

const at = (t: { x: number; z: number }) => ({ x: t.x, z: t.z, level: 0 });

describe('the Tirannwn seam table', () => {
    test('every pocket a seam names has spans baked for it', () => {
        const named = new Set(REGICIDE_SEAMS.flatMap(seam => seam.sides.map(side => side.pocket)));
        named.delete(ARDOUGNE);
        const baked = new Set(REGICIDE_POCKETS.map(pocket => pocket.name));
        expect([...named].filter(name => !baked.has(name))).toEqual([]);
    });

    test('every seam joins two different pockets', () => {
        const degenerate = REGICIDE_SEAMS.filter(seam => seam.sides[0].pocket === seam.sides[1]?.pocket);
        expect(degenerate).toEqual([]);
    });

    test('every seam stand is inside the pocket it claims', () => {
        const wrong = REGICIDE_SEAMS.flatMap(seam =>
            seam.sides
                .filter(side => side.pocket !== ARDOUGNE && pocketAt(at(side.stand)) !== side.pocket)
                .map(side => `${seam.loc}@(${seam.x},${seam.z}) -> ${side.pocket}`)
        );
        expect(wrong).toEqual([]);
    });
});

describe('pocketAt', () => {
    test.each([
        ['the Isafdar entry', RG_TILE.ISAFDAR_ENTRY, 'isafdar-entry'],
        ['the elf camp', RG_TILE.IORWERTH, 'elf-camp'],
        ['the loom', RG_TILE.LOOM, 'elf-camp'],
        ['the old camp', RG_TILE.TRACKER, 'old-camp'],
        ['the coal-tar seep', RG_TILE.TAR, 'old-camp'],
        ['the catapult', RG_TILE.CATAPULT, 'catapult'],
        ["Tyras's camp", RG_TILE.TYRAS_CAMP, 'tyras-camp'],
        ['the camp furnace', RG_TILE.FURNACE, 'tyras-camp'],
        ['the limestone quarry', RG_TILE.QUARRY, 'quarry']
    ])('%s is where the route table says it is', (_what, tile, pocket) => {
        expect(pocketAt(tile)).toBe(pocket);
    });

    test('the mainland is nobody\'s pocket — the navigator owns it', () => {
        expect(pocketAt(RG_TILE.ARDOUGNE_BANK)).toBeUndefined();
        expect(pocketAt(RG_TILE.ARANDAR_NORTH)).toBeUndefined();
    });
});

describe('planRoute', () => {
    const early = RG_STAGE.SPOKEN_SCOUTS;
    const late = RG_STAGE.SPOKEN_IORWERTH2;

    test('the early quest reaches the elf camp without a dense forest', () => {
        const route = planRoute('isafdar-entry', 'elf-camp', early);
        expect(route).not.toBeNull();
        expect(route!.every(leg => leg.seam.kind !== 'forest')).toBe(true);
    });

    test('the early quest reaches the old camp and its tracker', () => {
        expect(planRoute('isafdar-entry', 'old-camp', early)).not.toBeNull();
        expect(planRoute('elf-camp', 'old-camp', early)).not.toBeNull();
    });

    // Why: `_regicide_cross_over` answers "You can see no way to get past this" below stage 8, and the camp
    // is behind four of them — a route that used one early would park the run at a crossing that refuses.
    test("Tyras's camp is unreachable until the tracker has explained the woodland", () => {
        expect(planRoute('elf-camp', 'tyras-camp', FOREST_STAGE - 1)).toBeNull();
        expect(planRoute('elf-camp', 'tyras-camp', FOREST_STAGE)).not.toBeNull();
    });

    test('the catapult is reachable once the forests open', () => {
        expect(planRoute('elf-camp', 'catapult', late)).not.toBeNull();
        expect(planRoute('catapult', 'elf-camp', late)).not.toBeNull();
    });

    test('the quarry is reachable from the elf camp', () => {
        expect(planRoute('elf-camp', 'quarry', late)).not.toBeNull();
    });

    // Why: `arandar_gate` opens northbound at any stage and southbound only past `killed_tyras`, so the way
    // out is free from the moment the bomb ingredients are gathered and the way back in is not.
    test('the palisade lets the quest out at any stage', () => {
        const out = planRoute('elf-camp', ARDOUGNE, late);
        expect(out).not.toBeNull();
        expect(out!.some(leg => leg.seam.kind === 'gate')).toBe(true);
    });

    test('the palisade refuses to let the quest back in until the deed is reported', () => {
        expect(planRoute(ARDOUGNE, 'elf-camp', GATE_STAGE - 1)).toBeNull();
        expect(planRoute(ARDOUGNE, 'elf-camp', GATE_STAGE)).not.toBeNull();
    });

    test('a route that starts where it ends is no legs at all', () => {
        expect(planRoute('elf-camp', 'elf-camp', late)).toEqual([]);
    });
});
