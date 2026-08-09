/**
 * Full e2e sweep over every hard clue, in obj-id order, on one account.
 *
 * Solving a hard clue hands back the *next step of the natural trail*, so a bot
 * left to itself wanders a random trail. This sweep instead spawns the next clue
 * in sequence the moment the current one leaves the pack, which walks the bot
 * from every clue location to the next and exercises nav from all of them.
 *
 * The account is 70 across the board **including prayer**, so Protect from Magic
 * is available for the 30 guarded digs. Supplies are NOT cheated between clues:
 * the bot banks and prays at an altar under its own steam, which is what makes
 * this end-to-end rather than a nav probe.
 *
 *   HEADED=1 SLOWMO=0 bun tools/hard-clue-sweep-live.ts
 *   FROM=2745 bun tools/hard-clue-sweep-live.ts      # resume mid-sweep
 *   TELEPORTS=1 bun tools/hard-clue-sweep-live.ts    # allow spell/ring hops
 *
 * Proof: out/hard-clue-sweep.json (written after every clue, so a killed run
 * still leaves everything it had established).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from 'playwright-core';
import { CASKET_IDS, CLUE_DB } from '#/bot/clues/data/cluedb.js';
import { HARNESS_VIEWPORT, boot, bringUpOffIsland, cheatQuiet, fail, launchBrowser, login, parseArgs, setSettings, stopScript } from './lib/harness.js';

const { base } = parseArgs(process.argv.slice(2), { base: 'http://localhost:8888' });
const user = process.env.USER_NAME ?? `sweep${Date.now() % 100000}`;

/** Edgeville — a bank to start beside, and the trail's own first stop. */
const START = { x: 3094, z: 3493, level: 0 } as const;

const SCIMITAR = 1333;
const SPADE = 952;
const TRIO: [string, number][] = [
    ['trail_sextant', 2574],
    ['trail_watch', 2575],
    ['trail_chart', 2576]
];
/**
 * PlayerStatMap minus the placeholders — this build has no slayer, and STAT18/19
 * are disabled, so ::setstat rejects anything outside this set. Prayer IS in it:
 * the guarded digs are meant to be fought under Protect from Magic.
 */
const STATS = [
    'attack', 'strength', 'defence', 'ranged', 'magic', 'hitpoints', 'prayer',
    'crafting', 'mining', 'smithing', 'fishing', 'cooking', 'firemaking',
    'woodcutting', 'runecraft', 'herblore', 'agility', 'thieving', 'fletching'
];
const LEVEL = 70;

/** Guarded digs and puzzle boxes are slow; past this it is a real failure. */
const CLUE_BUDGET_MS = Number(process.env.CLUE_BUDGET_MS ?? 480_000);
/** Tight, because the swap has to beat the bot opening the casket it was just given. */
const POLL_MS = 400;

/** Every clue and casket id, so the pack can be reduced to exactly one of them. */
const TRAIL_IDS = [...Object.keys(CLUE_DB).map(Number), ...Object.keys(CASKET_IDS).map(Number)];

const HARD = Object.keys(CLUE_DB)
    .map(Number)
    .filter(id => CLUE_DB[id].obj.includes('hard'))
    .sort((a, b) => a - b);

type Outcome = 'solved' | 'abandoned' | 'timeout';
interface Result {
    id: number;
    obj: string;
    type: string;
    coord: { x: number; z: number; level: number } | null;
    guarded: boolean;
    puzzle: boolean;
    outcome: Outcome;
    reason: string | null;
    seconds: number;
    from: unknown;
    to: unknown;
}

type Api = {
    rs2b0t: {
        registry: { get(n: string): unknown };
        runner: { state: string; ctx: { log: { msg: string }[] } | null; start(m: unknown): void };
        reader: { inventory(): { id: number; name: string | null }[] };
    };
    __rs2b0t: {
        Game: { tile(): { x: number; z: number; level: number } | null };
        Skills: { level(n: string): number; effective(n: string): number };
        Inventory: { items(): { id: number; name: string | null }[]; count(n: string): number };
        Equipment: { contains(n: string): boolean };
    };
};

const logLines = (page: Page): Promise<string[]> =>
    page.evaluate(() => ((globalThis as never as Api).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));

const tile = (page: Page): Promise<{ x: number; z: number; level: number } | null> =>
    page.evaluate(() => (globalThis as never as Api).__rs2b0t.Game.tile());

const holds = (page: Page, id: number): Promise<boolean> =>
    page.evaluate(i => (globalThis as never as Api).rs2b0t.reader.inventory().some(x => x.id === i), id);

async function give(page: Page, debugName: string, id: number, count = 1): Promise<boolean> {
    await cheatQuiet(page, `give ${debugName} ${count}`, 900);
    return page
        .waitForFunction(i => (globalThis as never as Api).rs2b0t.reader.inventory().some(x => x.id === i), id, { timeout: 6000 })
        .then(() => true)
        .catch(() => false);
}

