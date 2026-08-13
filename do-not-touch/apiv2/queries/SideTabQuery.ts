import type { WidgetSnapshot } from '../snapshots/GameSnapshot.js';
import { Query } from './Query.js';
import { WidgetQuery } from './WidgetQuery.js';

export interface SideTabQueryEntity {
    readonly index: number;
    readonly rootComponentId: number;
    readonly available: boolean;
    readonly active: boolean;
    readonly visible: boolean;
    readonly widgets: readonly WidgetSnapshot[];
}

export class SideTabQuery<T extends SideTabQueryEntity> extends Query<T> {
    withIndex(...indexes: number[]): this {
        return this.where(tab => indexes.includes(tab.index));
    }

    withRootComponentId(...componentIds: number[]): this {
        return this.where(tab => componentIds.includes(tab.rootComponentId));
    }

    available(): this {
        return this.where(tab => tab.available);
    }

    unavailable(): this {
        return this.where(tab => !tab.available);
    }

    active(): this {
        return this.where(tab => tab.active);
    }

    inactive(): this {
        return this.where(tab => !tab.active);
    }

    visible(): this {
        return this.where(tab => tab.visible);
    }

    notVisible(): this {
        return this.where(tab => !tab.visible);
    }

    widgets(): WidgetQuery<WidgetSnapshot> {
        return new WidgetQuery(this.results().flatMap(tab => [...tab.widgets]));
    }
}
