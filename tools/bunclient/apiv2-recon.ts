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
const { ReadContext } = await import('../../do-not-touch/apiv2/ReadApi.js');
const source = new LiveSnapshotSource();
const r = new ReadContext(source.read());

console.log(`\nAT ${JSON.stringify(r.worldTile())}\n`);

console.log(`carried (${r.inventory().count()}):`, r.inventory().results().map(i => `${i.name} x${i.count} slot=${i.slot} com=${i.componentId}`).join(', ') || 'nothing');
console.log(`worn    (${r.equipment().count()}):`, r.equipment().results().map(i => i.name).join(', ') || 'nothing');
console.log('coins:', r.inventory().results().filter(i => /coin/i.test(i.name ?? '')).map(i => i.count).join(',') || '0');

console.log('\nNPCS WITH TALK-TO:');
for (const n of r.npcs().withAction('Talk-to').results().sort((a, b) => a.distance - b.distance).slice(0, 6)) {
    console.log(`  ${n.name} id=${n.id} idx=${n.index} dist=${n.distance} ops=${JSON.stringify(n.actions.filter(a => a !== null))}`);
}

console.log('\nNEAREST BANK / SHOP / STATION SCENERY:');
const interesting = /bank|booth|chest|stall|counter|shop|door|staircase|ladder|range|furnace|anvil/i;
const seen = new Set<string>();
for (const l of r.locs().results().filter(l => interesting.test(l.name ?? '')).sort((a, b) => a.distance - b.distance)) {
    const key = `${l.name}:${l.actions.filter(a => a !== null).join('/')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (seen.size > 10) break;
    console.log(`  ${l.name} dist=${l.distance} at ${l.tile.x},${l.tile.z} ops=${JSON.stringify(l.actions.filter(a => a !== null))}`);
}

console.log('\nGROUND ITEMS:', r.groundItems().results().slice(0, 6).map(i => `${i.name} x${i.count} dist=${i.distance}`).join(', ') || 'none');

console.log('\nINTERFACE STATE:');
console.log(`  modals: ${JSON.stringify(r.modals())}  activeSideTab=${r.activeSideTab()}  countDialogOpen=${r.countDialogOpen()}`);
console.log(`  chatContinue=${r.chatContinueComponentId()}  chatOptions=${r.chatOptions().count()}`);
console.log(`  runControls: ${JSON.stringify(r.runControls())}`);
console.log(`  retaliateControls: ${JSON.stringify(r.retaliateControls())}`);
console.log(`  widgets captured: ${r.widgets().count()}   side tabs: ${r.sideTabs().count()}`);
for (const t of r.sideTabs().results()) {
    console.log(`    tab ${t.index} root=${t.rootComponentId} available=${t.available} visible=${t.visible} widgets=${t.widgets.length}`);
}

console.log('\nSPELL-LIKE (targetable) COMPONENTS:');
const targetable = r.widgets().results().filter(w => w.buttonType === 2);
console.log(`  ${targetable.length} found` + (targetable.length ? `: ${targetable.slice(0, 5).map(w => `${w.componentId} mask=0x${w.targetMask.toString(16)} verb=${JSON.stringify(w.targetVerb)}`).join(', ')}` : ''));
const tabTargetable = r.sideTabs().results().flatMap(t => t.widgets.filter(w => w.buttonType === 2));
console.log(`  in side tabs: ${tabTargetable.length}` + (tabTargetable.length ? `: ${tabTargetable.slice(0, 5).map(w => `${w.componentId} mask=0x${w.targetMask.toString(16)} verb=${JSON.stringify(w.targetVerb)}`).join(', ')}` : ''));

console.log('\nSTATS:', r.stats().results().filter(s => s.base > 1).map(s => `${s.name}=${s.base}`).join(' ') || 'all 1');
process.exit(0);
