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

const source = new LiveSnapshotSource();
const { interactions, settle } = createInteractions({ source, driver: liveDriver });
const read = (): InstanceType<typeof ReadContext> => new ReadContext(source.read());
const traveller = new Traveller(source, interactions, settle);

const PRIOR_START = { x: 3208, z: 3428, level: 0 };
const PRIOR_GOAL = { x: 3251, z: 3420, level: 0 };
const GOAL = { x: 3222, z: 3218, level: 0 };

const nav = router();

const snap = (): string => {
    const ctx = read();
    const t = ctx.worldTile();
    const b = ctx.scene().base();
    const p = ctx.localPlayer();
    return `at ${t ? `${t.x},${t.z} L${t.level}` : 'null'} | base ${b.x},${b.z} L${b.level} | sceneState ${ctx.sceneState()} | moving ${p?.moving ?? '?'}`;
};

for (let attempt = 1; attempt <= 3; attempt++) {
    stamp(`\n=== attempt ${attempt} ===`);
    if (!(await teleportTo(client, PRIOR_START, () => read().worldTile()))) {
        stamp('could not get to the start tile');
        continue;
    }
    await settle.until({ arms: { ready: () => read().sceneState() === 2 }, budgetTicks: 30 });

    const p0 = read().worldTile()!;
    const prior = nav.route(idxOf(0, p0.x, p0.z), idxOf(0, PRIOR_GOAL.x, PRIOR_GOAL.z));
    if (prior.ok) {
        const pr = await traveller.follow(prior);
        stamp(`prior hop to Varrock East bank: ${pr.kind} — ${snap()}`);
    }
    stamp(`start: ${snap()}`);

    const here = read().worldTile()!;
    const route = nav.route(idxOf(here.level, here.x, here.z), idxOf(GOAL.level, GOAL.x, GOAL.z));
    if (!route.ok) {
        stamp('no route');
        continue;
    }
    stamp(`route: ${route.legs.length} legs, ${route.tiles} tiles`);

    let last = `${here.x},${here.z},${here.level}`;
    const watch = setInterval(() => {
        const t = read().worldTile();
        if (!t) return;
        const key = `${t.x},${t.z},${t.level}`;
        if (key === last) return;
        const prev = last.split(',').map(Number) as [number, number, number];
        const jump = Math.max(Math.abs(t.x - prev[0]), Math.abs(t.z - prev[1]));
        if (jump > 3 || t.level !== prev[2]) {
            stamp(`  *** JUMP ${prev[0]},${prev[1]} L${prev[2]} -> ${t.x},${t.z} L${t.level} (${jump} tiles) | ${snap()}`);
        }
        last = key;
    }, 200);

    const outcome = await traveller.follow(route, {
        onLeg: (leg, phase, detail) => {
            if (phase === 'start') stamp(`  leg start (${leg.kind}) ${snap()}`);
            if (phase === 'done') stamp(`  leg done  (${leg.kind}) ${snap()}`);
            if (phase === 'failed') stamp(`  leg FAILED (${leg.kind}) ${snap()}\n    ${(detail ?? '').slice(0, 200)}`);
        }
    });

    clearInterval(watch);
    const at = read().worldTile()!;
    const gap = Math.max(Math.abs(at.x - GOAL.x), Math.abs(at.z - GOAL.z));
    stamp(`attempt ${attempt}: ${outcome.kind}, ${gap} tiles off — ${snap()}`);
    if (outcome.kind === 'arrived' && gap <= 3) stamp('  (arrived — this attempt did not reproduce)');
}

process.exit(0);
