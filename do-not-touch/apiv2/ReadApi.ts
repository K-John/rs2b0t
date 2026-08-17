import { LiveSnapshotSource } from './snapshots/LiveSnapshotSource.js';
import type {
    ChatOptionSnapshot,
    CameraSnapshot,
    GameSnapshot,
    GroundItemSnapshot,
    ItemSnapshot,
    LocSnapshot,
    LocalPlayerSnapshot,
    MakeProductSnapshot,
    ModalSnapshot,
    NpcSnapshot,
    PlayerSnapshot,
    QuestStatusSnapshot,
    SideTabSnapshot,
    ToggleControlsSnapshot,
    VarpSnapshot,
    WidgetSnapshot,
    WorldStateSnapshot,
    WorldTile
} from './snapshots/GameSnapshot.js';
import type { SnapshotSource } from './snapshots/SnapshotSource.js';
import { ItemQuery } from './queries/ItemQuery.js';
import { GroundItemQuery } from './queries/GroundItemQuery.js';
import { LocalQuery } from './queries/LocalQuery.js';
import { NpcQuery } from './queries/NpcQuery.js';
import { PlayerQuery } from './queries/PlayerQuery.js';
import { Query } from './queries/Query.js';
import { ChatQuery } from './queries/ChatQuery.js';
import { StatQuery } from './queries/StatQuery.js';
import { WidgetQuery } from './queries/WidgetQuery.js';
import { VarpQuery } from './queries/VarpQuery.js';
import { SceneQuery } from './queries/SceneQuery.js';
import { SideTabQuery } from './queries/SideTabQuery.js';

export class ReadContext {
    constructor(readonly snapshot: GameSnapshot) {}

    tick(): number {
        return this.snapshot.tick;
    }

    attached(): boolean {
        return this.snapshot.attached;
    }

    ingame(): boolean {
        return this.snapshot.ingame;
    }

    sceneState(): number {
        return this.snapshot.sceneState;
    }

    localPlayer(): LocalPlayerSnapshot | null {
        return this.snapshot.localPlayer;
    }

    selfSlot(): number {
        return this.snapshot.selfSlot;
    }

    stats(): StatQuery {
        return new StatQuery(this.snapshot.stats);
    }

    npcs(): NpcQuery<NpcSnapshot> {
        return new NpcQuery(this.snapshot.npcs);
    }

    players(): PlayerQuery<PlayerSnapshot> {
        return new PlayerQuery(this.snapshot.players);
    }

    locs(): LocalQuery<LocSnapshot> {
        return new LocalQuery(this.snapshot.locs);
    }

    groundItems(): GroundItemQuery<GroundItemSnapshot> {
        return new GroundItemQuery(this.snapshot.groundItems);
    }

    inventory(): ItemQuery<ItemSnapshot> {
        return new ItemQuery(this.snapshot.inventory);
    }

    equipment(): ItemQuery<ItemSnapshot> {
        return new ItemQuery(this.snapshot.equipment);
    }

    inventoryCapacity(): number {
        return this.snapshot.inventorySize;
    }

    bank(): ItemQuery<ItemSnapshot> {
        return new ItemQuery(this.snapshot.bankItems);
    }

    bankSideItems(): ItemQuery<ItemSnapshot> {
        return new ItemQuery(this.snapshot.bankSideItems);
    }

    bankComponentId(): number {
        return this.snapshot.bankComponentId;
    }

    chat(): ChatQuery {
        return new ChatQuery(this.snapshot.chat);
    }

    chatOptions(): Query<ChatOptionSnapshot> {
        return new Query(this.snapshot.chatOptions);
    }

    chatContinueComponentId(): number {
        return this.snapshot.chatContinueComponentId;
    }

    makeProducts(): Query<MakeProductSnapshot> {
        return new Query(this.snapshot.makeProducts);
    }

    questStatuses(): Query<QuestStatusSnapshot> {
        return new Query(this.snapshot.questStatuses);
    }

    widgets(): WidgetQuery<WidgetSnapshot> {
        return new WidgetQuery(this.snapshot.widgets);
    }

    sideTabs(): SideTabQuery<SideTabSnapshot> {
        return new SideTabQuery(this.snapshot.sideTabs);
    }

    component(componentId: number): WidgetSnapshot | null {
        return [...this.snapshot.widgets, ...this.snapshot.sideTabs.flatMap(tab => tab.widgets)].find(widget => widget.componentId === componentId) ?? null;
    }

    varps(): VarpQuery<VarpSnapshot> {
        return new VarpQuery(this.snapshot.varps);
    }

    world(): WorldStateSnapshot {
        return this.snapshot.world;
    }

    scene(): SceneQuery {
        return new SceneQuery(this.snapshot.scene, this.snapshot.localPlayer?.tile ?? null);
    }

    camera(): CameraSnapshot {
        return this.snapshot.camera;
    }

    tradeMyOffer(): ItemQuery<ItemSnapshot> {
        return new ItemQuery(this.snapshot.trade.myOffer);
    }

    tradeTheirOffer(): ItemQuery<ItemSnapshot> {
        return new ItemQuery(this.snapshot.trade.theirOffer);
    }

    tradeSidePack(): ItemQuery<ItemSnapshot> {
        return new ItemQuery(this.snapshot.trade.sidePack);
    }

    modals(): ModalSnapshot {
        return this.snapshot.modals;
    }

    countDialogOpen(): boolean {
        return this.snapshot.countDialogOpen;
    }

    activeSideTab(): number {
        return this.snapshot.activeSideTab;
    }

    loginMessage(): string {
        return this.snapshot.loginMessage;
    }

    menuEntries(): readonly string[] {
        return this.snapshot.menuEntries;
    }

    mainModalTexts(): readonly string[] {
        return this.snapshot.mainModalTexts;
    }

    chatModalTexts(): readonly string[] {
        return this.snapshot.chatModalTexts;
    }

    runControls(): ToggleControlsSnapshot | null {
        return this.snapshot.runControls;
    }

    retaliateControls(): ToggleControlsSnapshot | null {
        return this.snapshot.retaliateControls;
    }

    worldTile(): WorldTile | null {
        return this.snapshot.localPlayer?.tile ?? null;
    }

    loginCredentials(): { username: string; password: string } {
        return this.snapshot.loginCredentials;
    }

    varp(index: number): number {
        return this.snapshot.varps.find(v => v.index === index)?.value ?? 0;
    }

    componentItems(componentId: number): ItemQuery<ItemSnapshot> {
        const widget = this.component(componentId);
        return new ItemQuery(widget?.items ?? []);
    }

    componentText(componentId: number): string | null {
        return this.component(componentId)?.text ?? null;
    }

    componentModelObjId(componentId: number): number | null {
        const com = this.component(componentId);
        return com !== null && com.modelType === 4 ? com.modelId : null;
    }

    sideTabInterface(tab: number): number {
        return this.snapshot.sideTabs.find(t => t.index === tab)?.rootComponentId ?? -1;
    }
}

export class ReadApi {
    constructor(private readonly source: SnapshotSource = new LiveSnapshotSource()) {}

    snapshot(): GameSnapshot {
        return this.source.read();
    }

    read(): ReadContext {
        return new ReadContext(this.snapshot());
    }
}
