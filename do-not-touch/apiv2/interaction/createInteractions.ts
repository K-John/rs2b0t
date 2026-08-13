import type { SnapshotSource } from '../snapshots/SnapshotSource.js';
import { Interactions } from './Interactions.js';
import { Settle } from './Settle.js';
import type { InteractionDriver } from './WireCommand.js';

const DEFAULT_POLL_MS = 100;

const realSleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export interface InteractionDeps {
    readonly source: SnapshotSource;
    readonly driver: InteractionDriver;
    readonly sleep?: (ms: number) => Promise<void>;
    readonly pollMs?: number;
}

export function createInteractions(deps: InteractionDeps): { interactions: Interactions; settle: Settle } {
    const interactions = new Interactions(deps.source, deps.driver);
    const settle = new Settle(deps.source, deps.sleep ?? realSleep, deps.pollMs ?? DEFAULT_POLL_MS);
    settle.interactions = interactions;
    return { interactions, settle };
}
