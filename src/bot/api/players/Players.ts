import { reader, type PlayerSnapshot } from '../../adapter/ClientAdapter.js';
import { Player } from '../model/Player.js';
import EntityQuery from '../query/Query.js';

/**
 * Player queries.
 * @see docs/reference/api-entities.md
 */
export const Players = {
    query(): EntityQuery<Player> {
        return EntityQuery.fromSnapshots(
            (): readonly PlayerSnapshot[] => reader.players().map(s => ({ ...s, ops: [] })),
            s => new Player(s)
        );
    }
};

export { Player };
