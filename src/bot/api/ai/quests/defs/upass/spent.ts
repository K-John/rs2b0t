/** A tile as the client reports it — the walker's `Tile` satisfies this too. */
export interface Stand {
    x: number;
    z: number;
    level: number;
}

// Why: a crossing spends the seam FROM THE SIDE it was crossed from, not outright. The slave cage that puts a character into a cell is the only thing that takes them out of it again, so a seam struck off the list on the far side seals the pocket behind them — one run stood in the fourteen-tile cell at (2385,9661) for an hour with its own door filtered out of every search. Which side the character is on is a question the loaded scene answers: a stand tile it can still walk to is a stand tile on this side.

/** The stand tiles each seam has already been used from, by seam key. */
export type SpentSides = Map<string, Stand[]>;

export function spentHere(sides: SpentSides, key: string, reachable: (tile: Stand) => boolean): boolean {
    return (sides.get(key) ?? []).some(reachable);
}

export function spendFrom(sides: SpentSides, key: string, stand: Stand): void {
    const used = sides.get(key) ?? [];
    if (!used.some(tile => tile.x === stand.x && tile.z === stand.z && tile.level === stand.level)) {
        used.push(stand);
    }
    sides.set(key, used);
}
