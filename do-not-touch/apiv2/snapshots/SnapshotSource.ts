import type {
    ChatLineSnapshot,
    ChatOptionSnapshot,
    CameraSnapshot,
    GameSnapshot,
    GroundItemSnapshot,
    ItemSnapshot,
    LocSnapshot,
    MakeProductSnapshot,
    ModalSnapshot,
    NpcSnapshot,
    PlayerSnapshot,
    QuestStatusSnapshot,
    SceneSnapshot,
    SideTabSnapshot,
    StatSnapshot,
    ToggleControlsSnapshot,
    TradeSnapshot,
    VarpSnapshot,
    WidgetSnapshot,
    WorldStateSnapshot,
    WorldTile
} from './GameSnapshot.js';

type ReaderNpcSnapshot = Omit<NpcSnapshot, 'kind'> & Partial<Pick<NpcSnapshot, 'kind'>>;
type ReaderPlayerSnapshot = Omit<PlayerSnapshot, 'kind'> & Partial<Pick<PlayerSnapshot, 'kind'>>;
type ReaderLocSnapshot = Omit<LocSnapshot, 'kind'> & Partial<Pick<LocSnapshot, 'kind'>>;
type ReaderGroundItemSnapshot = Omit<GroundItemSnapshot, 'kind'> & Partial<Pick<GroundItemSnapshot, 'kind'>>;
type ReaderItemSnapshot = Omit<ItemSnapshot, 'kind' | 'container' | 'actionFamily'> & Partial<Pick<ItemSnapshot, 'kind' | 'container' | 'actionFamily'>>;
type ReaderWidgetSnapshot = Omit<WidgetSnapshot, 'kind' | 'items'> & Partial<Pick<WidgetSnapshot, 'kind'>> & { readonly items: readonly ReaderItemSnapshot[] };
type ReaderSideTabSnapshot = Omit<SideTabSnapshot, 'widgets'> & { readonly widgets: readonly ReaderWidgetSnapshot[] };
type ReaderTradeSnapshot = Omit<TradeSnapshot, 'myOffer' | 'theirOffer' | 'sidePack'> & {
    readonly myOffer: readonly ReaderItemSnapshot[];
    readonly theirOffer: readonly ReaderItemSnapshot[];
    readonly sidePack: readonly ReaderItemSnapshot[];
};

export interface SnapshotReader {
    ingame(): boolean;
    chat(): readonly ChatLineSnapshot[];
    worldTile(): WorldTile | null;
    selfAnim(): number;
    energy(): number;
    weight(): number;
    localPlayerName(): string | null;
    inCombat(): boolean;
    npcs(): readonly ReaderNpcSnapshot[];
    players(): readonly ReaderPlayerSnapshot[];
    locs(): readonly ReaderLocSnapshot[];
    groundItems(): readonly ReaderGroundItemSnapshot[];
    inventory(): readonly ReaderItemSnapshot[];
    equipment(): readonly ReaderItemSnapshot[];
    attached?(): boolean;
    sceneState?(): number;
    selfSlot?(): number;
    localPlayer?(): ReaderPlayerSnapshot | null;
    stats?(): readonly StatSnapshot[];
    inventorySize?(): number;
    bankComId?(): number;
    bankItems?(): readonly ReaderItemSnapshot[];
    bankSideItems?(): readonly ReaderItemSnapshot[];
    chatContinueComId?(): number;
    chatOptions?(): readonly ChatOptionSnapshot[];
    makeProducts?(): readonly MakeProductSnapshot[];
    runControls?(): ToggleControlsSnapshot | null;
    retaliateControls?(): ToggleControlsSnapshot | null;
    loginMessage?(): string;
    menuEntries?(): readonly string[];
    modals?(): ModalSnapshot;
    countDialogOpen?(): boolean;
    activeSideTab?(): number;
    mainModalTexts?(): readonly string[];
    chatModalTexts?(): readonly string[];
    questStatuses?(): readonly QuestStatusSnapshot[];
    widgets?(): readonly ReaderWidgetSnapshot[];
    sideTabs?(): readonly ReaderSideTabSnapshot[];
    varps?(): readonly VarpSnapshot[];
    worldState?(): WorldStateSnapshot;
    scene?(): SceneSnapshot;
    cameraState?(): CameraSnapshot;
    mapFlag?(): { readonly lx: number; readonly lz: number } | null;
    trade?(): ReaderTradeSnapshot;
    loginCredentials?(): { username: string; password: string };
}

export interface SnapshotSource {
    read(): GameSnapshot;
}
