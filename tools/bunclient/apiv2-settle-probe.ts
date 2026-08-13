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

const { verify } = await import('./testSetup.js');
const { LiveSnapshotSource } = await import('../../do-not-touch/apiv2/snapshots/LiveSnapshotSource.js');
const { createInteractions } = await import('../../do-not-touch/apiv2/interaction/createInteractions.js');
const { liveDriver } = await import('../../do-not-touch/apiv2/interaction/LiveInteractionDriver.js');
const { arrived, optionGone, said, modalOpened, CANNOT_REACH } = await import('../../do-not-touch/apiv2/interaction/Evidence.js');
const { ReadContext } = await import('../../do-not-touch/apiv2/ReadApi.js');

const source = new LiveSnapshotSource();
const { settle } = createInteractions({ source, driver: liveDriver });
const read = (): InstanceType<typeof ReadContext> => new ReadContext(source.read());

stamp(`setup: ${verify(source.read()).tile}`);

const results: { name: string; ok: boolean; detail: string }[] = [];
const record = (name: string, ok: boolean, detail: string): void => {
    results.push({ name, ok, detail });
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(24)} ${detail}`);
};

{
    const me = read().worldTile()!;
    const goal = { x: me.x + 2, z: me.z, level: me.level };
    const outcome = await settle.perform(api => api.walk(goal), { arms: { there: arrived(goal, 1) }, budgetTicks: 30 });
    record(
        'perform resolves',
        outcome.kind === 'matched',
        outcome.kind === 'matched'
            ? `arm '${outcome.arm}' after ${outcome.tick - outcome.before.tick()} ticks; it carries both observations (${JSON.stringify(outcome.before.worldTile())} → ${JSON.stringify(outcome.now.worldTile())})`
            : `ended '${outcome.kind}'`
    );
}

{
    const door = read()
        .locs()
        .withName('Door')
        .results()
        .filter(l => l.actions.some(a => a === 'Open' || a === 'Close'))
        .sort((a, b) => a.distance - b.distance)[0];
    if (door === undefined) {
        record('named arms', false, 'no door nearby');
    } else {
        const verb = door.actions.includes('Open') ? 'Open' : 'Close';
        const outcome = await settle.perform(api => api.interact(door, verb), {
            arms: { worked: optionGone(door, verb), outOfReach: said(CANNOT_REACH) },
            budgetTicks: 40
        });
        record(
            'named arms',
            outcome.kind === 'matched',
            outcome.kind === 'matched' ? `${verb} on a door ${door.distance} away ended on arm '${outcome.arm}'` : `ended '${outcome.kind}' rather than naming an ending`
        );
    }
}

{
    const live = read().npcs().first();
    if (live === null) {
        record('refusal is instant', false, 'no npc in the scene');
    } else {
        const started = performance.now();
        const outcome = await settle.perform(api => api.interact({ ...live, id: live.id + 9999 }, 'Attack'), { arms: { never: () => false }, budgetTicks: 100 });
        const elapsed = performance.now() - started;
        record(
            'refusal is instant',
            outcome.kind === 'refused' && elapsed < 500,
            outcome.kind === 'refused' ? `reason '${outcome.reason}' after ${elapsed.toFixed(0)}ms, without waiting out 100 ticks` : `ended '${outcome.kind}'`
        );
    }
}

{
    const started = performance.now();
    const outcome = await settle.until({ arms: { impossible: modalOpened(999999) }, budgetTicks: 8 });
    record('budget expires cleanly', outcome.kind === 'expired', `ended '${outcome.kind}' after ${((performance.now() - started) / 1000).toFixed(1)}s of an 8-tick budget`);
}

const pass = results.filter(r => r.ok).length;
console.log(`\n  ${pass}/${results.length} live checks passed`);
process.exit(pass === results.length ? 0 : 1);
