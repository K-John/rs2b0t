import { describe, expect, test } from 'bun:test';

import { LQ_ID, LQ_STAGE, LQ_TILE, inJungleBand, inOctagram, jungleSection, legendsArea } from '#/bot/api/ai/quests/defs/legends/areas.js';
import { decide, legends } from '#/bot/api/ai/quests/defs/legends/index.js';
import { legendsPocket } from '#/bot/api/ai/quests/defs/legends/pockets.js';
import { KEEP_IDS, LQ_FOODS } from '#/bot/api/ai/quests/defs/legends/supplies.js';
import { QUEST_DEFS } from '#/bot/api/ai/quests/defs/index.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

interface SnapOpts {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    inv?: string[];
    invIds?: number[];
    worn?: string[];
    wornIds?: number[];
    bank?: string[];
    bankIds?: number[];
    bankKnown?: boolean;
    tile?: { x: number; z: number; level: number } | null;
}

function counts(names: string[]): Map<string, number> {
    const out = new Map<string, number>();
    for (const name of names) {
        const key = name.toLowerCase();
        out.set(key, (out.get(key) ?? 0) + 1);
    }
    return out;
}

function ids(list: number[]): Map<number, number> {
    const out = new Map<number, number>();
    for (const id of list) {
        out.set(id, (out.get(id) ?? 0) + 1);
    }
    return out;
}

/** Karamja's open ground, where every bank and shop leg is allowed to start. */
const KARAMJA = { x: 2850, z: 2960, level: 0 };

/** Everything the module asks a booth for, so the kit branches fall through. */
const FULL_KIT = [
    LQ_ID.RUNE_AXE, LQ_ID.MACHETE, LQ_ID.LOCKPICK, LQ_ID.UNPOWERED_ORB, LQ_ID.RUNE_PICKAXE,
    LQ_ID.HAMMER, LQ_ID.KNIFE, LQ_ID.ROPE, LQ_ID.CHISEL, LQ_ID.VIAL_WATER,
    LQ_ID.SOUL_RUNE, LQ_ID.MIND_RUNE, LQ_ID.EARTH_RUNE, LQ_ID.LAW_RUNE, LQ_ID.LAW_RUNE,
    LQ_ID.OPAL, LQ_ID.JADE, LQ_ID.RED_TOPAZ, LQ_ID.SAPPHIRE, LQ_ID.EMERALD, LQ_ID.RUBY, LQ_ID.DIAMOND,
    LQ_ID.COSMIC_RUNE, LQ_ID.COSMIC_RUNE, LQ_ID.COSMIC_RUNE,
    ...Array.from({ length: 30 }, () => LQ_ID.WATER_RUNE),
    LQ_ID.GOLD_BAR, LQ_ID.GOLD_BAR, LQ_ID.PAPYRUS, LQ_ID.PAPYRUS, LQ_ID.PAPYRUS, LQ_ID.PAPYRUS, LQ_ID.PAPYRUS, LQ_ID.PAPYRUS,
    LQ_ID.CHARCOAL, LQ_ID.CHARCOAL, LQ_ID.CHARCOAL, LQ_ID.CHARCOAL, LQ_ID.CHARCOAL, LQ_ID.CHARCOAL
];

const WORN_KIT = [LQ_ID.RUNE_SCIMITAR, 1113, 1079, 1163, 1201, 1704];

function snap(o: SnapOpts = {}): QuestSnapshot {
    return {
        journal: o.journal ?? 'inProgress',
        inv: counts(o.inv ?? []),
        invIds: ids(o.invIds ?? []),
        worn: new Set((o.worn ?? []).map(n => n.toLowerCase())),
        wornIds: new Set(o.wornIds ?? WORN_KIT),
        noProgress: 0,
        bankCoins: 0,
        stage: o.stage,
        bank: counts(o.bank ?? []),
        bankIds: ids(o.bankIds ?? []),
        bankKnown: o.bankKnown ?? true,
        tile: (o.tile ?? KARAMJA) as QuestSnapshot['tile'],
        freeSlots: 8
    };
}

