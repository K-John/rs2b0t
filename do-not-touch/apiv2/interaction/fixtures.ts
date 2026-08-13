import type {
    ChatLineSnapshot,
    GameSnapshot,
    ItemSnapshot,
    LocSnapshot,
    NpcSnapshot,
    SideTabSnapshot,
    WidgetSnapshot
} from '../snapshots/GameSnapshot.js';
import type { SnapshotSource } from '../snapshots/SnapshotSource.js';
import type { InteractionDriver, WireCommand } from './WireCommand.js';

export function recordingDriver(accept = true): InteractionDriver & { readonly commands: WireCommand[] } {
    const commands: WireCommand[] = [];
    return {
        commands,
        dispatch(command: WireCommand): boolean {
            commands.push(command);
            return accept;
        }
    };
}

export function sourceOf(value: GameSnapshot): SnapshotSource {
    return { read: () => value };
}

export function goblin(overrides: Partial<NpcSnapshot> = {}): NpcSnapshot {
    return {
        kind: 'npc',
        index: 12,
        id: 100,
        name: 'Goblin',
        level: 2,
        size: 1,
        actions: ['Attack', null, null, null, null],
        tile: { x: 3200, z: 3200, level: 0 },
        distance: 3,
        animation: -1,
        poseAnimation: -1,
        orientation: 0,
        targetOrientation: 0,
        overheadText: null,
        spotAnimation: -1,
        health: 0,
        totalHealth: 0,
        faceEntity: -1,
        target: null,
        moving: false,
        running: false,
        inCombat: false,
        ...overrides
    };
}

export function furnace(overrides: Partial<LocSnapshot> = {}): LocSnapshot {
    return {
        kind: 'location',
        typecode: 0x2000_0001,
        info: 0,
        id: 2030,
        name: 'Furnace',
        description: null,
        actions: ['Smelt', null, null, null, null],
        tile: { x: 3210, z: 3210, level: 0 },
        distance: 2,
        layer: 'ground',
        shape: 10,
        angle: 0,
        width: 1,
        length: 2,
        footprintWidth: 1,
        footprintLength: 2,
        blockWalk: true,
        blockRange: true,
        active: false,
        animation: -1,
        mapFunction: -1,
        mapScene: -1,
        forceApproach: 0,
        ...overrides
    };
}

export function heldItem(overrides: Partial<ItemSnapshot> = {}): ItemSnapshot {
    return {
        kind: 'item',
        container: 'inventory',
        actionFamily: 'held',
        slot: 3,
        id: 438,
        name: 'Tin ore',
        description: null,
        count: 1,
        actions: [null, null, null, null, 'Drop'],
        componentId: 3214,
        stackable: false,
        members: false,
        baseValue: 4,
        noted: false,
        certificateLink: -1,
        certificateTemplate: -1,
        ...overrides
    };
}

export function widget(overrides: Partial<WidgetSnapshot> = {}): WidgetSnapshot {
    return {
        kind: 'widget',
        componentId: 5000,
        layerId: 500,
        parentId: -1,
        rootComponentId: 500,
        root: 'main',
        type: 0,
        buttonType: 1,
        clientCode: 0,
        x: 0,
        y: 0,
        width: 32,
        height: 32,
        scrollHeight: 0,
        scrollPosition: 0,
        hidden: false,
        text: null,
        alternateText: null,
        buttonText: 'Withdraw',
        targetVerb: null,
        targetBase: null,
        targetMask: 0,
        modelType: 0,
        modelId: -1,
        alternateModelType: 0,
        alternateModelId: -1,
        scripts: null,
        scriptComparators: null,
        scriptOperands: null,
        varpBindings: [],
        colour: 0,
        actions: [],
        items: [],
        ...overrides
    };
}

export function sideTab(overrides: Partial<SideTabSnapshot> = {}): SideTabSnapshot {
    return {
        index: 3,
        rootComponentId: 600,
        available: true,
        active: false,
        visible: false,
        widgets: [],
        ...overrides
    };
}

export function snapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
    return {
        tick: 500,
        attached: true,
        ingame: true,
        sceneState: 2,
        localPlayer: null,
        selfSlot: 1,
        stats: [],
        npcs: [],
        players: [],
        locs: [],
        groundItems: [],
        inventory: [],
        equipment: [],
        chat: [],
        inventorySize: 28,
        bankComponentId: -1,
        bankItems: [],
        bankSideItems: [],
        chatContinueComponentId: -1,
        chatOptions: [],
        makeProducts: [],
        runControls: null,
        retaliateControls: null,
        loginMessage: '',
        menuEntries: [],
        modals: { main: -1, side: -1, chat: -1, tutorial: -1 },
        countDialogOpen: false,
        activeSideTab: -1,
        mainModalTexts: [],
        chatModalTexts: [],
        questStatuses: [],
        widgets: [],
        sideTabs: [],
        varps: [],
        world: { mapBaseX: 3200, mapBaseZ: 3200, level: 0, members: false, multiCombat: false, playerCount: 1, npcCount: 1, cycle: 0 },
        scene: { available: true, baseX: 3150, baseZ: 3150, level: 0, width: 104, height: 104, collisionFlags: [] },
        camera: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, orbitPitch: 0, orbitYaw: 0, cinematic: false },
        trade: { offerOpen: false, confirmOpen: false, myOffer: [], theirOffer: [], sidePack: [], partner: null },
        mapFlag: null,
        loginCredentials: { username: '', password: '' },
        ...overrides
    };
}

export function chatLine(text: string, sequence: number, type = 0): ChatLineSnapshot {
    return { type, username: null, text, sequence };
}
