import { ActorQuery, type ActorQueryEntity } from './ActorQuery.js';

export interface NpcQueryEntity extends ActorQueryEntity {
    readonly level: number;
    readonly size: number;
}

export class NpcQuery<T extends NpcQueryEntity> extends ActorQuery<T> {
    withLevel(...levels: number[]): this {
        return this.where(npc => levels.includes(npc.level));
    }

    levelAtLeast(level: number): this {
        return this.where(npc => npc.level >= level);
    }

    levelAtMost(level: number): this {
        return this.where(npc => npc.level <= level);
    }

    withSize(...sizes: number[]): this {
        return this.where(npc => sizes.includes(npc.size));
    }

    interactingWithLocal(selfSlot: number): this {
        return this.targetingPlayer(selfSlot);
    }
}
