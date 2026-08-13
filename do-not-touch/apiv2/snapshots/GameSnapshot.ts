export interface WorldTile {
    readonly x: number;
    readonly z: number;
    readonly level: number;
}

export interface LocalTile {
    readonly lx: number;
    readonly lz: number;
}

export interface SceneSnapshot {
    readonly available: boolean;
    readonly baseX: number;
    readonly baseZ: number;
    readonly level: number;
    readonly width: number;
    readonly height: number;
    readonly collisionFlags: readonly number[];
}

export interface VarpSnapshot {
    readonly index: number;
    readonly value: number;
}

export interface WorldStateSnapshot {
    readonly mapBaseX: number;
    readonly mapBaseZ: number;
    readonly level: number;
    readonly members: boolean;
    readonly multiCombat: boolean;
    readonly playerCount: number;
    readonly npcCount: number;
    readonly cycle: number;
}

export interface CameraSnapshot {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly pitch: number;
    readonly yaw: number;
    readonly orbitPitch: number;
    readonly orbitYaw: number;
    readonly cinematic: boolean;
}

export type SnapshotAction = string | null;

export interface ChatLineSnapshot {
    readonly type: number;
    readonly username: string | null;
    readonly text: string;
    readonly sequence: number;
}

export interface MapFlagSnapshot {
    readonly lx: number;
    readonly lz: number;
}

export interface StatSnapshot {
    readonly index: number;
    readonly name: string;
    readonly effective: number;
    readonly base: number;
    readonly xp: number;
    readonly used: boolean;
}

export interface ChatOptionSnapshot {
    readonly componentId: number;
    readonly text: string;
}

export interface MakeButtonSnapshot {
    readonly quantity: number;
    readonly componentId: number;
}

export interface MakeProductSnapshot {
    readonly objectId: number;
    readonly name: string;
    readonly buttons: readonly MakeButtonSnapshot[];
}

export interface ToggleControlsSnapshot {
    readonly onComponentId: number;
    readonly offComponentId: number;
}

export interface QuestStatusSnapshot {
    readonly componentId: number;
    readonly name: string;
    readonly colour: number;
}

export type WidgetRoot = 'main' | 'side' | 'chat' | 'tutorial';

export interface WidgetVarpBindingSnapshot {
    readonly scriptIndex: number;
    readonly varp: number;
    readonly value: number | null;
    readonly comparator: number | null;
}

export interface WidgetSnapshot {
    readonly kind: 'widget';
    readonly componentId: number;
    readonly layerId: number;
    readonly parentId: number;
    readonly rootComponentId: number;
    readonly root: WidgetRoot;
    readonly type: number;
    readonly buttonType: number;
    readonly clientCode: number;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly scrollHeight: number;
    readonly scrollPosition: number;
    readonly hidden: boolean;
    readonly text: string | null;
    readonly alternateText: string | null;
    readonly buttonText: string | null;
    readonly targetVerb: string | null;
    readonly targetBase: string | null;
    readonly targetMask: number;
    readonly modelType: number;
    readonly modelId: number;
    readonly alternateModelType: number;
    readonly alternateModelId: number;
    readonly scripts: readonly (readonly number[] | null)[] | null;
    readonly scriptComparators: readonly number[] | null;
    readonly scriptOperands: readonly number[] | null;
    readonly varpBindings: readonly WidgetVarpBindingSnapshot[];
    readonly colour: number;
    readonly actions: readonly SnapshotAction[];
    readonly items: readonly WidgetItemSnapshot[];
}

export interface SideTabSnapshot {
    readonly index: number;
    readonly rootComponentId: number;
    readonly available: boolean;
    readonly active: boolean;
    readonly visible: boolean;
    readonly widgets: readonly WidgetSnapshot[];
}

export interface TradeSnapshot {
    readonly offerOpen: boolean;
    readonly confirmOpen: boolean;
    readonly myOffer: readonly ItemSnapshot[];
    readonly theirOffer: readonly ItemSnapshot[];
    readonly sidePack: readonly ItemSnapshot[];
    readonly partner: string | null;
}

export interface ModalSnapshot {
    readonly main: number;
    readonly side: number;
    readonly chat: number;
    readonly tutorial: number;
}

export interface ActorTargetSnapshot {
    readonly kind: 'npc' | 'player';
    readonly index: number;
}

export interface ActorSnapshot {
    readonly name: string | null;
    readonly actions: readonly SnapshotAction[];
    readonly tile: WorldTile;
    readonly distance: number;
    readonly animation: number;
    readonly poseAnimation: number;
    readonly orientation: number;
    readonly targetOrientation: number;
    readonly overheadText: string | null;
    readonly spotAnimation: number;
    readonly health: number;
    readonly totalHealth: number;
    readonly faceEntity: number;
    readonly target: ActorTargetSnapshot | null;
    readonly moving: boolean;
    readonly running: boolean;
    readonly inCombat: boolean;
}

