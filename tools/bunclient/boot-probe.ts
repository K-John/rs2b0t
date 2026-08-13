import { installBrowserShim } from './shim.js';

if (!process.env.LOGIN_RSAN) {
    const engine = process.env.ENGINE_DIR ?? `${process.env.HOME}/code/rs2b2t-engine`;
    const key = `${engine}/data/config/private.pem`;
    const modHex = Bun.spawnSync(['openssl', 'rsa', '-in', key, '-noout', '-modulus'])
        .stdout.toString()
        .split('=')[1]
        ?.trim();

    const expHex = Bun.spawnSync(['sh', '-c', `openssl rsa -in '${key}' -text -noout 2>/dev/null | awk 'BEGIN {c=0} /^publicExponent:/{c=1; next} /^privateExponent:/{c=0} c {gsub(/[:[:space:]]/, ""); printf "%s", $0}'`])
        .stdout.toString()
        .trim();
    if (modHex !== undefined && modHex !== '' && expHex !== '') {
        process.env.LOGIN_RSAN = BigInt(`0x${modHex}`).toString();
        process.env.LOGIN_RSAE = BigInt(`0x${expHex}`).toString();
    }
}

installBrowserShim();

const USER = process.env.USER_NAME ?? 'abfixture4';
const BOOT_MS = Number(process.env.BOOT_MS ?? 120_000);

const rssMb = (): number => Math.round(process.memoryUsage.rss() / 1048576);
const stamp = (label: string): void => console.log(`  ${((performance.now() - t0) / 1000).toFixed(1)}s rss=${rssMb()}MB ${label}`);
const t0 = performance.now();

stamp('shim installed, importing client bundle entry…');

const main = (await import('../../src/bot/main.js')) as never as Record<string, unknown>;
stamp(`bundle entry imported (exports: ${Object.keys(main).join(', ') || 'none'})`);

const g = globalThis as never as {
    rs2b0t?: {
        client: { ingame: boolean; sceneState: number; constructor: { loopCycle: number } };
        reader: { ingame(): boolean; localPlayerName(): string | null; worldTile(): unknown };
    };
};

if (g.rs2b0t === undefined) {
    console.log('  FINDING: the entry evaluated but did not self-boot — rs2b0t global absent.');
    console.log('  The canvas gate in main.ts likely did not see the shim canvas. Next: trace the boot condition.');
    process.exit(1);
}
stamp('rs2b0t global present — client constructed');

const until = async (cond: () => boolean, ms: number): Promise<boolean> => {
    const deadline = performance.now() + ms;
    while (performance.now() < deadline) {
        if (cond()) {
            return true;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    return false;
};

if (!(await until(() => (g.rs2b0t!.client.constructor.loopCycle ?? 0) > 10, BOOT_MS))) {
    stamp('FINDING: title loop never started — asset download or frame pump is stuck');
    process.exit(1);
}
stamp('title loop running (loopCycle > 10) — assets downloaded, frame pump alive');

const { loginModulus } = await import('../../src/client/config/loginKey.js');
if (loginModulus() === 0n) {
    stamp('FINDING: no login key — openssl derivation failed and the engine serves none');
    process.exit(1);
}
stamp('RSA login key derived from the engine keypair');

const RealWS = globalThis.WebSocket;
(globalThis as never as Record<string, unknown>).WebSocket = class extends RealWS {
    constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        stamp(`ws: connecting ${String(url)}`);
        this.addEventListener('open', () => stamp('ws: open'));
        this.addEventListener('error', () => stamp('ws: error'));
        this.addEventListener('close', e => stamp(`ws: close code=${(e as CloseEvent).code}`));
    }
};

const client = g.rs2b0t.client as never as { loginUser: string; loginPass: string; login(u: string, p: string, reconnect: boolean): Promise<void> };
client.loginUser = USER;
client.loginPass = 'test';
void client.login(USER, 'test', false);
stamp(`login dispatched for '${USER}'`);

if (!(await until(() => g.rs2b0t!.client.ingame && g.rs2b0t!.client.sceneState === 2, 60_000))) {
    const message = (g.rs2b0t.reader as never as { loginMessage(): string }).loginMessage?.() ?? '?';
    stamp(`FINDING: login never reached ingame — login screen says: ${JSON.stringify(message)}`);
    process.exit(1);
}
stamp(`INGAME as ${g.rs2b0t.reader.localPlayerName()} at ${JSON.stringify(g.rs2b0t.reader.worldTile())}`);
stamp('boot probe complete — the client runs under bun');
process.exit(0);
