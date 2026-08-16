import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { GroundItems } from '#/bot/api/grounditems/GroundItems.js';
import { Npcs } from '#/bot/api/npcs/Npcs.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { SM_TILE } from '#/bot/api/ai/quests/defs/mortton/areas.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

interface WorldTileLike {
    x: number;
    z: number;
    level: number;
}

let walkTargets: WorldTileLike[];
let searchRadii: number[];
let visibleShade: { index: number; interact: (op: string) => Promise<boolean> } | null;
let alive: boolean;
let clock: number;

const npcChain = {
    where: () => npcChain,
    action: () => npcChain,
    within: (d: number) => {
        searchRadii.push(d);
        return npcChain;
    },
    nearest: () => visibleShade
};
const emptyGround = {
    where: () => emptyGround,
    within: () => emptyGround,
    nearest: () => null
};

// Why: Bun's mock.module is permanent for the process, so stub the singleton instead.
const restoreExec = stubProps(Execution, {
    delayTicks: async (): Promise<void> => {},
    delayUntil: async (): Promise<boolean> => false
});
const restoreTraversal = stubProps(Traversal, {
    walkResilient: async (dest: WorldTileLike): Promise<boolean> => {
        walkTargets.push({ x: dest.x, z: dest.z, level: dest.level });
        return true;
    }
});
const restoreNpcs = stubProps(Npcs, {
    query: () => npcChain as never,
    all: () => (alive && visibleShade ? [visibleShade as never] : [])
});
const restoreGround = stubProps(GroundItems, { query: () => emptyGround as never });
const restoreGame = stubProps(Game, {
    tick: () => clock++,
    inCombat: () => false,
    setAutoRetaliate: (): boolean => true
});
const restoreSkills = stubProps(Skills, { level: () => 10, effective: () => 10 });
const restoreSignal = stubProps(EventSignal, { pending: () => false });
afterAll(() => {
    restoreExec();
    restoreTraversal();
    restoreNpcs();
    restoreGround();
    restoreGame();
    restoreSkills();
    restoreSignal();
});

const { huntShade } = await import('#/bot/api/ai/quests/defs/mortton/shades.js');

describe('the shade hunt walks to where the shades are', () => {
    beforeEach(() => {
        walkTargets = [];
        searchRadii = [];
        visibleShade = null;
        alive = true;
        clock = 1;
    });

    // Why: Razmire's ai_timer walks every shade within 60 tiles to the transform centre, so the town spawns drain to the temple.
    test('an empty scene parks at the temple transform centre, not the town square', async () => {
        const lines: string[] = [];
        expect(await huntShade(m => lines.push(m))).toBe(false);
        expect(walkTargets).toEqual([{ x: SM_TILE.SHADE_LAIR.x, z: SM_TILE.SHADE_LAIR.z, level: 0 }]);
        expect(walkTargets[0]).not.toEqual({ x: SM_TILE.TOWN.x, z: SM_TILE.TOWN.z, level: 0 });
    });

    // Why: the server only transmits npcs inside 15 tiles, so a wider search radius would read tiles that never arrive.
    test('the search stays inside the transmitted npc radius', async () => {
        await huntShade(() => {});
        expect(searchRadii.length).toBeGreaterThan(0);
        for (const r of searchRadii) {
            expect(r).toBeLessThanOrEqual(15);
        }
    });

    test('a shade already in range is fought where it stands', async () => {
        let attacks = 0;
        visibleShade = {
            index: 7,
            interact: async (): Promise<boolean> => {
                attacks++;
                alive = false;
                return true;
            }
        };
        await huntShade(() => {});
        expect(walkTargets).toEqual([]);
        expect(attacks).toBeGreaterThan(0);
    });
});
