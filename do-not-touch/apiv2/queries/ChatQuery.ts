import type { ChatLineSnapshot } from '../snapshots/GameSnapshot.js';
import { Query } from './Query.js';

function normalized(value: string): string {
    return value.trim().toLowerCase();
}

export class ChatQuery extends Query<ChatLineSnapshot> {
    withType(...types: number[]): this {
        return this.where(value => types.includes(value.type));
    }

    from(...usernames: string[]): this {
        const wanted = usernames.map(normalized);
        return this.where(value => value.username !== null && wanted.includes(normalized(value.username)));
    }

    withSender(): this {
        return this.where(value => value.username !== null && value.username.trim().length > 0);
    }

    withoutSender(): this {
        return this.where(value => value.username === null || value.username.trim().length === 0);
    }

    withText(...texts: string[]): this {
        const wanted = texts.map(normalized);
        return this.where(value => wanted.includes(normalized(value.text)));
    }

    textContains(...terms: string[]): this {
        const wanted = terms.map(normalized);
        return this.where(value => wanted.length > 0 && wanted.some(term => normalized(value.text).includes(term)));
    }

    textMatches(pattern: RegExp): this {
        return this.where(value => {
            pattern.lastIndex = 0;
            return pattern.test(value.text);
        });
    }

    since(sequence: number): this {
        return this.where(line => line.sequence > sequence);
    }

    latestSequence(): number {
        return this.results().reduce((highest, line) => Math.max(highest, line.sequence), -1);
    }
}
