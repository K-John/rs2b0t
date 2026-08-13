import { BotHost } from '#/bot/runtime/BotHost.js';
import { actions as liveActions, reader as liveReader } from '#/bot/adapter/ClientAdapter.js';

import type {
    ChatLineSnapshot,
    ChatOptionSnapshot,
    CameraSnapshot,
    GameSnapshot,
    GroundItemSnapshot,
    ItemActionFamily,
    ItemContainer,
    ItemSnapshot,
    LocSnapshot,
    LocalPlayerSnapshot,
    MakeProductSnapshot,
    ModalSnapshot,
    NpcSnapshot,
    PlayerSnapshot,
    QuestStatusSnapshot,
    SceneSnapshot,
    SideTabSnapshot,
    SnapshotAction,
    StatSnapshot,
    ToggleControlsSnapshot,
    TradeSnapshot,
    VarpSnapshot,
    WidgetSnapshot,
    WorldStateSnapshot,
    WorldTile
} from './GameSnapshot.js';
import type { SnapshotReader, SnapshotSource } from './SnapshotSource.js';

const liveSourceReader: SnapshotReader = {
    attached: () => liveReader.attached(),
    ingame: () => liveReader.ingame(),
    sceneState: () => liveReader.sceneState(),
    chat: () => liveReader.chat(100).map(line => ({ ...line })),
    selfSlot: () => liveReader.selfSlot(),
    localPlayer: () => {
        const player = liveReader.localPlayer();
        if (player === null) {
            return null;
        }
        return {
            kind: 'player',
            index: player.index,
            name: player.name,
            actions: [...player.ops],
            tile: { ...player.tile },
            distance: player.distance,
            animation: player.animation,
            poseAnimation: player.poseAnimation,
            orientation: player.orientation,
            targetOrientation: player.targetOrientation,
            overheadText: player.overheadText,
            spotAnimation: player.spotAnimation,
            inCombat: player.inCombat,
            health: player.health,
            totalHealth: player.totalHealth,
            faceEntity: player.faceEntity,
            target: player.target === null ? null : { ...player.target },
            moving: player.moving,
            running: player.running,
            combatLevel: player.combatLevel,
            skillLevel: player.skillLevel
        };
    },
    stats: () => Array.from({ length: liveReader.skillCount() }, (_, index) => ({ ...liveReader.stat(index), index, used: liveReader.skillUsed(index) })),
    worldTile: () => liveReader.worldTile(),
    selfAnim: () => liveReader.selfAnim(),
    energy: () => liveReader.energy(),
    weight: () => liveReader.weight(),
    localPlayerName: () => liveReader.localPlayerName(),
    inCombat: () => liveReader.inCombat(),
    npcs: () =>
        liveReader.npcs().map(npc => ({
            kind: 'npc',
            index: npc.index,
            id: npc.id,
            animation: npc.anim,
            name: npc.name,
            level: npc.level,
            tile: { ...npc.tile },
            distance: npc.distance,
            actions: [...npc.ops],
            poseAnimation: npc.poseAnimation,
            orientation: npc.orientation,
            targetOrientation: npc.targetOrientation,
            overheadText: npc.overheadText,
            spotAnimation: npc.spotAnimation,
            inCombat: npc.inCombat,
            health: npc.health,
            totalHealth: npc.totalHealth,
            faceEntity: npc.faceEntity,
            target: npc.target === null ? null : { ...npc.target },
            moving: npc.moving,
            running: npc.running,
            size: npc.size
        })),
    players: () =>
        liveReader.players().map(player => ({
            kind: 'player',
            index: player.index,
            name: player.name,
            actions: [...player.ops],
            tile: { ...player.tile },
            distance: player.distance,
            animation: player.animation,
            poseAnimation: player.poseAnimation,
            orientation: player.orientation,
            targetOrientation: player.targetOrientation,
            overheadText: player.overheadText,
            spotAnimation: player.spotAnimation,
            inCombat: player.inCombat,
            health: player.health,
            totalHealth: player.totalHealth,
            faceEntity: player.faceEntity,
            target: player.target === null ? null : { ...player.target },
            moving: player.moving,
            running: player.running,
            combatLevel: player.combatLevel,
            skillLevel: player.skillLevel
        })),
    locs: () =>
        liveReader.locs().map(loc => ({
            kind: 'location',
            typecode: loc.typecode,
            info: loc.info,
            id: loc.id,
            name: loc.name,
            description: loc.description,
            actions: [...loc.ops],
            tile: { ...loc.tile },
            distance: loc.distance,
            layer: loc.layer,
            shape: loc.shape,
            angle: loc.angle,
            width: loc.width,
            length: loc.length,
            footprintWidth: loc.footprintWidth,
            footprintLength: loc.footprintLength,
            blockWalk: loc.blockWalk,
            blockRange: loc.blockRange,
            active: loc.active,
            animation: loc.animation,
            mapFunction: loc.mapFunction,
            mapScene: loc.mapScene,
            forceApproach: loc.forceApproach
        })),
    groundItems: () =>
        liveReader.groundItems().map(item => ({
            kind: 'groundItem',
            id: item.id,
            name: item.name,
            description: item.description,
            count: item.count,
            actions: [...item.ops],
            tile: { ...item.tile },
            distance: item.distance,
            stackable: item.stackable,
            members: item.members,
            baseValue: item.baseValue,
            noted: item.noted,
            certificateLink: item.certificateLink,
            certificateTemplate: item.certificateTemplate
        })),
    inventory: () => liveReader.inventory().map(item => liveItemSnapshot(item, 'inventory', 'held')),
    equipment: () => liveReader.equipment().map(item => liveItemSnapshot(item, 'equipment', 'component')),
    inventorySize: () => liveReader.inventorySize(),
    bankComId: () => liveReader.bankComId(),
    bankItems: () => liveReader.bankItems().map(item => liveItemSnapshot(item, 'bank', 'component')),
    bankSideItems: () => liveReader.bankSideItems().map(item => liveItemSnapshot(item, 'bankSide', 'component')),
    chatContinueComId: () => liveReader.chatContinueComId(),
    chatOptions: () => liveReader.chatOptions().map(option => ({ componentId: option.comId, text: option.text })),
    makeProducts: () =>
        liveReader.makeProducts().map(product => ({
            objectId: product.obj,
            name: product.name,
            buttons: product.buttons.map(button => ({ quantity: button.qty, componentId: button.comId }))
        })),
    runControls: () => {
        const controls = liveReader.runControls();
        return controls === null ? null : { onComponentId: controls.onComId, offComponentId: controls.offComId };
    },
    retaliateControls: () => {
        const controls = liveReader.retaliateControls();
        return controls === null ? null : { onComponentId: controls.onComId, offComponentId: controls.offComId };
    },
    loginMessage: () => liveReader.loginMessage(),
    menuEntries: () => [...liveReader.menuEntries()],
    modals: () => ({ ...liveReader.modals(), tutorial: -1 }) as ModalSnapshot,
    countDialogOpen: () => liveReader.countDialogOpen(),
    activeSideTab: () => liveReader.activeSideTab(),
    mainModalTexts: () => [...liveReader.mainModalTexts()],
    chatModalTexts: () => [...liveReader.chatModalTexts()],
    questStatuses: () => liveReader.questStatuses().map(status => ({ componentId: status.comId, name: status.name, colour: status.colour })),
    widgets: () => liveReader.widgets().map(liveWidgetSnapshot),
    sideTabs: () =>
        liveReader.sideTabs().map(tab => ({
            ...tab,
            widgets: tab.widgets.map(liveWidgetSnapshot)
        })),
    varps: () => liveReader.varps().map(varp => ({ ...varp })),
    worldState: () => ({ ...liveReader.worldState() }),
    scene: () => {
        const scene = liveReader.scene();
        return { ...scene, collisionFlags: [...scene.collisionFlags] };
    },
    cameraState: () => ({ ...liveReader.cameraState() }),
    mapFlag: () => liveReader.mapFlag(),
    loginCredentials: () => liveActions.loginCredentials(),
    trade: () => ({
        offerOpen: liveReader.tradeOfferOpen(),
        confirmOpen: liveReader.tradeConfirmOpen(),
        myOffer: liveReader.tradeMyOffer().map(item => liveItemSnapshot(item, 'tradeMyOffer', 'component')),
        theirOffer: liveReader.tradeTheirOffer().map(item => liveItemSnapshot(item, 'tradeTheirOffer', 'none')),
        sidePack: liveReader.tradeSidePack().map(item => liveItemSnapshot(item, 'tradeSidePack', 'component')),
        partner: normalizeTradePartner(liveReader.tradePartner())
    })
};

