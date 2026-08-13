import { WorldQuery, type WorldQueryEntity } from './WorldQuery.js';

export interface GroundItemQueryEntity extends WorldQueryEntity {
    readonly count: number;
    readonly stackable: boolean;
    readonly noted: boolean;
    readonly members: boolean;
    readonly baseValue: number;
}

export class GroundItemQuery<T extends GroundItemQueryEntity> extends WorldQuery<T> {
    withCount(count: number): this {
        return this.where(item => item.count === count);
    }

    countAtLeast(count: number): this {
        return this.where(item => item.count >= count);
    }

    countAtMost(count: number): this {
        return this.where(item => item.count <= count);
    }

    stackable(): this {
        return this.where(item => item.stackable);
    }

    unstackable(): this {
        return this.where(item => !item.stackable);
    }

    noted(): this {
        return this.where(item => item.noted);
    }

    unnoted(): this {
        return this.where(item => !item.noted);
    }

    members(): this {
        return this.where(item => item.members);
    }

    freeToPlay(): this {
        return this.where(item => !item.members);
    }

    valueAtLeast(value: number): this {
        return this.where(item => item.baseValue >= value);
    }

    valueAtMost(value: number): this {
        return this.where(item => item.baseValue <= value);
    }
}
