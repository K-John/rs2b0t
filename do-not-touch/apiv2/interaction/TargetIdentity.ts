import type { GameSnapshot, ItemSnapshot } from '../snapshots/GameSnapshot.js';
import type { OpTarget } from './WireCommand.js';

export function stillPresent(target: OpTarget, snapshot: GameSnapshot): boolean {
    switch (target.kind) {
        case 'npc':
            return snapshot.npcs.some(npc => npc.index === target.index && npc.id === target.id);

        case 'player':
            if (target.index === snapshot.selfSlot) return false;
            return snapshot.players.some(player => player.index === target.index && canonicalName(player.name) === canonicalName(target.name));

        case 'location':
            return snapshot.locs.some(
                loc =>
                    loc.typecode === target.typecode &&
                    loc.layer === target.layer &&
                    loc.tile.x === target.tile.x &&
                    loc.tile.z === target.tile.z &&
                    loc.tile.level === target.tile.level
            );

        case 'groundItem':
            return snapshot.groundItems.some(
                item => item.id === target.id && item.tile.x === target.tile.x && item.tile.z === target.tile.z && item.tile.level === target.tile.level
            );

        case 'item':
            return containerOf(target, snapshot).some(item => item.id === target.id && item.slot === target.slot && item.componentId === target.componentId);
    }
}

function canonicalName(name: string | null): string | null {
    return name === null ? null : name.trim().toLowerCase();
}

function containerOf(item: ItemSnapshot, snapshot: GameSnapshot): readonly ItemSnapshot[] {
    switch (item.container) {
        case 'inventory':
            return snapshot.inventory;
        case 'equipment':
            return snapshot.equipment;
        case 'bank':
            return snapshot.bankItems;
        case 'bankSide':
            return snapshot.bankSideItems;
        case 'tradeMyOffer':
            return snapshot.trade.myOffer;
        case 'tradeTheirOffer':
            return snapshot.trade.theirOffer;
        case 'tradeSidePack':
            return snapshot.trade.sidePack;
        case 'widget':
            return snapshot.widgets.flatMap(widget => widget.items);
    }
}
