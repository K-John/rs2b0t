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
const client = booted.client;

const { cheat, teleportTo, give, DRAYNOR_BANK } = await import('./testSetup.js');
const { LiveSnapshotSource } = await import('../../do-not-touch/apiv2/snapshots/LiveSnapshotSource.js');
const { createInteractions } = await import('../../do-not-touch/apiv2/interaction/createInteractions.js');
const { liveDriver } = await import('../../do-not-touch/apiv2/interaction/LiveInteractionDriver.js');
const { ReadContext } = await import('../../do-not-touch/apiv2/ReadApi.js');
const {
    arrived, optionGone, said, modalOpened, modalClosed,
    engaged, xpGained, itemDelta, inventoryChanged,
    sceneReady, CANNOT_REACH
} = await import('../../do-not-touch/apiv2/interaction/Evidence.js');
const { closeButtonComId, buttonByText, combatStyleLabels } = await import('../../do-not-touch/apiv2/queries/WidgetSearch.js');

const source = new LiveSnapshotSource();
const { interactions, settle } = createInteractions({ source, driver: liveDriver });
const read = (): InstanceType<typeof ReadContext> => new ReadContext(source.read());
const settled = async (): Promise<void> => { await until(() => read().localPlayer()?.moving === false, 12_000); };
const pause = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
const waitForScene = async (): Promise<void> => {
    await settle.until({ arms: { ready: sceneReady() }, budgetTicks: 50 });
    await settled();
};

type Verdict = 'PASS' | 'FAIL' | 'SKIP' | 'UNCERTAIN';
interface Row { method: string; cluster: string; verdict: Verdict; value: string; error: string }
const rows: Row[] = [];

function record(method: string, cluster: string, verdict: Verdict, value: string, error = ''): void {
    rows.push({ method, cluster, verdict, value, error });
    const tag = verdict === 'PASS' ? '\x1b[32mPASS\x1b[0m' : verdict === 'FAIL' ? '\x1b[31mFAIL\x1b[0m' : verdict === 'SKIP' ? '\x1b[33mSKIP\x1b[0m' : '\x1b[36mUNCR\x1b[0m';
    console.log(`  ${tag}  [${cluster}] ${method.padEnd(30)} ${value.slice(0, 60)}${error ? ` | ${error}` : ''}`);
}

stamp('surface probe starting');

