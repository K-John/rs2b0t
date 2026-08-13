import { Query } from './Query.js';

export interface VarpQueryEntity {
    readonly index: number;
    readonly value: number;
}

export class VarpQuery<T extends VarpQueryEntity> extends Query<T> {
    withIndex(...indexes: number[]): this {
        return this.where(varp => indexes.includes(varp.index));
    }

    withValue(...values: number[]): this {
        return this.where(varp => values.includes(varp.value));
    }

    zero(): this {
        return this.where(varp => varp.value === 0);
    }

    nonZero(): this {
        return this.where(varp => varp.value !== 0);
    }

    valueAtLeast(value: number): this {
        return this.where(varp => varp.value >= value);
    }

    valueAtMost(value: number): this {
        return this.where(varp => varp.value <= value);
    }
}
