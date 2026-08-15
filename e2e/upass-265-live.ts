/** Live Underground Pass harness (#265): --stage N --until N --minutes N, base :8890.
 *  Why: `%upass` and `%ibanmulti` are both `scope=perm` with no `transmit`, so the bot reads its own stage
 *  off the journal — the harness seeds the varps and relogs, because `~update_questlist` only recolours the
 *  list at login. Biohazard is seeded complete: it gates the cave mouth and King Lathas, and has no module yet.
 *  Why: stats are 70 across the board and the bank holds coins and Lobsters alone, so the bow, arrows,
 *  tinderbox and bucket are all sourced by the module rather than handed to it. */

//   HEADED=1 bun e2e/upass-265-live.ts --stage 0 --until 2 --minutes 30 --tick 200
//   HEADED=1 bun e2e/upass-265-live.ts --stage 2 --until 3 --minutes 25 --tick 200
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

import type { Page } from 'playwright-core';

import { launchBrowser } from './lib/harness.js';
import {
    cheatQuiet,
    clearChatDialogs,
    getServerVarQuiet,
    mainlandAccount,
    relog,
    seedItemsToBank,
    startScript,
    teleTo,
    type BankSeedItem
} from './tutorial/harness.js';

interface Args {
    base: string;
    user: string;
    stage: number;
    until: number;
    minutes: number;
    tickMs: number;
    food: string;
    stats: number;
    tele: boolean;
    deploy: boolean;
}

function parse(argv: string[]): Args {
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: `up${Date.now().toString(36).slice(-7)}`,
        stage: 0,
        until: 11,
        minutes: 45,
        tickMs: 300,
        food: 'Lobster',
        stats: 70,
        tele: true,
        deploy: true
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--no-deploy') { out.deploy = false; continue; }
        if (flag === '--no-tele') { out.tele = false; continue; }
        const value = argv[++i];
        if (value === undefined) { break; }
        if (flag === '--base') { out.base = value; }
        else if (flag === '--user') { out.user = value; }
        else if (flag === '--stage') { out.stage = Number(value); }
        else if (flag === '--until') { out.until = Number(value); }
        else if (flag === '--minutes') { out.minutes = Number(value); }
        else if (flag === '--tick') { out.tickMs = Number(value); }
        else if (flag === '--food') { out.food = value; }
        else if (flag === '--stats') { out.stats = Number(value); }
    }
    return out;
}

const args = parse(process.argv.slice(2));

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

const QUEST = 'Underground Pass';
const ARDOUGNE_BANK = { x: 2655, z: 3283, level: 0 };
const BIOHAZARD_COMPLETE = 16;
/** Plague City — its sewer is the only way through the Ardougne wall, and it gates Biohazard anyway. */
const PLAGUE_CITY_COMPLETE = 29;
/** Bit 11 of `%ibanmulti` — King Lathas has sent the player to Koftik. */
const UPASS_STARTED_BIT = 1 << 11;

/**
 * Coins, food, and the kit the module draws from the bank.
 * Why: the bow, arrows, tinderbox, bucket and rope are shop stock the module does not yet buy for itself —
 * seeded here, and called out as a gap rather than hidden.
 */
const BANK_SEED: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
    { debugName: 'lobster', displayName: 'Lobster', qty: 40 },
    { debugName: 'shortbow', displayName: 'Shortbow', qty: 1 },
    { debugName: 'bronze_arrow', displayName: 'Bronze arrow', qty: 50 },
    { debugName: 'tinderbox', displayName: 'Tinderbox', qty: 1 },
    { debugName: 'bucket_empty', displayName: 'Bucket', qty: 1 },
    { debugName: 'rope', displayName: 'Rope', qty: 1 }
];

const STATS = [
    'attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic', 'prayer',
    'cooking', 'woodcutting', 'fletching', 'fishing', 'firemaking', 'crafting',
    'smithing', 'mining', 'herblore', 'agility', 'thieving', 'runecraft'
];

