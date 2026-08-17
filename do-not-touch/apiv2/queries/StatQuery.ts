import type { StatSnapshot } from '../snapshots/GameSnapshot.js';
import { Query } from './Query.js';

function normalized(value: string): string {
    return value.trim().toLowerCase();
}

export class StatQuery extends Query<StatSnapshot> {
    withName(...names: string[]): this {
        const wanted = names.map(normalized);
        return this.where(value => wanted.length > 0 && wanted.includes(normalized(value.name)));
    }

    withIndex(...indexes: number[]): this {
        return this.where(value => indexes.includes(value.index));
    }

    withEffective(...levels: number[]): this {
        return this.where(value => levels.includes(value.effective));
    }

    effectiveAtLeast(level: number): this {
        return this.where(value => value.effective >= level);
    }

    effectiveAtMost(level: number): this {
        return this.where(value => value.effective <= level);
    }

    withBase(...levels: number[]): this {
        return this.where(value => levels.includes(value.base));
    }

    baseAtLeast(level: number): this {
        return this.where(value => value.base >= level);
    }

    baseAtMost(level: number): this {
        return this.where(value => value.base <= level);
    }

    withExperience(...experience: number[]): this {
        return this.where(value => experience.includes(value.xp));
    }

    experienceAtLeast(experience: number): this {
        return this.where(value => value.xp >= experience);
    }

    experienceAtMost(experience: number): this {
        return this.where(value => value.xp <= experience);
    }

    boosted(): this {
        return this.where(value => value.effective > value.base);
    }

    drained(): this {
        return this.where(value => value.effective < value.base);
    }

    unchanged(): this {
        return this.where(value => value.effective === value.base);
    }

    used(): this {
        return this.where(value => value.used);
    }
}
