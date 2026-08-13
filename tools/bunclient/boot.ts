import { installBrowserShim } from './shim.js';

export interface BootOptions {
    readonly user?: string;
    readonly setup?: boolean;
    readonly loginPatienceMs?: number;
    readonly quiet?: boolean;
}

export interface BootedClient {
    readonly client: { ingame: boolean; sceneState: number; constructor: { loopCycle: number }; login(u: string, p: string, r: boolean): Promise<void>; out: { p1Enc(o: number): void; p1(v: number): void; pjstr(v: string): void } };
    readonly seconds: () => number;
}

const HELD_SESSION = /already logged in/i;

function deriveLoginKey(): void {
    if (process.env.LOGIN_RSAN) return;
    const engine = process.env.ENGINE_DIR ?? `${process.env.HOME}/code/rs2b2t-engine`;
    const key = `${engine}/data/config/private.pem`;
    const modHex = Bun.spawnSync(['openssl', 'rsa', '-in', key, '-noout', '-modulus']).stdout.toString().split('=')[1]?.trim();
    const expHex = Bun.spawnSync([
        'sh',
        '-c',
        `openssl rsa -in '${key}' -text -noout 2>/dev/null | awk 'BEGIN {c=0} /^publicExponent:/{c=1; next} /^privateExponent:/{c=0} c {gsub(/[:[:space:]]/, ""); printf "%s", $0}'`
    ]).stdout.toString().trim();
    if (modHex !== undefined && modHex !== '' && expHex !== '') {
        process.env.LOGIN_RSAN = BigInt(`0x${modHex}`).toString();
        process.env.LOGIN_RSAE = BigInt(`0x${expHex}`).toString();
    }
}

async function waitFor(condition: () => boolean, ms: number): Promise<boolean> {
    const deadline = performance.now() + ms;
    while (performance.now() < deadline) {
        if (condition()) return true;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
}

export async function bootAndLogin(options: BootOptions = {}): Promise<BootedClient> {
    const user = options.user ?? process.env.USER_NAME ?? 'abfixture4';
    const patience = options.loginPatienceMs ?? 150_000;
    const started = performance.now();
    const seconds = (): number => (performance.now() - started) / 1000;
    const say = (message: string): void => {
        if (options.quiet !== true) console.log(`  ${seconds().toFixed(1)}s ${message}`);
    };

    deriveLoginKey();
    installBrowserShim();

    await import('../../src/bot/main.js');
    const g = globalThis as never as { rs2b0t?: { client: BootedClient['client'] } };
    if (g.rs2b0t === undefined) throw new Error('the client did not self-boot — the rs2b0t global is absent');

    const client = g.rs2b0t.client;
    if (!(await waitFor(() => (client.constructor.loopCycle ?? 0) > 10, 120_000))) {
        throw new Error('the title loop never started — assets or the frame pump are stuck');
    }

    const { reader } = await import('../../src/bot/adapter/ClientAdapter.js');

    const deadline = performance.now() + patience;
    let attempt = 0;
    for (;;) {
        attempt++;
        void client.login(user, 'test', false);
        if (await waitFor(() => client.ingame && client.sceneState === 2, 25_000)) break;

        const message = reader.loginMessage();
        if (!HELD_SESSION.test(message)) {
            throw new Error(`never reached ingame — the login screen says ${JSON.stringify(message)}`);
        }
        if (performance.now() >= deadline) {
            throw new Error(`the previous session is still held after ${(patience / 1000).toFixed(0)}s — ${JSON.stringify(message)}`);
        }
        say(`the server still holds the last session (attempt ${attempt}); waiting 15s`);
        await new Promise(resolve => setTimeout(resolve, 15_000));
    }
    say(`ingame as ${user}, scene built`);

    if (options.setup !== false) {
        const { standardSetup, verify } = await import('./testSetup.js');
        const { LiveSnapshotSource } = await import('../../do-not-touch/apiv2/snapshots/LiveSnapshotSource.js');
        standardSetup(client);
        await new Promise(resolve => setTimeout(resolve, 2500));
        const check = verify(new LiveSnapshotSource().read());
        say(`setup: ${check.tile} (Draynor bank: ${check.placed}); ${check.stats}`);
    }

    return { client, seconds };
}
