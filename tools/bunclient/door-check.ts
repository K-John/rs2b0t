import { bootAndLogin } from './boot.js';

const booted = await bootAndLogin();
const { teleportTo } = await import('./testSetup.js');
const { LiveSnapshotSource } = await import('../../do-not-touch/apiv2/snapshots/LiveSnapshotSource.js');
const { ReadContext } = await import('../../do-not-touch/apiv2/ReadApi.js');

const source = new LiveSnapshotSource();
const read = (): InstanceType<typeof ReadContext> => new ReadContext(source.read());

await teleportTo(booted.client, { x: 3033, z: 3313, level: 0 }, () => read().worldTile());
await new Promise(r => setTimeout(r, 2500));

console.log('\nstanding at', JSON.stringify(read().worldTile()));
for (const loc of read().locs().withId(1553).results()) {
    console.log(`loc 1553 at ${loc.tile.x},${loc.tile.z} layer=${loc.layer} actions=[${loc.actions.filter(a => a !== null).join(', ')}]`);
}
console.log('\nall nearby locs with an Open or Close option:');
for (const loc of read().locs().results()) {
    if (loc.distance <= 6 && loc.actions.some(a => a !== null && /^(open|close)$/i.test(a))) {
        console.log(`  id=${loc.id} "${loc.name}" at ${loc.tile.x},${loc.tile.z} dist=${loc.distance} actions=[${loc.actions.filter(a => a !== null).join(', ')}]`);
    }
}

const { createInteractions } = await import('../../do-not-touch/apiv2/interaction/createInteractions.js');
const { liveDriver } = await import('../../do-not-touch/apiv2/interaction/LiveInteractionDriver.js');
const { interactions } = createInteractions({ source, driver: liveDriver });

const gate = read().locs().withId(1553).results().find(l => l.tile.x === 3032 && l.tile.z === 3313)!;
console.log(`\nclicking Open on the gate at ${gate.tile.x},${gate.tile.z}`);
const sent = interactions.interact(gate, 'Open');
console.log('send result:', JSON.stringify(sent.sent ? { sent: true } : sent));

const chatBefore = read().chat().count();
for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 600));
    const still = read().locs().results().find(l => l.id === 1553 && l.tile.x === 3032 && l.tile.z === 3313);
    const me = read().worldTile()!;
    console.log(`  +${i + 1}: me=${me.x},${me.z} gate=${still ? `[${still.actions.filter(a => a !== null).join(',')}]` : 'GONE'}`);
    if (!still) break;
}
const said = read().chat().results().slice(0, read().chat().count() - chatBefore).map(l => l.text);
if (said.length) console.log('game said:', JSON.stringify(said));
process.exit(0);