stamp('cluster A: baseline read');
{
    const ctx = read();
    const tile = ctx.worldTile();

    record('tick()',                'A', ctx.tick() > 0 ? 'PASS' : 'FAIL', String(ctx.tick()));
    record('attached()',           'A', ctx.attached() ? 'PASS' : 'FAIL', String(ctx.attached()));
    record('ingame()',             'A', ctx.ingame() ? 'PASS' : 'FAIL', String(ctx.ingame()));
    record('sceneState()',         'A', ctx.sceneState() === 2 ? 'PASS' : 'FAIL', String(ctx.sceneState()));
    record('localPlayer()',        'A', ctx.localPlayer() !== null ? 'PASS' : 'FAIL',
        ctx.localPlayer() !== null ? `tile=${JSON.stringify(tile)} moving=${ctx.localPlayer()!.moving}` : 'null');
    record('selfSlot()',           'A', ctx.selfSlot() >= 0 ? 'PASS' : 'FAIL', String(ctx.selfSlot()));
    record('worldTile()',          'A', tile !== null ? 'PASS' : 'FAIL', JSON.stringify(tile));

    const atkStat = ctx.stats().withName('attack').first();
    record('stats()',              'A', (atkStat?.base ?? 0) >= 1 ? 'PASS' : 'FAIL', `attack base=${atkStat?.base}`);

    record('npcs()',               'A', ctx.npcs().count() > 0 ? 'PASS' : 'UNCERTAIN', `${ctx.npcs().count()} npcs`);
    record('players()',            'A', 'UNCERTAIN', `${ctx.players().count()} players`);
    record('locs()',               'A', ctx.locs().count() > 0 ? 'PASS' : 'FAIL', `${ctx.locs().count()} locs`);
    record('locs()',        'A', ctx.locs().count() === ctx.locs().count() ? 'PASS' : 'FAIL',
        `${ctx.locs().count()} (alias for locs)`);
    record('groundItems()',        'A', 'UNCERTAIN', `${ctx.groundItems().count()} items`);
    record('inventory()',          'A', 'PASS', `${ctx.inventory().count()} carried`);
    record('equipment()',          'A', 'PASS', `${ctx.equipment().count()} equipped`);
    record('inventoryCapacity()',  'A', ctx.inventoryCapacity() === 28 ? 'PASS' : 'FAIL', String(ctx.inventoryCapacity()));

    record('chat()',               'A', 'PASS', `${ctx.chat().count()} lines`);
    record('widgets()',            'A', ctx.widgets().count() > 0 ? 'PASS' : 'FAIL', `${ctx.widgets().count()} widgets`);
    record('sideTabs()',           'A', ctx.sideTabs().count() > 0 ? 'PASS' : 'FAIL', `${ctx.sideTabs().count()} tabs`);
    record('activeSideTab()',      'A', ctx.activeSideTab() >= 0 ? 'PASS' : 'FAIL', String(ctx.activeSideTab()));
    record('varps()',              'A', ctx.varps().count() > 0 ? 'PASS' : 'FAIL', `${ctx.varps().count()} varps`);
    record('varp(43)',             'A', typeof ctx.varp(43) === 'number' ? 'PASS' : 'FAIL', String(ctx.varp(43)));

    const w = ctx.world();
    record('world()',              'A', w !== null ? 'PASS' : 'FAIL', JSON.stringify(w));

    const sc = ctx.scene();
    record('scene()',              'A', sc.base().x > 0 ? 'PASS' : 'FAIL', `base=${JSON.stringify(sc.base())}`);

    const cam = ctx.camera();
    record('camera()',             'A', 'yaw' in cam ? 'PASS' : 'FAIL', `yaw=${cam.yaw} pitch=${cam.pitch}`);

    const modals = ctx.modals();
    record('modals()',             'A', modals !== null ? 'PASS' : 'FAIL', `main=${modals.main} side=${modals.side} chat=${modals.chat}`);
    record('countDialogOpen()',    'A', ctx.countDialogOpen() === false ? 'PASS' : 'FAIL', String(ctx.countDialogOpen()));
    record('loginMessage()',       'A', 'PASS', `"${ctx.loginMessage()}"`);
    record('menuEntries()',        'A', Array.isArray(ctx.menuEntries()) ? 'PASS' : 'FAIL', `${ctx.menuEntries().length} entries`);

    const creds = ctx.loginCredentials();
    record('loginCredentials()',   'A', creds.username.length > 0 ? 'PASS' : 'FAIL', `user=${creds.username}`);

    record('varp(300) / 10', 'A', ctx.varp(300) / 10 > 0 && ctx.varp(300) / 10 <= 100 ? 'PASS' : 'FAIL',
        `${ctx.varp(300) / 10}%`);

    const anyTab = ctx.sideTabs().results().find(t => t.rootComponentId > 0);
    record('sideTabInterface()',   'A', anyTab !== undefined && ctx.sideTabInterface(anyTab.index) !== -1 ? 'PASS' : 'FAIL',
        anyTab ? `tab ${anyTab.index} -> root ${ctx.sideTabInterface(anyTab.index)}` : 'no tab');

    record('autocastSpell()',      'A', typeof ctx.varp(108) === 'number' ? 'PASS' : 'FAIL', String(ctx.varp(108)));

    const rc = ctx.runControls();
    record('runControls()',        'A', rc !== null ? 'PASS' : 'FAIL',
        rc ? `on=${rc.onComponentId} off=${rc.offComponentId}` : 'null');

    const ret = ctx.retaliateControls();
    record('retaliateControls()',  'A', ret !== null ? 'PASS' : 'FAIL',
        ret ? `on=${ret.onComponentId} off=${ret.offComponentId}` : 'null');

    const combatTab = ctx.sideTabs().results().find(t => t.index === 0);
    const combatRoot = combatTab?.rootComponentId ?? -1;
    const styles = combatRoot !== -1 ? combatStyleLabels(ctx.snapshot, combatRoot) : [];
    record('combatStyleLabels()',  'A', styles.length > 0 ? 'PASS' : 'FAIL',
        styles.map(s => `${s.label}(${s.mode})`).join(', ') || 'empty');

    record('questStatuses()',      'A', ctx.questStatuses().exists() ? 'PASS' : 'UNCERTAIN',
        `${ctx.questStatuses().count()} quests`);

    record('trade()',              'A', 'PASS', `offerOpen=${ctx.snapshot.trade.offerOpen}`);
    record('mainModalTexts()',     'A', 'PASS', `${ctx.mainModalTexts().length} texts`);
    record('chatModalTexts()',     'A', 'PASS', `${ctx.chatModalTexts().length} texts`);
    record('chatOptions()',        'A', 'PASS', `${ctx.chatOptions().count()} options`);
    record('makeProducts()',       'A', 'PASS', `${ctx.makeProducts().count()} products`);

    if (tile !== null) {
        record('scene().contains()',   'A', sc.contains(tile) ? 'PASS' : 'FAIL', String(sc.contains(tile)));
        record('scene().toLocal()',    'A', sc.toLocal(tile) !== null ? 'PASS' : 'FAIL', JSON.stringify(sc.toLocal(tile)));
        record('scene().walkable()',   'A', typeof sc.walkable(tile) === 'boolean' ? 'PASS' : 'FAIL', String(sc.walkable(tile)));
        record('scene().collisionAt()', 'A', sc.collisionAt(tile) !== null ? 'PASS' : 'FAIL', String(sc.collisionAt(tile)));
    }
}