function liveItemSnapshot(item: ReturnType<typeof liveReader.inventory>[number], container: ItemContainer, actionFamily: ItemActionFamily): ItemSnapshot {
    return {
        kind: 'item',
        container,
        actionFamily,
        slot: item.slot,
        id: item.id,
        name: item.name,
        description: item.description ?? null,
        count: item.count,
        actions: [...item.ops],
        componentId: item.comId,
        stackable: item.stackable ?? false,
        members: item.members ?? false,
        baseValue: item.baseValue ?? 0,
        noted: item.noted ?? false,
        certificateLink: item.certificateLink ?? -1,
        certificateTemplate: item.certificateTemplate ?? -1
    };
}

function liveWidgetSnapshot(widget: ReturnType<typeof liveReader.widgets>[number]): WidgetSnapshot {
    return {
        kind: 'widget',
        componentId: widget.componentId,
        layerId: widget.layerId,
        parentId: widget.parentId,
        rootComponentId: widget.rootComponentId,
        root: widget.root,
        type: widget.type,
        buttonType: widget.buttonType,
        clientCode: widget.clientCode,
        x: widget.x,
        y: widget.y,
        width: widget.width,
        height: widget.height,
        scrollHeight: widget.scrollHeight,
        scrollPosition: widget.scrollPosition,
        hidden: widget.hidden,
        text: widget.text,
        alternateText: widget.alternateText,
        buttonText: widget.buttonText,
        targetVerb: widget.targetVerb,
        targetBase: widget.targetBase,
        targetMask: widget.targetMask,
        modelType: widget.modelType,
        modelId: widget.modelId,
        alternateModelType: widget.alternateModelType,
        alternateModelId: widget.alternateModelId,
        scripts: widget.scripts?.map(script => (script === null ? null : [...script])) ?? null,
        scriptComparators: widget.scriptComparators == null ? null : [...widget.scriptComparators],
        scriptOperands: widget.scriptOperands == null ? null : [...widget.scriptOperands],
        varpBindings: (widget.varpBindings ?? []).map(binding => ({ ...binding })),
        colour: widget.colour,
        actions: [...widget.ops],
        items: widget.items.map(item => liveItemSnapshot(item, 'widget', 'component'))
    };
}

