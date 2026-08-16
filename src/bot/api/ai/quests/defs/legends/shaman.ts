import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Skills } from '../../../../skills/Skills.js';
import { Reach } from '../../../../walking/Reach.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { LQ_ID, LQ_LOC, LQ_LOC_ID, LQ_NPC, LQ_TILE, inOctagram } from './areas.js';
import { drinkPrayer } from './fight.js';
import { enterJungle, leaveJungle, summonGujuo, talkGujuo } from './jungle.js';
import { climbOutOfTrials } from './trials.js';
import { driveToEnd, driveUntil, heldId, here, locNear, modalText, offerTo, promptLoc, settleScene, useOnLoc } from './scene.js';

const CRAWL_ATTEMPTS = 6;

/** The three mossy rocks that hide the shaman cave, by exact id. */
const ROCK_IDS: readonly number[] = [LQ_LOC_ID.MOSSY_ROCK_1, LQ_LOC_ID.MOSSY_ROCK_2, LQ_LOC_ID.MOSSY_ROCK_3];

// Why: the crawl rolls against agility twice — a hard gate at 50 and then `stat_random(agility, 125, 250)` — and a failed roll costs 5 hitpoints and leaves the player where they were.

/** Squeeze through the rocks in the north-west jungle into Ungadulu's cave. */
export async function enterShamanCave(log: (m: string) => void): Promise<boolean> {
    if (here() === 'shamanCaves') {
        return true;
    }
    if (!(await enterJungle(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(LQ_TILE.MOSSY_ROCKS, { radius: 2, attempts: 3, timeoutMs: 180_000, log }))) {
        return false;
    }
    await settleScene();
    for (let i = 0; i < CRAWL_ATTEMPTS; i++) {
        if (here() === 'shamanCaves') {
            await settleScene();
            return true;
        }
        // Why: "Rocks" and "Mossy rock" are shared with every ore vein in the jungle, so the three cave-mouth ids are the filter.
        const rock = Locs.query().where(l => ROCK_IDS.includes(l.id)).action('Search').within(8).nearest();
        if (!rock) {
            log('no mossy rock offering Search near the cave mouth');
            return false;
        }
        if (!(await rock.interact('Search'))) {
            continue;
        }
        await driveUntil(() => here() === 'shamanCaves', ["Yes, I'll crawl through"], log, 25_000);
    }
    log('six crawls and still outside the shaman cave');
    return false;
}

// Why: "Who are you?" sets both the where-bit and the who-bit, and the who-bit is what unlocks Gujuo's pure-water branch; "Where do I get pure water from?" then ends the conversation on its own.
// Why: taking them in the other order re-offers "Who are you?" every pass, which is the loop `driveDialog` only escapes by timing out.
const UNGADULU_PREFER = ['Who are you?', 'Where do I get pure water from?'];

/** Talk to Ungadulu through the flames until he has named the sacred water. */
export async function speakToUngadulu(log: (m: string) => void): Promise<boolean> {
    if (!(await enterShamanCave(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(LQ_TILE.FIRE_WALL_WEST, { radius: 1, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    await settleScene();
    const wall = locNear(LQ_LOC.FIRE_WALL, 'Investigate', 6);
    if (!wall) {
        log('no fire wall offering Investigate beside the octagram');
        return false;
    }
    if (!(await wall.interact('Investigate'))) {
        return false;
    }
    // The white-robed figure appears in a message box first, and the option list a beat later.
    if (!(await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 8000))) {
        log('the fire wall raised nothing — is Ungadulu still in the octagram?');
        return false;
    }
    return driveToEnd(UNGADULU_PREFER, log, 60_000);
}

// Why: the last two are the menu he offers once the sketch is handed over, and abandoning there logs a miss on a chain that has already done its job.
const GUJUO_WATER_PREFER = [
    'I need some pure water to douse some magic flames.',
    'Where is the pool of sacred water?',
    'What kind of a vessel?',
    'Ungadulu looks a little strange.',
    'How do I bless the vessel?',
    'Ok thanks for your help.'
];

// Why: the sketch is handed over by the same branch that sets the stage, so a sketch in the pack proves the stage moved without opening the journal.

const gujuoWaterTalk = talkGujuo(
    GUJUO_WATER_PREFER,
    () => heldId(LQ_ID.GOLD_BOWL_SKETCH) > 0,
    120_000
);

// Why: Gujuo only offers the pure-water topic once Ungadulu has been asked who he is, and that bit is `%legends_bits` — invisible from here.
// Why: without it his menu is four topics that all dead-end, so a stage-7 resume that skipped a question would ask him for ever; the recovery is to go back and ask.

/** Ask Gujuo where the pure water comes from, going back to Ungadulu if he cannot say. */
export async function askGujuoForWater(log: (m: string) => void): Promise<boolean> {
    if (await gujuoWaterTalk(log)) {
        return true;
    }
    log('Gujuo has no pure-water topic — Ungadulu has not been asked who he is');
    if (!(await speakToUngadulu(log))) {
        return false;
    }
    return gujuoWaterTalk(log);
}

// Why: `gujuo_start` only opens with the bless offer when it notices the bowl, and every other list it can raise leads there through the vessel questions — the goodbyes are left out on purpose, as they end the conversation with the bowl still plain.
const BLESS_PREFER = [
    "Yes, I'd like you to bless my gold bowl.",
    "Yes, I'd like to bless my gold bowl.",
    'How do I bless the vessel?',
    'What kind of a vessel?',
    'I need some pure water to douse some magic flames.'
];

// Why: `opnpcu,gujuo` offers the blessing straight off the bowl, which is one menu rather than the four the talk route walks through to reach the same question.

/** Gujuo blesses the bowl; the trance rolls against prayer and re-offers on a miss. */
export async function blessBowl(log: (m: string) => void): Promise<boolean> {
    const blessed = (): boolean =>
        heldId(LQ_ID.GOLD_BOWL_BLESSED) > 0 || heldId(LQ_ID.GOLD_BOWL_BLESSED_PURE) > 0 || heldId(LQ_ID.GOLD_BOWL_BLESSED_WATER) > 0;
    if (blessed()) {
        return true;
    }
    if (!(await summonGujuo(log))) {
        return false;
    }
    // Why: the use-on lands and the greeting sometimes never arrives, and one long wait on a chat that is not coming spends the whole budget learning nothing — so the offer is made again rather than waited on.
    for (let i = 0; i < BLESS_ATTEMPTS; i++) {
        const gujuo = Npcs.query().name(LQ_NPC.GUJUO).within(12).nearest();
        if (!gujuo) {
            log('no Gujuo in range for the bowl');
            return false;
        }
        await topUpPrayer(log);
        const offered = await offerTo(LQ_ID.GOLD_BOWL, gujuo, log);
        if (offered && await driveUntil(blessed, BLESS_PREFER, log, 40_000)) {
            return true;
        }
        // Why: a silent wait is the one failure that tells you nothing, and this one cost two live runs before it said a word.
        log(`bowl on Gujuo ${offered ? 'sent' : 'refused'} at ${gujuo.tile().x},${gujuo.tile().z}, chat "${modalText().slice(0, 60)}"`);
        await settleScene();
    }
    log('Gujuo took the bowl four times and never blessed it');
    return blessed();
}

const BLESS_ATTEMPTS = 4;

// Why: the trance rolls `stat_random(prayer, 80, 250)` and takes five points on every miss, so seventy misses its way under the script's own forty-two floor in six throws — and Gujuo then refuses outright, in a chain the driver has already closed.
const BLESS_PRAYER = 50;

/** Put the prayer back above the trance's floor, so a run of misses cannot end the leg. */
async function topUpPrayer(log: (m: string) => void): Promise<boolean> {
    return Skills.effective('prayer') >= BLESS_PRAYER ? true : drinkPrayer(log);
}

const BOWL_ATTEMPTS = 6;

// Why: the anvil carries no ops at all — the golden bowl is a gold bar *used on* it, which no op-based step can express.
// Why: a failed forge costs one bar and sometimes two, so the leg retries while bars remain.

/** Hammer two gold bars into a golden bowl at the Tai Bwo Wannai anvil. */
export async function makeGoldenBowl(log: (m: string) => void): Promise<boolean> {
    if (heldId(LQ_ID.GOLD_BOWL) > 0) {
        return true;
    }
    if (!(await leaveJungle(log))) {
        return false;
    }
    for (let i = 0; i < BOWL_ATTEMPTS; i++) {
        if (heldId(LQ_ID.GOLD_BOWL) > 0) {
            return true;
        }
        if (heldId(LQ_ID.GOLD_BAR) < 2) {
            log('fewer than two gold bars left for the bowl');
            return false;
        }
        await useOnLoc(
            LQ_ID.GOLD_BAR,
            { name: LQ_LOC.ANVIL, near: LQ_TILE.ANVIL },
            ['Yes'],
            () => heldId(LQ_ID.GOLD_BOWL) > 0,
            log
        );
    }
    return heldId(LQ_ID.GOLD_BOWL) > 0;
}

/** Cut a hollow reed at the sacred pool; the knife and the machete both work. */
export async function cutReed(log: (m: string) => void): Promise<boolean> {
    if (heldId(LQ_ID.HOLLOW_REED) > 0) {
        return true;
    }
    if (!(await enterJungle(log))) {
        return false;
    }
    const tool = heldId(LQ_ID.KNIFE) > 0 ? LQ_ID.KNIFE : LQ_ID.MACHETE;
    return useOnLoc(
        tool,
        { name: LQ_LOC.TALL_REEDS, near: LQ_TILE.TALL_REEDS },
        [],
        () => heldId(LQ_ID.HOLLOW_REED) > 0,
        log
    );
}

// Why: the reed is the only thing that reaches the water through the rocks, and it is consumed by the syphon.

/** Syphon the jungle pool into the blessed bowl. */
export async function fillBowlFromPool(log: (m: string) => void): Promise<boolean> {
    if (heldId(LQ_ID.GOLD_BOWL_BLESSED_PURE) > 0) {
        return true;
    }
    if (!(await cutReed(log))) {
        return false;
    }
    return useOnLoc(
        LQ_ID.HOLLOW_REED,
        { name: LQ_LOC.SACRED_WATER, near: LQ_TILE.SACRED_POOL, id: LQ_LOC_ID.SACRED_WATER },
        [],
        () => heldId(LQ_ID.GOLD_BOWL_BLESSED_PURE) > 0,
        log
    );
}

// Why: the pool answers the reed with "this pool has dried up" once the seeds are germinated, which is the step that moves the quest to `water_pool_dried_up`.

/** Touch the dried pool, which is what starts the hunt for the source. */
export async function findPoolDried(log: (m: string) => void): Promise<boolean> {
    if (!(await cutReed(log))) {
        return false;
    }
    const dry = (): boolean => locNear(LQ_LOC.POLLUTED_WATER, 'Look', 8) !== null;
    return useOnLoc(
        LQ_ID.HOLLOW_REED,
        { name: LQ_LOC.SACRED_WATER, near: LQ_TILE.SACRED_POOL, id: LQ_LOC_ID.SACRED_WATER },
        [],
        dry,
        log
    ) || dry();
}

// Why: the west wall is crossed by standing on its own tile — `~check_axis` compares the player's x with the wall's, so (2788,9325) is outside and the splash teleports us to (2789,9325).
// Why: the stand is taken at radius 0 first, as a diagonal section of the octagram two tiles away crosses on a different axis.

/** Douse the flames with pure water and step into the octagram. */
export async function enterOctagram(log: (m: string) => void): Promise<boolean> {
    if (inOctagram(Game.tile())) {
        return true;
    }
    // Why: the trials pockets are all `shamanCaves` to the area reader, so a leg that comes back up holding the book reads as "already there" and walks at a wall it cannot reach.
    if (!(await climbOutOfTrials(log))) {
        return false;
    }
    if (!(await enterShamanCave(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(LQ_TILE.FIRE_WALL_WEST, { radius: 0, attempts: 4, timeoutMs: 120_000, log }))) {
        return false;
    }
    await settleScene();
    if (heldId(LQ_ID.GOLD_BOWL_BLESSED_PURE) > 0) {
        const splashed = await useOnLoc(
            LQ_ID.GOLD_BOWL_BLESSED_PURE,
            { name: LQ_LOC.FIRE_WALL, near: LQ_TILE.FIRE_WALL_WEST, within: 2 },
            [],
            () => inOctagram(Game.tile()),
            log
        );
        if (splashed) {
            await settleScene();
            return true;
        }
    }
    // Why: once the demon is dead Ungadulu's spell walks anyone through the flames on a plain Touch, which is the only way in for a leg that no longer carries water.
    const touched = await promptLoc(
        {
            name: LQ_LOC.FIRE_WALL,
            op: 'Touch',
            near: LQ_TILE.FIRE_WALL_WEST,
            within: 2,
            expect: () => inOctagram(Game.tile())
        },
        log
    );
    if (touched) {
        await settleScene();
    }
    return touched;
}

/** Open the Book of Binding in front of Ungadulu, which pulls the demon out of him. */
export async function summonDemon(log: (m: string) => void): Promise<boolean> {
    if (!(await enterOctagram(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(LQ_TILE.OCTAGRAM_INSIDE, { radius: 2, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    await settleScene();
    const shaman = Npcs.query().name(LQ_NPC.UNGADULU).within(10).nearest();
    if (!shaman) {
        log('no Ungadulu inside the octagram');
        return false;
    }
    if (!(await offerTo(LQ_ID.BOOK_OF_BINDING, shaman, log))) {
        return false;
    }
    return Execution.delayUntil(() => Npcs.query().name(LQ_NPC.NEZIKCHENED).within(12).exists(), 25_000);
}

const SEEDS_PREFER = [
    'I need to collect some Yommi tree seeds for Gujuo.',
    'I need more Yommi tree seeds.',
    'Ok, thanks...'
];

// Why: the seeds come from inside the octagram, which the released shaman now lets anyone walk into.

/** Ask the freed Ungadulu for the three Yommi tree seeds. */
export async function askForSeeds(log: (m: string) => void): Promise<boolean> {
    if (heldId(LQ_ID.YOMMI_SEEDS) > 0 || heldId(LQ_ID.YOMMI_SEEDS_GERM) > 0) {
        return true;
    }
    if (!(await enterOctagram(log))) {
        return false;
    }
    const status = await Reach.npcDialog({ name: LQ_NPC.UNGADULU, near: LQ_TILE.OCTAGRAM_INSIDE, log });
    if (status !== 'done') {
        log('Ungadulu never opened a dialogue');
        return false;
    }
    return driveUntil(() => heldId(LQ_ID.YOMMI_SEEDS) > 0, SEEDS_PREFER, log, 90_000);
}

/** Germinate the seeds in the bowl of pure water. */
export async function germinateSeeds(log: (m: string) => void): Promise<boolean> {
    if (heldId(LQ_ID.YOMMI_SEEDS_GERM) > 0) {
        return true;
    }
    const bowl = Inventory.items().find(item => item.id === LQ_ID.GOLD_BOWL_BLESSED_PURE);
    const seeds = Inventory.items().find(item => item.id === LQ_ID.YOMMI_SEEDS);
    if (!bowl || !seeds) {
        log('need both the germinated-water bowl and the raw seeds in the pack');
        return false;
    }
    // Why: `opheldu` runs the handler on the item clicked second and the bowl is the one that carries it, so the seeds go on the bowl — the script's own comment says the reverse is "nothing interesting happens", and that is exactly what eleven attempts got.
    if (!(await seeds.useOn(bowl))) {
        return false;
    }
    // Why: `~doubleobjbox` suspends the script until the box is answered, and the germinated seeds are added after it — so waiting for them without clearing the box waits for something the server is not going to do.
    return driveUntil(() => heldId(LQ_ID.YOMMI_SEEDS_GERM) > 0, [], log, 20_000);
}
