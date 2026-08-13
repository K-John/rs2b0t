import { bootAndLogin } from './boot.js';

const t0 = performance.now();
const _stamp = (s: string): void => console.log(`  ${((performance.now() - t0) / 1000).toFixed(1)}s ${s}`);
const until = async (cond: () => boolean, ms: number): Promise<boolean> => {
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
const { Interactions } = await import('../../do-not-touch/apiv2/interaction/Interactions.js');
const { liveDriver } = await import('../../do-not-touch/apiv2/interaction/LiveInteractionDriver.js');
const { ReadContext } = await import('../../do-not-touch/apiv2/ReadApi.js');

const source = new LiveSnapshotSource();
const api = new Interactions(source, liveDriver);
const read = (): InstanceType<typeof ReadContext> => new ReadContext(source.read());
const settled = async (): Promise<void> => {
    await until(() => read().localPlayer()?.moving === false, 12_000);
};

const me = read().worldTile()!;
console.log(`\nat ${me.x},${me.z} level ${me.level}\n`);

console.log('doors within 3 tiles:');
for (const d of read().locs().results().filter(l => /door|gate/i.test(l.name ?? '') && l.distance <= 3)) {
    console.log(`  ${d.name} at ${d.tile.x},${d.tile.z} [${d.layer}] dist=${d.distance} ops=${JSON.stringify(d.actions.filter(a => a !== null))}`);
}

console.log('\nhow far can it walk, by direction:');
const scene = read().scene();
for (const [name, dx, dz] of [['east', 1, 0], ['west', -1, 0], ['north', 0, 1], ['south', 0, -1]] as const) {
    let furthest = 0;
    for (let n = 1; n <= 12; n++) {
        if (!scene.walkable({ x: me.x + dx * n, z: me.z + dz * n, level: me.level })) break;
        furthest = n;
    }
    console.log(`  ${name.padEnd(6)} ${furthest} tiles of open floor`);
}

const shut = read().locs().withAction('Open').results().filter(l => l.distance <= 2).sort((a, b) => a.distance - b.distance)[0];
if (shut !== undefined) {
    console.log(`\nopening ${shut.name} at ${shut.tile.x},${shut.tile.z}…`);
    const sent = api.interact(shut, 'Open');
    console.log(`  send: ${JSON.stringify(sent.sent ? { sent: true } : sent)}`);
    await until(() => {
        const now = read().locs().results().find(l => l.tile.x === shut.tile.x && l.tile.z === shut.tile.z && l.layer === shut.layer);
        return now === undefined || !now.actions.includes('Open');
    }, 10_000);
    await settled();
    console.log(`  now at ${JSON.stringify(read().worldTile())}`);
} else {
    console.log('\nnothing shut within 2 tiles');
}

const banker = read().npcs().withAction('Bank').results().sort((a, b) => a.distance - b.distance)[0];
if (banker !== undefined) {
    console.log(`\nretrying a walk toward the banker at ${banker.tile.x},${banker.tile.z} (${banker.distance} tiles)`);
    const sent = api.walk({ x: banker.tile.x, z: banker.tile.z + 2, level: banker.tile.level });
    console.log(`  walk: ${JSON.stringify(sent.sent ? { sent: true } : sent)}`);
    if (sent.sent) {
        await settled();
        console.log(`  ended at ${JSON.stringify(read().worldTile())}`);
    }
}

process.exit(0);
