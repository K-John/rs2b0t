import { EntityQuery, type QueryEntity } from './EntityQuery.js';

export interface ItemQueryEntity extends QueryEntity {
    readonly slot: number;
    readonly count: number;
    readonly stackable: boolean;
    readonly noted: boolean;
    readonly members: boolean;
    readonly baseValue: number;
}

export class ItemQuery<T extends ItemQueryEntity> extends EntityQuery<T> {
    withSlot(...slots: number[]): this {
        return this.where(value => slots.includes(value.slot));
    }

    withCount(count: number): this {
        return this.where(value => value.count === count);
    }

    countAtLeast(count: number): this {
        return this.where(value => value.count >= count);
    }

    countAtMost(count: number): this {
        return this.where(value => value.count <= count);
    }

    stackable(): this {
        return this.where(value => value.stackable);
    }

    unstackable(): this {
        return this.where(value => !value.stackable);
    }

    noted(): this {
        return this.where(value => value.noted);
    }

    unnoted(): this {
        return this.where(value => !value.noted);
    }

    members(): this {
        return this.where(value => value.members);
    }

    freeToPlay(): this {
        return this.where(value => !value.members);
    }

    valueAtLeast(value: number): this {
        return this.where(item => item.baseValue >= value);
    }

    total(): number {
        return this.results().reduce((sum, item) => sum + item.count, 0);
    }

    valueAtMost(value: number): this {
        return this.where(item => item.baseValue <= value);
    }
}