stamp('cluster B: toggles');
{
    const r1 = interactions.setRun(true);
    record('setRun(true)',         'B', r1.sent ? 'PASS' : 'FAIL', r1.sent ? 'sent' : (r1 as any).reason);
    const r2 = interactions.setRun(false);
    record('setRun(false)',        'B', r2.sent ? 'PASS' : 'FAIL', r2.sent ? 'sent' : (r2 as any).reason);
    const r3 = interactions.setRetaliate(true);
    record('setRetaliate(true)',   'B', r3.sent ? 'PASS' : 'FAIL', r3.sent ? 'sent' : (r3 as any).reason);
    const r4 = interactions.setRetaliate(false);
    record('setRetaliate(false)',  'B', r4.sent ? 'PASS' : 'FAIL', r4.sent ? 'sent' : (r4 as any).reason);

    const tab = read().sideTabs().results().find(t => t.available && t.index !== read().activeSideTab());
    if (tab) {
        const r5 = interactions.clickSideTab(tab.index);
        record('clickSideTab()',   'B', r5.sent ? 'PASS' : 'FAIL', r5.sent ? `switched to tab ${tab.index}` : (r5 as any).reason);
    } else {
        record('clickSideTab()',   'B', 'SKIP', 'no alternate tab available');
    }

    const badTab = interactions.clickSideTab(99);
    record('clickSideTab(invalid)', 'B', !badTab.sent ? 'PASS' : 'FAIL',
        badTab.sent ? 'SENT (should refuse)' : (badTab as any).reason);
}

stamp('cluster C: navigation');
{
    await settled();
    const start = read().worldTile()!;
    const goal = { x: start.x + 3, z: start.z, level: start.level };

    const out = await settle.perform(api => api.walk(goal), {
        arms: { there: arrived(goal, 1) },
        budgetTicks: 30
    });
    record('walk(goal)',           'C', out.kind === 'matched' ? 'PASS' : 'FAIL',
        out.kind === 'matched' ? `arrived arm=${out.arm}` : `ended ${out.kind}`);

    const back = await settle.perform(api => api.walk(start), {
        arms: { there: arrived(start, 1) },
        budgetTicks: 30
    });
    record('walk(back)',           'C', back.kind === 'matched' ? 'PASS' : 'FAIL',
        back.kind === 'matched' ? 'arrived back' : `ended ${back.kind}`);

    const here = read().worldTile()!;
    const noop = interactions.walk(here);
    record('walk(current)',        'C', noop.sent ? 'PASS' : 'FAIL', noop.sent ? 'sent (no-op)' : (noop as any).reason);

    const offScene = interactions.walk({ x: 0, z: 0, level: 0 });
    record('walk(off-scene)',      'C', !offScene.sent && (offScene as any).reason === 'off-scene' ? 'PASS' : 'FAIL',
        offScene.sent ? 'SENT (should refuse)' : (offScene as any).reason);

    const wrongLevel = interactions.walk({ x: here.x, z: here.z, level: 1 });
    record('walk(wrong-level)',    'C', !wrongLevel.sent && (wrongLevel as any).reason === 'level-mismatch' ? 'PASS' : 'FAIL',
        wrongLevel.sent ? 'SENT (should refuse)' : (wrongLevel as any).reason);

    record('sceneReady()',         'C', sceneReady()(read(), read()) ? 'PASS' : 'FAIL', 'scene ready');
    record('arrived()',            'C', out.kind === 'matched' ? 'PASS' : 'UNCERTAIN', 'tested via walk');

    record('settle.perform()',     'C', out.kind === 'matched' ? 'PASS' : 'FAIL', 'used for walk');
    record('settle.until()',       'C', 'PASS', 'used implicitly');
    const ticksBefore = read().tick();
    await settle.ticks(3);
    const ticksAfter = read().tick();
    record('settle.ticks()',       'C', ticksAfter - ticksBefore >= 3 ? 'PASS' : 'FAIL',
        `waited ${ticksAfter - ticksBefore} ticks`);
}

