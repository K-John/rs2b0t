import { Router } from './RouterCore';
import { decodeGraph } from './graphPack';

let pending: Promise<Router> | null = null;

export function browserRouter(): Promise<Router> {
    pending ??= (async () => {
        const url = new URL('./navgraph.bin.gz', import.meta.url);
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`nav: could not fetch ${url.pathname} (${response.status})`);
        }
        const gz = new Uint8Array(await response.arrayBuffer());

        const raw = gz[0] === 0x1f && gz[1] === 0x8b
            ? new Uint8Array(await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
            : gz;
        return new Router(decodeGraph(raw));
    })();
    return pending;
}