export interface PlayerSnapshot extends ActorSnapshot {
    readonly kind: 'player';
    readonly index: number;
    readonly combatLevel: number;
    readonly skillLevel: number;
}

export interface LocalPlayerSnapshot extends PlayerSnapshot {
    readonly energy: number;
    readonly weight: number;
}

export interface NpcSnapshot extends ActorSnapshot {
    readonly kind: 'npc';
    readonly index: number;
    readonly id: number;
    readonly level: number;
    readonly size: number;
}

export interface LocSnapshot {
    readonly kind: 'location';
    readonly typecode: number;
    readonly info: number;
    readonly id: number;
    readonly name: string | null;
    readonly description: string | null;
    readonly actions: readonly SnapshotAction[];
    readonly tile: WorldTile;
    readonly distance: number;
    readonly layer: 'wall' | 'wallDecoration' | 'ground' | 'groundDecoration';
    readonly shape: number;
    readonly angle: number;
    readonly width: number;
    readonly length: number;
    readonly footprintWidth: number;
    readonly footprintLength: number;
    readonly blockWalk: boolean;
    readonly blockRange: boolean;
    readonly active: boolean;
    readonly animation: number;
    readonly mapFunction: number;
    readonly mapScene: number;
    readonly forceApproach: number;
}

export interface ItemDefinitionSnapshot {
    readonly id: number;
    readonly name: string | null;
    readonly description: string | null;
    readonly stackable: boolean;
    readonly members: boolean;
    readonly baseValue: number;
    readonly noted: boolean;
    readonly certificateLink: number;
    readonly certificateTemplate: number;
}

export interface GroundItemSnapshot extends ItemDefinitionSnapshot {
    readonly kind: 'groundItem';
    readonly count: number;
    readonly actions: readonly SnapshotAction[];
    readonly tile: WorldTile;
    readonly distance: number;
}

export type ItemContainer = 'inventory' | 'equipment' | 'bank' | 'bankSide' | 'tradeMyOffer' | 'tradeTheirOffer' | 'tradeSidePack' | 'widget';

export type ItemActionFamily = 'held' | 'component' | 'none';

export interface ItemSnapshot extends ItemDefinitionSnapshot {
    readonly kind: 'item';
    readonly container: ItemContainer;
    readonly actionFamily: ItemActionFamily;
    readonly slot: number;
    readonly count: number;
    readonly actions: readonly SnapshotAction[];
    readonly componentId: number;
}

export type WidgetItemSnapshot = ItemSnapshot;

export interface GameSnapshot {
    readonly tick: number;
    readonly attached: boolean;
    readonly ingame: boolean;
    readonly sceneState: number;
    readonly localPlayer: LocalPlayerSnapshot | null;
    readonly selfSlot: number;
    readonly stats: readonly StatSnapshot[];
    readonly npcs: readonly NpcSnapshot[];
    readonly players: readonly PlayerSnapshot[];
    readonly locs: readonly LocSnapshot[];
    readonly groundItems: readonly GroundItemSnapshot[];
    readonly inventory: readonly ItemSnapshot[];
    readonly equipment: readonly ItemSnapshot[];
    readonly chat: readonly ChatLineSnapshot[];
    readonly inventorySize: number;
    readonly bankComponentId: number;
    readonly bankItems: readonly ItemSnapshot[];
    readonly bankSideItems: readonly ItemSnapshot[];
    readonly chatContinueComponentId: number;
    readonly chatOptions: readonly ChatOptionSnapshot[];
    readonly makeProducts: readonly MakeProductSnapshot[];
    readonly runControls: ToggleControlsSnapshot | null;
    readonly retaliateControls: ToggleControlsSnapshot | null;
    readonly loginMessage: string;
    readonly menuEntries: readonly string[];
    readonly modals: ModalSnapshot;
    readonly countDialogOpen: boolean;
    readonly activeSideTab: number;
    readonly mainModalTexts: readonly string[];
    readonly chatModalTexts: readonly string[];
    readonly questStatuses: readonly QuestStatusSnapshot[];
    readonly widgets: readonly WidgetSnapshot[];
    readonly sideTabs: readonly SideTabSnapshot[];
    readonly varps: readonly VarpSnapshot[];
    readonly world: WorldStateSnapshot;
    readonly scene: SceneSnapshot;
    readonly camera: CameraSnapshot;
    readonly trade: TradeSnapshot;
    readonly mapFlag: MapFlagSnapshot | null;
    readonly loginCredentials: { readonly username: string; readonly password: string };
}
