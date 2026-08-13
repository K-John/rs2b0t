const BASE = process.env.BASE ?? 'http://localhost:8890';

function makeContext2D(canvas: FakeCanvas): unknown {
    const imageData = (w: number, h: number): { data: Uint8ClampedArray; width: number; height: number } => ({
        data: new Uint8ClampedArray(Math.max(1, w | 0) * Math.max(1, h | 0) * 4),
        width: w,
        height: h
    });
    const real: Record<string, unknown> = {
        canvas,
        measureText: () => ({ width: 0 }),
        getImageData: (_x: number, _y: number, w: number, h: number) => imageData(w, h),
        createImageData: (w: number, h: number) => imageData(w, h)
    };
    const noop = (): void => {};
    return new Proxy(real, {
        get(target, prop: string) {
            if (prop in target) {
                return target[prop];
            }
            return noop;
        },
        set(target, prop: string, value) {
            target[prop] = value;
            return true;
        }
    });
}

class FakeCanvas {
    id = '';
    width = 789;
    height = 532;
    style: Record<string, string> = {};
    private context: unknown = null;
    getContext(): unknown {
        this.context ??= makeContext2D(this);
        return this.context;
    }
    addEventListener(): void {}
    removeEventListener(): void {}
    getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
        return { left: 0, top: 0, width: this.width, height: this.height };
    }
    toDataURL(): string {
        return 'data:,';
    }
    focus(): void {}
    requestFullscreen(): Promise<void> {
        return Promise.resolve();
    }
}

class FakeImage {
    naturalWidth = 128;
    naturalHeight = 128;
    onload: (() => void) | null = null;
    private _src = '';
    set src(value: string) {
        this._src = value;
        queueMicrotask(() => this.onload?.());
    }
    get src(): string {
        return this._src;
    }
}

class FakeElement {
    style: Record<string, string> = {};
    children: unknown[] = [];
    classList = { add(): void {}, remove(): void {}, toggle(): void {} };
    setAttribute(): void {}
    appendChild(child: unknown): unknown {
        this.children.push(child);
        return child;
    }
    removeChild(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
    click(): void {}
    focus(): void {}
    href = '';
    download = '';
}

export function installBrowserShim(): void {
    const g = globalThis as never as Record<string, unknown>;
    if (g.__bunClientShim === true) {
        return;
    }
    g.__bunClientShim = true;

    const gameCanvas = new FakeCanvas();
    gameCanvas.id = 'canvas';

    const document = {
        getElementById: (id: string): unknown => (id === 'canvas' ? gameCanvas : null),
        createElement: (tag: string): unknown => (tag === 'canvas' ? new FakeCanvas() : tag === 'img' ? new FakeImage() : new FakeElement()),
        body: new FakeElement(),
        documentElement: new FakeElement(),
        addEventListener: (): void => {},
        removeEventListener: (): void => {},
        hasFocus: (): boolean => true,
        visibilityState: 'visible',
        title: ''
    };

    const window = {
        location: new URL(`${BASE}/bot.html`),
        addEventListener: (): void => {},
        removeEventListener: (): void => {},
        devicePixelRatio: 1,
        innerWidth: 789,
        innerHeight: 532,
        performance,
        document,
        setTimeout,
        clearTimeout,
        requestAnimationFrame: (cb: (t: number) => void): number => setTimeout(() => cb(performance.now()), 20) as never,
        cancelAnimationFrame: (handle: number): void => clearTimeout(handle)
    };

    const realFetch = globalThis.fetch.bind(globalThis);
    const traceFetch = process.env.NATIVE_TRACE_FETCH === '1';
    g.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input instanceof Request ? input.url : input);
        let target: RequestInfo | URL = input;

        if (url.endsWith('.sf2') || url.endsWith('.lcnav.gz')) {
            target = `${BASE}/bot/${url.split('/').pop()}`;
        } else if (url.startsWith('/')) {

            target = `${BASE}${url}`;
        }
        try {
            const response = await realFetch(target as never, init);
            if (traceFetch && !response.ok) {
                console.warn(`[shim.fetch] ${url} -> HTTP ${response.status}`);
            }
            return response;
        } catch (error) {
            if (traceFetch) {
                console.warn(`[shim.fetch] ${url} THREW ${String(error).split('\n')[0]}`);
            }
            throw error;
        }
    };

    const RealWorker = globalThis.Worker;
    const WORKER_SOURCES: Record<string, string> = {
        'ondemandworker.js': new URL('../../src/client/io/OnDemandWorker.ts', import.meta.url).href
    };
    g.Worker = class extends RealWorker {
        constructor(scriptURL: string | URL, options?: WorkerOptions) {
            const name = String(scriptURL).split('/').pop() ?? '';
            const resolved = WORKER_SOURCES[name] ?? scriptURL;
            super(resolved, options);
            console.warn(`[shim.worker] ${name} -> ${String(resolved).split('/').slice(-3).join('/')}`);

            this.addEventListener('error', event => {
                console.warn(`[shim.worker] ${name} ERROR: ${(event as ErrorEvent).message ?? 'unknown'}`);
            });
        }
    };

    g.document = document;
    g.window = window;
    g.location = window.location;
    g.Image = FakeImage;
    g.HTMLCanvasElement = FakeCanvas;
    g.requestAnimationFrame = window.requestAnimationFrame;
    g.cancelAnimationFrame = window.cancelAnimationFrame;
    if (g.navigator === undefined) {
        g.navigator = { userAgent: 'bun-client', language: 'en', platform: 'bun' };
    }
    if (g.localStorage === undefined) {
        const store = new Map<string, string>();
        g.localStorage = {
            getItem: (k: string): string | null => store.get(k) ?? null,
            setItem: (k: string, v: string): void => void store.set(k, v),
            removeItem: (k: string): void => void store.delete(k),
            clear: (): void => store.clear(),
            get length(): number {
                return store.size;
            },
            key: (i: number): string | null => [...store.keys()][i] ?? null
        };
    }
    if (g.AudioContext === undefined) {
        class FakeAudioContext {
            destination = {};
            currentTime = 0;
            sampleRate = 44100;
            createBufferSource(): Record<string, unknown> {
                return { connect: () => undefined, start: () => undefined, stop: () => undefined, buffer: null, onended: null, playbackRate: { value: 1 } };
            }
            createBuffer(_ch: number, length: number, _rate: number): { getChannelData(): Float32Array; copyToChannel(): void } {
                return { getChannelData: () => new Float32Array(Math.max(0, length)), copyToChannel: () => undefined };
            }
            createGain(): Record<string, unknown> {
                return {
                    connect: () => undefined,
                    disconnect: () => undefined,
                    gain: {
                        value: 1,
                        setValueAtTime: () => undefined,
                        linearRampToValueAtTime: () => undefined,
                        exponentialRampToValueAtTime: () => undefined,
                        cancelScheduledValues: () => undefined,
                        setTargetAtTime: () => undefined
                    }
                };
            }
            resume(): Promise<void> {
                return Promise.resolve();
            }
            close(): Promise<void> {
                return Promise.resolve();
            }
        }
        g.AudioContext = FakeAudioContext;

        (window as never as Record<string, unknown>).audioContext = new FakeAudioContext();
    }
}
