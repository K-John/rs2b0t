import { describe, expect, test } from 'bun:test';

import { RG_ITEM } from '#/bot/api/ai/quests/defs/regicide/areas.js';
import { decide } from '#/bot/api/ai/quests/defs/regicide/index.js';
import { RG_FLAG, RG_STAGE } from '#/bot/api/ai/quests/defs/regicide/journal.js';
import { WOOL_TARGET } from '#/bot/api/ai/quests/defs/regicide/supplies.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

// Why: decide() reads only a snapshot, so the routing table is testable end to end without a client.
type Stack = number | [number, number];
const counts = (stacks: Stack[]): Map<number, number> =>
    new Map(stacks.map(s => (Array.isArray(s) ? s : [s, 1])));

const ARDOUGNE = { x: 2655, z: 3283, level: 0 };
const ELF_CAMP = { x: 2205, z: 3252, level: 0 };
const PASS = { x: 2450, z: 9716, level: 0 };

/** What the module refuses to cross the palisade without. */
const KIT: Stack[] = [[RG_ITEM.BALL_OF_WOOL.id, WOOL_TARGET], RG_ITEM.PICKAXE.id, RG_ITEM.PESTLE.id, [RG_ITEM.LOBSTER.id, 14]];
const WEAPON = 'rune scimitar';

function snapshot(over: Partial<QuestSnapshot> & {
    stage?: number;
    flags?: string[];
    carried?: Stack[];
    banked?: Stack[];
    wornNames?: string[];
} = {}): QuestSnapshot {
    const { stage = RG_STAGE.NOT_STARTED, flags = [], carried = KIT, banked = [], wornNames = [WEAPON], ...rest } = over;
    return {
        journal: 'inProgress',
        inv: new Map(),
        invIds: counts(carried),
        worn: new Set(wornNames),
        wornIds: new Set(),
        noProgress: 0,
        bankCoins: 2_000_000,
        bank: new Map(),
        bankIds: counts(banked),
        bankKnown: true,
        stage,
        progress: { stage, flags: new Set(flags) },
        tile: ELF_CAMP,
        ...rest
    } as QuestSnapshot;
}

const name = (step: QuestStep): string =>
    step.kind === 'custom' ? step.name : step.kind === 'wait' ? `wait: ${step.reason}` : step.kind;

describe('Regicide decide()', () => {
    test('a finished journal is done', () => {
        expect(decide(snapshot({ journal: 'complete' })).kind).toBe('done');
    });

    test('an unread journal waits rather than guessing a stage', () => {
        expect(decide(snapshot({ journal: 'unknown' })).kind).toBe('wait');
    });

    test('the messenger is waited for before anything else', () => {
        expect(name(decide(snapshot({ stage: RG_STAGE.NOT_STARTED, tile: ARDOUGNE })))).toContain('messenger');
    });

    test('a pack short of the kit is stopped on the mainland, not at the palisade', () => {
        const step = decide(snapshot({ stage: RG_STAGE.SPOKEN_LATHAS, tile: PASS, carried: [] }));
        expect(step.kind).toBe('wait');
        expect(step.kind === 'wait' && step.reason).toContain('not equipped for Tirannwn');
    });

    test('a kitted pack outside Tirannwn walks the pass', () => {
        expect(name(decide(snapshot({ stage: RG_STAGE.SPOKEN_LATHAS, tile: PASS })))).toContain('Underground Pass');
    });

    test('a melee weapon is part of what the palisade waits for', () => {
        const step = decide(snapshot({ stage: RG_STAGE.SPOKEN_LATHAS, tile: PASS, wornNames: [] }));
        expect(step.kind === 'wait' && step.reason).toContain('melee weapon');
    });

    test('the scouts are waited for inside the forest', () => {
        expect(name(decide(snapshot({ stage: RG_STAGE.SPOKEN_LATHAS })))).toContain('elf scouts');
    });

    test('the tracker is asked for proof before the pendant exists', () => {
        expect(name(decide(snapshot({ stage: RG_STAGE.SPOKEN_TRACKER })))).toContain('Lord Iorwerth');
    });

    test('the pendant in the pack sends the player back to the tracker', () => {
        const step = decide(snapshot({ stage: RG_STAGE.SPOKEN_TRACKER, carried: [...KIT, RG_ITEM.PENDANT.id] }));
        expect(name(step)).toContain('tracker');
    });

    test('a journal that records the pendant is enough, even once it has been handed over', () => {
        const step = decide(snapshot({ stage: RG_STAGE.SPOKEN_TRACKER, flags: [RG_FLAG.PENDANT] }));
        expect(name(step)).toContain('tracker');
    });
});

