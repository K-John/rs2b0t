import type { OpTarget } from './WireCommand.js';

export const MAX_OPERATIONS = 5;

function usable(action: string | null): action is string {
    if (action === null) return false;
    const trimmed = action.trim();
    return trimmed !== '' && trimmed.toLowerCase() !== 'hidden';
}

function matches(action: string, wanted: string | RegExp): boolean {
    if (typeof wanted === 'string') {
        return action.trim().toLowerCase() === wanted.trim().toLowerCase();
    }
    wanted.lastIndex = 0;
    return wanted.test(action);
}

export function operationOf(target: OpTarget, action: string | RegExp): number | null {
    const actions = target.actions;
    const limit = Math.min(actions.length, MAX_OPERATIONS);
    for (let index = 0; index < limit; index++) {
        const candidate = actions[index] ?? null;
        if (usable(candidate) && matches(candidate, action)) return index + 1;
    }
    return null;
}

export function offersOperation(target: OpTarget, operation: number): boolean {
    if (!Number.isInteger(operation) || operation < 1 || operation > MAX_OPERATIONS) return false;
    return usable(target.actions[operation - 1] ?? null);
}
