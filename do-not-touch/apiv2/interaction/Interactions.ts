import { ReadContext } from '../ReadApi.js';
import type { GameSnapshot, ItemSnapshot, SceneSnapshot, WidgetSnapshot, WorldTile } from '../snapshots/GameSnapshot.js';
import type { SnapshotSource } from '../snapshots/SnapshotSource.js';
import { offersOperation, operationOf } from './ActionResolution.js';
import { stillPresent } from './TargetIdentity.js';
import { SCENE_READY, type InteractionDriver, type OpTarget, type SendReason, type SendResult, type WireCommand } from './WireCommand.js';

const BUTTON_TARGET = 2;

const MAX_COUNT = 2147483647;

const AIM_BIT: Readonly<Record<OpTarget['kind'], number>> = {
    groundItem: 0x1,
    npc: 0x2,
    location: 0x4,
    player: 0x8,
    item: 0x10
};

function addressedByTile(target: OpTarget): target is Extract<OpTarget, { tile: WorldTile }> {
    return target.kind === 'location' || target.kind === 'groundItem';
}

function outsideScene(scene: SceneSnapshot, tile: WorldTile): boolean {
    const lx = tile.x - scene.baseX;
    const lz = tile.z - scene.baseZ;
    return lx < 0 || lz < 0 || lx >= scene.width || lz >= scene.height;
}

function componentVisible(widget: WidgetSnapshot, snapshot: GameSnapshot): boolean {
    const modals = snapshot.modals;
    if (widget.layerId === modals.main || widget.layerId === modals.side || widget.layerId === modals.chat || widget.layerId === modals.tutorial) return true;
    return snapshot.sideTabs.some(tab => tab.available && tab.rootComponentId === widget.layerId);
}

function refuse(snapshot: GameSnapshot, reason: SendReason): SendResult {
    return { sent: false, tick: snapshot.tick, reason };
}

export class Interactions {
    constructor(
        private readonly source: SnapshotSource,
        private readonly driver: InteractionDriver
    ) {}

    interact(target: OpTarget, action: string | RegExp | number): SendResult {
        const snapshot = this.source.read();

        const blocked = this.precondition(snapshot);
        if (blocked !== null) return refuse(snapshot, blocked);

        const rejected = this.checkTarget(target, snapshot);
        if (rejected !== null) return refuse(snapshot, rejected);

        const operation = typeof action === 'number' ? (offersOperation(target, action) ? action : null) : operationOf(target, action);
        if (operation === null) return refuse(snapshot, 'invalid-action');

        return this.dispatch({ kind: 'op', target, operation }, snapshot.tick);
    }

    useItemOn(item: ItemSnapshot, target: OpTarget): SendResult {
        const snapshot = this.source.read();

        const blocked = this.precondition(snapshot);
        if (blocked !== null) return refuse(snapshot, blocked);

        if (item.container !== 'inventory') return refuse(snapshot, 'unsupported-target');
        if (!stillPresent(item, snapshot)) return refuse(snapshot, 'stale-target');

        const rejected = this.checkTarget(target, snapshot);
        if (rejected !== null) return refuse(snapshot, rejected);

        return this.dispatch({ kind: 'use-item', select: item, target }, snapshot.tick);
    }

    useWidgetOn(widget: WidgetSnapshot, target: OpTarget): SendResult {
        const snapshot = this.source.read();

        const blocked = this.precondition(snapshot);
        if (blocked !== null) return refuse(snapshot, blocked);

        const live = new ReadContext(snapshot).component(widget.componentId);
        if (live === null) return refuse(snapshot, 'stale-target');
        if (live.buttonType !== BUTTON_TARGET) return refuse(snapshot, 'invalid-action');
        if (!componentVisible(live, snapshot)) return refuse(snapshot, 'component-not-visible');
        if ((live.targetMask & AIM_BIT[target.kind]) === 0) return refuse(snapshot, 'target-mask-mismatch');

        const rejected = this.checkTarget(target, snapshot);
        if (rejected !== null) return refuse(snapshot, rejected);

        return this.dispatch({ kind: 'use-widget', componentId: live.componentId, target }, snapshot.tick);
    }

    press(widget: WidgetSnapshot): SendResult {
        const snapshot = this.source.read();

        const blocked = this.precondition(snapshot);
        if (blocked !== null) return refuse(snapshot, blocked);

        const live = new ReadContext(snapshot).component(widget.componentId);
        if (live === null) return refuse(snapshot, 'stale-target');

        if (live.buttonType === 0 || live.buttonType === BUTTON_TARGET) return refuse(snapshot, 'invalid-action');

        if (live.clientCode > 0) return refuse(snapshot, 'client-side-only');

        if (!componentVisible(live, snapshot)) return refuse(snapshot, 'component-not-visible');

        return this.dispatch({ kind: 'button', componentId: live.componentId, buttonType: live.buttonType }, snapshot.tick);
    }

