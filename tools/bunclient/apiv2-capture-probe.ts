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

const OUT = process.argv[2] ?? '/tmp';
const booted = await bootAndLogin();
const g = { rs2b0t: { client: booted.client } };

const start = g.rs2b0t.client.constructor.loopCycle;
await until(() => g.rs2b0t.client.constructor.loopCycle > start + 30, 15_000);

const { LiveSnapshotSource } = await import('../../do-not-touch/apiv2/snapshots/LiveSnapshotSource.js');
const { screenshot, sceneMapSvg } = await import('./capture.js');

const snapshot = new LiveSnapshotSource().read();

const shot = await screenshot(`${OUT}/rs2b0t-view.png`);
await Bun.write(`${OUT}/rs2b0t-collision.svg`, sceneMapSvg(snapshot, { radius: 16 }));

console.log(`\nstanding at ${JSON.stringify(snapshot.localPlayer?.tile)}`);
console.log(shot === null ? 'screenshot: the client has not drawn a frame yet' : `screenshot: ${OUT}/rs2b0t-view.png (${shot.width}x${shot.height})`);
console.log(`collision map: ${OUT}/rs2b0t-collision.svg`);
process.exit(0);
