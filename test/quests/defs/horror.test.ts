import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { HD_ID, HD_STAGE } from '#/bot/quests/defs/horror/areas.js';
import { decide, horror } from '#/bot/quests/defs/horror/index.js';
import { FORM_ELEMENT, IMMUNE_FORMS, MOTHER_IDS, spellTier } from '#/bot/quests/defs/horror/fight.js';
import { HD_FLAG } from '#/bot/quests/defs/horror/journal.js';
import { NAILS_NEEDED, PLANKS_NEEDED } from '#/bot/quests/defs/horror/supplies.js';
import { QUEST_DEFS } from '#/bot/quests/defs/index.js';
import { QuestFood } from '#/bot/quests/food.js';
import type { QuestSnapshot, QuestStep } from '#/bot/quests/engine/types.js';

// QuestFood is a live module-level object several quest defs read, so restore it
// or this file silently changes whichever test file bun runs next.
const originalFood = QuestFood.name;
beforeAll(() => { QuestFood.name = 'Lobster'; });
afterAll(() => { QuestFood.name = originalFood; });

/** On the causeway by Larrissa: outside every sealed pocket. */
const CAUSEWAY = { x: 2508, z: 3634, level: 0 };
const QUEST_LIGHTHOUSE = { x: 2445, z: 4597, level: 0 };
const BASEMENT = { x: 2519, z: 4619, level: 1 };
const CAVERN = { x: 2518, z: 4634, level: 0 };

/** Fully kitted by default, so every case exercises the branch it names. */
function snap(options: {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    flags?: string[];
    invIds?: [number, number][];
    bankIds?: [number, number][];
    bankKnown?: boolean;
    food?: number;
    tile?: QuestSnapshot['tile'];
} = {}): QuestSnapshot {
    const stage = options.stage ?? HD_STAGE.NOT_STARTED;
    const flags = new Set(options.flags ?? []);
    const kitted: [number, number][] = [
        [HD_ID.COINS, 50_000],
        [HD_ID.HAMMER, 1],
        [HD_ID.TINDERBOX, 1],
        [HD_ID.SWAMP_TAR, 1],
        [HD_ID.MOLTEN_GLASS, 1],
        [HD_ID.DAGGER, 1],
        [HD_ID.ARROW, 5],
        [HD_ID.AIR_RUNE, 300],
        [HD_ID.WATER_RUNE, 200],
        [HD_ID.EARTH_RUNE, 200],
        [HD_ID.FIRE_RUNE, 250],
        [HD_ID.DEATH_RUNE, 150],
        [HD_ID.CHAOS_RUNE, 150]
    ];
    return {
        journal: options.journal ?? (stage === HD_STAGE.NOT_STARTED ? 'notStarted' : 'inProgress'),
        inv: new Map([['lobster', options.food ?? 15]]),
        invIds: new Map([...kitted, ...(options.invIds ?? [])]),
        worn: new Set(),
        wornIds: new Set(),
        noProgress: 0,
        bankCoins: 2_000_000,
        stage,
        progress: { stage, flags },
        bank: new Map(),
        bankIds: new Map(options.bankIds ?? []),
        bankKnown: options.bankKnown ?? true,
        tile: options.tile ?? CAUSEWAY,
        freeSlots: 6
    };
}

const step = (options: Parameters<typeof snap>[0] = {}): QuestStep => decide(snap(options));
const talkTo = (s: QuestStep): string | undefined => (s.kind === 'talk' ? s.stop.npc : undefined);
const customName = (s: QuestStep): string | undefined => (s.kind === 'custom' ? s.name : undefined);

describe('Horror from the Deep decide()', () => {
    test('waits while the journal is unknown', () => {
        // 'unknown' is not 'notStarted': the quest list is blank for a moment
        // after login, and restarting a finished quest is the worst outcome.
        expect(step({ journal: 'unknown' }).kind).toBe('wait');
    });

    test('is done once the journal is green', () => {
        expect(step({ journal: 'complete', stage: HD_STAGE.COMPLETE }).kind).toBe('done');
    });

    test('starts by talking to Larrissa', () => {
        expect(talkTo(step())).toBe('Larrissa');
    });

    test('tops the pack up with food before anything else', () => {
        const s = step({ stage: HD_STAGE.STARTED, food: 0 });
        expect(s.kind).toBe('withdraw');
    });

    test('never banks from inside a sealed pocket', () => {
        // Preparation stops at the door: a top-up mid-cavern walks the character
        // back out of a fight it cannot re-enter without redoing the wall.
        const s = step({ stage: HD_STAGE.DEFEATED_DAGJR, food: 0, tile: CAVERN });
        expect(s.kind).toBe('custom');
    });
});

describe('Horror from the Deep — the bridge', () => {
    const started = { stage: HD_STAGE.STARTED };

    test('buys a hammer before anything is smithed', () => {
        const s = step({ ...started, invIds: [[HD_ID.HAMMER, 0]] });
        expect(s.kind).toBe('buy');
        expect(s.kind === 'buy' && s.item).toBe('Hammer');
    });

    test('smiths the nails before fetching the planks', () => {
        // Strict order on purpose: the smithing leg banks the pack to make room
        // for ore, and a plank banked mid-leg is a plank fetched twice.
        const s = step(started);
        expect(customName(s)).toContain('nails');
    });

    test('fetches planks once the nails are in', () => {
        const s = step({ ...started, invIds: [[HD_ID.NAILS, NAILS_NEEDED]] });
        expect(s.kind).toBe('grabGround');
        expect(s.kind === 'grabGround' && s.item).toBe('Plank');
    });

    test('repairs the bridge once both are in', () => {
        const s = step({
            ...started,
            invIds: [[HD_ID.NAILS, NAILS_NEEDED], [HD_ID.PLANK, PLANKS_NEEDED]]
        });
        expect(customName(s)).toContain('bridge');
    });

    test('prefers banked nails to the anvil', () => {
        const s = step({ ...started, bankIds: [[HD_ID.NAILS, 100]] });
        expect(s.kind).toBe('withdraw');
    });

    test('scans the bank before deciding nothing is banked', () => {
        // An unread bank is not an empty bank: bankIds is empty until a booth has
        // been opened, and "no nails banked" would send the bot to the mine.
        const s = step({ ...started, bankKnown: false });
        expect(s.kind).toBe('scanBank');
    });
});