    continueDialog(): SendResult {
        const snapshot = this.source.read();

        const blocked = this.precondition(snapshot);
        if (blocked !== null) return refuse(snapshot, blocked);

        const componentId = snapshot.chatContinueComponentId;
        if (componentId === -1) return refuse(snapshot, 'no-continue');

        return this.dispatch({ kind: 'continue', componentId }, snapshot.tick);
    }

    closeModal(): SendResult {
        const snapshot = this.source.read();

        const blocked = this.precondition(snapshot);
        if (blocked !== null) return refuse(snapshot, blocked);

        const modals = snapshot.modals;
        if (modals.main === -1 && modals.side === -1 && modals.chat === -1 && modals.tutorial === -1) return refuse(snapshot, 'no-modal-open');

        return this.dispatch({ kind: 'close' }, snapshot.tick);
    }

    answerCount(value: number): SendResult {
        const snapshot = this.source.read();

        const blocked = this.precondition(snapshot, { allowCountDialog: true });
        if (blocked !== null) return refuse(snapshot, blocked);

        if (!snapshot.countDialogOpen) return refuse(snapshot, 'no-count-dialog');
        if (!Number.isInteger(value) || value < 0 || value > MAX_COUNT) return refuse(snapshot, 'invalid-count');

        return this.dispatch({ kind: 'count', value }, snapshot.tick);
    }

    walk(tile: WorldTile): SendResult {
        const snapshot = this.source.read();

        const blocked = this.precondition(snapshot);
        if (blocked !== null) return refuse(snapshot, blocked);

        if (tile.level !== snapshot.scene.level) return refuse(snapshot, 'level-mismatch');
        if (outsideScene(snapshot.scene, tile)) return refuse(snapshot, 'off-scene');

        return this.dispatch({ kind: 'walk', tile }, snapshot.tick, 'unreachable');
    }

    clickSideTab(tab: number): SendResult {
        const snapshot = this.source.read();

        if (!snapshot.attached) return refuse(snapshot, 'not-attached');
        if (!snapshot.ingame) return refuse(snapshot, 'not-ingame');

        const sideTab = snapshot.sideTabs.find(t => t.index === tab);
        if (sideTab === undefined || !sideTab.available) return refuse(snapshot, 'invalid-tab');

        return this.dispatch({ kind: 'side-tab', tab }, snapshot.tick);
    }

    login(username: string, password: string): SendResult {
        const snapshot = this.source.read();

        if (!snapshot.attached) return refuse(snapshot, 'not-attached');
        if (snapshot.ingame) return refuse(snapshot, 'already-ingame');

        return this.dispatch({ kind: 'login', username, password }, snapshot.tick);
    }

    clearLocalModal(componentId: number): SendResult {
        const snapshot = this.source.read();

        if (!snapshot.attached) return refuse(snapshot, 'not-attached');

        const modals = snapshot.modals;
        if (modals.main !== componentId && modals.side !== componentId && modals.chat !== componentId && modals.tutorial !== componentId) {
            return refuse(snapshot, 'no-modal-open');
        }

        return this.dispatch({ kind: 'clear-local-modal', componentId }, snapshot.tick);
    }

    setRun(on: boolean): SendResult {
        return this.setToggle(this.source.read(), 'runControls', on);
    }

    setRetaliate(on: boolean): SendResult {
        return this.setToggle(this.source.read(), 'retaliateControls', on);
    }

    private setToggle(snapshot: GameSnapshot, key: 'runControls' | 'retaliateControls', on: boolean): SendResult {
        const blocked = this.precondition(snapshot);
        if (blocked !== null) return refuse(snapshot, blocked);

        const controls = snapshot[key];
        if (controls === null) return refuse(snapshot, 'component-not-visible');

        const componentId = on ? controls.onComponentId : controls.offComponentId;
        const live = new ReadContext(snapshot).component(componentId);
        if (live === null) return refuse(snapshot, 'component-not-visible');

        return this.dispatch({ kind: 'button', componentId, buttonType: live.buttonType }, snapshot.tick);
    }

    private precondition(snapshot: GameSnapshot, options: { allowCountDialog?: boolean } = {}): SendReason | null {
        if (!snapshot.attached) return 'not-attached';
        if (!snapshot.ingame) return 'not-ingame';
        if (snapshot.countDialogOpen && options.allowCountDialog !== true) return 'count-dialog-open';
        if (!snapshot.scene.available || snapshot.sceneState !== SCENE_READY) return 'scene-unavailable';
        return null;
    }

    private checkTarget(target: OpTarget, snapshot: GameSnapshot): SendReason | null {
        if (target.kind === 'item' && target.actionFamily === 'none') return 'unsupported-target';

        if (addressedByTile(target)) {
            if (target.tile.level !== snapshot.scene.level) return 'level-mismatch';
            if (outsideScene(snapshot.scene, target.tile)) return 'off-scene';
        }

        if (!stillPresent(target, snapshot)) return 'stale-target';
        return null;
    }

    private dispatch(command: WireCommand, tick: number, rejectedReason: SendReason = 'driver-rejected'): SendResult {
        return this.driver.dispatch(command) ? { sent: true, tick, command } : { sent: false, tick, reason: rejectedReason };
    }
}
