import { bootAndLogin } from './boot.js';

const t0 = performance.now();
const stamp = (s: string): void => console.log(`  ${((performance.now() - t0) / 1000).toFixed(1)}s ${s}`);

const _booted = await bootAndLogin();

const { LiveSnapshotSource } = await import('../../do-not-touch/apiv2/snapshots/LiveSnapshotSource.js');
const { createInteractions } = await import('../../do-not-touch/apiv2/interaction/createInteractions.js');
const { liveDriver } = await import('../../do-not-touch/apiv2/interaction/LiveInteractionDriver.js');
const { ReadContext } = await import('../../do-not-touch/apiv2/ReadApi.js');
const { Traveller } = await import('../../do-not-touch/apiv2/travel/Traveller.js');
const { router } = await import('../../do-not-touch/apiv2/nav/router.js');
const { idxOf } = await import('../../do-not-touch/apiv2/nav/types.js');
const { DESTINATIONS } = await import('../../do-not-touch/scripts/travel/destinations.js');

const source = new LiveSnapshotSource();
const { interactions, settle } = createInteractions({ source, driver: liveDriver });
const read = (): InstanceType<typeof ReadContext> => new ReadContext(source.read());
const traveller = new Traveller(source, interactions, settle);

stamp('building router');
const nav = router();
stamp(`router ready — walking to all ${DESTINATIONS.length} destinations, no teleports`);

type Row = {
    order: number;
    label: string;
    verdict: 'PASS' | 'FAIL';
    legs: number;
    tiles: number;
    from: string;
    detail: string;
    seconds: number;
};
const rows: Row[] = [];
const remaining = [...DESTINATIONS];
let order = 0;

while (remaining.length > 0) {
    const here = read().worldTile();
    if (here === null) {
        stamp('lost the world tile — stopping');
        break;
    }

    remaining.sort(
        (a, b) =>
            Math.max(Math.abs(a.tile.x - here.x), Math.abs(a.tile.z - here.z)) -
            Math.max(Math.abs(b.tile.x - here.x), Math.abs(b.tile.z - here.z))
    );
    const dest = remaining.shift()!;
    order++;

    const legStart = performance.now();
    const from = `${here.x},${here.z}`;
    const chatBefore = read().chat().latestSequence();
    const route = nav.route(idxOf(here.level, here.x, here.z), idxOf(dest.tile.level, dest.tile.x, dest.tile.z));

    if (!route.ok) {
        rows.push({ order, label: dest.label, verdict: 'FAIL', legs: 0, tiles: 0, from, detail: 'planner found no route from here', seconds: 0 });
        stamp(`FAIL ${order}/${DESTINATIONS.length} ${dest.label} — no route from ${from}`);
        continue;
    }

    stamp(`--> ${order}/${DESTINATIONS.length} ${dest.label}: ${route.legs.length} legs, ${route.tiles} tiles from ${from}`);
    const outcome = await traveller.follow(route);

    const at = read().worldTile()!;
    const gap = Math.max(Math.abs(at.x - dest.tile.x), Math.abs(at.z - dest.tile.z));
    const ok = outcome.kind === 'arrived' && gap <= 3;
    const seconds = (performance.now() - legStart) / 1000;

    rows.push({
        order,
        label: dest.label,
        verdict: ok ? 'PASS' : 'FAIL',
        legs: route.legs.length,
        tiles: route.tiles,
        from,
        detail: ok
            ? `${gap} tiles off`
            : `${outcome.kind}${outcome.kind === 'blocked' ? `: ${outcome.detail}` : outcome.kind === 'refused' ? `: ${outcome.reason}` : outcome.kind === 'stalled' ? `: ${outcome.why}` : ''}, ${gap} tiles off`,
        seconds,
    });
    stamp(`${ok ? 'PASS' : 'FAIL'} ${dest.label} — ${outcome.kind}, ${gap} off, ${seconds.toFixed(0)}s`);
    if (!ok) {

        const said = read().chat().since(chatBefore).results().map(l => l.text);
        if (said.length) stamp(`    game said: ${JSON.stringify(said.slice(0, 12))}`);
        const at2 = read().worldTile()!;
        stamp(`    standing ${at2.x},${at2.z} level ${at2.level}; sceneLevel=${read().scene().base().level} sceneState=${read().sceneState()}`);
        stamp(`    outcome: ${JSON.stringify(outcome).slice(0, 240)}`);
    }
}

console.log('\n\n# Every curated destination, walked\n');
console.log('| # | Destination | Legs | Tiles | Walked from | Result | Detail | Secs |');
console.log('|---|---|---|---|---|---|---|---|');
for (const r of rows) {
    console.log(`| ${r.order} | ${r.label} | ${r.legs} | ${r.tiles} | ${r.from} | ${r.verdict} | ${r.detail.slice(0, 70)} | ${r.seconds.toFixed(0)} |`);
}

const fail = rows.filter(r => r.verdict === 'FAIL');
console.log(`\n**${rows.length - fail.length} PASS** | **${fail.length} FAIL** | ${rows.length} of ${DESTINATIONS.length} attempted`);
if (fail.length) console.log(`\nFailed: ${fail.map(f => f.label).join(', ')}`);
console.log(`\ncompleted in ${((performance.now() - t0) / 60_000).toFixed(1)} minutes`);
process.exit(fail.length === 0 ? 0 : 1);