function normalizeTradePartner(value: string | null): string | null {
    if (value === null) {
        return null;
    }

    const colon = value.indexOf(':');
    const name = (colon === -1 ? value : value.slice(colon + 1)).trim();
    return name || null;
}

function copyTile(tile: WorldTile): WorldTile {
    return { x: tile.x, z: tile.z, level: tile.level };
}

function copyActions(actions: readonly SnapshotAction[]): SnapshotAction[] {
    return [...actions];
}

function copyLocalPlayer(source: SnapshotReader, tile: WorldTile): LocalPlayerSnapshot {
    const player = source.localPlayer?.();
    if (player) {
        return {
            ...copyPlayer(player),
            energy: source.energy(),
            weight: source.weight()
        };
    }
    return {
        kind: 'player',
        index: source.selfSlot?.() ?? -1,
        name: source.localPlayerName(),
        actions: [],
        tile: copyTile(tile),
        distance: 0,
        animation: source.selfAnim(),
        poseAnimation: -1,
        orientation: 0,
        targetOrientation: 0,
        overheadText: null,
        spotAnimation: -1,
        energy: source.energy(),
        weight: source.weight(),
        inCombat: source.inCombat(),
        health: 0,
        totalHealth: 0,
        faceEntity: -1,
        target: null,
        moving: false,
        running: false,
        combatLevel: 0,
        skillLevel: 0
    };
}

