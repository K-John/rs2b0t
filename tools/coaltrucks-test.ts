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

const PHASES = ['cross', 'fill', 'run', 'drain', 'full'] as const;
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

    // The phase seeds never hand over a pickaxe — a stage test that seeds its own
    // tools proves nothing (docs/TESTING.md#live-harnesses).
    const seat = phase === 'drain' ? TELE.seersTruck
        : phase === 'run' ? TELE.mineTruck
            : phase === 'cross' ? TELE.logWest
                : TELE.mine;

    if (phase === 'drain' || phase === 'run') {
        // ::setvar works on a protected varp as long as the account is idle.
        if (!(await cheatQuiet(page, 'setvar coal_truck 120'))) {
            fail('could not seed the truck');
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
    let crossed = false;

    while (Date.now() < deadline) {
        await page.waitForTimeout(10_000);
        last = await read();
        console.log(
            `  t=${Math.round((Date.now() - t0) / 1000)}s pos=${fmt(last.pos)} pack=${last.coal} xp=+${last.xp - first.xp} runner=${last.runner}`
        );
        for (const line of last.logs) {
            if (line.time > lastLogTime) {
                console.log(`      · [${line.level}] ${line.msg}`);
            }
        }
        if (last.logs.length > 0) {
            lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time));
        }
        if ((last.pos?.x ?? 0) >= 2603 && (last.pos?.z ?? 0) <= 3480) {
            crossed = true;
        }
        if (last.runner === 'stopped') {
            console.log('  runner stopped');
            break;
        }
    }

    const truckAfter = await getServerVar(page, 'coal_truck');
    const ticks = last.tick - first.tick;
    const gained = last.xp - first.xp;
    console.log(`final: truck=${truckAfter} xp=+${gained} over ${ticks} ticks pos=${fmt(last.pos)}`);

    // Assert on game state, never on log lines.
    if (phase === 'cross') {
        if (!crossed) {
            fail(`never crossed the river (ended at ${fmt(last.pos)})`);
        }
        if (last.pos?.level !== 0) {
            fail(`log balance landed on level ${last.pos?.level} — the edge levels in transports.json are wrong`);
        }
        console.log(`PASS: crossed to ${fmt(last.pos)} on level 0`);
    } else if (phase === 'fill') {
        if ((truckAfter ?? 0) <= (truckBefore ?? 0)) {
            fail(`truck did not gain coal (${truckBefore} -> ${truckAfter})`);
        }
        if (gained <= 0) {
            fail('no mining xp gained — the bot never mined');
        }
        console.log(`PASS: truck ${truckBefore} -> ${truckAfter}, +${gained} mining xp`);
    } else if (phase === 'drain') {
        if ((truckAfter ?? 120) >= (truckBefore ?? 120)) {
            fail(`truck was not drained (${truckBefore} -> ${truckAfter})`);
        }
        console.log(`PASS: truck ${truckBefore} -> ${truckAfter}`);
    } else if (phase === 'run') {
        if ((last.pos?.x ?? 0) < 2650) {
            fail(`never reached Seers (ended at ${fmt(last.pos)})`);
        }
        console.log(`PASS: reached ${fmt(last.pos)}`);
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