/** Where each seeded stage drops the account, so a leg starts at its own obstacle. */
const STAGE_TELE: Record<number, { x: number; z: number; level: number }> = {
    0: ARDOUGNE_BANK,
    1: ARDOUGNE_BANK,
    2: { x: 2436, z: 3315, level: 0 },
    3: { x: 2494, z: 9716, level: 0 },
    4: { x: 2423, z: 9660, level: 0 },
    5: { x: 2423, z: 9660, level: 0 },
    6: { x: 2173, z: 4725, level: 1 },
    7: { x: 2315, z: 9806, level: 0 },
    8: { x: 2157, z: 4564, level: 1 },
    9: { x: 2144, z: 4647, level: 1 },
    10: ARDOUGNE_BANK
};

async function setStats(page: Page, level: number): Promise<void> {
    for (const skill of STATS) {
        await cheatQuiet(page, `setstat ${skill} ${level}`);
    }
    await clearChatDialogs(page, 'level-up dialog(s)');
    await page.waitForTimeout(1500);
    await clearChatDialogs(page, 'straggler dialog(s)');
}

interface Snapshot {
    pos: { x: number; z: number; level: number } | null;
    status: string;
    qp: number;
    runner: string;
    logs: { time: number; level: string; msg: string }[];
}

async function snapshot(page: Page): Promise<Snapshot> {
    return page.evaluate(quest => {
        const g = globalThis as never as {
            __rs2b0t: {
                reader: { worldTile(): { x: number; z: number; level: number } | null };
                Quests: { status(n: string): string; points(): number };
            };
            rs2b0t: { runner: { state: string; ctx?: { log?: { time: number; level: string; msg: string }[] } } };
        };
        const ring = g.rs2b0t.runner.ctx?.log ?? [];
        return {
            pos: g.__rs2b0t.reader.worldTile(),
            status: g.__rs2b0t.Quests.status(quest),
            qp: g.__rs2b0t.Quests.points(),
            runner: g.rs2b0t.runner.state,
            logs: ring.slice(-80).map(l => ({ time: l.time, level: l.level, msg: l.msg }))
        };
    }, QUEST);
}

const DEPLOYED = ['botclient.js', 'botclient.js.map', 'navworker.js', 'navworker.js.map'];

function deployBundle(): void {
    const engine = process.env.ENGINE_DIR ?? `${homedir()}/code/rs2b2t-engine`;
    const botDir = `${engine}/public/bot`;
    if (!existsSync(botDir)) {
        fail(`deploy: ${botDir} not found — set ENGINE_DIR to the engine serving ${args.base}`);
    }
    const build = Bun.spawnSync(['bun', 'run', 'build:bot'], { stdout: 'pipe', stderr: 'pipe' });
    if (build.exitCode !== 0) {
        fail(`deploy: build:bot failed\n${build.stderr.toString()}`);
    }
    const copy = Bun.spawnSync(['sh', '-c', `cp ${DEPLOYED.map(f => `out/${f}`).join(' ')} "${botDir}/"`]);
    if (copy.exitCode !== 0) {
        fail(`deploy: could not copy the bundles into ${botDir}`);
    }
    console.log(`deploy: fresh ${DEPLOYED.join(', ')} -> ${botDir}`);
}

if (args.stage < 0 || args.stage > 10) {
    fail('--stage is the %upass value and runs 0 to 10');
}

if (args.deploy) {
    deployBundle();
}

