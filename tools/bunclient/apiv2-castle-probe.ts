import { bootAndLogin } from './boot.js';

const booted = await bootAndLogin({ setup: false });

const { teleport } = await import('./testSetup.js');
teleport(booted.client, { x: 3212, z: 3465, level: 0 });
await new Promise(resolve => setTimeout(resolve, 3000));

const { LiveSnapshotSource } = await import('../../do-not-touch/apiv2/snapshots/LiveSnapshotSource.js');
const { ReadContext } = await import('../../do-not-touch/apiv2/ReadApi.js');
const { findRoute } = await import('../../do-not-touch/apiv2/nav/router.js');
const { idxOf, tileOf } = await import('../../do-not-touch/apiv2/nav/types.js');

const source = new LiveSnapshotSource();
const read = (): InstanceType<typeof ReadContext> => new ReadContext(source.read());

const me = read().worldTile()!;
console.log(`\nat ${me.x},${me.z} level ${me.level}\n`);

console.log('doors and gates within 8 tiles:');
for (const loc of read()
    .locs()
    .results()
    .filter(l => /door|gate/i.test(l.name ?? '') && l.distance <= 8)
    .sort((a, b) => a.distance - b.distance)) {
    console.log(`  ${loc.name} id=${loc.id} at ${loc.tile.x},${loc.tile.z} [${loc.layer}] dist=${loc.distance} ops=${JSON.stringify(loc.actions.filter(a => a !== null))}`);
}

console.log('\nwhat the live collision says about the way north:');
const scene = read().scene();
for (let z = me.z; z <= me.z + 8; z++) {
    const tile = { x: 3213, z, level: 0 };
    console.log(`  3213,${z}  in scene: ${scene.contains(tile)}  walkable: ${scene.contains(tile) ? scene.walkable(tile) : 'n/a'}`);
}

console.log('\nwhat the planner thinks from here:');
const route = findRoute(idxOf(0, me.x, me.z), idxOf(2, 3213, 3474));
if (!route.ok) {
    console.log(`  no route: ${route.reason}`);
} else {
    for (const leg of route.legs) {
        const to = tileOf(leg.to);
        const at = leg.at === undefined ? null : tileOf(leg.at);
        console.log(`  ${leg.kind.padEnd(7)} ${leg.tiles} tiles → ${to.x},${to.z} L${to.level}${leg.locName ? `  via ${leg.locName}${at ? ` at ${at.x},${at.z}` : ''}` : ''}`);
        if (leg.kind === 'walk' && leg.path) {
            const last = leg.path.slice(-3).map(i => { const t = tileOf(i); return `${t.x},${t.z}`; });
            console.log(`          path ends ${last.join(' → ')}`);
        }
    }
}

process.exit(0);
