import { describe, expect, test } from 'bun:test';
import { PC_ITEM } from '#/bot/api/ai/quests/defs/plaguecity/areas.js';
import { PC_STAGE } from '#/bot/api/ai/quests/defs/plaguecity/journal.js';
import { decide, plaguecity } from '#/bot/api/ai/quests/defs/plaguecity/index.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

const EAST = { x: 2616, z: 3332, level: 0 };
const WEST = { x: 2540, z: 3305, level: 0 };
const SEWER = { x: 2530, z: 9703, level: 0 };

const PURSE = new Map([[PC_ITEM.COINS.id, 100_000]]);

function snapshot(o: Partial<QuestSnapshot> = {}): QuestSnapshot {
    return {
        journal: o.journal ?? 'inProgress',
        inv: o.inv ?? new Map(),
        invIds: o.invIds ?? new Map(),
        worn: o.worn ?? new Set(),
        wornIds: o.wornIds ?? new Set(),
        noProgress: 0,
        bankCoins: o.bankCoins ?? 0,
        stage: o.stage,
        progress: o.progress,
        bank: o.bank ?? new Map(),
        bankIds: o.bankIds ?? PURSE,
        bankKnown: o.bankKnown ?? true,
        tile: o.tile === undefined ? EAST : o.tile,
        freeSlots: o.freeSlots ?? 28
    };
}

const carrying = (...items: [{ id: number }, number][]): Map<number, number> =>
    new Map(items.map(([item, qty]) => [item.id, qty]));

const name = (step: QuestStep): string => (step.kind === 'custom' ? step.name : step.kind);

const KIT = carrying([PC_ITEM.SPADE, 1], [PC_ITEM.GAS_MASK, 1]);

describe('plague city decide — terminal and guard cases', () => {
    test('a complete journal on the mainland is done', () => {
        expect(decide(snapshot({ journal: 'complete' })).kind).toBe('done');
    });

    test('a complete journal holding the reward scroll reads it before finishing', () => {
        const step = decide(snapshot({ journal: 'complete', invIds: carrying([PC_ITEM.ARDOUGNE_SCROLL, 1]) }));
        expect(name(step)).toBe('read the Ardougne teleport scroll');
    });

    test('a complete journal inside West Ardougne walks out first', () => {
        expect(name(decide(snapshot({ journal: 'complete', tile: WEST })))).toBe('walk back to East Ardougne');
    });

    test('an unloaded journal waits — it is not notStarted', () => {
        expect(decide(snapshot({ journal: 'unknown' })).kind).toBe('wait');
    });

    test('an unknown tile waits rather than guessing an area', () => {
        expect(decide(snapshot({ tile: null, stage: PC_STAGE.STARTED })).kind).toBe('wait');
    });

    test('an unreadable stage waits', () => {
        expect(decide(snapshot({ stage: undefined })).kind).toBe('wait');
    });

    test('a nearly full pack banks spillover before the next pickup', () => {
        const step = decide(snapshot({ stage: PC_STAGE.STARTED, freeSlots: 2 }));
        expect(step.kind).toBe('deposit');
    });
});

