// Ground-pickup smoke: a noted essence stack on the floor (a dead runner's drop) must be looted.
// The bot's own withdrawn note is dropped from under it, which is the same owner-visible ground obj.
// Usage: bun tools/naturecrafter-pickup-test.ts [base] [budget-min]

import type { Page } from 'playwright-core';
import { boot, bringUpOffIsland, fail, launchBrowser, login, type } from './lib/harness.js';
import { cheatQuiet, startScript } from './tutorial/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const budgetMin = Number(process.argv[3]) || 8;
const USER = `npik${Date.now().toString(36).slice(-6)}`;
const BANK_TELE = '::tele 0,41,51,31,19'; // Ardougne East bank (2655,3283)

type Abi = {
    __rs2b0t: {
        Inventory: { items(): { name: string | null; count: number; interact(op: string): boolean | Promise<boolean> }[] };
        GroundItems: { query(): { where(f: (g: { name: string | null }) => boolean): { results(): { name: string | null; count: number }[] } } };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
    };
    rs2b0t: { runner: { state: string; ctx?: { log?: { msg: string }[] } } };
};

async function teleTo(page: Page, user: string, tele: string): Promise<void> {
    await type(page, tele);
    await page.reload();
    await boot(page);
    let ok = false;
    for (let i = 0; i < 8 && !ok; i++) { await page.waitForTimeout(3000); ok = await login(page, user); }
    if (!ok) fail(`${user}: relogin failed`);
}

function sample(page: Page): Promise<{ noted: number; onGround: number; state: string; logs: string[] }> {
    return page.evaluate(() => {
        const g = globalThis as never as Abi;
        const ess = g.__rs2b0t.Inventory.items().filter(i => (i.name ?? '').toLowerCase() === 'rune essence');
        return {
            noted: ess.filter(i => i.count > 1).reduce((s, i) => s + i.count, 0),
            onGround: g.__rs2b0t.GroundItems.query().where(x => (x.name ?? '').toLowerCase() === 'rune essence').results().reduce((s, x) => s + x.count, 0),
            state: g.rs2b0t.runner.state,
            logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-30).map(l => l.msg)
        };
    });
}

// drop the whole noted stack under the bot — a dead runner's drop looks exactly like this
function dropNote(page: Page): Promise<boolean> {
    return page.evaluate(async () => {
        const g = globalThis as never as Abi;
        const note = g.__rs2b0t.Inventory.items().find(i => (i.name ?? '').toLowerCase() === 'rune essence' && i.count > 1);
        if (!note) { return false; }
        return Boolean(await note.interact('Drop'));
    });
}

const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    await page.goto(`${base}/bot.html`);
    await boot(page);
    if (!(await login(page, USER))) fail('first login failed');
    await bringUpOffIsland(page, { user: USER });
    await teleTo(page, USER, BANK_TELE);
    console.log(`runner '${USER}' at the Ardougne East bank`);

    await cheatQuiet(page, '~clearinv');
    await cheatQuiet(page, '~bankitem blankrune 40');
    await cheatQuiet(page, '~bankitem coins 100000');
    await page.waitForTimeout(800);

    await page.evaluate(() => {
        localStorage.setItem('rs2b0t:set:NatureCrafter:mode', 'Runner');
        localStorage.setItem('rs2b0t:set:NatureCrafter:partner', 'DummyMaster');
    });
    await startScript(page, 'NatureCrafter');
    console.log('runner started — waiting for the noted withdrawal, then dropping it on the floor');

    const deadline = Date.now() + budgetMin * 60_000;
    let s = await sample(page);
    let dropped = 0, seen = 0;
    while (Date.now() < deadline) {
        s = await sample(page);
        for (let i = seen; i < s.logs.length; i++) { console.log(`      · ${s.logs[i]}`); }
        seen = s.logs.length;
        const secs = Math.round((budgetMin * 60_000 - (deadline - Date.now())) / 1000);
        console.log(`  t=${secs}s noted=${s.noted} ground=${s.onGround} dropped=${dropped} state=${s.state}`);

        if (s.state !== 'running') { break; }

        if (dropped === 0 && s.noted > 0) {
            const n = s.noted;
            if (await dropNote(page)) {
                dropped = n;
                console.log(`dropped the ${n}-essence note on the floor — the bot should loot it back`);
            }
            await page.waitForTimeout(1200);
            continue;
        }

        if (dropped > 0 && s.noted >= dropped && s.logs.some(l => /picked up \d+ noted essence/.test(l))) {
            console.log(`PASS: the runner looted the dropped ${dropped}-essence note back off the ground (holding ${s.noted})`);
            await browser.close();
            process.exit(0);
        }

        await page.waitForTimeout(2000);
    }

    fail(`the dropped note was not looted within ${budgetMin}min [dropped=${dropped} noted=${s.noted} ground=${s.onGround} state=${s.state}]`);
} catch (e) {
    console.error(e);
    fail(String(e));
}