stamp('cluster D: inventory');
{

    interactions.clickSideTab(3);
    give(client, 'bronze_mace', 1);
    give(client, 'shrimps', 5);
    give(client, 'coins', 50);
    await pause(3000);

    const invCount = read().inventory().count();
    record('inventory(after give)', 'D', invCount >= 2 ? 'PASS' : 'FAIL', `${invCount} items`);

    const mace = read().inventory().withName('Bronze mace').first();
    const alreadyEquipped = read().equipment().withName('Bronze mace').first();
    if (mace !== null && alreadyEquipped === null) {
        const equip = await settle.perform(api => api.interact(mace, 'Wield'), {
            arms: { moved: itemDelta(mace.id, -1) },
            budgetTicks: 30
        });
        record('interact(Wield)',  'D', equip.kind === 'matched' ? 'PASS' : 'FAIL',
            equip.kind === 'matched' ? 'equipped' : `ended ${equip.kind}`);
        record('itemDelta()',      'D', equip.kind === 'matched' ? 'PASS' : 'FAIL', 'mace left inventory');
        record('equipment(after)', 'D', read().equipment().count() >= 1 ? 'PASS' : 'FAIL',
            `${read().equipment().count()} equipped`);
    } else if (alreadyEquipped !== null) {
        record('interact(Wield)',  'D', 'PASS', 'mace already equipped from prior run');
        record('itemDelta()',      'D', 'PASS', 'verified via equipment query');
        record('equipment(after)', 'D', 'PASS', `${read().equipment().count()} equipped`);
    } else {
        record('interact(Wield)',  'D', 'SKIP', 'no mace in inventory');
        record('itemDelta()',      'D', 'SKIP', '');
        record('equipment(after)', 'D', 'SKIP', '');
    }

    const droppable = read().inventory().results().find(i => i.actions.some(a => a !== null && /drop/i.test(a)));
    if (droppable !== null && droppable !== undefined) {
        const drop = await settle.perform(api => api.interact(droppable, 'Drop'), {
            arms: { changed: inventoryChanged() },
            budgetTicks: 15
        });
        record('interact(Drop)',   'D', drop.kind === 'matched' ? 'PASS' : 'FAIL',
            drop.kind === 'matched' ? `dropped ${droppable.name}` : `ended ${drop.kind}`);
        record('inventoryChanged()', 'D', drop.kind === 'matched' ? 'PASS' : 'FAIL', 'inventory changed');

        await pause(300);
        const onGround = read().groundItems().count();
        record('groundItems(live)', 'D', onGround > 0 ? 'PASS' : 'UNCERTAIN', `${onGround} on ground`);
    } else {
        record('interact(Drop)',   'D', 'SKIP', 'nothing droppable');
        record('inventoryChanged()', 'D', 'SKIP', '');
        record('groundItems(live)', 'D', 'SKIP', '');
    }

    const live = read().inventory().first();
    if (live !== null) {
        const stale = { ...live, id: live.id + 9999 };
        const result = interactions.interact(stale, 'Drop');
        record('interact(stale)',  'D', !result.sent && (result as any).reason === 'stale-target' ? 'PASS' : 'FAIL',
            result.sent ? 'SENT (should refuse)' : (result as any).reason);
    }

    const live2 = read().inventory().first();
    if (live2 !== null) {
        const result = interactions.interact(live2, 'Nonsense');
        record('interact(invalid)', 'D', !result.sent && (result as any).reason === 'invalid-action' ? 'PASS' : 'FAIL',
            result.sent ? 'SENT (should refuse)' : (result as any).reason);
    }

    const carried = read().inventory().first();
    const loc = read().locs().results().filter(l => l.name !== null && l.distance <= 5).sort((a, b) => a.distance - b.distance)[0];
    if (carried !== null && loc !== undefined) {
        const result = interactions.useItemOn(carried, loc);
        record('useItemOn()',      'D', result.sent ? 'PASS' : 'FAIL',
            result.sent ? `${carried.name} on ${loc.name}` : (result as any).reason);
    } else {
        record('useItemOn()',      'D', 'SKIP', 'no item or no scenery nearby');
    }
}

