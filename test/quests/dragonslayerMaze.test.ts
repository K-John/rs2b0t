import { describe, expect, test } from 'bun:test';

import { DS_ID } from '#/bot/quests/defs/dragonslayer/areas.js';
import { MAZE_LEGS, MAZE_NPC, doorCrossed, inMaze, legFromPosition } from '#/bot/quests/defs/dragonslayer/maze.js';

describe("Melzar's Maze route", () => {
    test('every key a kill drops is spent by a later door', () => {
        const spent = new Set<number>();
        for (const leg of MAZE_LEGS) {
            if (leg.kind !== 'door' || leg.keyId === DS_ID.MAZE_KEY) {
                continue;
            }
            const dropped = MAZE_LEGS.findIndex(l => l.kind === 'kill' && l.keyId === leg.keyId);
            const door = MAZE_LEGS.indexOf(leg);
            expect(dropped).toBeGreaterThanOrEqual(0);
            expect(dropped).toBeLessThan(door);
            spent.add(leg.keyId);
        }
        expect(spent.size).toBe(6);
    });

    test('the key droppers are the quest ids, not the decoys sharing their names', () => {
        const ids = MAZE_LEGS.filter(l => l.kind === 'kill').map(l => l.npcId);
        expect(ids).toEqual([
            MAZE_NPC.GIANT_RAT, MAZE_NPC.GHOST, MAZE_NPC.SKELETON,
            MAZE_NPC.ZOMBIE, MAZE_NPC.MELZAR, MAZE_NPC.DEMON
        ]);
    });

    test('each door lands on the far side of its own tile', () => {
        for (const leg of MAZE_LEGS) {
            if (leg.kind !== 'door') {
                continue;
            }
            expect(leg.land.distanceTo(leg.door)).toBeLessThanOrEqual(1);
            expect(leg.land.distanceTo(leg.stand)).toBeLessThanOrEqual(1);
        }
    });

    test('the route ends in the basement at the chest', () => {
        const last = MAZE_LEGS[MAZE_LEGS.length - 1];
        expect(last.kind).toBe('chest');
        if (last.kind === 'chest') {
            expect(last.stand.z).toBeGreaterThan(9600);
        }
    });

    test('the front door is crossed while the maze key is still in the pack', () => {
        const front = MAZE_LEGS[0];
        expect(front.kind).toBe('door');
        if (front.kind !== 'door') {
            return;
        }
        expect(front.keyId).toBe(DS_ID.MAZE_KEY);
        // Its oploc handler never deletes the key, so holding it proves nothing.
        expect(doorCrossed(front, { x: 2940, z: 3248, level: 0 }, true)).toBe(true);
        expect(doorCrossed(front, { x: 2941, z: 3248, level: 0 }, true)).toBe(false);
        expect(doorCrossed(front, { x: 2960, z: 3248, level: 0 }, false)).toBe(false);
    });

    test('a coloured door is crossed exactly when its key is gone', () => {
        const red = MAZE_LEGS.find(l => l.kind === 'door' && l.keyId === DS_ID.RED_KEY);
        expect(red).toBeDefined();
        if (red?.kind !== 'door') {
            return;
        }
        expect(doorCrossed(red, { x: 2925, z: 3253, level: 0 }, true)).toBe(false);
        expect(doorCrossed(red, { x: 2925, z: 3253, level: 0 }, false)).toBe(true);
    });

    test('inMaze covers all four floors and nothing outside', () => {
        expect(inMaze({ x: 2935, z: 3250, level: 0 })).toBe(true);
        expect(inMaze({ x: 2930, z: 3250, level: 2 })).toBe(true);
        expect(inMaze({ x: 2932, z: 9645, level: 0 })).toBe(true);
        expect(inMaze({ x: 2960, z: 3250, level: 0 })).toBe(false);
        // The front door's own tile is the doorstep outside; counting it in
        // sends the bot that just let itself out straight back through.
        expect(inMaze({ x: 2941, z: 3248, level: 0 })).toBe(false);
        expect(inMaze({ x: 2940, z: 3248, level: 0 })).toBe(true);
        expect(inMaze(null)).toBe(false);
    });

    test('a cold start resumes on the floor the bot is standing on', () => {
        expect(legFromPosition({ x: 3013, z: 3355, level: 0 })).toBe(0);
        expect(legFromPosition({ x: 2935, z: 3250, level: 0 })).toBe(1);
        expect(MAZE_LEGS[legFromPosition({ x: 2929, z: 3250, level: 1 })]).toMatchObject({ kind: 'kill', npcId: MAZE_NPC.GHOST });
        expect(MAZE_LEGS[legFromPosition({ x: 2925, z: 3251, level: 2 })]).toMatchObject({ kind: 'kill', npcId: MAZE_NPC.SKELETON });
        expect(MAZE_LEGS[legFromPosition({ x: 2932, z: 9641, level: 0 })]).toMatchObject({ kind: 'kill', npcId: MAZE_NPC.ZOMBIE });
        // The dead end the second-floor descent drops into, not the entrance hall.
        expect(MAZE_LEGS[legFromPosition({ x: 2936, z: 3240, level: 0 })]).toMatchObject({ kind: 'climb', op: 'Climb-down' });
    });
});
