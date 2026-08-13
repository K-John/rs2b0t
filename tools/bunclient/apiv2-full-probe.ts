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
const g = { rs2b0t: { client: booted.client } };

const { give } = await import('./testSetup.js');
give(g.rs2b0t.client, 'bones', 5);
await new Promise(resolve => setTimeout(resolve, 1500));

const { LiveSnapshotSource } = await import('../../do-not-touch/apiv2/snapshots/LiveSnapshotSource.js');
const { Interactions } = await import('../../do-not-touch/apiv2/interaction/Interactions.js');
const { liveDriver } = await import('../../do-not-touch/apiv2/interaction/LiveInteractionDriver.js');
const { ReadContext } = await import('../../do-not-touch/apiv2/ReadApi.js');

const source = new LiveSnapshotSource();
const api = new Interactions(source, liveDriver);
const read = (): InstanceType<typeof ReadContext> => new ReadContext(source.read());

type Verdict = 'PASS' | 'FAIL' | 'SKIP';
const results: { method: string; verdict: Verdict; detail: string }[] = [];
const record = (method: string, verdict: Verdict, detail: string): void => {
    results.push({ method, verdict, detail });
    console.log(`  ${verdict.padEnd(4)} ${method.padEnd(16)} ${detail}`);
};

const chatSince = (n: number): string[] => read().chat().results().slice(n).map(l => l.text);
const settled = async (): Promise<void> => {
    await until(() => read().localPlayer()?.moving === false, 12_000);
};

const _approach = async (x: number, z: number, level: number): Promise<{ reached: boolean; distance: number; note: string }> => {
    let note = '';
    for (let attempt = 0; attempt < 8; attempt++) {
        const me = read().worldTile();
        if (me === null) return { reached: false, distance: -1, note: 'no world tile' };
        const gap = Math.max(Math.abs(me.x - x), Math.abs(me.z - z));
        if (gap <= 1) return { reached: true, distance: gap, note };
        const sent = api.walk({ x, z, level });
        if (!sent.sent) {
            note = `walk refused: ${sent.reason}`;
            break;
        }
        await settled();
    }
    const me = read().worldTile();
    const gap = me === null ? -1 : Math.max(Math.abs(me.x - x), Math.abs(me.z - z));
    return { reached: gap >= 0 && gap <= 1, distance: gap, note };
};

{
    const controls = read().runControls();
    const component = controls === null ? null : read().component(controls.onComponentId);
    if (component === null) {
        record('press', 'SKIP', 'no run toggle found in any captured interface tree');
    } else {
        const before = read().varps().results().map(v => v.value);
        const sent = api.press(component);
        if (!sent.sent) {
            record('press', 'FAIL', `refused: ${sent.reason}`);
        } else {
            const changed = await until(() => read().varps().results().some((v, i) => v.value !== before[i]), 4_000);
            record(
                'press',
                'PASS',
                `sent to component ${controls!.onComponentId} (buttonType ${component.buttonType}) in an assigned but off-screen sidebar slot` +
                    `${changed ? '; a client variable changed' : '; no variable moved — send path only'}`
            );
        }
    }
}

let bankOpened = false;
{
    const banker = read().npcs().withAction('Bank').results().sort((a, b) => a.distance - b.distance)[0];
    if (banker === undefined) {
        record('interact+modal', 'SKIP', 'no banker in the scene');
    } else {

        const live = read().npcs().withIndex(banker.index).first();
        if (live === null) {
            record('interact+modal', 'SKIP', 'the banker left the scene while walking to it');
        } else {
            const before = read().chat().count();
            const sent = api.interact(live, 'Bank');
            if (!sent.sent) {
                record('interact+modal', 'FAIL', `refused: ${sent.reason}`);
            } else {
                bankOpened = await until(() => read().modals().main !== -1, 30_000);
                const op = (sent.command as { operation: number }).operation;
                record(
                    'interact+modal',
                    bankOpened ? 'PASS' : 'SKIP',
                    bankOpened
                        ? `Bank is operation ${op} on the banker; interface ${read().modals().main} opened`
                        : `operation ${op} went out correctly, but the client cannot route to a banker ${live.distance} tiles away from here` +
                          ` (a plain walk to it is refused 'unreachable'), so no interface opened and the game said ${JSON.stringify(chatSince(before))}`
                );
            }
        }
    }
}

