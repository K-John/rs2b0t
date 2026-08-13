import { installBrowserShim } from './shim.js';

const BASE = process.env.BASE ?? 'http://localhost:8890';

function deriveLoginKey(): void {
    if (process.env.LOGIN_RSAN) {
        return;
    }
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

let clientLoaded: Promise<void> | null = null;

function loadClient(): Promise<void> {
    clientLoaded ??= (async () => {
        deriveLoginKey();
        installBrowserShim();
        await import('../../src/bot/main.js');
    })();
    return clientLoaded;
}

type ConsoleHandler = (msg: { type(): string; text(): string }) => void;

function teeConsole(type: 'warning' | 'error', original: (...args: unknown[]) => void, handlers: Set<ConsoleHandler>): (...args: unknown[]) => void {
    return (...args: unknown[]): void => {
        original(...args);
        const text = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
        for (const handler of handlers) {
            handler({ type: () => type, text: () => text });
        }
    };
}

const consoleHandlers = new Set<ConsoleHandler>();
let teed = false;

export function createNativePage(): unknown {
    let closed = false;

    const myHandlers = new Set<ConsoleHandler>();

    const page = {
        async goto(_url: string): Promise<void> {
            await loadClient();
        },
        async evaluate<T>(fn: ((arg: never) => T) | string, arg?: unknown): Promise<T> {
            await loadClient();
            if (typeof fn === 'string') {

                throw new Error('nativePage.evaluate: string scripts are not supported');
            }
            const result = await fn(arg as never);

            await new Promise(resolve => setTimeout(resolve, 0));
            return result;
        },
        async waitForFunction(fn: (arg: never) => unknown, arg?: unknown, opts?: { timeout?: number }): Promise<void> {
            await loadClient();
            const deadline = Date.now() + (opts?.timeout ?? 30_000);
            for (;;) {
                if (await fn(arg as never)) {
                    return;
                }
                if (Date.now() >= deadline) {
                    throw new Error('nativePage.waitForFunction: timeout');
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        },
        waitForTimeout(ms: number): Promise<void> {
            return new Promise(resolve => setTimeout(resolve, ms));
        },
        on(event: string, handler: ConsoleHandler): void {
            if (event === 'console') {
                consoleHandlers.add(handler);
                myHandlers.add(handler);

                if (!teed) {
                    teed = true;
                    console.warn = teeConsole('warning', console.warn.bind(console), consoleHandlers);
                    console.error = teeConsole('error', console.error.bind(console), consoleHandlers);
                }
            }

        },
        isClosed(): boolean {
            return closed;
        },

        async close(): Promise<void> {
            closed = true;

            for (const handler of myHandlers) {
                consoleHandlers.delete(handler);
            }
            myHandlers.clear();
            const client = (globalThis as never as { rs2b0t?: { client?: { ingame: boolean; logout?: () => Promise<void> } } }).rs2b0t?.client;
            if (client?.ingame === true && typeof client.logout === 'function') {
                await client.logout().catch(() => undefined);
                for (let i = 0; i < 60 && client.ingame; i++) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
        },
        async title(): Promise<string> {
            return 'rs2b0t (native)';
        },
        locator(): { click(): Promise<void> } {
            console.warn('nativePage: locator() is a no-op — use packet cheats');
            return { click: async () => undefined };
        },
        keyboard: {
            async type(): Promise<void> {
                console.warn('nativePage: keyboard.type is a no-op — use packet cheats');
            },
            async press(): Promise<void> {}
        }
    };
    return page;
}

export function createNativeBrowser(): unknown {
    return {
        isConnected: (): boolean => true,
        newPage: async (): Promise<unknown> => createNativePage(),
        close: async (): Promise<void> => undefined,
        process: (): null => null,
        on: (): void => undefined
    };
}

export { BASE as NATIVE_BASE };
