import { describe, expect, test } from 'bun:test';

import { UP_ITEM } from '#/bot/api/ai/quests/defs/upass/areas.js';
import { decide } from '#/bot/api/ai/quests/defs/upass/index.js';
import { UP_FLAG, UP_STAGE } from '#/bot/api/ai/quests/defs/upass/journal.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

// Why: decide() reads only a snapshot, so the whole routing table is testable without a client.
type Stack = number | [number, number];
const counts = (stacks: Stack[]): Map<number, number> =>
    new Map(stacks.map(s => (Array.isArray(s) ? s : [s, 1])));

const ARDOUGNE = { x: 2655, z: 3283, level: 0 };
const WEST_ARDOUGNE = { x: 2500, z: 3300, level: 0 };
const AREA1 = { x: 2450, z: 9716, level: 0 };

/** The kit the module refuses to go underground without. */
const KIT: Stack[] = [
    [UP_ITEM.ROPE.id, 3],
    UP_ITEM.SHORTBOW.id,
    [UP_ITEM.BRONZE_ARROW.id, 50],
    UP_ITEM.TINDERBOX.id,
    UP_ITEM.BUCKET.id,
    [UP_ITEM.LOBSTER.id, 18]
];

function snapshot(over: Partial<QuestSnapshot> & {
    stage?: number;
    flags?: string[];
    carried?: Stack[];
    banked?: Stack[];
    wornIdList?: number[];
} = {}): QuestSnapshot {
    const { stage = UP_STAGE.NOT_STARTED, flags = [], carried = [], banked = [], wornIdList = [], ...rest } = over;
    return {
        journal: 'inProgress',
        inv: new Map(),
        invIds: counts(carried),
        worn: new Set(),
        wornIds: new Set(wornIdList),
        noProgress: 0,
        bankCoins: 0,
        bankIds: counts(banked),
        bankKnown: true,
        stage,
        progress: { stage, flags: new Set(flags) },
        tile: ARDOUGNE,
        ...rest
    } as QuestSnapshot;
}

const nameOf = (step: unknown): string => (step as { name?: string }).name ?? '';
const kindOf = (step: unknown): string => (step as { kind: string }).kind;
const reasonOf = (step: unknown): string => (step as { reason?: string }).reason ?? '';

