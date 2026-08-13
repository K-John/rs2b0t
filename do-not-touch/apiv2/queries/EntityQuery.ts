import { Query } from './Query.js';

export interface QueryEntity {
    readonly name: string | null;
    readonly actions: readonly (string | null)[];
    readonly id?: number;
    readonly index?: number;
}

function normalized(value: string): string {
    return value.trim().toLowerCase();
}

function anyConfigured<T>(values: readonly T[], predicate: (value: T) => boolean): boolean {
    return values.length > 0 && values.some(predicate);
}

function wildcardRegex(pattern: string): RegExp {
    let expression = '^';
    for (const char of pattern) {
        expression += char === '*' ? '.*' : char.replace(/[\\^$+?.()|[\]{}]/g, '\\$&');
    }
    return new RegExp(`${expression}$`, 'i');
}

export class EntityQuery<T extends QueryEntity> extends Query<T> {

    withName(...names: string[]): this {
        const wanted = names.map(normalized);
        return this.where(value => value.name !== null && wanted.includes(normalized(value.name)));
    }

    name(...names: string[]): this {
        return this.withName(...names);
    }

    withId(...ids: number[]): this {
        return this.where(value => value.id !== undefined && ids.includes(value.id));
    }

    withIndex(...indexes: number[]): this {
        return this.where(value => value.index !== undefined && indexes.includes(value.index));
    }

    withAction(...actions: string[]): this {
        const wanted = actions.map(normalized);
        return this.where(value => anyConfigured(value.actions, action => action !== null && wanted.includes(normalized(action))));
    }

    action(action: string): this {
        return this.withAction(action);
    }

    nameContains(...terms: string[]): this {
        const wanted = terms.map(normalized);
        return this.where(value => value.name !== null && anyConfigured(wanted, term => normalized(value.name!).includes(term)));
    }

    matchesWildcard(...patterns: string[]): this {
        const regexes = patterns.map(wildcardRegex);
        return this.where(value => value.name !== null && anyConfigured(regexes, regex => regex.test(value.name!)));
    }

    matchesRegex(pattern: RegExp): this {
        return this.where(value => {
            if (value.name === null) {
                return false;
            }
            pattern.lastIndex = 0;
            return pattern.test(value.name);
        });
    }

    withNameOrId(...values: (string | number)[]): this {
        const names = values.filter((value): value is string => typeof value === 'string' && !/^\d+$/.test(value.trim()));
        const ids = values.flatMap(value => {
            if (typeof value === 'number') {
                return [value];
            }
            return /^\d+$/.test(value.trim()) ? [Number(value)] : [];
        });
        return this.where(value => {
            const nameMatch = value.name !== null && names.some(name => normalized(name) === normalized(value.name!));
            const idMatch = value.id !== undefined && ids.includes(value.id);
            return nameMatch || idMatch;
        });
    }
}
