import { bootAndLogin } from './boot.js';
const booted = await bootAndLogin();
const { teleportTo } = await import('./testSetup.js');
const { LiveSnapshotSource } = await import('../../do-not-touch/apiv2/snapshots/LiveSnapshotSource.js');
const { ReadContext } = await import('../../do-not-touch/apiv2/ReadApi.js');
const source = new LiveSnapshotSource();
const read = (): InstanceType<typeof ReadContext> => new ReadContext(source.read());

for (const spot of [{ x: 3055, z: 3281, level: 0 }, { x: 3053, z: 3283, level: 0 }]) {
    await teleportTo(booted.client, spot, () => read().worldTile());
    await new Promise(r => setTimeout(r, 2500));
    const me = read().worldTile()!;
    const near = read().locs().results().filter(l => Math.max(Math.abs(l.tile.x - 3053), Math.abs(l.tile.z - 3283)) <= 4);
    console.log(`\nstanding ${me.x},${me.z} — locs within 4 of 3053,3283: ${near.length}`);
    for (const l of near) {
        console.log(`  id=${l.id} "${l.name}" ${l.tile.x},${l.tile.z} layer=${l.layer} ops=[${l.actions.filter(a => a !== null).join(',')}]`);
    }
}
process.exit(0);