function copyNpc(npc: ReturnType<SnapshotReader['npcs']>[number]): NpcSnapshot {
    return {
        ...npc,
        kind: 'npc',
        tile: copyTile(npc.tile),
        actions: copyActions(npc.actions),
        target: npc.target === null ? null : { ...npc.target }
    };
}

function copyPlayer(player: ReturnType<SnapshotReader['players']>[number]): PlayerSnapshot {
    return { ...player, kind: 'player', actions: copyActions(player.actions), tile: copyTile(player.tile), target: player.target === null ? null : { ...player.target } };
}

function copyLoc(loc: ReturnType<SnapshotReader['locs']>[number]): LocSnapshot {
    return {
        ...loc,
        kind: 'location',
        actions: copyActions(loc.actions),
        tile: copyTile(loc.tile)
    };
}

function copyGroundItem(item: ReturnType<SnapshotReader['groundItems']>[number]): GroundItemSnapshot {
    return {
        ...item,
        kind: 'groundItem',
        actions: copyActions(item.actions),
        tile: copyTile(item.tile)
    };
}

function copyItem(item: ReturnType<SnapshotReader['inventory']>[number], container: ItemContainer, actionFamily: ItemActionFamily): ItemSnapshot {
    return { ...item, kind: 'item', container, actionFamily, actions: copyActions(item.actions) };
}

function copyChatLine(line: ChatLineSnapshot): ChatLineSnapshot {
    return { ...line };
}

function copyStat(stat: StatSnapshot): StatSnapshot {
    return { ...stat };
}

function copyChatOption(option: ChatOptionSnapshot): ChatOptionSnapshot {
    return { ...option };
}

function copyMakeProduct(product: MakeProductSnapshot): MakeProductSnapshot {
    return {
        ...product,
        buttons: product.buttons.map(button => ({ ...button }))
    };
}

function copyToggleControls(controls: ToggleControlsSnapshot | null): ToggleControlsSnapshot | null {
    return controls === null ? null : { ...controls };
}

function copyQuestStatus(status: QuestStatusSnapshot): QuestStatusSnapshot {
    return { ...status };
}

function copyWidget(widget: ReturnType<NonNullable<SnapshotReader['widgets']>>[number]): WidgetSnapshot {
    return {
        ...widget,
        kind: 'widget',
        scripts: widget.scripts?.map(script => (script === null ? null : [...script])) ?? null,
        scriptComparators: widget.scriptComparators === null ? null : [...widget.scriptComparators],
        scriptOperands: widget.scriptOperands === null ? null : [...widget.scriptOperands],
        varpBindings: widget.varpBindings.map(binding => ({ ...binding })),
        actions: copyActions(widget.actions),
        items: widget.items.map(item => copyItem(item, 'widget', 'component'))
    };
}

function copySideTab(tab: ReturnType<NonNullable<SnapshotReader['sideTabs']>>[number]): SideTabSnapshot {
    return { ...tab, widgets: tab.widgets.map(copyWidget) };
}

function copyVarp(varp: VarpSnapshot): VarpSnapshot {
    return { ...varp };
}

function copyScene(scene: SceneSnapshot): SceneSnapshot {
    return { ...scene, collisionFlags: [...scene.collisionFlags] };
}

const emptyWorldState: WorldStateSnapshot = { mapBaseX: 0, mapBaseZ: 0, level: 0, members: false, multiCombat: false, playerCount: 0, npcCount: 0, cycle: 0 };
const emptyCamera: CameraSnapshot = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, orbitPitch: 0, orbitYaw: 0, cinematic: false };

function copyTrade(trade: ReturnType<NonNullable<SnapshotReader['trade']>>): TradeSnapshot {
    return {
        offerOpen: trade.offerOpen,
        confirmOpen: trade.confirmOpen,
        myOffer: trade.myOffer.map(item => copyItem(item, 'tradeMyOffer', 'component')),
        theirOffer: trade.theirOffer.map(item => copyItem(item, 'tradeTheirOffer', 'none')),
        sidePack: trade.sidePack.map(item => copyItem(item, 'tradeSidePack', 'component')),
        partner: trade.partner
    };
}