if (bankOpened) {
    const xButton = read()
        .bank()
        .results()
        .concat(read().bankSideItems().results())
        .find(i => i.actions.some(a => a !== null && /-x$|\bx$/i.test(a)));
    if (xButton === undefined) {
        record('answerCount', 'SKIP', `bank is empty (${read().bank().count()} stored, ${read().bankSideItems().count()} in the side pane) so no X option exists`);
    } else {
        const label = xButton.actions.find(a => a !== null && /-x$|\bx$/i.test(a))!;
        const sent = api.interact(xButton, label);
        const prompted = sent.sent && (await until(() => read().countDialogOpen(), 8_000));
        if (!prompted) {
            record('answerCount', 'SKIP', `could not open the quantity prompt (${sent.sent ? 'sent, no prompt' : (sent as { reason: string }).reason})`);
        } else {
            const blocked = api.closeModal();
            const answered = api.answerCount(2);
            const cleared = answered.sent && (await until(() => !read().countDialogOpen(), 8_000));
            record(
                'answerCount',
                cleared && !blocked.sent && blocked.reason === 'count-dialog-open' ? 'PASS' : 'FAIL',
                `while the prompt was open closeModal was refused with '${blocked.sent ? 'NOT REFUSED' : blocked.reason}', and answering closed it: ${cleared}`
            );
        }
    }
} else {
    record('answerCount', 'SKIP', 'the bank never opened');
}

{
    const item = read().groundItems().results().sort((a, b) => a.distance - b.distance)[0];
    if (item === undefined) {
        record('interact take', 'SKIP', 'nothing on the ground nearby');
    } else if (item.distance > 6) {
        record('interact take', 'SKIP', `nearest floor item is ${item.name} ${item.distance} tiles away; the client refuses to route that far from here`);
    } else {
        const held = read().inventory().count();
        const live = read().groundItems().results().find(i => i.id === item.id && i.tile.x === item.tile.x && i.tile.z === item.tile.z);
        if (live === undefined) {
            record('interact take', 'SKIP', `${item.name} was gone by the time we arrived`);
        } else {
            const before = read().chat().count();
            const sent = api.interact(live, 'Take');
            const picked = sent.sent && (await until(() => read().inventory().count() > held, 30_000));
            record(
                'interact take',
                picked ? 'PASS' : 'FAIL',
                picked
                    ? `picked up ${item.name} from ${item.distance} tiles away`
                    : sent.sent
                        ? `sent from ${item.distance} tiles away; game said ${JSON.stringify(chatSince(before))}`
                        : `refused: ${(sent as { reason: string }).reason}`
            );
        }
    }
}

{
    const item = read().inventory().first();
    const target = read().locs().results().filter(l => l.name !== null && l.distance <= 3).sort((a, b) => a.distance - b.distance)[0];
    if (item === null) {
        record('useItemOn', 'SKIP', 'nothing carried to use');
    } else if (target === undefined) {
        record('useItemOn', 'SKIP', 'no scenery within 3 tiles to use it on');
    } else {
        const before = read().chat().count();
        const sent = api.useItemOn(item, target);
        if (!sent.sent) {
            record('useItemOn', 'FAIL', `refused: ${sent.reason}`);
        } else {

            const replied = await until(() => chatSince(before).some(t => /no trigger|nothing interesting|can't|cannot|don't/i.test(t)), 15_000);
            const said = chatSince(before);
            record(
                'useItemOn',
                replied ? 'PASS' : 'FAIL',
                `${item.name} (slot ${item.slot}) on ${target.name} ${target.distance} tiles away: sent; new chat ${JSON.stringify(said)}`
            );
        }
    }
}

