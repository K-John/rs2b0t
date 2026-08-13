import { bootAndLogin } from './boot.js';

const t0 = performance.now();
const _stamp = (s: string): void => console.log(`  ${((performance.now() - t0) / 1000).toFixed(1)}s ${s}`);
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
const { Interactions } = await import('../../do-not-touch/apiv2/interaction/Interactions.js');
const { liveDriver } = await import('../../do-not-touch/apiv2/interaction/LiveInteractionDriver.js');
const { ReadContext } = await import('../../do-not-touch/apiv2/ReadApi.js');

const source = new LiveSnapshotSource();
const api = new Interactions(source, liveDriver);
const read = (): InstanceType<typeof ReadContext> => new ReadContext(source.read());

const door = read()
    .locs()
    .withAction('Open')
    .results()
    .sort((a, b) => a.distance - b.distance)[0];

if (door === undefined) {
    console.log('no scenery nearby offers Open');
    process.exit(1);
}

const me = read().worldTile()!;
console.log(`me:   ${me.x},${me.z} level ${me.level}`);
console.log(`door: ${door.name} id=${door.id} at ${door.tile.x},${door.tile.z} level ${door.tile.level}`);
console.log(`      layer=${door.layer} shape=${door.shape} angle=${door.angle} distance=${door.distance}`);
console.log(`      actions=${JSON.stringify(door.actions)}`);
console.log(`      typecode=${door.typecode}\n`);

const chatBefore = read().chat().count();
const sent = api.interact(door, 'Open');
console.log(`send: ${JSON.stringify(sent.sent ? { sent: true, operation: (sent.command as { operation: number }).operation } : sent)}\n`);

for (let second = 1; second <= 15; second++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const now = read();
    const tile = now.worldTile()!;

    const byId = now
        .locs()
        .withId(door.id)
        .results()
        .filter(l => Math.abs(l.tile.x - door.tile.x) <= 2 && Math.abs(l.tile.z - door.tile.z) <= 2);
    const onTile = now
        .locs()
        .results()
        .filter(l => l.tile.x === door.tile.x && l.tile.z === door.tile.z && l.tile.level === door.tile.level);

    const fresh = now
        .chat()
        .results()
        .slice(chatBefore)
        .map(line => line.text);

    console.log(
        `${second}s me=${tile.x},${tile.z}` +
            ` | same id near: ${byId.map(l => `${l.tile.x},${l.tile.z}[${l.layer}] ${JSON.stringify(l.actions.filter(a => a !== null))}`).join(' ') || 'none'}` +
            ` | on tile: ${onTile.map(l => `${l.name}[${l.layer}]`).join(' ') || 'none'}` +
            (fresh.length ? ` | chat: ${JSON.stringify(fresh)}` : '')
    );
}

process.exit(0);
