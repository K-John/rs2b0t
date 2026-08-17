import type { GameSnapshot } from './GameSnapshot.js';

export interface SnapshotSource {
    read(): GameSnapshot;
}