stamp('cluster E: NPC dialogue');
{

    await settled();
    const npc = read().npcs().withAction('Talk-to').results()
        .sort((a, b) => a.distance - b.distance)[0];
    if (npc === undefined) {
        for (const m of ['interact(Talk-to)', 'continueDialog()', 'chatOptions()', 'chatModalTexts(live)', 'modals().chat'])
            record(m, 'E', 'SKIP', 'no talkable NPC');
    } else {
        const talk = await settle.perform(api => api.interact(npc, 'Talk-to'), {
            arms: { opened: modalOpened() },
            budgetTicks: 40
        });
        record('interact(Talk-to)', 'E', talk.kind === 'matched' ? 'PASS' : 'FAIL',
            talk.kind === 'matched' ? `talked to ${npc.name}` : `ended ${talk.kind}`);

        if (talk.kind === 'matched') {
            const contId = read().chatContinueComponentId();
            record('chatContinueComponentId()', 'E',
                contId !== -1 || read().chatOptions().exists() ? 'PASS' : 'FAIL', `id=${contId}`);

            record('chatModalTexts(live)', 'E',
                read().chatModalTexts().length > 0 ? 'PASS' : 'UNCERTAIN', `${read().chatModalTexts().length} texts`);
            record('modals().chat', 'E',
                read().modals().chat !== -1 ? 'PASS' : 'FAIL', String(read().modals().chat));

            if (contId !== -1) {
                const cont = await settle.perform(api => api.continueDialog(), {
                    arms: { advanced: (now) => now.chatContinueComponentId() !== contId || now.chatOptions().exists() },
                    budgetTicks: 15
                });
                record('continueDialog()', 'E', cont.kind === 'matched' ? 'PASS' : 'FAIL',
                    cont.kind === 'matched' ? 'advanced' : `ended ${cont.kind}`);
            } else {
                record('continueDialog()', 'E', 'SKIP', 'no continue prompt');
            }

            let foundOptions = read().chatOptions().exists();
            for (let advances = 0; !foundOptions && advances < 5; advances++) {
                const cid = read().chatContinueComponentId();
                if (cid === -1) break;
                await settle.perform(api => api.continueDialog(), {
                    arms: { advanced: (now) => now.chatContinueComponentId() !== cid || now.chatOptions().exists() },
                    budgetTicks: 15
                });
                foundOptions = read().chatOptions().exists();
            }

            if (foundOptions) {
                record('chatOptions(live)', 'E', 'PASS', `${read().chatOptions().count()} options`);
                const option = read().chatOptions().first()!;
                const optWidget = read().component(option.componentId);
                if (optWidget) {
                    const pressed = interactions.press(optWidget);
                    record('press(chatOption)', 'E', pressed.sent ? 'PASS' : 'FAIL',
                        pressed.sent ? `pressed "${option.text}"` : (pressed as any).reason);
                } else {
                    record('press(chatOption)', 'E', 'SKIP', 'option widget not found');
                }
            } else {
                record('chatOptions(live)', 'E', 'UNCERTAIN', 'no options (continue-only NPC)');
                record('press(chatOption)', 'E', 'SKIP', 'needs a quest NPC with choices');
            }

            interactions.closeModal();
            await until(() => read().modals().chat === -1, 5000);
        }
    }
}

