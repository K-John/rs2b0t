/**
 * Live proof for the loadout panel: open it in a real client, define a loadout,
 * and confirm it survives a reload. Item icons only render against a loaded
 * cache, which is the half a DOM test cannot cover.
 *
 *   HEADED=1 bun tools/loadout-panel-live.ts
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

import { launchBrowser } from './lib/harness.js';
import { mainlandAccount } from './tutorial/harness.js';

const base = process.env.BASE ?? 'http://localhost:8890';
const user = `load${Date.now().toString(36).slice(-6)}`;
const deploy = !process.argv.includes('--no-deploy');

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

/** A live run loads the deployed bundle, never the working tree. */
function deployBundle(): void {
    const engine = process.env.ENGINE_DIR ?? `${homedir()}/code/rs2b2t-engine`;
    const botDir = `${engine}/public/bot`;
    if (!existsSync(botDir)) {
        fail(`deploy: ${botDir} not found — set ENGINE_DIR to the engine serving ${base}`);
    }
    const build = Bun.spawnSync(['bun', 'run', 'build:bot'], { stdout: 'pipe', stderr: 'pipe' });
    if (build.exitCode !== 0) {
        fail(`deploy: build:bot failed\n${build.stderr.toString()}`);
    }
    const copy = Bun.spawnSync(['sh', '-c', `cp out/botclient.js out/botclient.js.map "${botDir}/"`]);
    if (copy.exitCode !== 0) {
        fail(`deploy: could not copy the bundle into ${botDir}`);
    }
    console.log(`deploy: fresh botclient.js -> ${botDir}`);
}

if (deploy) {
    deployBundle();
}

const browser = await launchBrowser({ swiftshader: true });
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    await mainlandAccount(page, base, user);
    console.log(`mainland-ready as '${user}'`);

    await page.click('button:has-text("Loadouts")');
    await page.click('[data-action=new]');
    await page.click('[data-slot=righthand]');
    await page.fill('[data-role=item-search]', 'Rune scimitar');
    await page.click('[data-item="Rune scimitar"]');
    console.log('picked Rune scimitar for the weapon slot');

    // The client streams item models on demand, so the icon is not there the
    // instant the slot is filled — the panel fills it in once the sprite builds.
    // A freshly-logged-in client has never seen a rune scimitar.
    try {
        await page.waitForSelector('[data-slot=righthand] img', { timeout: 20_000 });
        console.log('item icon filled in from the client cache');
    } catch {
        fail('weapon slot never rendered an icon — the panel gave up before the model streamed in');
    }

    await page.reload();
    await page.waitForSelector('button:has-text("Loadouts")', { timeout: 180_000 });
    await page.click('button:has-text("Loadouts")');
    const worn = await page.getAttribute('[data-slot=righthand]', 'data-item');
    if (worn !== 'Rune scimitar') {
        fail(`after reload the weapon slot read '${worn}', wanted 'Rune scimitar'`);
    }
    console.log('PASS (loadout defined, icon rendered, survived a reload)');
} finally {
    await browser.close();
}
