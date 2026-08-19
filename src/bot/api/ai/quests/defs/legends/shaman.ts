import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Modals } from '../../../../ui/widgets/Modals.js';
import { Skills } from '../../../../skills/Skills.js';
import { Reach } from '../../../../walking/Reach.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { LQ_ID, LQ_LOC, LQ_LOC_ID, LQ_NPC, LQ_TILE, inOctagram } from './areas.js';
import { drinkPrayer } from './fight.js';
import { enterJungle, leaveJungle, summonGujuo, talkGujuoStatus, type GujuoTalk } from './jungle.js';
import { climbOutOfTrials, leaveOctagram } from './trials.js';
import { driveBoxes, driveToEnd, driveUntil, heldId, here, locNear, modalText, offerTo, promptLoc, settleScene, useOnLoc } from './scene.js';

const CRAWL_ATTEMPTS = 6;

/** The three mossy rocks that hide the shaman cave, by exact id. */
const ROCK_IDS: readonly number[] = [LQ_LOC_ID.MOSSY_ROCK_1, LQ_LOC_ID.MOSSY_ROCK_2, LQ_LOC_ID.MOSSY_ROCK_3];

// Why: the crawl rolls against agility twice, a hard gate at 50 and then `stat_random(agility, 125, 250)`, and a failed roll costs 5 hitpoints and leaves the player where they were.

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
    // Why: from inside the ring, Investigate raises "Leap out of the flaming octagram." and "Attract the shaman's attention." instead of his conversation, neither is a thing `UNGADULU_PREFER` can answer, so the drive abandons, the step fails and the engine sends the run straight back to Gujuo, over and over.
    if (inOctagram(Game.tile()) && !(await leaveOctagram(log))) {
        log('cannot get out of the octagram to talk to Ungadulu through the flames');
        return false;
    }
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
    // Why: "Who are you?" is what sets `asked_ungadulu_who`, and that bit is the reason for coming here, Gujuo's pure-water topic is gated on it.
    // Why: named as required because a chain of boxes with no options at all ends quietly and reads as a conversation that ran its course. `npc_find(coord, ungadulu_good, 10, 0)` failing gives that: two message boxes, no menu, and a `driveToEnd` that reports success having asked nothing.
    return driveToEnd(UNGADULU_PREFER, log, 60_000, 'Who are you?');
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

const gujuoWaterTalk = talkGujuoStatus(
    GUJUO_WATER_PREFER,
    () => heldId(LQ_ID.GOLD_BOWL_SKETCH) > 0,
    120_000
);

// Why: Gujuo only offers the pure-water topic once Ungadulu has been asked who he is, and that bit is `%legends_bits`, invisible from here.
// Why: without it his menu is four topics that all dead-end, so a stage-7 resume that skipped a question would ask him for ever; the recovery is to go back and ask.

// Why: the caves are the answer to a menu without the topic on it, and to nothing else. A shaman who never opened his mouth says nothing about the bit, and walking to Ungadulu on that reading set a bit that was already set, came back, failed to talk again, and went again, the loop a live run spent six minutes in, four attempts deep, reporting a cause it had not checked.

/** What a failed water talk calls for: the topic is there, he needs asking again, or the bit wants setting. */
export function waterTalkAnswer(talk: GujuoTalk): 'done' | 'retry' | 'caves' {
    if (talk === 'goal') {
        return 'done';
    }
    return talk === 'nodialog' ? 'retry' : 'caves';
}

/** Ask Gujuo where the pure water comes from, going back to Ungadulu if he cannot say. */
export async function askGujuoForWater(log: (m: string) => void): Promise<boolean> {
    const first = await gujuoWaterTalk(log);
    if (waterTalkAnswer(first) === 'done') {
        return true;
    }
    if (waterTalkAnswer(first) === 'retry') {
        log('Gujuo would not open a dialogue — trying him again rather than walking the caves for a bit he never spoke about');
        return (await gujuoWaterTalk(log)) === 'goal';
    }
    log('Gujuo has no pure-water topic — Ungadulu has not been asked who he is');
    if (!(await speakToUngadulu(log))) {
        return false;
    }
    // Why: the trip back is the half that fails, and returning its verdict bare left the one interesting failure of this step with nothing said about it at all.
    const after = await gujuoWaterTalk(log);
    if (after !== 'goal') {
        log(`back from Ungadulu and the sketch still did not come — ${after === 'nodialog' ? 'no conversation happened' : 'no topic on his menu'}`);
    }
    return after === 'goal';
}