const browser = await launchBrowser({ swiftshader: true });
try {
    const page = await browser.newPage();
    const t0 = Date.now();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    page.on('console', m => {
        const txt = m.text();
        if (txt.startsWith('[bot]')) {
            console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${txt}`);
        }
    });

    await mainlandAccount(page, args.base, args.user);
    console.log(`mainland-ready as '${args.user}'`);

    await cheatQuiet(page, `speed ${args.tickMs}`);
    console.log(`tick rate: ${args.tickMs}ms`);

    await setStats(page, args.stats);
    console.log(`stats: ${args.stats} across the board`);

    console.log(`seeding ${BANK_SEED.length} item type(s) into the Ardougne East bank`);
    await seedItemsToBank(page, BANK_SEED, ARDOUGNE_BANK);

    // Why: Biohazard gates both King Lathas's Underground Pass branch and the cave mouth itself, and it has
    // no module yet — seeding it complete is what makes this quest reachable at all.
    // Why: Plague City is seeded with it. Its dug tunnel is the only way through the Ardougne wall, and the
    // real chain reaches this quest through it, so an unfinished garden is a harness artefact, not a case.
    await cheatQuiet(page, `setvar elenaquest ${PLAGUE_CITY_COMPLETE}`);
    await cheatQuiet(page, `setvar biohazard ${BIOHAZARD_COMPLETE}`);
    const bio = await getServerVarQuiet(page, 'biohazard');
    if (bio !== BIOHAZARD_COMPLETE) {
        fail(`setvar biohazard ${BIOHAZARD_COMPLETE} did not take (read back ${bio})`);
    }

    if (args.stage > 0) {
        await cheatQuiet(page, `setvar upass ${args.stage}`);
        // Why: the started bit is what the journal and the cave mouth read, and a seeded stage without it
        // leaves Koftik refusing entry to a quest the journal says is under way.
        await cheatQuiet(page, `setvar ibanmulti ${UPASS_STARTED_BIT}`);
        const read = await getServerVarQuiet(page, 'upass');
        if (read !== args.stage) {
            fail(`setvar upass ${args.stage} did not take (read back ${read})`);
        }
        console.log(`upass=${read} ibanmulti=${UPASS_STARTED_BIT}`);
    }
    await relog(page, args.user);
    await clearChatDialogs(page, 'post-relog dialog(s)');

    const start = STAGE_TELE[args.stage] ?? ARDOUGNE_BANK;
    if (args.tele) {
        if (!(await teleTo(page, start, 10, 25_000))) {
            await clearChatDialogs(page, 'pre-tele dialog(s)');
            if (!(await teleTo(page, start, 10, 25_000))) {
                fail(`tele to ${start.x},${start.z} did not arrive`);
            }
        }
        await relog(page, args.user);
        await clearChatDialogs(page, 'post-tele dialog(s)');
        console.log(`start tile → ${start.x},${start.z},${start.level}`);
    }

    const gates = await page.evaluate(() => {
        const g = globalThis as never as { __rs2b0t: { Quests: { status(n: string): string } } };
        return {
            plague: g.__rs2b0t.Quests.status('Plague City'),
            biohazard: g.__rs2b0t.Quests.status('Biohazard'),
            upass: g.__rs2b0t.Quests.status('Underground Pass')
        };
    });
    console.log(`journal gates → Plague City ${gates.plague}, Biohazard ${gates.biohazard}, Underground Pass ${gates.upass}`);
    if (gates.plague !== 'complete') {
        fail(`Plague City reads ${gates.plague} after the seed — the wall crossing needs its dug tunnel`);
    }
    if (gates.biohazard !== 'complete') {
        fail(`Biohazard reads ${gates.biohazard} after the seed — the prerequisite gate will block the queue`);
    }

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'upass'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for %upass to reach ${args.until}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = args.stage;
    let queueChecked = false;
    while (Date.now() < deadline) {
        const last = await snapshot(page);
        // Why: the engine serves one bundle to everyone, so a session that redeploys inside this run's boot
        // window hands it their branch — and a queue without this quest spends the budget on somebody else's.
        const queue = last.logs.find(l => l.msg.startsWith('AIOQuester — queue:'));
        if (!queueChecked && queue) {
            queueChecked = true;
            if (!queue.msg.includes(QUEST)) {
                fail(`the loaded bundle has no ${QUEST} — another session redeployed over it (${queue.msg})`);
            }
            console.log(`queue confirmed: ${queue.msg}`);
        }
        for (const line of last.logs) {
            if (line.time > lastLogTime) {
                lastLogTime = line.time;
                console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${line.level}: ${line.msg}`);
            }
        }
        const stage = (await getServerVarQuiet(page, 'upass')) ?? reached;
        if (stage > reached) {
            reached = stage;
            console.log(`  >> %upass reached ${reached}`);
        }
        if (reached >= args.until || last.status === 'complete') {
            console.log(`PASS (%upass ${reached}, journal ${last.status}, ${Math.round((Date.now() - t0) / 1000)}s)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`the runner stopped at %upass ${reached} — see the log above`);
        }
        await page.waitForTimeout(4_000);
    }
    fail(`timed out at %upass ${reached} after ${args.minutes} minute(s)`);
} finally {
    await browser.close();
}
