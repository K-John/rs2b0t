import { bootAndLogin } from './boot.js';

const t0 = performance.now();
const stamp = (s: string): void => console.log(`  ${((performance.now() - t0) / 1000).toFixed(1)}s ${s}`);

const booted = await bootAndLogin();
const client = booted.client;

const { teleportTo } = await import('./testSetup.js');
const { LiveSnapshotSource } = await import('../../do-not-touch/apiv2/snapshots/LiveSnapshotSource.js');
const { createInteractions } = await import('../../do-not-touch/apiv2/interaction/createInteractions.js');
const { liveDriver } = await import('../../do-not-touch/apiv2/interaction/LiveInteractionDriver.js');
const { ReadContext } = await import('../../do-not-touch/apiv2/ReadApi.js');
const { Traveller } = await import('../../do-not-touch/apiv2/travel/Traveller.js');
const { router } = await import('../../do-not-touch/apiv2/nav/router.js');
const { idxOf } = await import('../../do-not-touch/apiv2/nav/types.js');
const { destinationByLabel } = await import('../../do-not-touch/scripts/travel/destinations.js');

const source = new LiveSnapshotSource();
const { interactions, settle } = createInteractions({ source, driver: liveDriver });
const read = (): InstanceType<typeof ReadContext> => new ReadContext(source.read());
const traveller = new Traveller(source, interactions, settle);

stamp('building router');
const nav = router();
stamp('router ready');

const START = { x: 3092, z: 3243, level: 0 };
const TRIPS = ['Varrock West bank', 'Falador East bank', 'Barbarian Village', 'Al Kharid bank'];

type Row = { to: string; verdict: 'PASS' | 'FAIL'; legs: number; tiles: number; detail: string };
const rows: Row[] = [];

for (const label of TRIPS) {
    const dest = destinationByLabel(label)!;
    stamp(`\n=== ${label} ===`);

    if (!(await teleportTo(client, START, () => read().worldTile()))) {
        rows.push({ to: label, verdict: 'FAIL', legs: 0, tiles: 0, detail: 'could not reach the start tile' });
        continue;
    }

    const here = read().worldTile()!;
    const route = nav.route(idxOf(here.level, here.x, here.z), idxOf(dest.tile.level, dest.tile.x, dest.tile.z));
    if (!route.ok) {
        rows.push({ to: label, verdict: 'FAIL', legs: 0, tiles: 0, detail: 'planner found no route' });
        continue;
    }
    stamp(`route: ${route.legs.length} legs, ${route.tiles} tiles`);

    const outcome = await traveller.follow(route, {
        onLeg: (leg, phase, detail) => {
            const me = read().worldTile();
            const pos = me ? `${me.x},${me.z}` : '?';
            if (phase === 'start') stamp(`  leg start (${leg.kind}) at ${pos} locId=${(leg as { locId?: number }).locId ?? '-'}`);
            if (phase === 'done') stamp(`  leg done (${leg.kind}) at ${pos}`);
            if (phase === 'failed') {
                stamp(`  leg FAILED (${leg.kind}): ${detail ?? ''}`);
                const id = (leg as { locId?: number }).locId;
                if (id !== undefined) {
                    const all = read().locs().withId(id).results();
                    stamp(`    locs with id ${id} now: ${all.length}`);
                    for (const l of all.slice(0, 5)) stamp(`      ${l.tile.x},${l.tile.z} level=${l.tile.level} ops=[${l.actions.filter(a => a !== null).join(',')}]`);
                    stamp(`    total locs in scene: ${read().locs().count()}, sceneState=${read().sceneState()}, base=${JSON.stringify(read().scene().base())}`);
                }
            }
        }
    });

    const at = read().worldTile()!;
    const gap = Math.max(Math.abs(at.x - dest.tile.x), Math.abs(at.z - dest.tile.z));
    const arrived = outcome.kind === 'arrived' && gap <= 3;
    stamp(`${outcome.kind} at ${at.x},${at.z} (${gap} tiles from target)`);

    rows.push({
        to: label,
        verdict: arrived ? 'PASS' : 'FAIL',
        legs: route.legs.length,
        tiles: route.tiles,
        detail: `${outcome.kind}, ${gap} tiles off`,
    });
}

console.log('\n\n# Travel probe\n');
console.log('| Destination | Legs | Tiles | Result | Detail |');
console.log('|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.to} | ${r.legs} | ${r.tiles} | ${r.verdict} | ${r.detail} |`);

const fail = rows.filter(r => r.verdict === 'FAIL').length;
console.log(`\n**${rows.length - fail} PASS** | **${fail} FAIL**`);
console.log(`\ncompleted in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
process.exit(fail === 0 ? 0 : 1);