// Why: `gujuo_start` only opens with the bless offer when it notices the bowl, and every other list it can raise leads there through the vessel questions. The goodbyes are left out on purpose, as they end the conversation with the bowl still plain.
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
    // Why: the use-on lands and the greeting sometimes never arrives, and one long wait on a chat that is not coming spends the budget learning nothing, so the offer is made again rather than waited on.
    for (let i = 0; i < BLESS_ATTEMPTS; i++) {
        const gujuo = Npcs.query().name(LQ_NPC.GUJUO).within(12).nearest();
        if (!gujuo) {
            log('no Gujuo in range for the bowl');
            return false;
        }
        if (!(await topUpPrayer(log))) {
            log(`prayer at ${Skills.effective('prayer')} with nothing left to drink, and the trance refuses below ${BLESS_FLOOR}`);
            return false;
        }
        const offered = await offerTo(LQ_ID.GOLD_BOWL, gujuo, log);
        const outcome = offered ? await driveBlessing(blessed) : 'quiet';
        if (outcome === 'blessed') {
            return true;
        }
        if (needsDose(outcome, Skills.effective('prayer'))) {
            await drinkPrayer(log);
        }
        // Why: a silent wait is the one failure that tells you nothing, and this one cost two live runs before it said a word.
        log(`bowl on Gujuo ${offered ? 'sent' : 'refused'} at ${gujuo.tile().x},${gujuo.tile().z}, prayer ${Skills.effective('prayer')}/${Skills.level('prayer')}, trance ${outcome}`);
        await settleScene();
    }
    log(`Gujuo took the bowl ${BLESS_ATTEMPTS} times and never blessed it`);
    return blessed();
}

// Why: a devout account starts at the wrong end of the roll and only five points a miss walks it down, from ninety-nine it is eleven misses to the forty-two where the odds are best, and twelve throws still leave one run in fifteen unblessed. Twenty covers the walk with room over, and a throw is now seconds rather than the better part of a minute.
const BLESS_ATTEMPTS = 20;

// Why: a miss ends the conversation outright. Gujuo offers a retry, but the five points it took put the answer under his own forty-two gate, so "too inexperienced" closes the chain, and a wait watching for a blessing that is no longer coming polled a chat that had already gone for all forty seconds, four times over.
const BLESS_MS = 40_000;

// Why: the trance closes its own dialogue and then chants, `if_close`, two `mes`, then six `p_delay(2)` carrying `npc_say`/`say`, which are overhead chat and open no widget. That is twelve ticks in which nothing is up and the throw has not resolved, so a shorter patience gives up mid-meditation, reports the trance quiet, and re-offers the bowl to a shaman still humming.

/** How many idle ticks end the wait, longer than the trance's own twelve of silence. */
const BLESS_IDLE_TICKS = 20;

/** What Gujuo's own words said about a throw, read while the chain is still up. */
export type Trance = 'blessed' | 'refused' | 'missed' | 'quiet';

/** He took the five points and the trance failed. */
const BLESS_MISSED = /deep enough trance/;

/** He would not begin, the server's prayer is under his gate, whatever the stat block says. */
const BLESS_REFUSED = /too inexperienced/;

/** Drive Gujuo's trance, ending the moment it blesses the bowl or the conversation closes without it. */
async function driveBlessing(blessed: () => boolean): Promise<Trance> {
    let opened = false;
    let idle = 0;
    let missed = false;
    let refused = false;
    const ended = (): boolean => {
        if (blessed()) {
            return true;
        }
        const said = modalText();
        missed = missed || BLESS_MISSED.test(said);
        refused = refused || BLESS_REFUSED.test(said);
        if (ChatDialog.isOpen() || ChatDialog.canContinue() || Modals.isOpen()) {
            opened = true;
            idle = 0;
            return false;
        }
        idle++;
        return opened && idle >= BLESS_IDLE_TICKS;
    };
    // Why: `driveUntil` hands the chain to `driveChoice`, which clicks to the end without re-testing, so the box naming the miss was dismissed before anything read it, and every throw came back `quiet`. `driveBoxes` tests between clicks, which is the point of reading his words.
    await driveBoxes(ended, BLESS_MS, BLESS_PREFER);
    if (blessed()) {
        return 'blessed';
    }
    if (refused) {
        return 'refused';
    }
    return missed ? 'missed' : 'quiet';
}

// Why: the stat block lags the server by a tick or two, so a throw made straight after a miss reads a prayer bar that has not fallen yet. Gujuo refuses on his own gate and the throw is spent learning what the miss had already said. At forty-two that doubled every miss: eighteen throws to land nine rolls, against a budget of twenty.
// Why: a miss takes five, so they are counted rather than waited for, and his refusal is believed over the stat block outright.

/** The points `gujuo_bless_bowl` takes on a miss. */
const BLESS_MISS_COST = 5;

/** True when the next throw would meet Gujuo's gate short, whatever the stat block has caught up to. */
export function needsDose(outcome: Trance, points: number): boolean {
    if (outcome === 'refused') {
        return true;
    }
    return outcome === 'missed' && points - BLESS_MISS_COST < BLESS_FLOOR;
}

/** The points Gujuo's own gate demands, below which he will not begin. */
const BLESS_FLOOR = 42;

