import { bootAndLogin } from './boot.js';

const t0 = performance.now();
const stamp = (s: string): void => console.log(`  ${((performance.now() - t0) / 1000).toFixed(1)}s ${s}`);
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

const results: { name: string; ok: boolean; detail: string }[] = [];
const record = (name: string, ok: boolean, detail: string): void => {
    results.push({ name, ok, detail });
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const here = read();
const start = here.worldTile();
stamp(`standing at ${JSON.stringify(start)}; ${here.npcs().count()} npcs, ${here.locs().count()} locs, ${here.inventory().count()} carried`);

if (start === null) {
    stamp('FINDING: no world tile — the read half cannot see the player');
    process.exit(1);
}

{
    const goal = { x: start.x + 2, z: start.z, level: start.level };
    const sent = api.walk(goal);
    if (!sent.sent) {
        record('walk goes out', false, `refused: ${sent.reason}`);
    } else {
        const arrived = await until(() => {
            const tile = read().worldTile();
            return tile !== null && tile.x === goal.x && tile.z === goal.z && tile.level === goal.level;
        }, 10_000);
        record('walk goes out and the character arrives', arrived, arrived ? `reached ${goal.x},${goal.z}` : `still at ${JSON.stringify(read().worldTile())}`);
    }
}

{

    await until(() => read().localPlayer()?.moving === false, 10_000);

    const door = read()
        .locs()
        .withName('Door')
        .results()
        .filter(l => l.actions.some(a => a === 'Open' || a === 'Close'))
        .sort((a, b) => a.distance - b.distance)[0];
    const verb = door?.actions.includes('Open') === true ? 'Open' : 'Close';
    const npc = read()
        .npcs()
        .withAction('Talk-to')
        .results()
        .sort((a, b) => a.distance - b.distance)[0];

    if (door !== undefined) {
        const before = read().chat().count();
        const startedAt = read().worldTile()!;
        const sent = api.interact(door, verb);
        if (!sent.sent) {
            record('operation goes out', false, `refused: ${sent.reason}`);
        } else {

            const opened = await until(() => {
                const now = read()
                    .locs()
                    .results()
                    .find(l => l.tile.x === door.tile.x && l.tile.z === door.tile.z && l.layer === door.layer);
                return now === undefined || !now.actions.includes(verb);
            }, 15_000);
            const said = read().chat().results().slice(before).map(l => l.text).filter(t => /reach|can't|cannot/i.test(t));
            const ended = read().worldTile()!;
            const walked = ended.x !== startedAt.x || ended.z !== startedAt.z;
            record(
                'operation goes out and the game acts on it',
                opened,
                opened
                    ? `${verb} on a door ${door.distance} tiles away worked`
                    : `door ${door.distance} tiles away still offers ${verb}; character ${walked ? 'walked to it' : 'never moved'}` +
                      `${said.length ? `; game said ${JSON.stringify(said)}` : '; no message from the game'}`
            );
        }
    } else if (npc !== undefined) {
        const sent = api.interact(npc, 'Talk-to');
        const answered = sent.sent && (await until(() => read().modals().chat !== -1 || read().chatOptions().exists(), 12_000));
        record('operation goes out and the game acts on it', answered, sent.sent ? `talked to ${npc.name}` : `refused: ${(sent as { reason: string }).reason}`);
    } else {
        record('operation goes out and the game acts on it', false, 'nothing nearby offered Open or Talk-to');
    }
}

{
    const live = read().npcs().first();
    if (live === null) {
        record('a stale target is refused', false, 'no npc in the scene to build a stale record from');
    } else {

        const stale = { ...live, id: live.id + 9999 };
        const sent = api.interact(stale, live.actions.find(a => a !== null) ?? 'Attack');
        record('a stale target is refused, not sent', !sent.sent && sent.reason === 'stale-target', sent.sent ? 'IT WAS SENT' : `refused: ${sent.reason}`);
    }
}

{
    const live = read().npcs().first();
    if (live === null) {
        record('an unoffered label is refused', false, 'no npc in the scene');
    } else {
        const sent = api.interact(live, 'Definitely-not-an-option');
        record('an unoffered label is refused', !sent.sent && sent.reason === 'invalid-action', sent.sent ? 'IT WAS SENT' : `refused: ${sent.reason}`);
    }
}

const passed = results.filter(r => r.ok).length;
console.log(`\n  ${passed}/${results.length} live checks passed`);
process.exit(passed === results.length ? 0 : 1);