describe('Horror from the Deep — the key and the door', () => {
    const bridged = { stage: HD_STAGE.STARTED, flags: [HD_FLAG.BRIDGE] };

    test('runs the barcrawl and Gunnjorn once the bridge is up', () => {
        expect(customName(step(bridged))).toContain('barcrawl');
    });

    test('draws coin for the tour before walking it', () => {
        const s = step({ ...bridged, invIds: [[HD_ID.COINS, 10]] });
        expect(s.kind).toBe('withdraw');
    });

    test('completes the dungeon load before the last word with Larrissa', () => {
        // One causeway crossing instead of three: everything the lighthouse and
        // the cavern want is bought while the character is still mainland-side.
        const s = step({ ...bridged, invIds: [[HD_ID.KEY, 1], [HD_ID.DEATH_RUNE, 0]] });
        expect(s.kind).toBe('buy');
    });

    test('talks to Larrissa once key and load are both in', () => {
        expect(talkTo(step({ ...bridged, invIds: [[HD_ID.KEY, 1]] }))).toBe('Larrissa');
    });
});

describe('Horror from the Deep — the lighthouse and the cavern', () => {
    test('walks in through the doorway when outside and loaded', () => {
        const s = step({ stage: HD_STAGE.ENTERED_LIGHTHOUSE, invIds: [[HD_ID.KEY, 1]] });
        expect(customName(s)).toContain('enter');
    });

    test('re-buys a missing load rather than entering short', () => {
        const s = step({ stage: HD_STAGE.ENTERED_LIGHTHOUSE, invIds: [[HD_ID.TINDERBOX, 0]] });
        expect(s.kind).toBe('buy');
    });

    test('repairs the light once inside', () => {
        const s = step({ stage: HD_STAGE.ENTERED_LIGHTHOUSE, tile: QUEST_LIGHTHOUSE });
        expect(customName(s)).toContain('light');
    });

    test('does not re-source the lamp kit after the lamp is lit', () => {
        // Past the repair the tinderbox, tar and glass are spent; asking again is
        // a trip to Lumbridge swamp and Catherby beach for nothing.
        const s = step({
            stage: HD_STAGE.REPAIRED_LIGHTHOUSE,
            invIds: [[HD_ID.TINDERBOX, 0], [HD_ID.SWAMP_TAR, 0], [HD_ID.MOLTEN_GLASS, 0]]
        });
        expect(customName(s)).toContain('enter');
    });

    test('opens the strange wall from the basement', () => {
        const s = step({ stage: HD_STAGE.REPAIRED_LIGHTHOUSE, tile: BASEMENT });
        expect(customName(s)).toContain('wall');
    });

    test('fights the junior in the cavern', () => {
        const s = step({ stage: HD_STAGE.REPAIRED_LIGHTHOUSE, tile: CAVERN });
        expect(customName(s)).toContain('junior');
    });

    test('fights the mother once the junior is down', () => {
        const s = step({ stage: HD_STAGE.DEFEATED_DAGJR, tile: CAVERN });
        expect(customName(s)).toContain('mother');
    });

    test('walks back to the lighthouse when a death drops it mainland-side', () => {
        const s = step({ stage: HD_STAGE.DEFEATED_DAGJR, tile: { x: 3222, z: 3218, level: 0 } });
        expect(s.kind).toBe('custom');
    });
});

describe('Horror from the Deep module', () => {
    test('is registered in the queue', () => {
        expect(QUEST_DEFS.some(d => d.record.id === 'horror')).toBe(true);
    });

    test('owns its own inventory', () => {
        // Without it the engine provisions record.items up front and never lets
        // decide() acquire anything at the stage that needs it.
        expect(horror.ownsInventory).toBe(true);
    });

    test('keeps coins in its tools', () => {
        // A quest that buys anything and omits coins parks on "need gp" forever.
        expect(horror.tools).toContain('coins');
    });
});

describe('Dagannoth mother forms', () => {
    test('every form the npc can take is either answerable or named immune', () => {
        // `npc_max_dealt` zeroes any hit that is not the one the current form is
        // weak to, so a form missing from both tables is a form the fight stands
        // still through — and the only symptom is a very slow loss.
        for (const id of MOTHER_IDS) {
            expect(FORM_ELEMENT[id] !== undefined || IMMUNE_FORMS.has(id)).toBe(true);
        }
    });

    test('the four elemental forms map to their own element', () => {
        expect(FORM_ELEMENT[1351]).toBe('Wind');
        expect(FORM_ELEMENT[1352]).toBe('Water');
        expect(FORM_ELEMENT[1353]).toBe('Fire');
        expect(FORM_ELEMENT[1354]).toBe('Earth');
    });

    test('the spell tier follows the magic level', () => {
        expect(spellTier(99)).toBe('blast');
        expect(spellTier(59)).toBe('blast');
        expect(spellTier(58)).toBe('bolt');
        expect(spellTier(35)).toBe('bolt');
        expect(spellTier(13)).toBe('strike');
        // Below Fire Strike four of her six forms cannot be answered at all.
        expect(spellTier(12)).toBeNull();
    });
});