describe('plague city decide — East Ardougne', () => {
    test('stage 0 asks Edmond about his daughter', () => {
        expect(name(decide(snapshot({ stage: PC_STAGE.NOT_STARTED })))).toBe('ask Edmond about his daughter');
    });

    test('stage 1 fetches dwellberries, then hands them to Alrena', () => {
        const fetch = decide(snapshot({ stage: PC_STAGE.STARTED }));
        expect(fetch.kind).toBe('grabGround');
        expect(fetch.kind === 'grabGround' && fetch.item).toBe(PC_ITEM.DWELLBERRIES.name);
        const give = decide(snapshot({ stage: PC_STAGE.STARTED, invIds: carrying([PC_ITEM.DWELLBERRIES, 1]) }));
        expect(name(give)).toBe('give Alrena the dwellberries');
    });

    test('banked dwellberries are withdrawn rather than picked', () => {
        const step = decide(snapshot({
            stage: PC_STAGE.STARTED,
            bankIds: new Map([[PC_ITEM.DWELLBERRIES.id, 3]])
        }));
        expect(step.kind).toBe('withdraw');
    });

    test('stage 2 asks Edmond about the way in', () => {
        expect(name(decide(snapshot({ stage: PC_STAGE.GASMASK })))).toBe('ask Edmond about the way into West Ardougne');
    });

    test('the water block sources a bucket, fills it, then pours it', () => {
        const empty = decide(snapshot({ stage: PC_STAGE.MUD_START, bankIds: new Map() }));
        expect(empty.kind).toBe('grabGround');
        const fill = decide(snapshot({ stage: PC_STAGE.MUD_START, invIds: carrying([PC_ITEM.BUCKET, 2]) }));
        expect(name(fill)).toBe('fill buckets at the Ardougne fountain');
        const pour = decide(snapshot({ stage: PC_STAGE.MUD_START, invIds: carrying([PC_ITEM.BUCKET_WATER, 2]) }));
        expect(name(pour)).toBe('pour water on the garden soil');
    });

    test('a stocked bank fills the pack with buckets in one trip', () => {
        const step = decide(snapshot({
            stage: PC_STAGE.MUD_START,
            bankIds: new Map([[PC_ITEM.BUCKET.id, 9]])
        }));
        expect(step.kind === 'withdraw' && step.items[0].qty).toBe(4);
    });

    test('stage 7 needs a spade before it can dig', () => {
        const spade = decide(snapshot({ stage: PC_STAGE.MUD_SOFT, bankIds: new Map() }));
        expect(spade.kind === 'grabGround' && spade.item).toBe(PC_ITEM.SPADE.name);
        const dig = decide(snapshot({ stage: PC_STAGE.MUD_SOFT, invIds: carrying([PC_ITEM.SPADE, 1]) }));
        expect(name(dig)).toBe('drop into the Ardougne sewer');
    });

    test('stage 8 buys the rope on the mainland and ties it in the sewer', () => {
        const buy = decide(snapshot({ stage: PC_STAGE.TUNNEL, invIds: carrying([PC_ITEM.COINS, 500]) }));
        expect(buy.kind === 'buy' && buy.item).toBe(PC_ITEM.ROPE.name);
        const tie = decide(snapshot({
            stage: PC_STAGE.TUNNEL,
            tile: SEWER,
            invIds: carrying([PC_ITEM.ROPE, 1])
        }));
        expect(name(tie)).toBe('tie the rope to the sewer grill');
    });

    test('the rope purse is withdrawn before the shop trip', () => {
        const step = decide(snapshot({ stage: PC_STAGE.TUNNEL }));
        expect(step.kind === 'withdraw' && step.items[0].name).toBe(PC_ITEM.COINS.name);
    });

    test('a rope carried into the sewer is tied without another shop trip', () => {
        const step = decide(snapshot({
            stage: PC_STAGE.ROPE_TIED,
            tile: SEWER,
            invIds: carrying([PC_ITEM.SPADE, 1])
        }));
        expect(name(step)).toBe('pull the grill off with Edmond');
    });

    test('stage 9 on the mainland digs back down rather than talking to the wrong Edmond', () => {
        const step = decide(snapshot({ stage: PC_STAGE.ROPE_TIED, invIds: carrying([PC_ITEM.SPADE, 1]) }));
        expect(name(step)).toBe('drop into the Ardougne sewer');
    });

    test('stage 28 reports back to Edmond', () => {
        expect(name(decide(snapshot({ stage: PC_STAGE.FREED_ELENA })))).toBe('tell Edmond his daughter is safe');
    });
});

describe('plague city decide — crossing into West Ardougne', () => {
    test('the picture comes off the floor of Edmond house before the crossing', () => {
        const step = decide(snapshot({ stage: PC_STAGE.PIPE_OPEN, bankIds: new Map(), invIds: KIT }));
        expect(step.kind === 'grabGround' && step.item).toBe(PC_ITEM.PICTURE.name);
    });

    test('a missing gas mask is searched out of the cupboard, never skipped', () => {
        const step = decide(snapshot({
            stage: PC_STAGE.PIPE_OPEN,
            bankIds: new Map(),
            invIds: carrying([PC_ITEM.PICTURE, 1], [PC_ITEM.SPADE, 1])
        }));
        expect(name(step)).toBe("search Alrena's cupboard for the spare gas mask");
    });

    test('a worn gas mask counts as held', () => {
        const step = decide(snapshot({
            stage: PC_STAGE.PIPE_OPEN,
            bankIds: new Map(),
            invIds: carrying([PC_ITEM.PICTURE, 1], [PC_ITEM.SPADE, 1]),
            wornIds: new Set([PC_ITEM.GAS_MASK.id])
        }));
        expect(name(step)).toBe('cross into West Ardougne');
    });

    test('the full kit crosses, and Jethick is asked once inside', () => {
        const cross = decide(snapshot({
            stage: PC_STAGE.PIPE_OPEN,
            invIds: new Map([...KIT, [PC_ITEM.PICTURE.id, 1]])
        }));
        expect(name(cross)).toBe('cross into West Ardougne');
        const ask = decide(snapshot({
            stage: PC_STAGE.PIPE_OPEN,
            tile: WEST,
            invIds: new Map([...KIT, [PC_ITEM.PICTURE.id, 1]])
        }));
        expect(name(ask)).toBe("show Jethick Elena's picture");
    });
});

