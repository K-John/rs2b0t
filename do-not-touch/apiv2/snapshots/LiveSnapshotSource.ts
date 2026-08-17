import { actions as liveActions, reader as liveReader } from '#/bot/adapter/ClientAdapter.js';
import { BotHost } from '#/bot/runtime/BotHost.js';

import type { GameSnapshot, ItemActionFamily, ItemContainer, ItemSnapshot, LocalPlayerSnapshot, ModalSnapshot, PlayerSnapshot, WidgetSnapshot, WorldTile } from './GameSnapshot.js';
import type { SnapshotSource } from './SnapshotSource.js';

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

function livePlayerSnapshot(player: NonNullable<ReturnType<typeof liveReader.localPlayer>>): PlayerSnapshot {
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
}

function liveLocalPlayer(tile: WorldTile): LocalPlayerSnapshot {
    const player = liveReader.localPlayer();
    if (player !== null) {
        return { ...livePlayerSnapshot(player), energy: liveReader.energy(), weight: liveReader.weight() };
    }
    return {
        kind: 'player',
        index: liveReader.selfSlot(),
        name: liveReader.localPlayerName(),
        actions: [],
        tile: { ...tile },
        distance: 0,
        animation: liveReader.selfAnim(),
        poseAnimation: -1,
        orientation: 0,
        targetOrientation: 0,
        overheadText: null,
        spotAnimation: -1,
        energy: liveReader.energy(),
        weight: liveReader.weight(),
        inCombat: liveReader.inCombat(),
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
    if (value === null) return null;
    const colon = value.indexOf(':');
    return (colon === -1 ? value : value.slice(colon + 1)).trim() || null;
}

export class LiveSnapshotSource implements SnapshotSource {
    read(): GameSnapshot {
        const tile = liveReader.worldTile();
        const runControls = liveReader.runControls();
        const retaliateControls = liveReader.retaliateControls();
        const scene = liveReader.scene();

        return {
            tick: BotHost.tickCount,
            attached: liveReader.attached(),
            ingame: liveReader.ingame(),
            sceneState: liveReader.sceneState(),
            localPlayer: tile === null ? null : liveLocalPlayer(tile),
            selfSlot: liveReader.selfSlot(),
            stats: Array.from({ length: liveReader.skillCount() }, (_, index) => ({ ...liveReader.stat(index), index, used: liveReader.skillUsed(index) })),
            npcs: liveReader.npcs().map(npc => ({
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
            players: liveReader.players().map(livePlayerSnapshot),
            locs: liveReader.locs().map(loc => ({
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
            groundItems: liveReader.groundItems().map(item => ({
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
            inventory: liveReader.inventory().map(item => liveItemSnapshot(item, 'inventory', 'held')),
            equipment: liveReader.equipment().map(item => liveItemSnapshot(item, 'equipment', 'component')),
            chat: liveReader.chat(100).map(line => ({ ...line })),
            inventorySize: liveReader.inventorySize(),
            bankComponentId: liveReader.bankComId(),
            bankItems: liveReader.bankItems().map(item => liveItemSnapshot(item, 'bank', 'component')),
            bankSideItems: liveReader.bankSideItems().map(item => liveItemSnapshot(item, 'bankSide', 'component')),
            chatContinueComponentId: liveReader.chatContinueComId(),
            chatOptions: liveReader.chatOptions().map(option => ({ componentId: option.comId, text: option.text })),
            makeProducts: liveReader.makeProducts().map(product => ({
                objectId: product.obj,
                name: product.name,
                buttons: product.buttons.map(button => ({ quantity: button.qty, componentId: button.comId }))
            })),
            runControls: runControls === null ? null : { onComponentId: runControls.onComId, offComponentId: runControls.offComId },
            retaliateControls: retaliateControls === null ? null : { onComponentId: retaliateControls.onComId, offComponentId: retaliateControls.offComId },
            loginMessage: liveReader.loginMessage(),
            menuEntries: [...liveReader.menuEntries()],
            modals: { ...liveReader.modals(), tutorial: -1 } as ModalSnapshot,
            countDialogOpen: liveReader.countDialogOpen(),
            activeSideTab: liveReader.activeSideTab(),
            mainModalTexts: [...liveReader.mainModalTexts()],
            chatModalTexts: [...liveReader.chatModalTexts()],
            questStatuses: liveReader.questStatuses().map(status => ({ componentId: status.comId, name: status.name, colour: status.colour })),
            widgets: liveReader.widgets().map(liveWidgetSnapshot),
            sideTabs: liveReader.sideTabs().map(tab => ({ ...tab, widgets: tab.widgets.map(liveWidgetSnapshot) })),
            varps: liveReader.varps().map(varp => ({ ...varp })),
            world: { ...liveReader.worldState() },
            scene: { ...scene, collisionFlags: [...scene.collisionFlags] },
            camera: { ...liveReader.cameraState() },
            trade: {
                offerOpen: liveReader.tradeOfferOpen(),
                confirmOpen: liveReader.tradeConfirmOpen(),
                myOffer: liveReader.tradeMyOffer().map(item => liveItemSnapshot(item, 'tradeMyOffer', 'component')),
                theirOffer: liveReader.tradeTheirOffer().map(item => liveItemSnapshot(item, 'tradeTheirOffer', 'none')),
                sidePack: liveReader.tradeSidePack().map(item => liveItemSnapshot(item, 'tradeSidePack', 'component')),
                partner: normalizeTradePartner(liveReader.tradePartner())
            },
            mapFlag: liveReader.mapFlag(),
            loginCredentials: liveActions.loginCredentials()
        };
    }
}
