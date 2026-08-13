import { WorldQuery, type WorldQueryEntity } from './WorldQuery.js';

export type LocLayer = 'wall' | 'wallDecoration' | 'ground' | 'groundDecoration';

export interface LocalQueryEntity extends WorldQueryEntity {
    readonly layer: LocLayer;
    readonly shape: number;
    readonly angle: number;
    readonly footprintWidth: number;
    readonly footprintLength: number;
    readonly blockWalk: boolean;
    readonly blockRange: boolean;
    readonly active: boolean;
    readonly animation: number;
}

export class LocalQuery<T extends LocalQueryEntity> extends WorldQuery<T> {
    withLayer(...layers: LocLayer[]): this {
        return this.where(loc => layers.includes(loc.layer));
    }

    withShape(...shapes: number[]): this {
        return this.where(loc => shapes.includes(loc.shape));
    }

    withAngle(...angles: number[]): this {
        return this.where(loc => angles.includes(loc.angle));
    }

    withFootprint(width: number, length: number): this {
        return this.where(loc => loc.footprintWidth === width && loc.footprintLength === length);
    }

    blockingWalk(): this {
        return this.where(loc => loc.blockWalk);
    }

    notBlockingWalk(): this {
        return this.where(loc => !loc.blockWalk);
    }

    blockingRange(): this {
        return this.where(loc => loc.blockRange);
    }

    notBlockingRange(): this {
        return this.where(loc => !loc.blockRange);
    }

    active(): this {
        return this.where(loc => loc.active);
    }

    inactive(): this {
        return this.where(loc => !loc.active);
    }

    animated(): this {
        return this.where(loc => loc.animation !== -1);
    }

    static(): this {
        return this.where(loc => loc.animation === -1);
    }

    withAnimation(...animations: number[]): this {
        return this.where(loc => animations.includes(loc.animation));
    }
}
