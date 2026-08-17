import { describe, expect, test } from 'bun:test';

import { RG_ITEM } from '#/bot/api/ai/quests/defs/regicide/areas.js';
import { decide } from '#/bot/api/ai/quests/defs/regicide/index.js';
import { RG_FLAG, RG_STAGE } from '#/bot/api/ai/quests/defs/regicide/journal.js';
import { ARROW_TARGET, FOOD_TARGET, ROPE_TARGET, WOOL_TARGET } from '#/bot/api/ai/quests/defs/regicide/supplies.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

// Why: decide() reads only a snapshot, so the routing table is testable end to end without a client.
type Stack = number | [number, number];
const counts = (stacks: Stack[]): Map<number, number> =>
    new Map(stacks.map(s => (Array.isArray(s) ? s : [s, 1])));

const ARDOUGNE = { x: 2655, z: 3283, level: 0 };
const ELF_CAMP = { x: 2205, z: 3252, level: 0 };
const PASS = { x: 2450, z: 9716, level: 0 };

/** What the module refuses to cross the palisade without. */
const KIT: Stack[] = [
    [RG_ITEM.BALL_OF_WOOL.id, WOOL_TARGET],
    RG_ITEM.PICKAXE.id,
    RG_ITEM.PESTLE.id,
    [RG_ITEM.ROPE.id, ROPE_TARGET],
    RG_ITEM.SHORTBOW.id,
    [RG_ITEM.BRONZE_ARROW.id, ARROW_TARGET],
    RG_ITEM.TINDERBOX.id,
    RG_ITEM.SPADE.id,
    [RG_ITEM.SHARK.id, FOOD_TARGET]
];
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

    // Why: `upass_bridge` writes no permanent state and its lever only sends the player east, so a finished Underground Pass still owes a fire arrow on every westbound walk — a pack without one crosses nothing.
    const BRIDGE_KIT = [RG_ITEM.SHORTBOW, RG_ITEM.BRONZE_ARROW, RG_ITEM.TINDERBOX, RG_ITEM.SPADE] as const;

    for (const item of BRIDGE_KIT) {
        test(`the palisade waits for the ${item.name.toLowerCase()}`, () => {
            const short = KIT.filter(s => (Array.isArray(s) ? s[0] : s) !== item.id);
            const step = decide(snapshot({ stage: RG_STAGE.SPOKEN_LATHAS, tile: PASS, carried: short }));
            expect(step.kind).toBe('wait');
            expect(step.kind === 'wait' && step.reason.toLowerCase()).toContain(item.name.toLowerCase());
        });
    }

    test('a melee weapon is part of what the palisade waits for', () => {
        const step = decide(snapshot({ stage: RG_STAGE.SPOKEN_LATHAS, tile: PASS, wornNames: [] }));
        expect(step.kind === 'wait' && step.reason).toContain('melee weapon');
    });

    // Why: the gate is re-asked every cycle and the pass is walked with the pack in hand, so anything keyed on the full float blocks the moment the pass spends some of it — the run parked at the bridge's west foot, across the chasm, on "have 49" of fifty arrows.
    const SPENT: [string, [number, number]][] = [
        ['an arrow on the guide-rope shot', [RG_ITEM.BRONZE_ARROW.id, ARROW_TARGET - 1]],
        ['a rope on the rock swing', [RG_ITEM.ROPE.id, 1]],
        ['sharks on the traps', [RG_ITEM.SHARK.id, 1]]
    ];

    test.each(SPENT)('a pack that spent %s still walks on', (_what, left) => {
        const spent: Stack[] = KIT.map(s => ((Array.isArray(s) ? s[0] : s) === left[0] ? left : s));
        expect(name(decide(snapshot({ stage: RG_STAGE.SPOKEN_LATHAS, tile: PASS, carried: spent })))).toContain(
            'Underground Pass'
        );
    });

    // Why: the kit is 24 of the pack's 28 slots and the armour is drawn five pieces at a time, so a bank trip that takes the food first has nowhere to put the set — and `wearGear` withdraws nothing while `sourceKit` is still asking for sharks.
    test('the armour is drawn before the food, because the kit fills the pack', () => {
        const step = decide(
            snapshot({
                stage: RG_STAGE.SPOKEN_LATHAS,
                tile: ARDOUGNE,
                carried: [],
                wornNames: [],
                banked: KIT,
                bank: new Map([['rune scimitar', 1], ['rune chainbody', 1], ['rune platelegs', 1], ['rune full helm', 1], ['rune kiteshield', 1]])
            })
        );
        expect(step.kind).toBe('withdraw');
        const drawn = step.kind === 'withdraw' ? step.items.map(i => i.name.toLowerCase()) : [];
        expect(drawn).toContain('rune chainbody');
        expect(drawn).not.toContain(RG_ITEM.SHARK.name.toLowerCase());
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

    // Why: the pot is taken while the loom is still in sight, because the elf camp is four crossings from the swamp and eight from the palisade — going back for it is the forest crossed twice over.
    test('the pot is taken while the pack is still in the elf camp', () => {
        expect(name(atStage([RG_ITEM.CLOTH.id]))).toContain('pot');
    });

    test('the barrel comes next, off the same floor', () => {
        expect(name(atStage([RG_ITEM.CLOTH.id, RG_ITEM.POT.id]))).toContain('empty barrel');
    });

    test('a barrel in hand is filled rather than a second one fetched', () => {
        expect(name(atStage([RG_ITEM.CLOTH.id, RG_ITEM.POT.id, RG_ITEM.BARREL.id]))).toContain('coal-tar');
    });

    const FOREST_KIT: Stack[] = [RG_ITEM.CLOTH.id, RG_ITEM.POT.id, RG_ITEM.BARREL_TAR.id];

    test('a barrel already full of tar is not refilled', () => {
        expect(name(atStage(FOREST_KIT))).toContain('rabbit');
    });

    test('the sulphur is broken off once the rabbit is caught', () => {
        expect(name(atStage([...FOREST_KIT, RG_ITEM.RAW_RABBIT.id]))).toContain('sulphur');
    });

    test('a lump of sulphur is ground rather than a second one taken', () => {
        expect(name(atStage([...FOREST_KIT, RG_ITEM.RAW_RABBIT.id, RG_ITEM.SULPHUR.id]))).toContain('grind');
    });

    test('limestone is the last thing the forest owes, and the quarry is on the way out', () => {
        const step = atStage([...FOREST_KIT, RG_ITEM.RAW_RABBIT.id, RG_ITEM.SULPHUR_DUST.id]);
        expect(step.kind).toBe('mineRock');
        expect(step.kind === 'mineRock' && step.rock).toBe('Limestone');
    });

    test('a full pack leaves through the palisade', () => {
        const step = atStage([
            ...FOREST_KIT,
            RG_ITEM.RAW_RABBIT.id,
            RG_ITEM.SULPHUR_DUST.id,
            RG_ITEM.LIMESTONE.id
        ]);
        expect(name(step)).toContain('Arandar');
    });

    // Why: the mainland half is keyed on the same pack, so the same snapshot with a mainland tile has to pick up where the forest left off.
    const onMainland = (carried: Stack[]): QuestStep =>
        decide(snapshot({ stage: RG_STAGE.SPOKEN_IORWERTH2, tile: ARDOUGNE, carried: [...KIT, ...carried] }));

    const CARRIED_OUT: Stack[] = [RG_ITEM.CLOTH.id, RG_ITEM.POT.id, RG_ITEM.BARREL_TAR.id, RG_ITEM.SULPHUR_DUST.id];

    test('the raw rabbit is cooked before anything else on the mainland', () => {
        expect(name(onMainland([...CARRIED_OUT, RG_ITEM.RAW_RABBIT.id, RG_ITEM.LIMESTONE.id]))).toContain('cook');
    });

    test('the limestone is burned at a furnace the forest does not have', () => {
        const step = onMainland([...CARRIED_OUT, RG_ITEM.COOKED_RABBIT.id, RG_ITEM.LIMESTONE.id]);
        expect(name(step)).toContain('burn the limestone');
    });

    test('the quicklime is ground into the pot carried out of the forest', () => {
        const step = onMainland([...CARRIED_OUT, RG_ITEM.COOKED_RABBIT.id, RG_ITEM.QUICKLIME.id]);
        expect(name(step)).toContain('grind the quicklime');
    });

    test('coal is sourced before the tar is distilled', () => {
        const step = onMainland([...CARRIED_OUT, RG_ITEM.COOKED_RABBIT.id, RG_ITEM.QUICKLIME_DUST.id]);
        expect(step.kind).toBe('mineRock');
        expect(step.kind === 'mineRock' && step.rock).toBe('Coal');
    });

    test('a pack with coal distils', () => {
        const step = onMainland([...CARRIED_OUT, RG_ITEM.COOKED_RABBIT.id, RG_ITEM.QUICKLIME_DUST.id, [RG_ITEM.COAL.id, 20]]);
        expect(name(step)).toContain('distil');
    });

    test('naphtha is mixed with the powders', () => {
        const step = onMainland([RG_ITEM.CLOTH.id, RG_ITEM.SULPHUR_DUST.id, RG_ITEM.QUICKLIME_DUST.id, RG_ITEM.BARREL_NAPHTHA.id, RG_ITEM.COOKED_RABBIT.id]);
        expect(name(step)).toContain('mix');
    });

    test('a half-mixed barrel is still the mixing step', () => {
        const step = onMainland([RG_ITEM.CLOTH.id, RG_ITEM.SULPHUR_DUST.id, RG_ITEM.MIX_QUICKLIME.id, RG_ITEM.COOKED_RABBIT.id]);
        expect(name(step)).toContain('mix');
    });

    test('a sealed barrel takes the fuse', () => {
        expect(name(onMainland([RG_ITEM.CLOTH.id, RG_ITEM.BARREL_LID.id, RG_ITEM.COOKED_RABBIT.id]))).toContain('fuse');
    });

    test('a fused bomb on the mainland walks back through the pass', () => {
        expect(name(onMainland([RG_ITEM.BARREL_FUSED.id, RG_ITEM.COOKED_RABBIT.id]))).toContain('Underground Pass');
    });

    // Why: `regicide_cross_over3` clears the given-rabbit bit inside mapsquare 34_49, which the walk to the catapult crosses — so the guard is fed after arriving, and never before setting out.
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
