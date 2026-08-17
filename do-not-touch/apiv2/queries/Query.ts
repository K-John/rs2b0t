export type QueryPredicate<T> = (value: T) => boolean;

export class Query<T> {
    private readonly predicates: QueryPredicate<T>[] = [];

    constructor(private readonly values: readonly T[]) {}

    where(predicate: QueryPredicate<T>): this {
        this.predicates.push(predicate);
        return this;
    }

    results(): T[] {
        return this.values.filter(value => this.predicates.every(predicate => predicate(value)));
    }

    first(): T | null {
        return this.results()[0] ?? null;
    }

    last(): T | null {
        const values = this.results();
        return values[values.length - 1] ?? null;
    }

    exists(): boolean {
        return this.values.some(value => this.predicates.every(predicate => predicate(value)));
    }

    empty(): boolean {
        return !this.exists();
    }

    count(): number {
        return this.results().length;
    }
}