/** Kitted out on Karamja: coins, food and every sourceable item already in the pack. */
function kitted(o: SnapOpts = {}): QuestSnapshot {
    return snap({
        ...o,
        inv: [...(o.inv ?? []), ...Array.from({ length: 60_000 }, () => 'Coins').slice(0, 1), ...Array.from({ length: 14 }, () => 'Lobster')],
        invIds: [...(o.invIds ?? []), ...FULL_KIT, ...Array.from({ length: 60_000 }, () => LQ_ID.COINS).slice(0, 1)]
    });
}

const name = (step: QuestStep): string => (step.kind === 'custom' ? `custom:${step.name}` : step.kind);

describe('legendsArea', () => {
    test('the Kharazi Jungle is its own world', () => {
        expect(legendsArea({ x: 2790, z: 2910, level: 0 })).toBe('jungle');
        expect(legendsArea({ x: 2790, z: 2960, level: 0 })).toBe('mainland');
    });

    test('the shaman caves and the Viyeldi caves are separate complexes', () => {
        expect(legendsArea({ x: 2773, z: 9341, level: 0 })).toBe('shamanCaves');
        expect(legendsArea({ x: 2400, z: 4710, level: 0 })).toBe('viyeldiCaves');
    });

    test('a missing tile is unknown rather than mainland', () => {
        expect(legendsArea(null)).toBe('unknown');
    });

    test('the jungle splits into the three thirds the map is drawn in', () => {
        expect(jungleSection({ x: 2790, z: 2910, level: 0 })).toBe('west');
        expect(jungleSection({ x: 2840, z: 2910, level: 0 })).toBe('middle');
        expect(jungleSection({ x: 2900, z: 2910, level: 0 })).toBe('east');
        expect(jungleSection({ x: 2790, z: 2960, level: 0 })).toBeNull();
    });
});

describe('inJungleBand', () => {
    test('covers the three blocked rows and neither open tile', () => {
        expect(inJungleBand({ x: 2816, z: 2936, level: 0 })).toBe(false);
        expect(inJungleBand({ x: 2816, z: 2937, level: 0 })).toBe(true);
        expect(inJungleBand({ x: 2816, z: 2939, level: 0 })).toBe(true);
        expect(inJungleBand({ x: 2816, z: 2940, level: 0 })).toBe(false);
    });
});

describe('inOctagram', () => {
    test('the wall tile is outside and the tile past it is inside', () => {
        expect(inOctagram(LQ_TILE.OCTAGRAM_OUTSIDE)).toBe(false);
        expect(inOctagram(LQ_TILE.OCTAGRAM_INSIDE)).toBe(true);
    });

    test("Ungadulu's own tile is inside", () => {
        expect(inOctagram({ x: 2792, z: 9327, level: 0 })).toBe(true);
    });
});

describe('legendsPocket', () => {
    // Why: every one of these is a crossing the module drives, so a tile that lands in the wrong pocket runs the wrong leg.
    const CASES: readonly [string, number, number, string | null][] = [
        ['the cave landing', 2773, 9341, 'shamanCave'],
        ['inside the flames', 2792, 9328, 'octagram'],
        ['past the bookcase crevice', 2800, 9340, 'crevice'],
        ['north of the outer gate', 2809, 9333, 'crevice'],
        ['south of the outer gate', 2809, 9331, 'outerGate'],
        ['between the first two boulders', 2809, 9325, 'boulderOne'],
        ['between the last two boulders', 2809, 9321, 'boulderTwo'],
        ['north of the inner gate', 2809, 9315, 'innerGate'],
        ['south of the inner gate', 2809, 9313, 'trials'],
        ['south of the jagged wall', 2790, 9295, 'trials'],
        ['north of the jagged wall', 2789, 9296, 'wallRoom'],
        ['the gem room', 2774, 9301, 'gemRoom'],
        ['the winch room', 2760, 9328, 'winchRoom'],
        ['the rope landing', 2377, 4712, 'viyeldiLedge'],
        ['the Viyeldi cave floor', 2400, 4710, 'viyeldiMain'],
        ['past the barrier', 2387, 4689, 'viyeldiSource'],
        ['open jungle', 2790, 2910, null]
    ];
    for (const [label, x, z, want] of CASES) {
        test(`${label} is ${want ?? 'open ground'}`, () => {
            expect(legendsPocket({ x, z, level: 0 })).toBe(want as never);
        });
    }
});

