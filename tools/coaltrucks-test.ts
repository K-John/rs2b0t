// docs/TESTING.md#live-harnesses
// Live CoalTrucks run against a local engine.
//   bun tools/coaltrucks-test.ts --phase cross --speed 300 --minutes 3   # proves the log balance level
//   bun tools/coaltrucks-test.ts --phase fill  --speed 300 --minutes 8
//   bun tools/coaltrucks-test.ts --phase drain --speed 300 --minutes 8
//   bun tools/coaltrucks-test.ts --minutes 45                            # full uncheated loop
//
// The truck count is a server-only varp the bot cannot read, but ::getvar can —
// so the truck is seeded with ::setvar and asserted with ::getvar.
import { fail, launchBrowser } from './lib/harness.js';
import { cheatQuiet, getServerVar, mainlandAccount, relog, startScript } from './tutorial/harness.js';

// ::tele takes level,squareX,squareZ,localX,localZ — i.e. x>>6, x&63.
const TELE = {
    mine: '0,40,54,22,25', // 2582,3481 — the rocks
    mineTruck: '0,40,54,15,30', // 2575,3486 — the mine-side truck stand
    seersTruck: '0,42,54,7,47', // 2695,3503 — the Seers-side truck stand
    logWest: '0,40,54,38,21' // 2598,3477 — west of the log balance
};

const PHASES = ['cross', 'fill', 'partial', 'run', 'drain', 'nopick', 'full'] as const;
type Phase = (typeof PHASES)[number];

const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
};

const base = opt('--base') ?? 'http://localhost:8888';
const user = opt('--user') ?? `ct${Date.now().toString(36).slice(-7)}`;
const minutes = Number(opt('--minutes') ?? 8);
const speed = opt('--speed');
const phase = (opt('--phase') ?? 'full') as Phase;

if (!PHASES.includes(phase)) {
    fail(`unknown --phase '${phase}' (want one of ${PHASES.join(', ')})`);
}

interface Snapshot {
    pos: { x: number; z: number; level: number } | null;
    coal: number;
    xp: number;
    tick: number;
    runner: string;
    logs: { time: number; level: string; msg: string }[];
}