describe('Underground Pass decide()', () => {
    test('an unloaded journal waits rather than guessing a stage', () => {
        expect(kindOf(decide(snapshot({ journal: 'unknown' })))).toBe('wait');
    });

    test('a complete journal is done', () => {
        expect(kindOf(decide(snapshot({ journal: 'complete' })))).toBe('done');
    });

    test('the kit is drawn before the quest is started', () => {
        const step = decide(snapshot({ banked: KIT }));
        expect(kindOf(step)).toBe('withdraw');
    });

    test('with the kit in the pack, an unstarted quest goes to King Lathas', () => {
        const step = decide(snapshot({ carried: KIT }));
        expect(nameOf(step)).toContain('King Lathas');
    });

    // Why: the started bit is not a stage — reading it as one sent the bot back to Lathas forever.
    test('started is a flag on stage zero and routes to Koftik, not back to Lathas', () => {
        const step = decide(snapshot({ carried: KIT, flags: [UP_FLAG.STARTED] }));
        expect(nameOf(step)).not.toContain('King Lathas');
    });

    // Why: `no path to (2436,3315): unreachable` — the navigator has no edge into West Ardougne, so the
    // wall has to be crossed explicitly before anything inside it is reachable.
    test('Koftik is behind the wall, so the crossing comes first', () => {
        const step = decide(snapshot({ carried: KIT, flags: [UP_FLAG.STARTED] }));
        expect(nameOf(step)).toContain('West Ardougne');
    });

    test('inside West Ardougne it goes to Koftik instead of crossing again', () => {
        const step = decide(snapshot({ carried: KIT, flags: [UP_FLAG.STARTED], tile: WEST_ARDOUGNE }));
        expect(nameOf(step)).toContain('Koftik');
    });

    // Why: the pass is one-way with no bank in it, so a short pack stops at the mouth and says what is
    // missing rather than walking in and parking at an obstacle it cannot pass.
    test('a pack short of the kit refuses to descend and names what is missing', () => {
        const step = decide(snapshot({
            stage: UP_STAGE.SPOKEN_KOFTIK,
            tile: WEST_ARDOUGNE,
            carried: [UP_ITEM.TINDERBOX.id],
            banked: []
        }));
        expect(kindOf(step)).toBe('wait');
        expect(reasonOf(step)).toContain('Shortbow');
    });

    test('in the first cavern with no cloth, it asks Koftik for one', () => {
        const step = decide(snapshot({ stage: UP_STAGE.SPOKEN_KOFTIK, tile: AREA1, carried: KIT }));
        expect(nameOf(step)).toContain('damp cloth');
    });

    test('with the cloth it builds the fire arrow', () => {
        const step = decide(snapshot({
            stage: UP_STAGE.SPOKEN_KOFTIK,
            tile: AREA1,
            carried: [...KIT, UP_ITEM.DAMP_CLOTH.id]
        }));
        expect(nameOf(step)).toContain('fire arrow');
    });

    test('a lit arrow in the pack is wielded before the shot', () => {
        const step = decide(snapshot({
            stage: UP_STAGE.SPOKEN_KOFTIK,
            tile: AREA1,
            carried: [...KIT, UP_ITEM.LIT_ARROW.id]
        }));
        expect(nameOf(step)).toContain('wield');
    });

    test('a lit arrow already worn fires at the stay rope', () => {
        const step = decide(snapshot({
            stage: UP_STAGE.SPOKEN_KOFTIK,
            tile: AREA1,
            carried: KIT,
            wornIdList: [UP_ITEM.LIT_ARROW.id, UP_ITEM.SHORTBOW.id]
        }));
        expect(nameOf(step)).toContain('stay rope');
    });

    // Why: which orbs are already dark is not answerable from a snapshot — a burned orb has simply left the
    // pack, and neither the trap nor the ground spawns hand over a second one. A per-site decide cycle
    // therefore picks the same site forever, so the whole sweep is one step that keeps its own tally.
    test('past the grid, the orb phase is a single step whatever the pack holds', () => {
        const inside = { x: 2460, z: 9678, level: 0 };
        for (const carried of [[], [UP_ITEM.ORB1.id], [UP_ITEM.ORB1.id, UP_ITEM.ORB2.id, UP_ITEM.ORB3.id]]) {
            const step = decide(snapshot({ stage: UP_STAGE.PASSED_BRIDGE, tile: inside, carried }));
            expect(nameOf(step)).toContain('orbs');
        }
    });

    test('east of the grid it crosses before sweeping orbs', () => {
        const step = decide(snapshot({
            stage: UP_STAGE.PASSED_BRIDGE,
            tile: { x: 2479, z: 9679, level: 0 }
        }));
        expect(nameOf(step)).toContain('grid');
    });

    test('a finished doll at the confronted stage is thrown into the pit', () => {
        const step = decide(snapshot({
            stage: UP_STAGE.CONFRONTED_IBAN,
            tile: { x: 2140, z: 4647, level: 1 },
            carried: [UP_ITEM.DOLL.id],
            flags: [UP_FLAG.DOLL_COMPLETE]
        }));
        expect(nameOf(step)).toContain('pit of the damned');
    });

    test('an unimplemented stage waits with the stage named, never a silent retry', () => {
        const step = decide(snapshot({ stage: UP_STAGE.DEFEATED_IBAN, tile: AREA1 }));
        expect(kindOf(step)).toBe('wait');
        expect(reasonOf(step)).toContain('Iban is dead');
    });
});
