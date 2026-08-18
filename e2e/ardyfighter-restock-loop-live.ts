/** Live proof — ArdyFighter fights instead of spinning on the Baker's stall when a loadout names a food the stall never hands over.
 *  Why: a loadout is seeded with Lobster, the pack holds only cakes, and the pre-fix gate re-entered the stall driver every loop. */

//   bun e2e/ardyfighter-restock-loop-live.ts [http://localhost:8888]
import { boot, bringUpOffIsland, cheatQuiet, deployIsolatedClient, fail, launchBrowser, login, positionalArgs, setSettings } from './lib/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8888');
const base = args[0];
const user = args[1] ?? `af${Date.now().toString(36).slice(-5)}`;

const ANCHOR = { x: 2661, z: 3306 };
const FOOD_TARGET = 8;
const SEEDED_CAKES = 13;
const RUN_MS = 150_000;
/** One line is the honest report of a stocked pack; a stream of them is the loop this run exists to catch. */
const STOCKED_CAP = 3;

interface Api {
    __rs2b0t: {
        Inventory: { items(): Array<{ name: string | null }> };
        Skills: { xp(name: string): number };
        Game: { inCombat(): boolean };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
    };
    rs2b0t: {
        runner: { state: string; start(meta: unknown): void; stop(reason: string): void; ctx: { log: { msg: string }[] } | null };
        registry: { get(name: string): unknown };
    };
}

const LOADOUT = JSON.stringify([{ name: 'Melee', worn: { righthand: 'Rune scimitar' }, carry: [{ item: 'Lobster', qty: 8 }] }]);

const client = deployIsolatedClient(`af${Date.now().toString(36).slice(-6)}`, process.env.ENGINE_DIR ?? `${process.env.HOME}/code/lostcity-dev/engine`);
const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
try {
    await page.goto(`${base}${client.page}`);
    await boot(page);
    if (!(await login(page, user))) {
        fail('login failed');
    }
    await bringUpOffIsland(page, { user });
    console.log(`ingame as ${user}`);

    for (const stat of ['attack', 'strength', 'defence', 'hitpoints']) {
        await cheatQuiet(page, `setstat ${stat} 60`, 800);
    }
    await cheatQuiet(page, 'setstat thieving 40', 800);
    await cheatQuiet(page, `give cake ${SEEDED_CAKES}`, 1500);
    await cheatQuiet(page, `tele 0,${ANCHOR.x >> 6},${ANCHOR.z >> 6},${ANCHOR.x & 63},${ANCHOR.z & 63}`, 3500);

    await setSettings(page, 'Loadouts', { sets: LOADOUT });
    await setSettings(page, 'ArdyFighter', {
        loadout: 'Melee',
        foodTarget: FOOD_TARGET,
        solveClues: false,
        bankStrategy: 'Off'
    });

    const seeded = await page.evaluate(() => {
        const api = (globalThis as never as Api).__rs2b0t;
        return {
            cakes: api.Inventory.items().filter(i => (i.name ?? '').toLowerCase().includes('cake')).length,
            tile: api.reader.worldTile()
        };
    });
    if (seeded.cakes < FOOD_TARGET) {
        fail(`expected a stocked pack, cakes=${seeded.cakes}`);
    }
    console.log(`seeded cakes=${seeded.cakes} at ${JSON.stringify(seeded.tile)}, loadout food is Lobster`);

    const xpBefore = await page.evaluate(() =>
        ['attack', 'strength', 'defence', 'hitpoints'].reduce((n, s) => n + (globalThis as never as Api).__rs2b0t.Skills.xp(s), 0)
    );

    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('ArdyFighter');
        if (!meta) {
            throw new Error('ArdyFighter not registered');
        }
        g.rs2b0t.runner.start(meta);
    });
    console.log('ArdyFighter started — watching for combat XP, not for stall spin');

    const deadline = Date.now() + RUN_MS;
    let stocked = 0;
    let xpGained = 0;
    let fought = false;
    while (Date.now() < deadline) {
        const snap = await page.evaluate(() => {
            const g = globalThis as never as Api;
            return {
                logs: (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg),
                state: g.rs2b0t.runner.state,
                combat: g.__rs2b0t.Game.inCombat(),
                xp: ['attack', 'strength', 'defence', 'hitpoints'].reduce((n, s) => n + g.__rs2b0t.Skills.xp(s), 0)
            };
        });
        stocked = snap.logs.filter(m => /stall food/i.test(m)).length;
        xpGained = snap.xp - xpBefore;
        fought = fought || snap.combat || xpGained > 0;
        if (snap.state !== 'running') {
            fail(`script stopped early: ${snap.logs.slice(-6).join(' | ')}`);
        }
        if (stocked > STOCKED_CAP) {
            fail(`stall spin is back — ${stocked} "stocked N stall food" lines: ${snap.logs.slice(-4).join(' | ')}`);
        }
        if (fought && xpGained > 0) {
            break;
        }
        await page.waitForTimeout(1500);
    }

    const logs = await page.evaluate(() =>
        ((globalThis as never as Api).rs2b0t.runner.ctx?.log ?? []).slice(-20).map(l => l.msg)
    );
    console.log('--- recent logs ---');
    for (const m of logs) {
        console.log(`  ${m}`);
    }
    await page.screenshot({ path: 'docs/e2e/ardyfighter-restock-loop-live.png' });
    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.stop('harness stop'));

    if (xpGained <= 0) {
        fail(`no combat XP in ${RUN_MS / 1000}s — the bot never left the stall (stocked lines=${stocked})`);
    }
    console.log(`PASS — combat xp +${xpGained}, "stocked" lines=${stocked} (cap ${STOCKED_CAP})`);
} finally {
    client.cleanup();
    await browser.close();
}
