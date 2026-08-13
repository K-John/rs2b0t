import type { WidgetItemSnapshot, WidgetRoot, WidgetVarpBindingSnapshot } from '../snapshots/GameSnapshot.js';
import { ItemQuery } from './ItemQuery.js';
import { Query } from './Query.js';

export interface WidgetQueryEntity {
    readonly componentId: number;
    readonly layerId: number;
    readonly parentId: number;
    readonly rootComponentId: number;
    readonly root: WidgetRoot;
    readonly type: number;
    readonly buttonType: number;
    readonly clientCode: number;
    readonly hidden: boolean;
    readonly text: string | null;
    readonly alternateText: string | null;
    readonly buttonText: string | null;
    readonly targetBase: string | null;
    readonly modelType: number;
    readonly modelId: number;
    readonly varpBindings: readonly WidgetVarpBindingSnapshot[];
    readonly actions: readonly (string | null)[];
    readonly items: readonly WidgetItemSnapshot[];
}

function normalized(value: string): string {
    return value.trim().toLowerCase();
}

export class WidgetQuery<T extends WidgetQueryEntity> extends Query<T> {
    withComponentId(...componentIds: number[]): this {
        return this.where(widget => componentIds.includes(widget.componentId));
    }

    withLayerId(...layerIds: number[]): this {
        return this.where(widget => layerIds.includes(widget.layerId));
    }

    withParentId(...parentIds: number[]): this {
        return this.where(widget => parentIds.includes(widget.parentId));
    }

    withRootComponentId(...rootComponentIds: number[]): this {
        return this.where(widget => rootComponentIds.includes(widget.rootComponentId));
    }

    withRoot(...roots: WidgetRoot[]): this {
        return this.where(widget => roots.includes(widget.root));
    }

    withType(...types: number[]): this {
        return this.where(widget => types.includes(widget.type));
    }

    withButtonType(...buttonTypes: number[]): this {
        return this.where(widget => buttonTypes.includes(widget.buttonType));
    }

    withClientCode(...clientCodes: number[]): this {
        return this.where(widget => clientCodes.includes(widget.clientCode));
    }

    withButtonText(...texts: string[]): this {
        const wanted = texts.map(normalized);
        return this.where(widget => widget.buttonText !== null && wanted.includes(normalized(widget.buttonText)));
    }

    withTargetBase(...targets: string[]): this {
        const wanted = targets.map(normalized);
        return this.where(widget => widget.targetBase !== null && wanted.includes(normalized(widget.targetBase)));
    }

    withModelObjectId(...itemIds: number[]): this {
        return this.where(widget => widget.modelType === 4 && itemIds.includes(widget.modelId));
    }

    boundToVarp(varp: number, value?: number): this {
        return this.where(widget => widget.varpBindings.some(binding => binding.varp === varp && (value === undefined || binding.value === value)));
    }

    hidden(): this {
        return this.where(widget => widget.hidden);
    }

    notHidden(): this {
        return this.where(widget => !widget.hidden);
    }

    withText(...texts: string[]): this {
        const wanted = texts.map(normalized);
        return this.where(widget => [widget.text, widget.alternateText].some(text => text !== null && wanted.includes(normalized(text))));
    }

    textContains(...terms: string[]): this {
        const wanted = terms.map(normalized);
        return this.where(widget => [widget.text, widget.alternateText].some(text => text !== null && wanted.some(term => normalized(text).includes(term))));
    }

    textMatches(pattern: RegExp): this {
        return this.where(widget =>
            [widget.text, widget.alternateText].some(text => {
                if (text === null) return false;
                pattern.lastIndex = 0;
                return pattern.test(text);
            })
        );
    }

    withAction(...actions: string[]): this {
        const wanted = actions.map(normalized);
        return this.where(widget => widget.actions.some(action => action !== null && wanted.includes(normalized(action))));
    }

    withItemId(...itemIds: number[]): this {
        return this.where(widget => widget.items.some(item => itemIds.includes(item.id)));
    }

    withAnyItem(): this {
        return this.where(widget => widget.items.length > 0);
    }

    withItemAction(...actions: string[]): this {
        const wanted = actions.map(normalized);
        return this.where(widget => widget.items.some(item => item.actions.some(action => action !== null && wanted.includes(normalized(action)))));
    }

    items(): ItemQuery<WidgetItemSnapshot> {
        return new ItemQuery(this.results().flatMap(widget => [...widget.items]));
    }
}