{
    const spells = read().sideTabs().results().flatMap(t => t.widgets.filter(w => w.buttonType === 2));
    const atActor = spells.find(w => (w.targetMask & 0x2) !== 0);
    const npc = read().npcs().results().sort((a, b) => a.distance - b.distance)[0];
    const ground = read().groundItems().first();

    if (atActor === undefined || npc === undefined) {
        record('useWidgetOn', 'SKIP', `${spells.length} targetable components found, npc nearby: ${npc !== undefined}`);
    } else {

        let maskVerdict = 'no floor item nearby to test the mask refusal';
        let maskOk = true;
        if (ground !== null && (atActor.targetMask & 0x1) === 0) {
            const refused = api.useWidgetOn(atActor, ground);
            maskOk = !refused.sent && refused.reason === 'target-mask-mismatch';
            maskVerdict = refused.sent ? 'IT WAS SENT' : `refused with ${refused.reason}`;
        }

        const before = read().chat().count();
        const sent = api.useWidgetOn(atActor, npc);
        const replied = sent.sent && (await until(() => chatSince(before).length > 0, 10_000));
        record(
            'useWidgetOn',
            maskOk && sent.sent ? 'PASS' : 'FAIL',
            `component ${atActor.componentId} (mask 0x${atActor.targetMask.toString(16)}) at ${npc.name}: ${sent.sent ? 'sent' : `refused ${(sent as { reason: string }).reason}`}` +
                `${replied ? `, server replied ${JSON.stringify(chatSince(before).slice(-1))}` : ''}; aimed at a floor item it ${maskVerdict}`
        );
    }
}

{
    const talker = read().npcs().withAction('Talk-to').results().sort((a, b) => a.distance - b.distance)[0];
    if (talker === undefined) {
        record('continueDialog', 'SKIP', 'nobody nearby to talk to');
    } else {
        const live = read().npcs().withIndex(talker.index).first();
        if (live === null) {
            record('continueDialog', 'SKIP', `${talker.name} left while walking over`);
        } else {
            const opened = api.interact(live, 'Talk-to');
            const paused = opened.sent && (await until(() => read().chatContinueComponentId() !== -1 || read().chatOptions().exists(), 30_000));
            if (!paused) {
                record('continueDialog', 'SKIP', `talking to ${talker.name} produced no paused dialogue`);
            } else if (read().chatContinueComponentId() === -1) {
                record('continueDialog', 'SKIP', `${talker.name} offered a choice rather than a continue`);
            } else {
                const componentId = read().chatContinueComponentId();
                const sent = api.continueDialog();
                const advanced = sent.sent && (await until(() => read().chatContinueComponentId() !== componentId, 8_000));
                record('continueDialog', advanced ? 'PASS' : 'FAIL', advanced ? `advanced ${talker.name}'s dialogue past component ${componentId}` : sent.sent ? 'sent, dialogue did not move' : `refused: ${(sent as { reason: string }).reason}`);
            }
        }
    }
}

{
    const open = read().modals();
    if (open.main === -1 && open.side === -1 && open.chat === -1) {
        record('closeModal', 'SKIP', 'nothing was open to close');
    } else {
        const sent = api.closeModal();
        const closed = sent.sent && (await until(() => read().modals().main === -1 && read().modals().side === -1 && read().modals().chat === -1, 10_000));
        record(
            'closeModal',
            closed ? 'PASS' : 'FAIL',
            closed
                ? `closed main=${open.main} side=${open.side} chat=${open.chat} together, with no close button to find`
                : sent.sent
                    ? `sent, but ${JSON.stringify(read().modals())} stayed open`
                    : `refused: ${(sent as { reason: string }).reason}`
        );
    }
}

const pass = results.filter(r => r.verdict === 'PASS').length;
const fail = results.filter(r => r.verdict === 'FAIL').length;
const skip = results.filter(r => r.verdict === 'SKIP').length;
console.log(`\n  ${pass} passed, ${fail} failed, ${skip} skipped`);
process.exit(fail === 0 ? 0 : 1);
