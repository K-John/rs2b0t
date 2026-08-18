import type {
    ChatOptionSnapshot,
    GameSnapshot,
    GroundItemSnapshot,
    ItemSnapshot,
    LocSnapshot,
    MakeProductSnapshot,
    NpcSnapshot,
    PlayerSnapshot,
    QuestStatusSnapshot,
    SideTabSnapshot,
    VarpSnapshot,
    WidgetSnapshot
} from './snapshots/GameSnapshot.js';
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

    bank(): ItemQuery<ItemSnapshot> {
        return new ItemQuery(this.snapshot.bankItems);
    }

    bankSideItems(): ItemQuery<ItemSnapshot> {
        return new ItemQuery(this.snapshot.bankSideItems);
    }

    chat(): ChatQuery {
        return new ChatQuery(this.snapshot.chat);
    }

    chatOptions(): Query<ChatOptionSnapshot> {
        return new Query(this.snapshot.chatOptions);
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

    scene(): SceneQuery {
        return new SceneQuery(this.snapshot.scene, this.snapshot.localPlayer?.tile ?? null);
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
}