const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    await mainlandAccount(page, base, user);
    console.log(`mainland-ready as '${user}'`);

    if (speed && !(await cheatQuiet(page, `speed ${speed}`))) {
        fail('could not set speed');
    }
    if (!(await cheatQuiet(page, '~maxme'))) {
        fail('could not max stats');
    }

    // A fresh bot always starts in the fill phase, so there is no teleport that drops it
    // straight into draining — the run/cross/drain legs all start at the mine truck with
    // a full truck and a full pack, and reach their leg through the real transitions.
    const seat = phase === 'run' || phase === 'cross' || phase === 'drain' ? TELE.mineTruck : TELE.mine;

    // ::setvar works on a protected varp as long as the account is idle.
    if (phase === 'drain' || phase === 'run' || phase === 'cross') {
        if (!(await cheatQuiet(page, 'setvar coal_truck 120'))) {
            fail('could not seed the truck');
        }
    }
    if (phase === 'run' || phase === 'cross' || phase === 'drain') {
        // 27, not 28: the pickaxe needs the last slot, and 27 coal + pickaxe is still
        // a full pack, so the deposit fires against a full truck and answers "full".
        if (!(await cheatQuiet(page, 'give coal 27'))) {
            fail('could not seed the pack with coal');
        }
    }
    if (phase === 'fill' || phase === 'partial') {
        // Coal is a 16/100 roll, so a pack mined from empty takes ~11 minutes. Seed
        // most of it and let the bot mine the last few: the leg is about the deposit
        // ladder, and the xp assertion still proves it did the mining itself.
        if (!(await cheatQuiet(page, 'give coal 24'))) {
            fail('could not seed the pack with coal');
        }
    }
    if (phase === 'partial') {
        // 110 + a 27-coal pack overshoots 120, so the truck takes 10 and answers
        // "some" — the one deposit branch the other legs never reach.
        if (!(await cheatQuiet(page, 'setvar coal_truck 110'))) {
            fail('could not seed the truck');
        }
    }
    // ~maxme grants stats and never gear. Pickaxe *acquisition* is what --phase nopick
    // covers, so handing one to the other legs cannot hide a missing-tool bug.
    if (phase !== 'nopick') {
        if (!(await cheatQuiet(page, 'give rune_pickaxe'))) {
            fail('could not seed a pickaxe');
        }
    }
    if (!(await cheatQuiet(page, `tele ${seat}`))) {
        fail(`could not tele for phase ${phase}`);
    }
    // A headless ::tele leaves the scene unbuilt; the login payload rebuilds it.
    await relog(page, user);

    const read = (): Promise<Snapshot> =>
        page.evaluate((): Snapshot => {
            const g = globalThis as never as {
                __rs2b0t: {
                    reader: {
                        worldTile(): { x: number; z: number; level: number } | null;
                        inventory(): { name: string | null; count: number }[];
                    };
                    Skills: { xp(n: string): number };
                };
                rs2b0t: {
                    host: { tickCount: number };
                    runner: { state: string; ctx?: { log?: { time: number; level: string; msg: string }[] } };
                };
            };
            return {
                pos: g.__rs2b0t.reader.worldTile(),
                coal: g.__rs2b0t.reader.inventory().filter(i => i.name === 'Coal').length,
                xp: g.__rs2b0t.Skills.xp('mining'),
                tick: g.rs2b0t.host.tickCount,
                runner: g.rs2b0t.runner.state,
                logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-60)
            };
        });

    const truckBefore = await getServerVar(page, 'coal_truck');
    const first = await read();
    console.log(`seeded phase=${phase} truck=${truckBefore} pos=${fmt(first.pos)} xp=${first.xp}`);

    await startScript(page, 'CoalTrucks');
    console.log('started CoalTrucks — watching');

    const t0 = Date.now();
    const deadline = t0 + minutes * 60_000;
    let lastLogTime = 0;
    let last = first;
    // WalkExecutor logs "<label>: crossed" only after isOnFarSide confirms it, so this
    // is evidence the log was actually walked — not that a packet was sent.
    let crossed = false;
    /** A leg that meant to hand over a pickaxe and did not is a broken seed, not a pass. */
    let sawNoPickaxe = false;
    const deposits: string[] = [];
    // A completed cycle ends back at the mine, so the final position is no evidence
    // Seers was ever reached — track it across the whole run.
    let reachedSeers = false;

    while (Date.now() < deadline) {
        await page.waitForTimeout(10_000);
        last = await read();
        console.log(
            `  t=${Math.round((Date.now() - t0) / 1000)}s pos=${fmt(last.pos)} pack=${last.coal} xp=+${last.xp - first.xp} runner=${last.runner}`
        );
        for (const line of last.logs) {
            if (line.time > lastLogTime) {
                console.log(`      · [${line.level}] ${line.msg}`);
                if (line.msg.includes('Coal trucks log balance: crossed')) {
                    crossed = true;
                }
                if (line.msg.includes('no pickaxe') || line.msg.includes('no usable pickaxe')) {
                    sawNoPickaxe = true;
                }
                const deposit = /coal in the truck \((\w+)\)/.exec(line.msg);
                if (deposit) {
                    deposits.push(deposit[1]);
                }
            }
        }
        if (last.logs.length > 0) {
            lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time));
        }
        if ((last.pos?.x ?? 0) >= 2650) {
            reachedSeers = true;
        }
        if (last.runner === 'stopped') {
            console.log('  runner stopped');
            break;
        }
    }

    const truckAfter = await getServerVar(page, 'coal_truck');
    const ticks = last.tick - first.tick;
    const gained = last.xp - first.xp;
    console.log(`final: truck=${truckAfter} xp=+${gained} over ${ticks} ticks pos=${fmt(last.pos)} deposits=[${deposits.join(',')}]`);

    // Catch a broken seed before it reads as a pass: every leg but nopick hands over a
    // pickaxe, and a pack seeded so full it has no room for one silently reroutes the
    // whole run down the no-pickaxe path.
    if (phase !== 'nopick' && sawNoPickaxe) {
        fail('the pickaxe seed did not land — the pack had no free slot for it');
    }

    // Assert on game state, never on log lines.
    if (phase === 'cross') {
        if (!crossed) {
            fail(`the log balance never reported a crossing (ended at ${fmt(last.pos)})`);
        }
        // A crossing that dumped us on the level-1 deck would strand us there: the deck
        // is an 8x5 island with no descent, so arriving anywhere else proves level 0.
        if (last.pos?.level !== 0) {
            fail(`log balance left us on level ${last.pos?.level} — the edge levels in transports.json are wrong`);
        }
        if ((last.pos?.x ?? 0) < 2603) {
            fail(`crossed but drifted back west (${fmt(last.pos)})`);
        }
        console.log(`PASS: crossed the log balance, now at ${fmt(last.pos)} on level 0`);
    } else if (phase === 'fill') {
        if ((truckAfter ?? 0) <= (truckBefore ?? 0)) {
            fail(`truck did not gain coal (${truckBefore} -> ${truckAfter})`);
        }
        if (gained <= 0) {
            fail('no mining xp gained — the bot never mined');
        }
        console.log(`PASS: truck ${truckBefore} -> ${truckAfter}, +${gained} mining xp`);
    } else if (phase === 'partial') {
        if (!deposits.includes('partial')) {
            fail(`the deposit never reported a partial accept (saw [${deposits.join(',')}])`);
        }
        if (!reachedSeers) {
            fail('a partial accept means the truck hit 120 — the bot should have run to Seers');
        }
        console.log(`PASS: deposit answered "partial" at the 120 cap, then ran to Seers (truck ${truckBefore} -> ${truckAfter})`);
    } else if (phase === 'drain') {
        if ((truckAfter ?? 120) >= (truckBefore ?? 120)) {
            fail(`truck was not drained (${truckBefore} -> ${truckAfter})`);
        }
        console.log(`PASS: truck ${truckBefore} -> ${truckAfter}`);
    } else if (phase === 'run') {
        if (!deposits.includes('full')) {
            fail(`the deposit never reported a full truck (saw [${deposits.join(',')}])`);
        }
        if (!reachedSeers) {
            fail(`never reached Seers (ended at ${fmt(last.pos)})`);
        }
        console.log('PASS: deposit answered "full", ran to Seers');
    } else if (phase === 'nopick') {
        // Regression guard: mining with no pickaxe fails silently, so the bot must
        // notice and stop rather than mime at the rocks forever.
        if (last.runner !== 'stopped') {
            fail(`no pickaxe but the bot is still ${last.runner} at ${fmt(last.pos)}`);
        }
        if (gained > 0) {
            fail(`gained ${gained} mining xp with no pickaxe — the seed is wrong`);
        }
        if ((last.pos?.x ?? 0) < 2650) {
            fail(`stopped without going to the bank for a pickaxe (${fmt(last.pos)})`);
        }
        console.log(`PASS: no pickaxe — walked to the bank and stopped honestly at ${fmt(last.pos)}`);
    } else {
        if (gained <= 0) {
            fail('no mining xp gained over the full run');
        }
        console.log(`PASS: +${gained} mining xp over ${ticks} ticks, truck at ${truckAfter}`);
    }
} finally {
    await browser.close();
}

function fmt(pos: { x: number; z: number; level: number } | null): string {
    return pos ? `${pos.x},${pos.z},${pos.level}` : '?';
}
