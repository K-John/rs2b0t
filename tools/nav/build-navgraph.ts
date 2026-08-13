import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { stepGrid } from '../../do-not-touch/apiv2/nav/grid.js';
import { buildCollisionGrid } from '../../do-not-touch/apiv2/nav/doors.js';
import { tickCosts } from '../../do-not-touch/apiv2/nav/costs.js';
import { buildGraph } from '../../do-not-touch/apiv2/nav/router.js';
import { Router } from '../../do-not-touch/apiv2/nav/RouterCore.js';
import { encodeGraph, decodeGraph } from '../../do-not-touch/apiv2/nav/graphPack.js';
import { idxOf } from '../../do-not-touch/apiv2/nav/types.js';

const OUT = join(process.cwd(), 'out');

const t0 = performance.now();
const say = (s: string): void => console.log(`  ${((performance.now() - t0) / 1000).toFixed(1)}s ${s}`);

say('building the step grid');
const grid = stepGrid();
buildCollisionGrid();

say('measuring doors and transports');
const costs = tickCosts();
const built = buildGraph(grid, costs);
say(`doors ${built.doorMs.toFixed(0)}ms, transports ${built.transportMs.toFixed(0)}ms`);

say('encoding');
const bytes = encodeGraph(built.graph);

say('verifying: decode, build a router, plan a route');
const graph = decodeGraph(bytes);
const router = new Router(graph);
const route = router.route(idxOf(0, 3222, 3218), idxOf(0, 3185, 3440));
if (!route.ok) throw new Error('build-navgraph: the decoded pack cannot route Lumbridge to Varrock West bank');
say(`route ok: ${route.legs.length} legs, ${route.tiles} tiles, ${route.ticks} ticks`);

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'navgraph.bin'), bytes);
const gz = Bun.gzipSync(new Uint8Array(bytes), { level: 9 });
writeFileSync(join(OUT, 'navgraph.bin.gz'), gz);

const mb = (n: number): string => `${(n / 1024 / 1024).toFixed(1)}MB`;
const kb = (n: number): string => `${(n / 1024).toFixed(0)}KB`;
say(`wrote out/navgraph.bin (${mb(bytes.length)}) and out/navgraph.bin.gz (${kb(gz.length)})`);
