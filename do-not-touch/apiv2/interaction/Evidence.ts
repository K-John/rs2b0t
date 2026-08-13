import type { ItemContainer, LocSnapshot, NpcSnapshot, PlayerSnapshot, WorldTile } from '../snapshots/GameSnapshot.js';
import type { Evidence } from './Outcome.js';

export const CANNOT_REACH = "I can't reach that!";

export function arrived(tile: WorldTile, radius = 0): Evidence {
    return now => {
        const here = now.worldTile();
        if (here === null || here.level !== tile.level) return false;
        return Math.max(Math.abs(here.x - tile.x), Math.abs(here.z - tile.z)) <= radius;
    };
}

export function itemDelta(itemId: number, change: number, container: ItemContainer = 'inventory'): Evidence {
    const total = (context: Parameters<Evidence>[0]): number => containerQuery(context, container).withId(itemId).total();
    return (now, before) => {
        const moved = total(now) - total(before);
        return change >= 0 ? moved >= change : moved <= change;
    };
}

function containerQuery(context: Parameters<Evidence>[0], container: ItemContainer): ReturnType<Parameters<Evidence>[0]['inventory']> {
    switch (container) {
        case 'equipment':
            return context.equipment();
        case 'bank':
            return context.bank();
        case 'bankSide':
            return context.bankSideItems();
        case 'tradeMyOffer':
            return context.tradeMyOffer();
        case 'tradeTheirOffer':
            return context.tradeTheirOffer();
        case 'tradeSidePack':
            return context.tradeSidePack();
        default:
            return context.inventory();
    }
}

export function xpGained(skillIndex: number, atLeast = 1): Evidence {
    const xp = (context: Parameters<Evidence>[0]): number => context.stats().withIndex(skillIndex).first()?.xp ?? 0;
    return (now, before) => xp(now) - xp(before) >= atLeast;
}

export function engaged(target: NpcSnapshot | PlayerSnapshot): Evidence {
    return (now, before) => {
        const me = now.localPlayer();
        if (me !== null && me.target !== null && me.target.index === target.index && me.target.kind === target.kind) return true;

        const find = (context: Parameters<Evidence>[0]): NpcSnapshot | PlayerSnapshot | null =>
            target.kind === 'npc' ? context.npcs().withIndex(target.index).first() : context.players().withIndex(target.index).first();
        const then = find(before);
        const live = find(now);
        return then !== null && live !== null && live.health < then.health;
    };
}

export function modalOpened(rootComponentId?: number): Evidence {
    return now => {
        const modals = now.modals();
        if (rootComponentId === undefined) return modals.main !== -1 || modals.side !== -1 || modals.chat !== -1 || modals.tutorial !== -1;
        return modals.main === rootComponentId || modals.side === rootComponentId || modals.chat === rootComponentId || modals.tutorial === rootComponentId;
    };
}

export function modalClosed(rootComponentId?: number): Evidence {
    return now => {
        const modals = now.modals();
        if (rootComponentId === undefined) return modals.main === -1 && modals.side === -1 && modals.chat === -1 && modals.tutorial === -1;
        return modals.main !== rootComponentId && modals.side !== rootComponentId && modals.chat !== rootComponentId && modals.tutorial !== rootComponentId;
    };
}

export function optionGone(target: LocSnapshot, action: string): Evidence {
    const wanted = action.trim().toLowerCase();
    return now => {
        const live = now
            .locs()
            .results()
            .find(loc => loc.id === target.id && loc.layer === target.layer && loc.tile.x === target.tile.x && loc.tile.z === target.tile.z && loc.tile.level === target.tile.level);
        if (live === undefined) return true;
        return !live.actions.some(candidate => candidate !== null && candidate.trim().toLowerCase() === wanted);
    };
}

export function said(...phrases: string[]): Evidence {
    const wanted = phrases.map(phrase => phrase.trim().toLowerCase());
    return (now, before) => {
        const after = before.chat().latestSequence();
        return now
            .chat()
            .since(after)
            .results()
            .some(line => wanted.some(phrase => line.text.toLowerCase().includes(phrase)));
    };
}

export function serverRefused(): Evidence {
    return (now, before) => {
        const was = before.snapshot.mapFlag;
        if (was === null || now.snapshot.mapFlag !== null) return false;

        const here = now.worldTile();
        const scene = now.snapshot.scene;
        if (here === null || !scene.available) return true;
        return here.x - scene.baseX !== was.lx || here.z - scene.baseZ !== was.lz;
    };
}

export function sceneReady(): Evidence {
    return now => now.sceneState() === 2 && now.scene().base().x !== 0;
}

export function inventoryChanged(): Evidence {
    return (now, before) => {
        const describe = (context: Parameters<Evidence>[0]): string =>
            context
                .inventory()
                .results()
                .map(item => `${item.slot}:${item.id}:${item.count}`)
                .join(',');
        return describe(now) !== describe(before);
    };
}
