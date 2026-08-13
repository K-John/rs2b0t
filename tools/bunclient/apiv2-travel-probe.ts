import { bootAndLogin } from './boot.js';

const t0 = performance.now();
const stamp = (s: string): void => console.log(`  ${((performance.now() - t0) / 1000).toFixed(1)}s ${s}`);
const _until = async (cond: () => boolean, ms: number): Promise<boolean> => {
    const deadline = performance.now() + ms;
    while (performance.now() < deadline) {
        if (cond()) return true;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
};

const booted = await bootAndLogin();
const _g = { rs2b0t: { client: booted.client } };

const { LiveSnapshotSource } = await import('../../do-not-touch/apiv2/snapshots/LiveSnapshotSource.js');
const { createInteractions } = await import('../../do-not-touch/apiv2/interaction/createInteractions.js');
const { liveDriver } = await import('../../do-not-touch/apiv2/interaction/LiveInteractionDriver.js');
const { Traveller } = await import('../../do-not-touch/apiv2/travel/Traveller.js');
const { ReadContext } = await import('../../do-not-touch/apiv2/ReadApi.js');
const { findRoute } = await import('../../do-not-touch/apiv2/nav/router.js');
const { idxOf } = await import('../../do-not-touch/apiv2/nav/types.js');

const source = new LiveSnapshotSource();
const { interactions, settle } = createInteractions({ source, driver: liveDriver });
const read = (): InstanceType<typeof ReadContext> => new ReadContext(source.read());

let clicks = 0;
const counting = {
    dispatch(command: Parameters<typeof liveDriver.dispatch>[0]): boolean {
        if (command.kind === 'walk') clicks++;
        return liveDriver.dispatch(command);
    }
};
const counted = createInteractions({ source, driver: counting });
const traveller = new Traveller(source, counted.interactions, counted.settle);
void interactions;
void settle;

const from = read().worldTile()!;

const goal = {
    x: Number(process.argv[2] ?? 3222),
    z: Number(process.argv[3] ?? 3218),
    level: Number(process.argv[4] ?? 0)
};

stamp(`planning ${from.x},${from.z} → ${goal.x},${goal.z}`);
const planStarted = performance.now();
let route = findRoute(idxOf(from.level, from.x, from.z), idxOf(goal.level, goal.x, goal.z));
if (!route.ok && route.closest !== undefined && route.closest !== null) {

    stamp(`exact goal unreachable (${route.reason}); retrying to the nearest tile it reached`);
    route = findRoute(idxOf(from.level, from.x, from.z), route.closest);
}
stamp(`planner: ${route.ok ? `${route.legs.length} legs, ${route.tiles} tiles, ${route.ticks} ticks` : 'still no route'} in ${(performance.now() - planStarted).toFixed(0)}ms`);

if (!route.ok) process.exit(1);
const target = route.legs.length > 0 ? route.legs[route.legs.length - 1]!.to : idxOf(goal.level, goal.x, goal.z);
const targetTile = (await import('../../do-not-touch/apiv2/nav/types.js')).tileOf(target);

for (const leg of route.legs) {
    stamp(`  leg ${leg.kind}: ${leg.tiles} tiles${leg.path ? `, path carries ${leg.path.length}` : ', NO PATH'}${leg.locName ? `, via ${leg.locName}` : ''}`);
}

stamp('walking…');
const walkStarted = performance.now();
const outcome = await traveller.follow(route, {
    closeEnough: 2,
    budgetTicksPerHop: 60,
    maxHops: 120,
    onLeg: (leg, phase, detail) => {
        if (phase === 'start') return;
        const where = read().worldTile();
        stamp(`  ${phase === 'done' ? 'ok  ' : 'FAIL'} ${leg.kind.padEnd(7)}${leg.locName ? ` ${leg.locName}` : ''} — now at ${where?.x},${where?.z} L${where?.level}${detail ? ` ${detail}` : ''}`);
    }
});
const seconds = (performance.now() - walkStarted) / 1000;

const ended = read().worldTile()!;
const gap = Math.max(Math.abs(ended.x - targetTile.x), Math.abs(ended.z - targetTile.z));
stamp(`ended '${outcome.kind}' at ${ended.x},${ended.z} level ${ended.level} — ${gap} tiles from the goal, in ${seconds.toFixed(1)}s`);
if (outcome.kind !== 'arrived') stamp(`  detail: ${JSON.stringify(outcome)}`);
stamp(`clicks sent: ${clicks} for a ${route.tiles}-tile route (${(route.tiles / Math.max(clicks, 1)).toFixed(1)} tiles per click)`);

process.exit(outcome.kind === 'arrived' && gap <= 2 ? 0 : 1);
