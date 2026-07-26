// Random-event litter smoke: a runner must bank anything that isn't essence, and a master must
// trade back anything that isn't its talisman or its runes — without ever giving those two away.
// Usage: bun tools/naturecrafter-junk-test.ts [base] [budget-min]

import type { Page } from 'playwright-core';
import { boot, bringUpOffIsland, fail, launchBrowser, login, type } from './lib/harness.js';
import { cheatQuiet, startScript } from './tutorial/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const budgetMin = Number(process.argv[3]) || 12;
const stamp = Date.now().toString(36).slice(-6);
const M_USER = `njm${stamp}`;
const R_USER = `njr${stamp}`;
const RUINS_TELE = '::tele 0,46,51,39,24'; // air Mysterious ruins (2983,3288)
const BANK_TELE = '::tele 0,47,52,5,27'; // Falador East bank (3013,3355)
const JUNK = ['bones', 'bronze_axe']; // debugnames known to work with ~item on this engine

type Abi = {
    __rs2b0t: { Inventory: { items(): { name: string | null; id: number; count: number }[] }; reader: { worldTile(): { x: number; z: number; level: number } | null } };
    rs2b0t: { runner: { state: string; ctx?: { log?: { msg: string }[] } } };
};

async function bringUp(page: Page, user: string): Promise<void> {
    page.on('pageerror', e => console.log(`[${user}] pageerror: ${e}`));
    await page.goto(`${base}/bot.html`);
    await boot(page);
    if (!(await login(page, user))) fail(`${user}: first login failed`);
    await bringUpOffIsland(page, { user });
}

async function teleTo(page: Page, user: string, tele: string): Promise<void> {
    await type(page, tele);
    await page.reload();
    await boot(page);
    let ok = false;
    for (let i = 0; i < 8 && !ok; i++) { await page.waitForTimeout(2500); ok = await login(page, user); }
    if (!ok) fail(`${user}: relogin failed`);
}

function sample(page: Page): Promise<{ names: string[]; junk: string[]; talisman: number; runes: number; state: string; logs: string[] }> {
    return page.evaluate(() => {
        const g = globalThis as never as Abi;
        const items = g.__rs2b0t.Inventory.items();
        const named = items.map(i => (i.name ?? '').toLowerCase()).filter(Boolean);
        const ok = ['rune essence', 'air talisman', 'air rune', 'coins'];
        return {
            names: named,
            junk: named.filter(n => !ok.includes(n)),
            talisman: items.filter(i => (i.name ?? '').toLowerCase() === 'air talisman').length,
            runes: items.filter(i => (i.name ?? '').toLowerCase() === 'air rune').reduce((s, i) => s + Math.max(1, i.count), 0),
            state: g.rs2b0t.runner.state,
            logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-16).map(l => l.msg)
        };
    });
}

const browser = await launchBrowser();
try {
    const ctxM = await browser.newContext();
    const ctxR = await browser.newContext();
    const pageM = await ctxM.newPage();
    const pageR = await ctxR.newPage();

    await bringUp(pageM, M_USER);
    await bringUp(pageR, R_USER);
    await teleTo(pageM, M_USER, RUINS_TELE);
    await teleTo(pageR, R_USER, BANK_TELE);

    // master starts holding litter it must hand back, plus the talisman it must never give away
    await cheatQuiet(pageM, '~clearinv');
    await cheatQuiet(pageM, '~item air_talisman 1');
    for (const j of JUNK) { await cheatQuiet(pageM, `~item ${j} 1`); }
    await pageM.evaluate(n => {
        sessionStorage.setItem('rs2b0t:set:NatureCrafter:rune', 'Air runes');
        sessionStorage.setItem('rs2b0t:set:NatureCrafter:mode', 'Master');
        sessionStorage.setItem('rs2b0t:set:NatureCrafter:partner', n);
        sessionStorage.setItem('rs2b0t:set:NatureCrafter:bankAt', '400');
    }, R_USER);

    // runner starts holding litter it must bank before it can carry a full trade load
    await cheatQuiet(pageR, '~clearinv');
    await cheatQuiet(pageR, '~bankitem blankrune 60');
    for (const j of JUNK) { await cheatQuiet(pageR, `~item ${j} 1`); }
    await pageR.evaluate(n => {
        sessionStorage.setItem('rs2b0t:set:NatureCrafter:rune', 'Air runes');
        sessionStorage.setItem('rs2b0t:set:NatureCrafter:mode', 'Runner');
        sessionStorage.setItem('rs2b0t:set:NatureCrafter:partner', n);
    }, M_USER);
    await pageR.waitForTimeout(800);

    const m0 = await sample(pageM), r0 = await sample(pageR);
    if (m0.junk.length === 0) fail(`master seeding failed — no litter in pack (${m0.names.join(',')})`);
    if (r0.junk.length === 0) fail(`runner seeding failed — no litter in pack (${r0.names.join(',')})`);
    console.log(`seeded litter — master: [${m0.junk.join(', ')}], runner: [${r0.junk.join(', ')}]`);

    await startScript(pageM, 'NatureCrafter');
    await startScript(pageR, 'NatureCrafter');

    const deadline = Date.now() + budgetMin * 60_000;
    let seenM = 0, seenR = 0;
    let m = m0, r = r0;
    let runnerBanked = false, masterHandedBack = false;
    while (Date.now() < deadline) {
        m = await sample(pageM); r = await sample(pageR);
        for (let i = seenR; i < r.logs.length; i++) { console.log(`   [R] ${r.logs[i]}`); }
        seenR = r.logs.length;
        for (let i = seenM; i < m.logs.length; i++) { console.log(`   [M] ${m.logs[i]}`); }
        seenM = m.logs.length;
        const secs = Math.round((budgetMin * 60_000 - (deadline - Date.now())) / 1000);
        console.log(`  t=${secs}s | M junk=[${m.junk.join(',')}] talisman=${m.talisman} runes=${m.runes} | R junk=[${r.junk.join(',')}] | ${m.state}/${r.state}`);

        // the master must never part with these, litter hand-back or not
        if (m.talisman === 0) fail('master lost its Air talisman — it must never be traded away');
        if (r.names.includes('air talisman')) fail('the talisman ended up on the runner — master gave away something precious');

        if (r.logs.some(l => /banked \d+ slot\(s\) of random-event litter/.test(l)) && r.junk.length === 0) { runnerBanked = true; }
        // the master's litter lands on the runner, which banks it on its next restock — same path
        if (m.logs.some(l => /handing .* back to/.test(l)) && m.junk.length === 0) { masterHandedBack = true; }
        if (runnerBanked && masterHandedBack) { break; }
        if (m.state === 'crashed' || r.state === 'crashed') { break; }
        await pageM.waitForTimeout(2500);
    }

    if (runnerBanked && masterHandedBack) {
        console.log(`PASS: runner banked its seeded litter [${r0.junk.join(', ')}] before loading essence; master handed its litter [${m0.junk.join(', ')}] back and kept its talisman (master pack is now talisman + essence only). The returned litter sits on the runner until its next restock banks it the same way.`);
        await browser.close();
        process.exit(0);
    }
    fail(`litter not cleared within ${budgetMin}min [runnerBanked=${runnerBanked} masterHandedBack=${masterHandedBack} Mjunk=${m.junk.join(',')} Rjunk=${r.junk.join(',')} Mstate=${m.state} Rstate=${r.state}]`);
} catch (e) {
    console.error(e);
    fail(String(e));
}