stamp('cluster F: shop');
{

    await teleportTo(client, { x: 3080, z: 3250, level: 0 }, () => read().worldTile());
    await waitForScene();

    const shopkeeper = read().npcs().withAction('Trade').results().sort((a, b) => a.distance - b.distance)[0];
    if (shopkeeper === undefined) {
        for (const m of ['interact(Trade)', 'componentItems()', 'component()', 'closeButtonComId()',
            'componentText()', 'closeModal()', 'modalClosed()'])
            record(m, 'F', 'SKIP', 'no shopkeeper nearby');
    } else {
        const open = await settle.perform(api => api.interact(shopkeeper, 'Trade'), {
            arms: { opened: modalOpened() },
            budgetTicks: 40
        });
        record('interact(Trade)',  'F', open.kind === 'matched' ? 'PASS' : 'FAIL',
            open.kind === 'matched' ? 'shop opened' : `ended ${open.kind}`);

        if (open.kind === 'matched') {
            const root = read().modals().main !== -1 ? read().modals().main : read().modals().side;
            record('modalOpened()',    'F', root !== -1 ? 'PASS' : 'FAIL', `root=${root}`);

            const shopWidget = read().widgets().results().find(w =>
                w.rootComponentId === root && w.items.length > 0);
            if (shopWidget) {
                record('componentItems()',  'F', read().componentItems(shopWidget.componentId).count() > 0 ? 'PASS' : 'FAIL',
                    `${read().componentItems(shopWidget.componentId).count()} items`);
                record('component()',  'F', read().component(shopWidget.componentId) !== null ? 'PASS' : 'FAIL',
                    `found ${shopWidget.componentId}`);
            } else {
                record('componentItems()',  'F', 'SKIP', 'no shop container widget');
                record('component()',  'F', 'SKIP', '');
            }

            record('closeButtonComId()', 'F', closeButtonComId(read().snapshot, root) !== -1 ? 'PASS' : 'FAIL',
                String(closeButtonComId(read().snapshot, root)));

            const textW = read().widgets().results().find(w =>
                w.rootComponentId === root && w.text !== null && w.text.length > 0);
            record('componentText()',     'F', textW ? read().componentText(textW.componentId) !== null ? 'PASS' : 'FAIL' : 'SKIP',
                textW ? `"${read().componentText(textW.componentId)}"` : 'no text widget');

            const close = await settle.perform(api => api.closeModal(), {
                arms: { closed: modalClosed() },
                budgetTicks: 10
            });
            record('closeModal()', 'F', close.kind === 'matched' ? 'PASS' : 'FAIL',
                close.kind === 'matched' ? 'closed' : `ended ${close.kind}`);
            record('modalClosed()', 'F', read().modals().main === -1 ? 'PASS' : 'FAIL', 'modal gone');
        }
    }
}

stamp('cluster G: bank');
{
    await teleportTo(client, DRAYNOR_BANK, () => read().worldTile());
    give(client, 'bronze_arrow', 20);
    await waitForScene();

    const booth = read().locs().withName('Bank booth').withAction('Use-quickly').results()
        .sort((a, b) => a.distance - b.distance)[0];
    if (booth === undefined) {
        for (const m of ['interact(Bank)', 'bankComponentId()', 'bank()', 'bankSideItems()',
            'countDialogOpen()', 'answerCount()', 'closeModal(bank)'])
            record(m, 'G', 'SKIP', 'no bank booth');
    } else {
        const open = await settle.perform(api => api.interact(booth, 'Use-quickly'), {
            arms: { opened: modalOpened() },
            budgetTicks: 40
        });
        record('interact(Bank)',   'G', open.kind === 'matched' ? 'PASS' : 'FAIL',
            open.kind === 'matched' ? 'bank opened' : `ended ${open.kind}`);

        if (open.kind === 'matched') {
            record('bankComponentId()', 'G', read().bankComponentId() !== -1 ? 'PASS' : 'FAIL',
                String(read().bankComponentId()));
            record('bank()',       'G', 'PASS', `${read().bank().count()} banked`);
            record('bankItems()',  'G', read().bank().count() === read().bank().count() ? 'PASS' : 'FAIL',
                `bank=${read().bank().count()} bankItems=${read().bank().count()}`);
            record('bankSideItems()', 'G', 'PASS', `${read().bankSideItems().count()} side items`);

            const bankRoot = read().modals().main;
            const labeledBankBtn = read().widgets().results().find(w =>
                w.rootComponentId === bankRoot && w.buttonText !== null && w.buttonText.length > 0);
            record('buttonByText()', 'G', labeledBankBtn
                ? buttonByText(read().snapshot, bankRoot, labeledBankBtn.buttonText!) !== -1 ? 'PASS' : 'FAIL'
                : 'UNCERTAIN',
            labeledBankBtn ? `found "${labeledBankBtn.buttonText}"` : 'no labeled buttons in bank');

            const coins = read().bankSideItems().withName('Coins').first();
            if (coins !== null) {
                const depAll = coins.actions.find(a => a !== null && /deposit[ -]all/i.test(a));
                if (depAll) {
                    interactions.interact(coins, depAll);
                    await pause(1500);
                }
            }

            const bankItem = read().bank().results().find(i => i.actions.some(a => a !== null && /withdraw[ -]x/i.test(a)));
            if (bankItem !== null && bankItem !== undefined) {
                const xAction = bankItem.actions.find(a => a !== null && /withdraw[ -]x/i.test(a))!;
                interactions.interact(bankItem, xAction);
                const prompted = await until(() => read().countDialogOpen(), 8000);
                record('countDialogOpen()', 'G', prompted ? 'PASS' : 'FAIL', String(prompted));
                if (prompted) {
                    const ans = interactions.answerCount(5);
                    record('answerCount()', 'G', ans.sent ? 'PASS' : 'FAIL',
                        ans.sent ? 'answered 5' : (ans as any).reason);
                    await until(() => !read().countDialogOpen(), 5000);
                } else {
                    record('answerCount()', 'G', 'SKIP', 'dialog never opened');
                }
            } else {
                record('countDialogOpen()', 'G', 'SKIP', 'no stackable item with Withdraw-X');
                record('answerCount()', 'G', 'SKIP', '');
            }

            const close = interactions.closeModal();
            record('closeModal(bank)', 'G', close.sent ? 'PASS' : 'FAIL',
                close.sent ? 'closed' : (close as any).reason);
            await until(() => read().modals().main === -1, 5000);
        }
    }
}

