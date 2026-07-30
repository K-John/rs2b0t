// docs/TESTING.md#live-harnesses
// Live RoguesPurse run against a local engine.
//   bun tools/roguespurse-test.ts --base http://localhost:8888 --minutes 4
//   bun tools/roguespurse-test.ts --at mainland --fare 100 --minutes 25 --speed 100
//   bun tools/roguespurse-test.ts --stage 0 --no-maxme --minutes 2   # gate rejection
//
// herbs/tick is the metric that matters: it is immune to `::speed`, and 1.0 is the
// pipelined ceiling (one search + identify + drop per game tick).
import { fail, launchBrowser } from './lib/harness.js';
import { cheatQuiet, mainlandAccount, relog, startScript } from './tutorial/harness.js';

const UNID_ID = 1533;
const PURSE_ID = 1534;
const IDENTIFY_XP = 2.5;
// ::tele takes level,squareX,squareZ,localX,localZ — i.e. x>>6, x&63.
/** The wall stand (2850, 9477): grinds with no walking at all. */
const WALL_TELE = '0,44,148,34,5';
/** The surface pothole stand (2823, 3119): exercises the cave entry + the in-cave walk. */
const POTHOLE_TELE = '0,44,48,7,47';

const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
};
const flag = (name: string): boolean => argv.includes(name);

const base = opt('--base') ?? 'http://localhost:8888';
const user = opt('--user') ?? `rp${Date.now().toString(36).slice(-7)}`;
const minutes = Number(opt('--minutes') ?? 4);
const stage = opt('--stage') ?? '12';
const speed = opt('--speed');
const at = opt('--at') ?? 'cave';

interface Snapshot {
    pos: { x: number; z: number; level: number } | null;
    level: number;
    xp: number;
    tick: number;
    unids: number;
    purses: number;
    runner: string;
    logs: { time: number; level: string; msg: string }[];
}

const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    const t0 = Date.now();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    await mainlandAccount(page, base, user);
    console.log(`mainland-ready as '${user}'`);

    if (speed && !(await cheatQuiet(page, `speed ${speed}`))) {
        fail('could not set speed');
    }
    if (!flag('--no-maxme') && !(await cheatQuiet(page, '~maxme'))) {
        fail('could not max stats');
    }
    if (!(await cheatQuiet(page, `setvar junglepotion ${stage}`))) {
        fail('could not set junglepotion');
    }
    // The quest-tab colour comes from if_setcolour at login, not from the varp.
    await relog(page, user);
    console.log(`junglepotion=${stage}, relogged`);

    // The Karamja ship is a Pay-fare crossing; without coins the navigator prunes it and
    // the whole island reads as unreachable. `::give` reaches the pack, never the bank.
    const fare = opt('--fare');
    if (fare && !(await cheatQuiet(page, `give coins ${Number(fare) || 100}`))) {
        fail('could not give coins');
    }

    const seat = at === 'cave' ? WALL_TELE : at === 'pothole' ? POTHOLE_TELE : null;
    if (seat) {
        if (!(await cheatQuiet(page, `tele ${seat}`))) {
            fail(`could not tele to ${at}`);
        }
        // A headless ::tele leaves the scene unbuilt, so the loc query would come back
        // empty forever; the login payload is what rebuilds it.
        await relog(page, user);
        console.log(`teleported to the ${at}`);
    }

    const read = (): Promise<Snapshot> =>
        page.evaluate(
            ([unidId, purseId]): Snapshot => {
                const g = globalThis as never as {
                    __rs2b0t: {
                        reader: {
                            worldTile(): { x: number; z: number; level: number } | null;
                            inventory(): { id: number; count: number }[];
                        };
                        Skills: { level(n: string): number; xp(n: string): number };
                    };
                    rs2b0t: {
                        host: { tickCount: number };
                        runner: { state: string; ctx?: { log?: { time: number; level: string; msg: string }[] } };
                    };
                };
                const inv = g.__rs2b0t.reader.inventory();
                return {
                    pos: g.__rs2b0t.reader.worldTile(),
                    level: g.__rs2b0t.Skills.level('herblore'),
                    xp: g.__rs2b0t.Skills.xp('herblore'),
                    tick: g.rs2b0t.host.tickCount,
                    unids: inv.filter(i => i.id === unidId).length,
                    purses: inv.filter(i => i.id === purseId).length,
                    runner: g.rs2b0t.runner.state,
                    logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-60)
                };
            },
            [UNID_ID, PURSE_ID]
        );

    await startScript(page, 'RoguesPurse');
    console.log('started RoguesPurse — watching');

    const first = await read();
    const deadline = Date.now() + minutes * 60_000;
    let lastLogTime = 0;
    let last = first;
    let grindStart: Snapshot | null = null;

    while (Date.now() < deadline) {
        last = await read();
        const t = Math.round((Date.now() - t0) / 1000);
        const pos = last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?';
        const gained = last.xp - first.xp;
        console.log(
            `  t=${t}s pos=${pos} hb=${last.level} xp=+${gained} pack=${last.unids}u/${last.purses}p runner=${last.runner}`
        );
        for (const line of last.logs) {
            if (line.time > lastLogTime) {
                console.log(`      · [${line.level}] ${line.msg}`);
            }
        }
        if (last.logs.length > 0) {
            lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time));
        }
        // Measure the cycle only from the first xp, so a long travel leg is excluded.
        if (!grindStart && gained > 0) {
            grindStart = last;
        }
        if (last.runner !== 'running') {
            break;
        }
        await page.waitForTimeout(10_000);
    }

    const gained = last.xp - first.xp;
    const identified = Math.round(gained / IDENTIFY_XP);
    console.log(`END runner=${last.runner} herblore=${first.level}→${last.level} xp=+${gained} (~${identified} herbs)`);
    if (grindStart) {
        const ticks = last.tick - grindStart.tick;
        const herbs = Math.round((last.xp - grindStart.xp) / IDENTIFY_XP);
        console.log(`CYCLE ${herbs} herbs in ${ticks} ticks = ${(herbs / Math.max(1, ticks)).toFixed(2)} herbs/tick`);
    }
    // A run that is expected to be refused must prove it was refused, not just survive.
    const expectGrind = stage === '12' && !flag('--no-maxme');
    if (expectGrind && gained <= 0) {
        fail('no herblore xp — the grind never landed');
    }
    if (!expectGrind && last.runner === 'running') {
        fail('a failed gate left the script running');
    }
    console.log('PASS');
} finally {
    await browser.close();
}