// Why: `value = ⌊80·(99−n)/98⌋ + ⌊250·(n−1)/98⌋ + 1` against `rand(0..256)`, and true is the miss, so the roll rises about 1.73 for every point of prayer and the trance is likelier to fail the more devout you are. It misses three times in five at forty-two and ninety-eight times in a hundred at ninety-nine.
// Why: that makes every dose above the gate a cost. Prayer is held as low as Gujuo will accept rather than as high as the bar goes, and the five points a miss takes walk the odds towards the player rather than away.

/** The points to hold before a throw. The gate itself, the roll only worsens above it. */
export function blessPrayerFloor(): number {
    return BLESS_FLOOR;
}

/** Put the prayer back above the trance's floor, so a run of misses cannot end the leg. */
async function topUpPrayer(log: (m: string) => void): Promise<boolean> {
    return Skills.effective('prayer') >= blessPrayerFloor() ? true : drinkPrayer(log);
}

const BOWL_ATTEMPTS = 6;

// Why: the anvil carries no ops at all, the golden bowl is a gold bar *used on* it, which no op-based step can express.
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

// Why: the west wall is crossed by standing on its own tile, `~check_axis` compares the player's x with the wall's, so (2788,9325) is outside and the splash teleports us to (2789,9325).
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
    // Why: every chop through the dense band boils the bowl dry, blessed or not, and the octagram is reached through that band, so a bowl filled before the last crossing arrives empty and the splash above never runs.
    if (heldId(LQ_ID.GOLD_BOWL_BLESSED_PURE) === 0) {
        log('no pure water in the bowl at the flames — the fill has to be the last thing before the cave, as crossing the band boils it off');
    }
    // Why: once the demon is dead Ungadulu's spell walks anyone through the flames on a plain Touch, which is the only way in for a leg that no longer carries water.
    // Why: bounded, because before the demon is dead Touch cannot work at all, and `Reach` would otherwise spend eight attempts of its own budget proving it, which is a leg standing at the wall rather than going back for water.
    const touched = await promptLoc(
        {
            name: LQ_LOC.FIRE_WALL,
            op: 'Touch',
            near: LQ_TILE.FIRE_WALL_WEST,
            within: 2,
            expect: () => inOctagram(Game.tile()),
            expectMs: 6000
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

const GERMINATE_ATTEMPTS = 4;

/** Close whatever page is still up, so the next use-on is not thrown away unread. */
async function closeChat(log: (m: string) => void): Promise<void> {
    if (!ChatDialog.isOpen() && !ChatDialog.canContinue()) {
        return;
    }
    await driveUntil(() => !ChatDialog.isOpen() && !ChatDialog.canContinue(), [], log, 8_000);
}

/** Germinate the seeds in the bowl of pure water. */
export async function germinateSeeds(log: (m: string) => void): Promise<boolean> {
    const done = (): boolean => heldId(LQ_ID.YOMMI_SEEDS_GERM) > 0;
    if (done()) {
        return true;
    }
    for (let i = 0; i < GERMINATE_ATTEMPTS; i++) {
        // Why: the seeds arrive on the last page of Ungadulu's chat, and an `opheldu` sent while that page is still up is dropped without a word.
        await closeChat(log);
        await settleScene();
        const bowl = Inventory.items().find(item => item.id === LQ_ID.GOLD_BOWL_BLESSED_PURE);
        const seeds = Inventory.items().find(item => item.id === LQ_ID.YOMMI_SEEDS);
        if (!bowl || !seeds) {
            log(`pack holds ${bowl ? 'the pure bowl' : `bowls [${bowlsHeld()}]`} and ${seeds ? 'the seeds' : 'no seeds'}`);
            return false;
        }
        // Why: `opheldu` runs the handler on the item clicked second and the bowl is the one that carries it, so the seeds go on the bowl, the script's own comment says the reverse is "nothing interesting happens", and that is what eleven attempts got.
        const sent = await seeds.useOn(bowl);
        // Why: `~doubleobjbox` suspends the script until the box is answered, and the germinated seeds are added after it, so waiting for them without clearing the box waits for something the server is not going to do.
        if (sent && await driveUntil(done, [], log, 20_000)) {
            return true;
        }
        // Why: a use-on that lands and answers nothing is the one failure that tells you nothing, and this one has cost two runs already.
        log(`seeds on bowl ${sent ? 'sent' : 'refused'}, chat "${modalText().slice(0, 60)}"`);
    }
    return done();
}

/** Which bowls are in the pack, for when the pure one is not. */
function bowlsHeld(): string {
    const names: Record<number, string> = {
        [LQ_ID.GOLD_BOWL]: 'plain',
        [LQ_ID.GOLD_BOWL_BLESSED]: 'blessed',
        [LQ_ID.GOLD_BOWL_WATER]: 'water',
        [LQ_ID.GOLD_BOWL_PURE]: 'pure',
        [LQ_ID.GOLD_BOWL_BLESSED_WATER]: 'blessed+water'
    };
    return Object.entries(names).filter(([id]) => heldId(Number(id)) > 0).map(([, name]) => name).join(', ') || 'none';
}
