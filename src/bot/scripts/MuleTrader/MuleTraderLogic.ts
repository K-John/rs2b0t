import type { TradeItem } from '../../api/trade/Trade.js';

export interface TradeSpec {
    name: string;
    quantity: number;
}

export function parseTradeSpecs(raw: string): TradeSpec[] {
    const merged = new Map<string, TradeSpec>();
    for (const part of raw.split(/[;,\n]/)) {
        const entry = part.trim();
        if (!entry) continue;
        const split = entry.lastIndexOf(':');
        if (split <= 0) throw new Error(`Invalid trade item '${entry}' (expected Item name:quantity)`);
        const name = entry.slice(0, split).trim();
        const quantity = Number(entry.slice(split + 1).trim().replaceAll('_', ''));
        if (!name || !Number.isSafeInteger(quantity) || quantity <= 0) {
            throw new Error(`Invalid trade item '${entry}' (quantity must be a positive whole number)`);
        }
        const key = name.toLowerCase();
        const prior = merged.get(key);
        merged.set(key, { name: prior?.name ?? name, quantity: (prior?.quantity ?? 0) + quantity });
    }
    return [...merged.values()];
}

export function offerCount(items: readonly TradeItem[], name: string): number {
    const wanted = name.trim().toLowerCase();
    return items
        .filter(item => (item.name ?? '').trim().toLowerCase() === wanted)
        .reduce((total, item) => total + Math.max(1, item.count), 0);
}

export function offerMatchesExactly(items: readonly TradeItem[], specs: readonly TradeSpec[]): boolean {
    if (items.some(item => !specs.some(spec => spec.name.toLowerCase() === (item.name ?? '').trim().toLowerCase()))) {
        return false;
    }
    return specs.every(spec => offerCount(items, spec.name) === spec.quantity);
}
