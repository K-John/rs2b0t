import { chebyshevDistance, containsTile, type WorldArea } from '../geometry/Area.js';
import type { WorldTile } from '../snapshots/GameSnapshot.js';
import { EntityQuery, type QueryEntity } from './EntityQuery.js';

export interface WorldQueryEntity extends QueryEntity {
    readonly tile: WorldTile;
    readonly distance: number;
}

export class WorldQuery<T extends WorldQueryEntity> extends EntityQuery<T> {
    withinDistance(distance: number): this {
        return this.where(value => value.distance <= distance);
    }

    withinDistanceTo(point: WorldTile, distance: number): this {
        return this.where(value => chebyshevDistance(value.tile, point) <= distance);
    }

    inside(area: WorldArea): this {
        return this.where(value => containsTile(value.tile, area));
    }

    withinArea(area: WorldArea): this {
        return this.inside(area);
    }

    inArea(area: WorldArea): this {
        return this.inside(area);
    }

    onLevel(level: number): this {
        return this.where(value => value.tile.level === level);
    }

    onTile(tile: WorldTile): this {
        return this.where(value => value.tile.x === tile.x && value.tile.z === tile.z && value.tile.level === tile.level);
    }

    nearest(): T | null {
        return this.results().reduce<T | null>((nearest, value) => (nearest === null || value.distance < nearest.distance ? value : nearest), null);
    }

    nearestTo(point: WorldTile): T | null {
        return this.results().reduce<T | null>((nearest, value) => {
            const distance = chebyshevDistance(value.tile, point);
            if (nearest === null || distance < chebyshevDistance(nearest.tile, point)) {
                return value;
            }
            return nearest;
        }, null);
    }

    nearestToPlayer(): T | null {
        return this.nearest();
    }
}
