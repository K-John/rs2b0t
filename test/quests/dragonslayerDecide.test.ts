import { describe, expect, test } from 'bun:test';

import { DS_ID } from '#/bot/quests/defs/dragonslayer/areas.js';
import { decide } from '#/bot/quests/defs/dragonslayer/index.js';
import { DRAGON_STAGE } from '#/bot/quests/defs/dragonslayer/journal.js';
import type { QuestSnapshot } from '#/bot/quests/engine/types.js';

/**
 * `decide()` reads a snapshot and nothing else, so the whole routing table is
 * testable without a client. These cases are the ones that have actually gone
 * wrong in live runs — each names the symptom it prevents.
 */
type Stack = number | [number, number];
const counts = (stacks: Stack[]): Map<number, number> =>
    new Map(stacks.map(s => (Array.isArray(s) ? s : [s, 1])));

function snapshot(over: Partial<QuestSnapshot> & { flags?: string[]; carried?: Stack[]; banked?: Stack[] } = {}): QuestSnapshot {
    const { flags = [], carried = [], banked = [], ...rest } = over;
    return {
        journal: 'inProgress',
        inv: new Map(),
        invIds: counts(carried),
        worn: new Set(),
        wornIds: new Set(),
        noProgress: 0,
        bankCoins: 0,
        bankIds: counts(banked),
        bankKnown: true,
        progress: { stage: DRAGON_STAGE.SPOKEN_OZIACH, flags: new Set(flags) },
        tile: { x: 3013, z: 3355, level: 0 },
        ...rest
    } as QuestSnapshot;
}

/** Enough nails that the nails leg is satisfied and later branches are reachable. */
const NAILS: Stack = [DS_ID.NAILS, 12];
const nailed = (ids: Stack[]): Stack[] => [...ids, NAILS];

describe('Dragon Slayer decide()', () => {
    test('a banked maze key is not a missing one', () => {
        // The nails leg banks the pack to make room for ore. Reading a banked key
        // as absent sent the bot back to Oziach mid-way through smithing.
        const step = decide(snapshot({
            banked: nailed([DS_ID.MAZE_KEY, DS_ID.SHIELD]),
            flags: ['has-shield']
        }));
        expect((step as { name?: string }).name ?? '').not.toContain('Oziach');
    });

    test('an unfinished briefing outranks everything else', () => {
        const step = decide(snapshot({ flags: ['needs-briefing'], carried: [DS_ID.MAZE_KEY] }));
        expect(step).toMatchObject({ kind: 'custom' });
        expect((step as { name: string }).name).toContain('Oziach');
    });

    test('no maze key anywhere sends the bot back to Oziach', () => {
        const step = decide(snapshot({ flags: ['has-shield'] }));
        expect((step as { name: string }).name).toContain('Oziach');
    });

    test('the step name says why it was chosen', () => {
        // These names are the only record of the decision in a live log.
        const step = decide(snapshot({ flags: ['needs-briefing'] }));
        const name = (step as { name: string }).name;
        expect(name).toContain('mazekey=nowhere');
        expect(name).toContain('stage=');
    });

    test('the shield is asked of the Duke only while it is nowhere to be found', () => {
        const missing = decide(snapshot({ carried: nailed([DS_ID.MAZE_KEY]) }));
        expect(missing).toMatchObject({ kind: 'talk' });

        for (const held of [{ carried: nailed([DS_ID.MAZE_KEY, DS_ID.SHIELD]) }, { carried: nailed([DS_ID.MAZE_KEY]), banked: [DS_ID.SHIELD, NAILS] }]) {
            expect(decide(snapshot({ ...held, flags: [] })).kind).not.toBe('talk');
        }
    });

    test('nails are smithed after the shield and before the maze', () => {
        const step = decide(snapshot({
            carried: [DS_ID.MAZE_KEY, DS_ID.SHIELD],
            flags: ['has-shield']
        }));
        expect((step as { name: string }).name).toContain('nails');
    });

    test('nails already banked are not smithed again', () => {
        const step = decide(snapshot({
            carried: [DS_ID.MAZE_KEY, DS_ID.SHIELD],
            banked: [NAILS],
            flags: ['has-shield']
        }));
        expect((step as { name?: string }).name ?? '').not.toContain('nails');
    });

    test('map pieces left in the bank are withdrawn, not re-earned', () => {
        const step = decide(snapshot({
            carried: nailed([DS_ID.MAZE_KEY, DS_ID.SHIELD]),
            banked: [DS_ID.MAP_MELZAR, NAILS],
            flags: ['has-shield']
        }));
        expect(step.kind).toBe('withdraw');
    });

    test('a complete journal ends the quest whatever the snapshot says', () => {
        expect(decide(snapshot({ journal: 'complete' })).kind).toBe('done');
    });

    test('an unreadable journal waits rather than guessing', () => {
        expect(decide(snapshot({ progress: undefined }))).toMatchObject({ kind: 'wait' });
    });
});
