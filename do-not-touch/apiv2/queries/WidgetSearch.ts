import type { GameSnapshot, WidgetSnapshot } from '../snapshots/GameSnapshot.js';

function allWidgets(snapshot: GameSnapshot, rootComponentId?: number): WidgetSnapshot[] {
    const widgets = [...snapshot.widgets, ...snapshot.sideTabs.flatMap(tab => tab.widgets)];
    return rootComponentId === undefined ? widgets : widgets.filter(widget => widget.rootComponentId === rootComponentId);
}

export function closeButtonComId(snapshot: GameSnapshot, rootComponentId: number): number {
    const w = allWidgets(snapshot, rootComponentId).find(w => w.buttonType === 3);
    return w?.componentId ?? -1;
}

export function buttonByText(snapshot: GameSnapshot, rootComponentId: number, label: string): number {
    const wanted = label.trim().toLowerCase();
    const w = allWidgets(snapshot, rootComponentId).find(w =>
        w.buttonText !== null && w.buttonText.trim().toLowerCase() === wanted);
    return w?.componentId ?? -1;
}

export function targetButtonByBase(snapshot: GameSnapshot, rootComponentId: number, base: string): number {
    const wanted = base.trim().toLowerCase();
    const w = allWidgets(snapshot, rootComponentId).find(w =>
        w.buttonType === 2 && w.targetBase !== null && w.targetBase.trim().toLowerCase() === wanted);
    return w?.componentId ?? -1;
}

export function selectButtonByVarp(snapshot: GameSnapshot, rootComponentId: number, varp: number, value: number): number {
    const w = allWidgets(snapshot, rootComponentId).find(w =>
        w.buttonType === 5 && w.varpBindings.some(b => b.varp === varp && b.value === value));
    return w?.componentId ?? -1;
}

export function combatStyleLabels(snapshot: GameSnapshot, rootComponentId: number, varp = 43): { mode: number; label: string; componentId: number }[] {
    const widgets = allWidgets(snapshot, rootComponentId);

    const buttons = widgets
        .filter(w => w.buttonType === 5 && w.varpBindings.some(b => b.varp === varp))
        .map(w => ({
            componentId: w.componentId,
            mode: w.varpBindings.find(b => b.varp === varp)!.value ?? 0,
            y: w.y
        }));

    const texts = widgets
        .filter(w => w.text !== null && w.text.length > 0)
        .map(w => ({ text: w.text!, y: w.y }));

    return buttons
        .map(btn => {
            const nearest = texts.reduce<{ text: string; dist: number } | null>((best, t) => {
                const dist = Math.abs(t.y - btn.y);
                return best === null || dist < best.dist ? { text: t.text, dist } : best;
            }, null);
            return { mode: btn.mode, label: nearest?.text ?? '', componentId: btn.componentId };
        })
        .sort((a, b) => a.mode - b.mode);
}