/**
 * Leave exactly one trail item in the pack: the clue we want solved next.
 *
 * Deliberately does NOT stop the script. `ClueExecutor` only reports a trail
 * `done` when the pack holds no clue and no casket, and that is what resets
 * `bankedThisSolve` — so stopping between clues, or letting the pack ever go
 * empty, buys a fresh bank trip every single clue. Swapping underneath a running
 * executor keeps one continuous trail, and the walk starts from wherever the
 * last clue finished, which is the whole point of the sweep.
 *
 * Give first, then drop the leftovers: the pack must never be clue-less.
 */
async function swapToClue(page: Page, id: number): Promise<boolean> {
    if (!(await holds(page, id)) && !(await give(page, CLUE_DB[id].obj, id))) {
        return false;
    }
    for (let guard = 0; guard < 40; guard++) {
        const dropped = await page.evaluate(
            ([ids, keep]) => {
                const it = (globalThis as never as Api).__rs2b0t.Inventory.items().find(
                    i => i.id !== keep && (ids as number[]).includes(i.id)
                ) as { interact(a: string): unknown } | undefined;
                if (!it) {
                    return false;
                }
                it.interact('Drop');
                return true;
            },
            [TRAIL_IDS, id] as const
        );
        if (!dropped) {
            return true;
        }
        await page.waitForTimeout(600);
    }
    return true;
}

async function startBot(page: Page): Promise<void> {
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('ClueSolver');
        if (!meta) {
            throw new Error('ClueSolver is not registered');
        }
        g.rs2b0t.runner.start(meta);
    });
    await page.waitForTimeout(600);
}

function describe(id: number): string {
    const r = CLUE_DB[id];
    const c = r.coord ? `(${r.coord.x},${r.coord.z},${r.coord.level})` : (r.npc ?? '?');
    const tags = [r.guardian ? 'guarded' : '', r.puzzle ? 'puzzle' : '', r.needsSextant ? 'sextant' : '']
        .filter(t => t !== '')
        .join('+');
    return `${r.obj} ${r.type} ${c}${tags ? ` [${tags}]` : ''}`;
}

async function runClue(page: Page, id: number, index: number, startedAt: number): Promise<Result> {
    const row = CLUE_DB[id];
    const stamp = (): string => `+${((Date.now() - startedAt) / 1000 / 60).toFixed(1)}m`.padStart(8);

    console.log(`\n${'─'.repeat(78)}`);
    console.log(`[${index + 1}/${HARD.length}] ${id} ${describe(id)}`);
    console.log('─'.repeat(78));

    if (!(await swapToClue(page, id))) {
        return {
            id, obj: row.obj, type: row.type, coord: row.coord ?? null,
            guarded: Boolean(row.guardian), puzzle: Boolean(row.puzzle),
            outcome: 'abandoned', reason: `::give ${row.obj} did not land`, seconds: 0,
            from: await tile(page), to: await tile(page)
        };
    }
    const from = await tile(page);

    let seenLines = (await logLines(page)).length;
    const t0 = Date.now();
    let outcome: Outcome = 'timeout';
    let reason: string | null = null;

    while (Date.now() - t0 < CLUE_BUDGET_MS) {
        await page.waitForTimeout(POLL_MS);
        const lines = await logLines(page);
        for (const l of lines.slice(seenLines)) {
            console.log(`${stamp()}  ${l}`);
        }
        seenLines = lines.length;

        if (!(await holds(page, id))) {
            outcome = 'solved';
            break;
        }
        const abandon = lines.find(l => l.includes('abandoning'));
        if (abandon) {
            outcome = 'abandoned';
            reason = abandon.replace(/^.*abandoning[^:]*:\s*/, '');
            break;
        }
    }

    const seconds = Math.round((Date.now() - t0) / 1000);
    const to = await tile(page);
    const mark = outcome === 'solved' ? 'SOLVED ' : outcome === 'abandoned' ? 'ABANDON' : 'TIMEOUT';
    console.log(`${' '.repeat(8)}  => ${mark} in ${seconds}s${reason ? ` — ${reason}` : ''}`);

    return {
        id, obj: row.obj, type: row.type, coord: row.coord ?? null,
        guarded: Boolean(row.guardian), puzzle: Boolean(row.puzzle),
        outcome, reason, seconds, from, to
    };
}