describe('Legends Quest decide', () => {
    test('a complete journal is done', () => {
        expect(decide(snap({ journal: 'complete' })).kind).toBe('done');
    });

    test('an unloaded journal waits rather than restarting the quest', () => {
        expect(decide(snap({ journal: 'unknown' })).kind).toBe('wait');
    });

    test('an unreadable stage waits', () => {
        expect(decide(snap({ stage: undefined })).kind).toBe('wait');
    });

    test('a complete quest still climbs out of the caves before it stops', () => {
        const step = decide(snap({ journal: 'complete', tile: { x: 2774, z: 9301, level: 0 } }));
        expect(name(step)).toBe('custom:climb back out of the caves');
    });

    test('not started asks Radimus for the quest', () => {
        const step = decide(snap({ journal: 'notStarted', stage: LQ_STAGE.NOT_STARTED }));
        expect(name(step)).toBe('custom:ask Radimus Erkle for the quest');
    });

    test('started with no machete takes one from the cupboard', () => {
        const step = decide(snap({ stage: LQ_STAGE.STARTED }));
        expect(name(step)).toBe("custom:take the machete from Radimus' cupboard");
    });

    test('started with the kit maps the jungle', () => {
        const step = decide(kitted({ stage: LQ_STAGE.STARTED }));
        expect(name(step)).toBe('custom:map all three thirds of the Kharazi Jungle');
    });

    test('a mapped jungle trades the copy for the bull roarer', () => {
        const step = decide(kitted({ stage: LQ_STAGE.MAPPED_JUNGLE }));
        expect(name(step)).toBe('custom:trade a copy of the map for the bull roarer');
    });

    test('with the roarer in hand the next step is Gujuo', () => {
        const step = decide(kitted({ stage: LQ_STAGE.GOT_BULLROARER, invIds: [LQ_ID.BULLROARER] }));
        expect(name(step)).toBe('custom:swing the bull roarer and befriend Gujuo');
    });

    test('the rescue stage goes to the shaman cave', () => {
        const step = decide(kitted({ stage: LQ_STAGE.ACCEPTED_RESCUE, invIds: [LQ_ID.BULLROARER] }));
        expect(name(step)).toBe('custom:find Ungadulu and talk through the flames');
    });

    test('after Ungadulu the quest asks Gujuo about the water', () => {
        const step = decide(kitted({ stage: LQ_STAGE.SPOKE_UNGADULU, invIds: [LQ_ID.BULLROARER] }));
        expect(name(step)).toBe('custom:ask Gujuo where the sacred water is');
    });

    test('with the sketch and two bars the bowl is forged', () => {
        const step = decide(kitted({ stage: LQ_STAGE.ASKED_GUJUO_WATER, invIds: [LQ_ID.GOLD_BOWL_SKETCH] }));
        expect(name(step)).toBe('custom:hammer two gold bars into a golden bowl');
    });

    test('an unblessed bowl goes to Gujuo', () => {
        const step = decide(kitted({ stage: LQ_STAGE.ASKED_GUJUO_WATER, invIds: [LQ_ID.GOLD_BOWL] }));
        expect(name(step)).toBe('custom:have Gujuo bless the golden bowl');
    });

    test('a blessed bowl and no reed cuts one', () => {
        const step = decide(kitted({ stage: LQ_STAGE.ASKED_GUJUO_WATER, invIds: [LQ_ID.GOLD_BOWL_BLESSED] }));
        expect(name(step)).toBe('custom:cut a hollow reed at the sacred pool');
    });

    test('a reed and a blessed bowl fill it at the pool', () => {
        const step = decide(kitted({ stage: LQ_STAGE.ASKED_GUJUO_WATER, invIds: [LQ_ID.GOLD_BOWL_BLESSED, LQ_ID.HOLLOW_REED] }));
        expect(name(step)).toBe('custom:syphon the sacred pool into the blessed bowl');
    });

    test('a full bowl and no book goes down the trials', () => {
        const step = decide(kitted({ stage: LQ_STAGE.FILLED_BOWL, invIds: [LQ_ID.GOLD_BOWL_BLESSED_PURE] }));
        expect(name(step)).toBe('custom:fetch the Book of Binding from the gem room');
    });

    test('book plus water opens it on Ungadulu', () => {
        const step = decide(kitted({
            stage: LQ_STAGE.FILLED_BOWL,
            invIds: [LQ_ID.GOLD_BOWL_BLESSED_PURE, LQ_ID.BOOK_OF_BINDING]
        }));
        expect(name(step)).toBe('custom:open the Book of Binding on Ungadulu');
    });

    test('the freed shaman is asked for seeds', () => {
        const step = decide(kitted({ stage: LQ_STAGE.DEFEATED_NEZI_FIRE }));
        expect(name(step)).toBe('custom:ask Ungadulu for the Yommi tree seeds');
    });

    test('raw seeds and a full bowl germinate', () => {
        const step = decide(kitted({
            stage: LQ_STAGE.DEFEATED_NEZI_FIRE,
            invIds: [LQ_ID.YOMMI_SEEDS, LQ_ID.GOLD_BOWL_BLESSED_PURE]
        }));
        expect(name(step)).toBe('custom:germinate the seeds in the bowl of sacred water');
    });

    test('germinated seeds go looking for the fouled pool', () => {
        const step = decide(kitted({ stage: LQ_STAGE.GERMINATED_SEEDS, invIds: [LQ_ID.YOMMI_SEEDS_GERM] }));
        expect(name(step)).toBe('custom:find the sacred pool fouled');
    });

    test('a dried pool asks Gujuo for the potion recipe', () => {
        const step = decide(kitted({ stage: LQ_STAGE.POOL_DRIED }));
        expect(name(step)).toBe('custom:ask Gujuo for the bravery potion recipe');
    });

    test('the potion stage picks the first herb it is missing', () => {
        const step = decide(kitted({ stage: LQ_STAGE.TALK_GUJUO_POOL }));
        expect(name(step)).toBe('custom:pick the Snake weed');
    });

    test('an unidentified herb is identified before the next one is picked', () => {
        const step = decide(kitted({ stage: LQ_STAGE.TALK_GUJUO_POOL, invIds: [LQ_ID.UNID_SNAKE_WEED] }));
        expect(name(step)).toBe('custom:identify the Snake weed');
    });

    test('both herbs and a vial mix the snakeweed first', () => {
        const step = decide(kitted({
            stage: LQ_STAGE.TALK_GUJUO_POOL,
            invIds: [LQ_ID.SNAKE_WEED, LQ_ID.ARDRIGAL]
        }));
        expect(step.kind).toBe('useOn');
    });

    test('a mixture and ardrigal finish the potion', () => {
        const step = decide(kitted({
            stage: LQ_STAGE.TALK_GUJUO_POOL,
            invIds: [LQ_ID.SNAKEWEED_MIXTURE, LQ_ID.ARDRIGAL]
        }));
        expect(step.kind).toBe('useOn');
        expect(step.kind === 'useOn' && step.product).toBe('Bravery potion');
    });

    test('the potion in the pack climbs down the winch', () => {
        const step = decide(kitted({ stage: LQ_STAGE.TALK_GUJUO_POOL, invIds: [LQ_ID.BRAVERY_POTION] }));
        expect(name(step)).toBe('custom:climb down the winch into the Viyeldi caves');
    });

    test('the lower dungeon fights the three guardians', () => {
        const step = decide(kitted({ stage: LQ_STAGE.ENTER_LOWER_DUNGEON, tile: { x: 2400, z: 4710, level: 0 } }));
        expect(name(step)).toBe('custom:take the dragon heart off the three guardians');
    });

    test('a fused heart is charged on the dragon eye', () => {
        const step = decide(kitted({
            stage: LQ_STAGE.CRYSTAL_SMELTED,
            invIds: [LQ_ID.HEART_CRYSTAL],
            tile: { x: 2400, z: 4710, level: 0 }
        }));
        expect(name(step)).toBe("custom:charge the heart on the dragon's eye");
    });

    test('a glowing heart goes into the recess', () => {
        const step = decide(kitted({
            stage: LQ_STAGE.CRYSTAL_SMELTED,
            invIds: [LQ_ID.HEART_CRYSTAL_GLOW],
            tile: { x: 2400, z: 4710, level: 0 }
        }));
        expect(name(step)).toBe('custom:slot the glowing heart into the recess');
    });

    test('the black dagger goes up to Ungadulu rather than into Viyeldi', () => {
        const step = decide(kitted({
            stage: LQ_STAGE.RECEIVED_DAGGER,
            invIds: [LQ_ID.DEATH_DAGGER],
            tile: { x: 2387, z: 4689, level: 0 }
        }));
        expect(name(step)).toBe('custom:take the black dagger to Ungadulu');
    });

    test('the Holy Force is read at the spirit', () => {
        const step = decide(kitted({
            stage: LQ_STAGE.RECEIVED_DAGGER,
            invIds: [LQ_ID.HOLY_FORCE],
            tile: { x: 2387, z: 4689, level: 0 }
        }));
        expect(name(step)).toBe('custom:read the Holy Force at the spirit and kill it');
    });

    test('the source is bottled once the demon is down', () => {
        const step = decide(kitted({
            stage: LQ_STAGE.DEFEATED_NEZI_WATER,
            invIds: [LQ_ID.GOLD_BOWL_BLESSED],
            tile: { x: 2387, z: 4689, level: 0 }
        }));
        expect(name(step)).toBe('custom:shift the boulder and fill the bowl at the source');
    });

    test('sacred water and germinated seeds grow the tree', () => {
        const step = decide(kitted({
            stage: LQ_STAGE.SACRED_WATER,
            invIds: [LQ_ID.GOLD_BOWL_BLESSED_PURE, LQ_ID.YOMMI_SEEDS_GERM]
        }));
        expect(name(step)).toBe('custom:grow a Yommi tree and carve a totem pole');
    });

    test('a carved pole is taken to an evil totem', () => {
        const step = decide(kitted({ stage: LQ_STAGE.COLLECTED_TOTEM, invIds: [LQ_ID.TOTEM_POLE] }));
        expect(name(step)).toBe('custom:replace the evil totem and kill what comes out');
    });

    test('with the pole gone the gift comes from Gujuo', () => {
        const step = decide(kitted({ stage: LQ_STAGE.DEFEATED_NEZI_FINAL }));
        expect(name(step)).toBe('custom:collect the gilded totem from Gujuo');
    });

    test('the gilded totem goes back to Radimus', () => {
        const step = decide(kitted({ stage: LQ_STAGE.GOT_GILDED_TOTEM, invIds: [LQ_ID.GILDED_TOTEM] }));
        expect(name(step)).toBe('custom:take the gilded totem to Radimus');
    });

    test('the last stages take the four training sessions', () => {
        for (const stage of [LQ_STAGE.RETURNED_TO_RADIMUS, LQ_STAGE.TRAINING_1, LQ_STAGE.TRAINING_2, LQ_STAGE.TRAINING_3, LQ_STAGE.TRAINING_4]) {
            expect(name(decide(kitted({ stage })))).toBe("custom:take Radimus' four training sessions");
        }
    });

    // Why: `jungle_tree` boils a filled bowl dry on every chop, so the last errand off the island runs before the pool.
    test('the trials kit is fetched before the bowl is filled', () => {
        const jungle = { x: 2820, z: 2915, level: 0 };
        const bare = snap({ stage: LQ_STAGE.FILLED_BOWL, invIds: [LQ_ID.GOLD_BOWL_BLESSED], tile: jungle });
        expect(name(decide(bare))).toBe('custom:cut back out of the Kharazi Jungle');
        const ready = kitted({ stage: LQ_STAGE.FILLED_BOWL, invIds: [LQ_ID.GOLD_BOWL_BLESSED, LQ_ID.BOOK_OF_BINDING], tile: jungle });
        expect(name(decide(ready))).toBe('custom:cut a hollow reed at the sacred pool');
    });

    test('a filled bowl on the mainland is never sent back to a booth', () => {
        const step = decide(kitted({ stage: LQ_STAGE.FILLED_BOWL, invIds: [LQ_ID.GOLD_BOWL_BLESSED_PURE] }));
        expect(name(step)).toBe('custom:fetch the Book of Binding from the gem room');
    });

    // Why: three aggressive guardians wait at the bottom of the winch and the trials float of five lobsters is what died to them.
    test('the winch stages take the fight float, not the trials one', () => {
        const lean = snap({
            stage: LQ_STAGE.ENTER_LOWER_DUNGEON,
            invIds: [LQ_ID.RUNE_AXE],
            bank: Array.from({ length: 30 }, () => 'Lobster')
        });
        const step = decide({ ...lean, freeSlots: 12 });
        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items[0]?.qty).toBe(10);
    });

    // Why: a death drops the machete and the axe, and every leg past the map has to cross the band to get anywhere.
    test('a lost machete is replaced like food', () => {
        const lean = snap({
            stage: LQ_STAGE.DEFEATED_NEZI_FIRE,
            invIds: [LQ_ID.RUNE_AXE],
            inv: [...Array.from({ length: 14 }, () => 'Lobster')],
            bankIds: [LQ_ID.MACHETE]
        });
        const step = decide(lean);
        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items[0]?.name).toBe('Machete');
    });

    // Why: the octagram demon is level 187 with 150 hitpoints and the trials float of five lobsters is what died to him.
    test('the book in the pack raises the float to the fight numbers', () => {
        const lean = snap({
            stage: LQ_STAGE.FILLED_BOWL,
            invIds: [LQ_ID.GOLD_BOWL_BLESSED, LQ_ID.BOOK_OF_BINDING],
            bank: Array.from({ length: 30 }, () => 'Lobster')
        });
        const step = decide({ ...lean, freeSlots: 12 });
        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items[0]?.qty).toBe(10);
        // Why: the ask is what the pack can take rather than what the leg wanted — after a death the whole kit comes back at once and ten lobsters have nowhere to go.
        const tight = decide({ ...lean, freeSlots: 3 });
        expect(tight.kind === 'withdraw' && tight.items[0]?.qty).toBe(3);
    });

    // Why: the outer gate shuts behind whoever picked it and the boulders drop back down, so a second descent is paid for in full.
    test('a re-descent fetches the lockpick and pickaxe again', () => {
        const kit = [LQ_ID.RUNE_AXE, LQ_ID.MACHETE, LQ_ID.YOMMI_SEEDS_GERM, LQ_ID.UNPOWERED_ORB, LQ_ID.COSMIC_RUNE, LQ_ID.COSMIC_RUNE, LQ_ID.COSMIC_RUNE];
        const lean = snap({
            stage: LQ_STAGE.SACRED_WATER,
            invIds: [...kit, ...Array.from({ length: 30 }, () => LQ_ID.WATER_RUNE)],
            inv: [...Array.from({ length: 14 }, () => 'Lobster')],
            bankIds: [LQ_ID.LOCKPICK, LQ_ID.RUNE_PICKAXE]
        });
        const step = decide(lean);
        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items[0]?.name).toBe('Lockpick');
    });

    // Why: the Holy Force trade happens inside the octagram, and the descent it is followed by has not been paid for yet.
    test('a leg that starts beside Ungadulu still fetches the descent kit', () => {
        const octagram = { x: 2792, z: 9327, level: 0 };
        const lean = snap({
            stage: LQ_STAGE.DEFEATED_NEZI_WATER,
            invIds: [LQ_ID.RUNE_AXE, LQ_ID.MACHETE, LQ_ID.GOLD_BOWL_BLESSED],
            inv: [...Array.from({ length: 14 }, () => 'Lobster')],
            bankIds: [LQ_ID.LOCKPICK, LQ_ID.UNPOWERED_ORB],
            tile: octagram
        });
        expect(name(decide(lean))).toBe('custom:climb back out of the caves');
    });

    // Why: the magic gate eats the orb as it lets you through, so the same check made from the winch room turns a finished descent back round.
    test('a spent orb below the gate does not send the run back up for another', () => {
        const winchRoom = { x: 2763, z: 9320, level: 0 };
        const lean = snap({
            stage: LQ_STAGE.SACRED_WATER,
            invIds: [LQ_ID.RUNE_AXE, LQ_ID.MACHETE, LQ_ID.YOMMI_SEEDS_GERM, LQ_ID.LOCKPICK, LQ_ID.RUNE_PICKAXE],
            inv: [...Array.from({ length: 14 }, () => 'Lobster')],
            bankIds: [LQ_ID.UNPOWERED_ORB],
            tile: winchRoom
        });
        expect(name(decide(lean))).toBe('custom:climb back down to the Viyeldi caves');
    });

    // Why: a full pack is the normal state of this quest, so only a pending withdraw is a reason to walk to a booth.
    test('a full pack alone does not send the run to a booth', () => {
        const pool = { x: 2836, z: 2917, level: 0 };
        const full = kitted({
            stage: LQ_STAGE.FILLED_BOWL,
            invIds: [LQ_ID.GOLD_BOWL_BLESSED, LQ_ID.BOOK_OF_BINDING, 2434, 2434],
            tile: pool
        });
        const step = decide({ ...full, freeSlots: 0 });
        expect(step.kind).toBe('custom');
        expect(step.kind).not.toBe('deposit');
    });

    // Why: a sketch, a spell and a set of seeds are all handed over into a pack that has to have room for them.
    test('a full pack drops the spent supplies rather than banking them', () => {
        const cave = { x: 2791, z: 9334, level: 0 };
        const full = kitted({
            stage: LQ_STAGE.RECEIVED_DAGGER,
            invIds: [LQ_ID.DEATH_DAGGER, 594, 594, 594],
            tile: cave
        });
        expect(name(decide({ ...full, freeSlots: 0 }))).toBe('custom:drop what the quest has finished with');
    });

    // Why: a withdraw decided with no room fails for ever, and the trials and the band both hand back things the keep list does not want.
    test('a full pack banks the junk at the booth the withdraw was going to', () => {
        const full = snap({
            stage: LQ_STAGE.SACRED_WATER,
            invIds: [LQ_ID.RUNE_AXE, LQ_ID.MACHETE, LQ_ID.YOMMI_SEEDS_GERM, 1511, 1511],
            inv: [...Array.from({ length: 14 }, () => 'Lobster')],
            bankIds: [LQ_ID.LOCKPICK, LQ_ID.UNPOWERED_ORB],
            bank: ['Coins']
        });
        expect(decide({ ...full, freeSlots: 0 }).kind).toBe('deposit');
        expect(decide({ ...full, freeSlots: 3 }).kind).toBe('withdraw');
    });

    // Why: a random event's gift takes the slot the reed wants, and nothing is walking to a bank to be rid of it.
    test('a full pack drops a random event gift when the step is not going to a bank', () => {
        const jungle = { x: 2836, z: 2917, level: 0 };
        const full = snap({
            stage: LQ_STAGE.ASKED_GUJUO_WATER,
            invIds: [LQ_ID.GOLD_BOWL_BLESSED, LQ_ID.MACHETE, LQ_ID.COINS, 4566],
            inv: [...Array.from({ length: 14 }, () => 'Lobster'), 'Coins'],
            tile: jungle
        });
        expect(name(decide({ ...full, freeSlots: 0 }))).toBe('custom:drop what the quest has no use for');
        expect(name(decide({ ...full, freeSlots: 3 }))).not.toBe('custom:drop what the quest has no use for');
    });

    // Why: twenty-eight wanted things leave no slot for the herb the step is about to pick, and there is nothing spent or junk to shed.
    test('a full pack of wanted things eats a lobster for the slot', () => {
        const jungle = { x: 2836, z: 2917, level: 0 };
        const full = snap({
            stage: LQ_STAGE.ASKED_GUJUO_WATER,
            invIds: [LQ_ID.GOLD_BOWL_BLESSED, LQ_ID.MACHETE, LQ_ID.COINS, LQ_ID.LOBSTER],
            inv: [...Array.from({ length: 14 }, () => 'Lobster'), 'Coins'],
            tile: jungle
        });
        expect(name(decide({ ...full, freeSlots: 0 }))).toBe('custom:eat a lobster to make room');
        expect(name(decide({ ...full, freeSlots: 3 }))).not.toBe('custom:eat a lobster to make room');
    });

    // Why: the book is gone from the pack once it is read, which is not the same as never having had it.
    test('the trials kit is not re-bought after the book has been read', () => {
        const jungle = { x: 2820, z: 2915, level: 0 };
        const bare = snap({
            stage: LQ_STAGE.DEFEATED_NEZI_FIRE,
            invIds: [LQ_ID.GOLD_BOWL_BLESSED, LQ_ID.YOMMI_SEEDS, LQ_ID.KNIFE],
            inv: [...Array.from({ length: 14 }, () => 'Lobster')],
            tile: jungle
        });
        expect(name(decide(bare))).toBe('custom:cut a hollow reed at the sacred pool');
    });

    // Why: every leg below the winch stands on a tile no surface path reaches, so a resumed run has to climb down before it acts.
    test('every Viyeldi leg descends first when the run is on the surface', () => {
        const surface = { x: 2800, z: 3000, level: 0 };
        const stages = [
            LQ_STAGE.ENTER_LOWER_DUNGEON,
            LQ_STAGE.CRYSTAL_SMELTED,
            LQ_STAGE.HEART_IN_RECESS,
            LQ_STAGE.PUSHED_BOULDER,
            LQ_STAGE.DEFEATED_NEZI_WATER
        ];
        for (const stage of stages) {
            const step = decide(kitted({ stage, invIds: [LQ_ID.GOLD_BOWL_BLESSED], tile: surface }));
            expect(name(step)).toBe('custom:climb back down to the Viyeldi caves');
        }
    });

    test('the dagger hand-in climbs up to Ungadulu rather than back down', () => {
        const surface = { x: 2800, z: 3000, level: 0 };
        const step = decide(kitted({ stage: LQ_STAGE.RECEIVED_DAGGER, invIds: [LQ_ID.DEATH_DAGGER], tile: surface }));
        expect(name(step)).toBe('custom:take the black dagger to Ungadulu');
    });

    // Why: a branch that acts from inside a sealed pocket sends the walker at a tile on the wrong side of a one-way crossing.
    test('every mainland leg escapes the caves first', () => {
        const inCaves = { x: 2774, z: 9301, level: 0 };
        for (const stage of [LQ_STAGE.NOT_STARTED, LQ_STAGE.GOT_GILDED_TOTEM, LQ_STAGE.TRAINING_1]) {
            const step = decide(kitted({ stage, invIds: [LQ_ID.GILDED_TOTEM, LQ_ID.YOMMI_SEEDS_GERM], tile: inCaves }));
            expect(name(step)).toBe('custom:climb back out of the caves');
        }
    });

    test('an unknown location waits rather than guessing', () => {
        const step = decide(snap({ stage: LQ_STAGE.STARTED, tile: { x: 100, z: 9000, level: 0 } }));
        expect(step.kind).toBe('wait');
    });
});