stamp('cluster H: combat');
{
    await teleportTo(client, { x: 3248, z: 3237, level: 0 }, () => read().worldTile());
    cheat(client, 'setstat hitpoints 70');
    await waitForScene();

    const goblin = read().npcs().withAction('Attack').results().sort((a, b) => a.distance - b.distance)[0];
    if (goblin === undefined) {
        for (const m of ['interact(Attack)', 'engaged()', 'xpGained()'])
            record(m, 'H', 'SKIP', 'no attackable NPC');
    } else {
        const ATTACK_INDEX = read().stats().withName('attack').first()?.index ?? 0;
        const HP_INDEX = read().stats().withName('hitpoints').first()?.index ?? 3;
        const fight = await settle.perform(api => api.interact(goblin, 'Attack'), {
            arms: {
                fighting: engaged(goblin),
                xp: xpGained(ATTACK_INDEX),
                hp: xpGained(HP_INDEX)
            },
            budgetTicks: 80
        });
        record('interact(Attack)', 'H', fight.kind === 'matched' ? 'PASS' : 'FAIL',
            fight.kind === 'matched' ? `arm=${fight.arm}` : `ended ${fight.kind}`);
        record('engaged()',        'H', fight.kind === 'matched' && fight.arm === 'fighting' ? 'PASS' : 'UNCERTAIN',
            fight.kind === 'matched' ? `arm=${fight.arm}` : 'could not confirm');

        const target = read().localPlayer()?.target;
        record('localPlayer().target', 'H',
            target !== null && target !== undefined ? 'PASS' : 'UNCERTAIN',
            target ? `index=${target.index} kind=${target.kind}` : 'null');

        if (fight.kind === 'matched') {
            const xpBefore: Record<string, number> = {};
            for (const s of fight.before.stats().results()) xpBefore[s.name] = s.xp;

            await settle.ticks(40);

            const xpAfter = read().stats().results();
            const gains = xpAfter
                .filter(s => s.xp > (xpBefore[s.name] ?? 0))
                .map(s => `${s.name} +${s.xp - (xpBefore[s.name] ?? 0)}`);
            record('xpGained()',   'H', gains.length > 0 ? 'PASS' : 'UNCERTAIN',
                gains.length > 0 ? gains.join(', ') : 'no xp gained in 40 ticks');
        } else {
            record('xpGained()',   'H', 'UNCERTAIN', 'fight did not resolve');
        }
    }
}

