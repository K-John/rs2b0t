import { ActorQuery, type ActorQueryEntity } from './ActorQuery.js';

export interface PlayerQueryEntity extends ActorQueryEntity {
    readonly combatLevel: number;
    readonly skillLevel: number;
}

export class PlayerQuery<T extends PlayerQueryEntity> extends ActorQuery<T> {
    withCombatLevel(...levels: number[]): this {
        return this.where(player => levels.includes(player.combatLevel));
    }

    combatLevelAtLeast(level: number): this {
        return this.where(player => player.combatLevel >= level);
    }

    combatLevelAtMost(level: number): this {
        return this.where(player => player.combatLevel <= level);
    }

    withSkillLevel(...levels: number[]): this {
        return this.where(player => levels.includes(player.skillLevel));
    }
}