describe('the module', () => {
    test('is registered in the quest list', () => {
        expect(QUEST_DEFS.some(def => def.record.id === 'legends')).toBe(true);
    });

    test('owns its own inventory and carries no engine coin float', () => {
        expect(legends.ownsInventory).toBe(true);
        expect(legends.coinFloat).toBe(0);
    });

    test('eats lobster first', () => {
        expect(legends.sustain?.foods[0]).toBe('Lobster');
        expect(LQ_FOODS[0]).toBe('Lobster');
    });

    test('the keep list holds every quest item the deposit would otherwise lose', () => {
        for (const id of [LQ_ID.MAP, LQ_ID.MAP_COMPLETE, LQ_ID.BULLROARER, LQ_ID.GOLD_BOWL_BLESSED_PURE,
            LQ_ID.BOOK_OF_BINDING, LQ_ID.YOMMI_SEEDS_GERM, LQ_ID.HEART_CRYSTAL_GLOW, LQ_ID.DEATH_DAGGER,
            LQ_ID.HOLY_FORCE, LQ_ID.TOTEM_POLE, LQ_ID.GILDED_TOTEM, LQ_ID.RUNE_AXE, LQ_ID.LOCKPICK,
            LQ_ID.UNPOWERED_ORB, LQ_ID.COSMIC_RUNE]) {
            expect(KEEP_IDS).toContain(id);
        }
    });

    test('the record lists everything with no counter and no rock', () => {
        const wanted = legends.record.items.map(item => item.name);
        expect(wanted).toContain('Rune axe');
        expect(wanted).toContain('Lockpick');
        expect(wanted).toContain('Unpowered orb');
        expect(wanted).toContain('Cosmic rune');
        // Why: eligibility runs before a booth has ever been opened, so a `mustHave` would block the quest at startup.
        expect(legends.record.items.every(item => item.kind === 'acquirable')).toBe(true);
    });
});