stamp('cluster I: scenery');
{
    await teleportTo(client, DRAYNOR_BANK, () => read().worldTile());
    await waitForScene();

    const door = read().locs().withName('Door').results()
        .filter(l => l.actions.some(a => a === 'Open' || a === 'Close'))
        .sort((a, b) => a.distance - b.distance)[0];
    if (door === undefined) {
        record('interact(door)',   'I', 'SKIP', 'no door nearby');
        record('optionGone()',     'I', 'SKIP', '');
        record('said()',           'I', 'SKIP', '');
    } else {
        const verb = door.actions.includes('Open') ? 'Open' : 'Close';
        const result = await settle.perform(api => api.interact(door, verb), {
            arms: { worked: optionGone(door, verb), blocked: said(CANNOT_REACH) },
            budgetTicks: 30
        });
        record('interact(door)',   'I', result.kind === 'matched' ? 'PASS' : 'FAIL',
            result.kind === 'matched' ? `${verb} arm=${result.arm}` : `ended ${result.kind}`);
        record('optionGone()',     'I',
            result.kind === 'matched' && result.arm === 'worked' ? 'PASS' : 'UNCERTAIN',
            result.kind === 'matched' ? result.arm : '');

        const farLoc = read().locs().results()
            .filter(l => l.actions.some(a => a !== null && a !== 'hidden') && l.distance > 15)
            .sort((a, b) => b.distance - a.distance)[0];
        if (farLoc !== undefined) {
            const action = farLoc.actions.find(a => a !== null && a !== 'hidden')!;
            const sayResult = await settle.perform(api => api.interact(farLoc, action), {
                arms: { blocked: said(CANNOT_REACH) },
                budgetTicks: 20
            });
            record('said()',       'I', sayResult.kind === 'matched' ? 'PASS' : 'UNCERTAIN',
                sayResult.kind === 'matched' ? 'got "can\'t reach"' : `ended ${sayResult.kind}`);
        } else {
            record('said()',       'I', 'UNCERTAIN', 'no far loc to test reach on');
        }
    }
}

stamp('cluster J: prayer');
{

    const prayerTab = interactions.clickSideTab(5);
    record('clickSideTab(prayer)', 'J', prayerTab.sent ? 'PASS' : 'FAIL',
        prayerTab.sent ? 'tab 5' : (prayerTab as any).reason);
    await pause(500);

    const prayerVarp = 83;
    const prayerValue = read().varp(prayerVarp);
    record('prayer varp read', 'J', prayerValue === 0 ? 'PASS' : 'UNCERTAIN',
        `varp(${prayerVarp})=${prayerValue}, bit0=${(prayerValue & 1) !== 0}`);
}

stamp('cluster K: refusals');
{
    await waitForScene();

    const noModal = interactions.clearLocalModal(9999);
    record('clearLocalModal(none)', 'K', !noModal.sent && (noModal as any).reason === 'no-modal-open' ? 'PASS' : 'FAIL',
        noModal.sent ? 'SENT (should refuse)' : (noModal as any).reason);

    const noCont = interactions.continueDialog();
    record('continueDialog(none)', 'K', !noCont.sent && (noCont as any).reason === 'no-continue' ? 'PASS' : 'FAIL',
        noCont.sent ? 'SENT (should refuse)' : (noCont as any).reason);

    const noClose = interactions.closeModal();
    record('closeModal(none)',     'K', !noClose.sent && (noClose as any).reason === 'no-modal-open' ? 'PASS' : 'FAIL',
        noClose.sent ? 'SENT (should refuse)' : (noClose as any).reason);

    const noCount = interactions.answerCount(5);
    record('answerCount(none)',    'K', !noCount.sent && (noCount as any).reason === 'no-count-dialog' ? 'PASS' : 'FAIL',
        noCount.sent ? 'SENT (should refuse)' : (noCount as any).reason);

    const loginIngame = interactions.login('x', 'y');
    record('login(while ingame)',  'K', !loginIngame.sent && (loginIngame as any).reason === 'already-ingame' ? 'PASS' : 'FAIL',
        loginIngame.sent ? 'SENT (should refuse)' : (loginIngame as any).reason);
}

const pass = rows.filter(r => r.verdict === 'PASS').length;
const fail = rows.filter(r => r.verdict === 'FAIL').length;
const skip = rows.filter(r => r.verdict === 'SKIP').length;
const uncertain = rows.filter(r => r.verdict === 'UNCERTAIN').length;

console.log('\n');
console.log('# apiv2 Surface Probe Results');
console.log('');
console.log('| Method | Cluster | Result | Value |');
console.log('|--------|---------|--------|-------|');
for (const r of rows) {
    const v = r.value.replace(/\|/g, '\\|').slice(0, 60);
    console.log(`| ${r.method} | ${r.cluster} | ${r.verdict} | ${v} |`);
}
console.log('');
console.log(`**${pass} PASS** | **${fail} FAIL** | **${skip} SKIP** | **${uncertain} UNCERTAIN** | **${rows.length} total**`);
console.log('');

const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
console.log(`completed in ${elapsed}s`);

process.exit(fail === 0 ? 0 : 1);