const emptyModals: ModalSnapshot = { main: -1, side: -1, chat: -1, tutorial: -1 };
const emptyTrade: TradeSnapshot = {
    offerOpen: false,
    confirmOpen: false,
    myOffer: [],
    theirOffer: [],
    sidePack: [],
    partner: null
};

const emptyScene: SceneSnapshot = {
    available: false,
    baseX: 0,
    baseZ: 0,
    level: 0,
    width: 104,
    height: 104,
    collisionFlags: []
};

export class LiveSnapshotSource implements SnapshotSource {
    constructor(
        private readonly source: SnapshotReader = liveSourceReader,
        private readonly tick: () => number = () => BotHost.tickCount
    ) {}

    read(): GameSnapshot {
        const tile = this.source.worldTile();
        const localPlayer = tile === null ? null : copyLocalPlayer(this.source, tile);

        return {
            tick: this.tick(),
            attached: this.source.attached?.() ?? true,
            ingame: this.source.ingame(),
            sceneState: this.source.sceneState?.() ?? 0,
            localPlayer,
            selfSlot: this.source.selfSlot?.() ?? -1,
            stats: (this.source.stats?.() ?? []).map(copyStat),
            npcs: this.source.npcs().map(copyNpc),
            players: this.source.players().map(copyPlayer),
            locs: this.source.locs().map(copyLoc),
            groundItems: this.source.groundItems().map(copyGroundItem),
            inventory: this.source.inventory().map(item => copyItem(item, 'inventory', 'held')),
            equipment: this.source.equipment().map(item => copyItem(item, 'equipment', 'component')),
            chat: this.source.chat().map(copyChatLine),
            inventorySize: this.source.inventorySize?.() ?? 0,
            bankComponentId: this.source.bankComId?.() ?? -1,
            bankItems: (this.source.bankItems?.() ?? []).map(item => copyItem(item, 'bank', 'component')),
            bankSideItems: (this.source.bankSideItems?.() ?? []).map(item => copyItem(item, 'bankSide', 'component')),
            chatContinueComponentId: this.source.chatContinueComId?.() ?? -1,
            chatOptions: (this.source.chatOptions?.() ?? []).map(copyChatOption),
            makeProducts: (this.source.makeProducts?.() ?? []).map(copyMakeProduct),
            runControls: copyToggleControls(this.source.runControls?.() ?? null),
            retaliateControls: copyToggleControls(this.source.retaliateControls?.() ?? null),
            loginMessage: this.source.loginMessage?.() ?? '',
            menuEntries: [...(this.source.menuEntries?.() ?? [])],
            modals: { ...emptyModals, ...(this.source.modals?.() ?? emptyModals) },
            countDialogOpen: this.source.countDialogOpen?.() ?? false,
            activeSideTab: this.source.activeSideTab?.() ?? -1,
            mainModalTexts: [...(this.source.mainModalTexts?.() ?? [])],
            chatModalTexts: [...(this.source.chatModalTexts?.() ?? [])],
            questStatuses: (this.source.questStatuses?.() ?? []).map(copyQuestStatus),
            widgets: (this.source.widgets?.() ?? []).map(copyWidget),
            sideTabs: (this.source.sideTabs?.() ?? []).map(copySideTab),
            varps: (this.source.varps?.() ?? []).map(copyVarp),
            world: { ...(this.source.worldState?.() ?? emptyWorldState) },
            scene: copyScene(this.source.scene?.() ?? emptyScene),
            camera: { ...(this.source.cameraState?.() ?? emptyCamera) },
            trade: copyTrade(this.source.trade?.() ?? emptyTrade),
            mapFlag: this.source.mapFlag?.() ?? null,
            loginCredentials: this.source.loginCredentials?.() ?? { username: '', password: '' }
        };
    }
}