describe('Regicide bomb chain', () => {
    const atStage = (carried: Stack[]): QuestStep =>
        decide(snapshot({ stage: RG_STAGE.SPOKEN_IORWERTH2, carried: [...KIT, ...carried] }));

    test('the cloth is woven first, while the wool is still in the pack', () => {
        expect(name(atStage([]))).toContain('weave');
    });

    test('the barrel comes next, once the cloth is made', () => {
        expect(name(atStage([RG_ITEM.CLOTH.id]))).toContain('empty barrel');
    });

    test('a barrel in hand is filled rather than a second one fetched', () => {
        expect(name(atStage([RG_ITEM.CLOTH.id, RG_ITEM.BARREL.id]))).toContain('coal-tar');
    });

    test('a barrel already full of tar is not refilled', () => {
        expect(name(atStage([RG_ITEM.CLOTH.id, RG_ITEM.BARREL_TAR.id]))).toContain('sulphur');
    });

    test('a lump of sulphur is ground rather than a second one taken', () => {
        expect(name(atStage([RG_ITEM.CLOTH.id, RG_ITEM.BARREL_TAR.id, RG_ITEM.SULPHUR.id]))).toContain('grind');
    });

    test('limestone is mined once the sulphur is dust', () => {
        const step = atStage([RG_ITEM.CLOTH.id, RG_ITEM.BARREL_TAR.id, RG_ITEM.SULPHUR_DUST.id]);
        expect(step.kind).toBe('mineRock');
        expect(step.kind === 'mineRock' && step.rock).toBe('Limestone');
    });

    test('a pot is fetched before the quicklime is ground', () => {
        const step = atStage([RG_ITEM.CLOTH.id, RG_ITEM.BARREL_TAR.id, RG_ITEM.SULPHUR_DUST.id, RG_ITEM.QUICKLIME.id]);
        expect(name(step)).toContain('pot');
    });

    test('a rabbit is the last thing the forest owes', () => {
        const step = atStage([RG_ITEM.CLOTH.id, RG_ITEM.BARREL_TAR.id, RG_ITEM.SULPHUR_DUST.id, RG_ITEM.QUICKLIME_DUST.id]);
        expect(name(step)).toContain('rabbit');
    });

    test('a full pack leaves through the palisade', () => {
        const step = atStage([
            RG_ITEM.CLOTH.id,
            RG_ITEM.BARREL_TAR.id,
            RG_ITEM.SULPHUR_DUST.id,
            RG_ITEM.QUICKLIME_DUST.id,
            RG_ITEM.RAW_RABBIT.id
        ]);
        expect(name(step)).toContain('Arandar');
    });

    // Why: the mainland half is keyed on the same pack, so the same snapshot with a mainland tile has to
    // pick up where the forest left off.
    const onMainland = (carried: Stack[]): QuestStep =>
        decide(snapshot({ stage: RG_STAGE.SPOKEN_IORWERTH2, tile: ARDOUGNE, carried: [...KIT, ...carried] }));

    test('the raw rabbit is cooked before the still is visited', () => {
        expect(name(onMainland([RG_ITEM.BARREL_TAR.id, RG_ITEM.RAW_RABBIT.id]))).toContain('cook');
    });

    test('coal is sourced before the tar is distilled', () => {
        const step = onMainland([RG_ITEM.BARREL_TAR.id, RG_ITEM.COOKED_RABBIT.id]);
        expect(step.kind).toBe('mineRock');
        expect(step.kind === 'mineRock' && step.rock).toBe('Coal');
    });

    test('a pack with coal distils', () => {
        const step = onMainland([RG_ITEM.BARREL_TAR.id, RG_ITEM.COOKED_RABBIT.id, [RG_ITEM.COAL.id, 20]]);
        expect(name(step)).toContain('distil');
    });

    test('naphtha is mixed with the powders', () => {
        expect(name(onMainland([RG_ITEM.BARREL_NAPHTHA.id, RG_ITEM.COOKED_RABBIT.id]))).toContain('mix');
    });

    test('a half-mixed barrel is still the mixing step', () => {
        expect(name(onMainland([RG_ITEM.MIX_QUICKLIME.id, RG_ITEM.COOKED_RABBIT.id]))).toContain('mix');
    });

    test('a sealed barrel takes the fuse', () => {
        expect(name(onMainland([RG_ITEM.BARREL_LID.id, RG_ITEM.COOKED_RABBIT.id]))).toContain('fuse');
    });

    test('a fused bomb on the mainland walks back through the pass', () => {
        expect(name(onMainland([RG_ITEM.BARREL_FUSED.id, RG_ITEM.COOKED_RABBIT.id]))).toContain('Underground Pass');
    });

    // Why: `regicide_cross_over3` clears the given-rabbit bit inside mapsquare 34_49, which the walk to the
    // catapult crosses — so the guard is fed after arriving, and never before setting out.
    test('the guard is fed after the bomb is back in the forest', () => {
        expect(name(atStage([RG_ITEM.BARREL_FUSED.id, RG_ITEM.COOKED_RABBIT.id]))).toContain('catapult guard');
    });

    test('with the rabbit handed over, the catapult fires', () => {
        expect(name(atStage([RG_ITEM.BARREL_FUSED.id]))).toContain('fire the barrel bomb');
    });
});

describe('Regicide endgame', () => {
    test('the deed is reported to Iorwerth before leaving', () => {
        expect(name(decide(snapshot({ stage: RG_STAGE.KILLED_TYRAS })))).toContain('Lord Iorwerth');
    });

    test('the letter is carried out through the palisade', () => {
        expect(name(decide(snapshot({ stage: RG_STAGE.REPORTED_IORWERTH })))).toContain('Arandar');
    });

    test('on the mainland the Ardougne road is walked for Arianwyn', () => {
        expect(name(decide(snapshot({ stage: RG_STAGE.REPORTED_IORWERTH, tile: ARDOUGNE })))).toContain('Arianwyn');
    });

    test('once Arianwyn has spoken, the letter goes to King Lathas', () => {
        expect(name(decide(snapshot({ stage: RG_STAGE.SPOKEN_ARIANWYN, tile: ARDOUGNE })))).toContain('King Lathas');
    });
});