function summarise(results: Result[]): void {
    const by = (o: Outcome): Result[] => results.filter(r => r.outcome === o);
    console.log(`\n${'='.repeat(78)}\nHARD CLUE SWEEP — ${results.length}/${HARD.length} attempted\n${'='.repeat(78)}`);
    console.log(`solved    ${by('solved').length}`);
    console.log(`abandoned ${by('abandoned').length}`);
    console.log(`timeout   ${by('timeout').length}`);
    const failures = results.filter(r => r.outcome !== 'solved');
    if (failures.length > 0) {
        console.log('\nfailures:');
        for (const f of failures) {
            const c = f.coord ? `(${f.coord.x},${f.coord.z},${f.coord.level})` : '-';
            console.log(`  ${f.id} ${f.obj.padEnd(30)} ${f.type.padEnd(6)} ${c.padEnd(20)} ${f.outcome} — ${f.reason ?? 'no reason'}`);
        }
    }
    const guarded = results.filter(r => r.guarded);
    if (guarded.length > 0) {
        console.log(`\nguarded digs: ${guarded.filter(r => r.outcome === 'solved').length}/${guarded.length} solved`);
    }
    console.log('\nproof: out/hard-clue-sweep.json');
}

async function main(): Promise<void> {
    const from = Number(process.env.FROM ?? 0);
    const startIndex = from > 0 ? Math.max(0, HARD.indexOf(from)) : 0;
    if (from > 0 && HARD.indexOf(from) === -1) {
        fail(`FROM=${from} is not a hard clue id`);
    }

    const browser = await launchBrowser({ swiftshader: !process.env.HEADED });
    const context = await browser.newContext({ viewport: HARNESS_VIEWPORT });
    const page = await context.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    const results: Result[] = [];
    const startedAt = Date.now();
    try {
        await page.goto(`${base}/bot.html`);
        await boot(page);
        if (!(await login(page, user))) {
            fail(`login failed for ${user}`);
        }
        await bringUpOffIsland(page, { user });

        console.log(`stats: ${LEVEL} across the board (prayer included — protect prayers on)`);
        for (const s of STATS) {
            await cheatQuiet(page, `setstat ${s} ${LEVEL}`, 250);
        }
        const stats = await page.evaluate(
            names => Object.fromEntries(names.map(n => [n, (globalThis as never as Api).__rs2b0t.Skills.level(n)])),
            STATS
        );
        const wrong = Object.entries(stats).filter(([, v]) => v !== LEVEL);
        if (wrong.length > 0) {
            fail(`stats not as asked: ${JSON.stringify(wrong)}`);
        }
        console.log(`  ${JSON.stringify(stats)}`);

        await cheatQuiet(page, '~bank_f2p', 2500);
        await cheatQuiet(page, `tele 0,${START.x >> 6},${START.z >> 6},${START.x & 63},${START.z & 63}`, 3500);

        // Seeded once. The trail's bank prep keeps the weapon, spade and trio, so
        // they ride through every bank stop rather than needing a re-seed.
        await give(page, 'rune_scimitar', SCIMITAR);
        for (let attempt = 0; attempt < 4 && !(await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Equipment.contains('Rune scimitar'))); attempt++) {
            await page.evaluate(id => {
                const it = (globalThis as never as Api).__rs2b0t.Inventory.items().find(i => i.id === id) as
                    | { interact(a: string): unknown }
                    | undefined;
                it?.interact('Wield');
            }, SCIMITAR);
            await page.waitForTimeout(1000);
        }
        await give(page, 'spade', SPADE);
        for (const [debugName, id] of TRIO) {
            await give(page, debugName, id);
        }

        const teleports = process.env.TELEPORTS === '1';
        await setSettings(page, 'ClueSolver', {
            food: 'Lobster',
            foodWithdraw: 20,
            restorePrayer: true,
            useTeleports: teleports
        });
        // Nav/routing overlay: the planned path, the transports it routes through,
        // the click it actually sent, and the client's own walk trail beside it.
        await setSettings(page, 'Global', {
            showNavPath: true,
            navPathShowText: true,
            navPathSceneExpand: true,
            navPathClientSegment: true,
            navCameraFollow: true
        });
        console.log(`sweeping ${HARD.length - startIndex} hard clues from ${HARD[startIndex]}, teleports ${teleports ? 'on' : 'off'}, budget ${Math.round(CLUE_BUDGET_MS / 1000)}s each`);

        // Started once, and never stopped between clues — see swapToClue().
        await startBot(page);

        const limit = Number(process.env.LIMIT ?? 0);
        const end = limit > 0 ? Math.min(HARD.length, startIndex + limit) : HARD.length;
        for (let i = startIndex; i < end; i++) {
            results.push(await runClue(page, HARD[i], i, startedAt));
            if (!existsSync('out')) {
                mkdirSync('out', { recursive: true });
            }
            writeFileSync('out/hard-clue-sweep.json', JSON.stringify({ user, base, startedAt, results }, null, 2));
            const solved = results.filter(r => r.outcome === 'solved').length;
            console.log(`${' '.repeat(8)}  running: ${solved}/${results.length} solved, ${Math.round((Date.now() - startedAt) / 60_000)}m elapsed`);
        }
    } finally {
        summarise(results);
        await stopScript(page).catch(() => undefined);
        if (!process.env.HEADED) {
            await browser.close();
        }
    }
}

await main();
