import { boot, cheatQuiet, launchBrowser, login, parseArgs, bringUpOffIsland } from './lib/harness.js';
const { base } = parseArgs(process.argv.slice(2), { base: 'http://localhost:8888' });
const user = `web${Date.now() % 100000}`;
type Abi = { __rs2b0t: { Locs: { query(): { name(n: string): { results(): { id: number; tile(): { x: number; z: number; level: number }; actions(): string[] }[] } } }; Game: { tile(): unknown } } };
const browser = await launchBrowser();
const page = await browser.newPage();
try {
    await page.goto(`${base}/bot.html`);
    await boot(page); await login(page, user); await bringUpOffIsland(page, { user });
    await cheatQuiet(page, 'tele 0,49,61,10,24', 4000); // 3154,3928
    const r = await page.evaluate(() => {
        const g = (globalThis as never as Abi).__rs2b0t;
        return { me: g.Game.tile(), webs: g.Locs.query().name('Web').results().map(l => ({ id: l.id, tile: l.tile(), ops: l.actions() })) };
    });
    console.log('me:', JSON.stringify(r.me));
    for (const w of r.webs) console.log('  Web', w.id, JSON.stringify(w.tile), JSON.stringify(w.ops));
} finally { await browser.close(); }