describe('plague city decide — West Ardougne', () => {
    const west = (stage: number, invIds = new Map<number, number>()): QuestStep =>
        decide(snapshot({ stage, tile: WEST, invIds }));

    test('stage 20 returns the book when it is carried and asks for another when it is not', () => {
        expect(name(west(PC_STAGE.SHOWN_PICTURE, carrying([PC_ITEM.TURNIP_BOOK, 1]))))
            .toBe("return Jethick's book to the Rehnisons");
        expect(name(west(PC_STAGE.SHOWN_PICTURE))).toBe('ask Jethick for the book again');
    });

    test('stages 21 to 23 walk the Rehnison chain and then the plague house door', () => {
        expect(name(west(PC_STAGE.RETURNED_BOOK))).toBe('ask the Rehnisons about Elena');
        expect(name(west(PC_STAGE.SPOKEN_PARENTS))).toBe('ask Milli what she saw');
        expect(name(west(PC_STAGE.SPOKEN_MILLI))).toBe('ask the mourner about the plague house');
    });

    test('both clearance stages run the one clerk-then-Bravek leg', () => {
        expect(name(west(PC_STAGE.NEED_CLEARANCE))).toBe('get an audience with Bravek');
        expect(name(west(PC_STAGE.SPOKEN_CLERK))).toBe('get an audience with Bravek');
    });

    test('stage 27 rescues Elena with the warrant and asks for another without one', () => {
        expect(name(west(PC_STAGE.CURED_BRAVEK, carrying([PC_ITEM.WARRANT, 1]))))
            .toBe('free Elena from the plague house');
        expect(name(west(PC_STAGE.CURED_BRAVEK))).toBe('ask Bravek for another warrant');
    });

    test('a banked warrant is enough to head for the plague house', () => {
        const step = decide(snapshot({
            stage: PC_STAGE.CURED_BRAVEK,
            tile: WEST,
            bankIds: new Map([[PC_ITEM.WARRANT.id, 1]])
        }));
        expect(name(step)).toBe('free Elena from the plague house');
    });
});

describe('plague city decide — the hangover cure chain', () => {
    const cure = (invIds: Map<number, number>): QuestStep =>
        decide(snapshot({ stage: PC_STAGE.SPOKEN_BRAVEK, invIds }));

    test('an empty pack buys the chocolate bar first', () => {
        const step = cure(carrying([PC_ITEM.COINS, 500]));
        expect(step.kind === 'buy' && step.item).toBe(PC_ITEM.CHOCOLATE_BAR.name);
    });

    test('a bar without a pestle buys the pestle', () => {
        const step = cure(carrying([PC_ITEM.COINS, 500], [PC_ITEM.CHOCOLATE_BAR, 1]));
        expect(step.kind === 'buy' && step.item).toBe(PC_ITEM.PESTLE.name);
    });

    test('bar plus pestle grinds the dust', () => {
        const step = cure(carrying([PC_ITEM.COINS, 500], [PC_ITEM.CHOCOLATE_BAR, 1], [PC_ITEM.PESTLE, 1]));
        expect(step.kind === 'useOn' && step.product).toBe(PC_ITEM.CHOCOLATE_DUST.name);
    });

    test('dust without milk milks a cow, and with milk mixes chocolaty milk', () => {
        const milk = cure(carrying([PC_ITEM.CHOCOLATE_DUST, 1], [PC_ITEM.BUCKET, 1]));
        expect(milk.kind === 'useOn' && milk.product).toBe(PC_ITEM.BUCKET_MILK.name);
        const mix = cure(carrying([PC_ITEM.CHOCOLATE_DUST, 1], [PC_ITEM.BUCKET_MILK, 1]));
        expect(mix.kind === 'useOn' && mix.product).toBe(PC_ITEM.CHOCOLATY_MILK.name);
    });

    test('chocolaty milk fetches snape grass, then finishes the cure', () => {
        const grass = cure(carrying([PC_ITEM.CHOCOLATY_MILK, 1]));
        expect(grass.kind === 'grabGround' && grass.item).toBe(PC_ITEM.SNAPE_GRASS.name);
        const finish = cure(carrying([PC_ITEM.CHOCOLATY_MILK, 1], [PC_ITEM.SNAPE_GRASS, 1]));
        expect(finish.kind === 'useOn' && finish.product).toBe(PC_ITEM.HANGOVER_CURE.name);
    });

    test('a finished cure is carried to Bravek', () => {
        const step = decide(snapshot({
            stage: PC_STAGE.SPOKEN_BRAVEK,
            tile: WEST,
            invIds: carrying([PC_ITEM.HANGOVER_CURE, 1])
        }));
        expect(name(step)).toBe('give Bravek the hangover cure');
    });
});

describe('plaguecity module', () => {
    test('it owns its inventory and banks in north Ardougne', () => {
        expect(plaguecity.record.id).toBe('elena');
        expect(plaguecity.ownsInventory).toBe(true);
        expect(plaguecity.record.items).toEqual([]);
        expect(plaguecity.bank).toEqual({ x: 2616, z: 3332, level: 0 } as never);
    });
});
