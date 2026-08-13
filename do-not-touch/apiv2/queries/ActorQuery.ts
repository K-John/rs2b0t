import { WorldQuery, type WorldQueryEntity } from './WorldQuery.js';

export interface ActorTargetQueryEntity {
    readonly kind: 'npc' | 'player';
    readonly index: number;
}

export interface ActorQueryEntity extends WorldQueryEntity {
    readonly animation: number;
    readonly poseAnimation: number;
    readonly inCombat: boolean;
    readonly health: number;
    readonly totalHealth: number;
    readonly target: ActorTargetQueryEntity | null;
    readonly moving: boolean;
    readonly running: boolean;
}

export class ActorQuery<T extends ActorQueryEntity> extends WorldQuery<T> {
    withAnimation(...animations: number[]): this {
        return this.where(actor => animations.includes(actor.animation));
    }

    withPoseAnimation(...animations: number[]): this {
        return this.where(actor => animations.includes(actor.poseAnimation));
    }

    inCombat(): this {
        return this.where(actor => actor.inCombat);
    }

    notInCombat(): this {
        return this.where(actor => !actor.inCombat);
    }

    interacting(): this {
        return this.where(actor => actor.target !== null);
    }

    notInteracting(): this {
        return this.where(actor => actor.target === null);
    }

    targetingNpc(...indexes: number[]): this {
        return this.where(actor => actor.target?.kind === 'npc' && indexes.includes(actor.target.index));
    }

    targetingPlayer(...indexes: number[]): this {
        return this.where(actor => actor.target?.kind === 'player' && indexes.includes(actor.target.index));
    }

    moving(): this {
        return this.where(actor => actor.moving);
    }

    stationary(): this {
        return this.where(actor => !actor.moving);
    }

    running(): this {
        return this.where(actor => actor.moving && actor.running);
    }

    walking(): this {
        return this.where(actor => actor.moving && !actor.running);
    }

    alive(): this {
        return this.where(actor => actor.totalHealth === 0 || actor.health > 0);
    }

    dead(): this {
        return this.where(actor => actor.totalHealth > 0 && actor.health === 0);
    }

    healthAtLeast(percent: number): this {
        return this.where(actor => actor.totalHealth > 0 && actor.health * 100 >= actor.totalHealth * percent);
    }

    healthAtMost(percent: number): this {
        return this.where(actor => actor.totalHealth > 0 && actor.health * 100 <= actor.totalHealth * percent);
    }
}
