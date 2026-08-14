import { describe, expect, test } from 'bun:test';
import type { WorldTile } from '#/bot/adapter/ClientAdapter.js';
import { MC_OBJ } from '#/bot/api/ai/quests/defs/dwarfcannon/areas.js';
import { decide, dwarfcannon } from '#/bot/api/ai/quests/defs/dwarfcannon/index.js';
import { MC_FLAG, MC_STAGE } from '#/bot/api/ai/quests/defs/dwarfcannon/journal.js';
import { defById } from '#/bot/api/ai/quests/defs/index.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

interface Options {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    flags?: string[];
    invIds?: number[];
    tile?: WorldTile | null;
}

function snap(options: Options = {}): QuestSnapshot {
    const stage = options.stage ?? MC_STAGE.NOT_STARTED;
    const invIds = new Map<number, number>();
    for (const id of options.invIds ?? []) {
        invIds.set(id, (invIds.get(id) ?? 0) + 1);
    }
    return {
        journal: options.journal ?? (stage === MC_STAGE.NOT_STARTED ? 'notStarted' : 'inProgress'),
        inv: new Map(),
        invIds,
        worn: new Set(),
        noProgress: 0,
        bankCoins: 0,
        stage,
        progress: { stage, flags: new Set(options.flags ?? []) },
        bank: new Map(),
        bankIds: new Map(),
        bankKnown: true,
        tile: options.tile === undefined ? { x: 2571, z: 3463, level: 0 } : options.tile,
        freeSlots: 20
    };
}

describe('dwarfcannon decide', () => {
    test('an unloaded journal waits rather than restarting the quest', () => {
        expect(decide(snap({ journal: 'unknown' })).kind).toBe('wait');
    });

    test('a complete journal is done', () => {
        expect(decide(snap({ journal: 'complete', stage: MC_STAGE.COMPLETE })).kind).toBe('done');
    });

    test('not started talks to the Commander', () => {
        const step = decide(snap());
        expect(step.kind).toBe('talk');
        expect(step.kind === 'talk' && step.stop.npc).toBe('Dwarf Commander');
    });

    test('railings done reports back to the Commander', () => {
        const step = decide(snap({ stage: MC_STAGE.RAILINGS, flags: [MC_FLAG.RAILINGS_DONE] }));
        expect(step.kind).toBe('talk');
    });

    test('holding the remains reports back to the Commander', () => {
        const step = decide(
            snap({
                stage: MC_STAGE.GUARD_TOWER,
                flags: [MC_FLAG.HAS_REMAINS],
                invIds: [MC_OBJ.REMAINS.id]
            })
        );
        expect(step.kind).toBe('talk');
    });

    test('the child is rescued, so the Commander is next', () => {
        expect(decide(snap({ stage: MC_STAGE.CHILD_RESCUED })).kind).toBe('talk');
    });

    test('the cannon is fixed, so the Commander is next', () => {
        expect(decide(snap({ stage: MC_STAGE.CANNON_FIXED })).kind).toBe('talk');
    });

    test('stage 9 talks to Nulodion', () => {
        const step = decide(snap({ stage: MC_STAGE.SEE_NULODION }));
        expect(step.kind).toBe('talk');
        expect(step.kind === 'talk' && step.stop.npc).toBe('Nulodion');
    });

    test('stage 10 holding both hands them to the Commander', () => {
        const step = decide(
            snap({ stage: MC_STAGE.RETURN_NOTES, invIds: [MC_OBJ.NOTES.id, MC_OBJ.MOULD.id] })
        );
        expect(step.kind).toBe('talk');
        expect(step.kind === 'talk' && step.stop.npc).toBe('Dwarf Commander');
    });

    test('stage 10 missing the mould goes back to Nulodion for a replacement', () => {
        const step = decide(snap({ stage: MC_STAGE.RETURN_NOTES, invIds: [MC_OBJ.NOTES.id] }));
        expect(step.kind).toBe('talk');
        expect(step.kind === 'talk' && step.stop.npc).toBe('Nulodion');
    });
});

describe('dwarfcannon module', () => {
    test('is registered', () => {
        expect(defById('mcannon')).toBe(dwarfcannon);
    });

    test('requires no items, so nothing is provisioned up front', () => {
        expect(dwarfcannon.record.items).toEqual([]);
    });

    test('keeps every carried quest item off the spillover deposit', () => {
        for (const name of ['tool kit', 'dwarf remains', "nulodion's notes", 'ammo mould', 'railing']) {
            expect(dwarfcannon.tools).toContain(name);
        }
    });
});
