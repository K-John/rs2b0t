export const TRADE_CAP = 25; // max essence offered per trade; the store-visit target
export const BUY_ONLY_STOCK = 30; // shop stock above which the runner only buys (drain mode)
export const LOW_COINS = 1000; // coin floor: below it, bank instead of shopping
export const PICKUP_RANGE = 20; // max tiles to chase a dropped noted stack
export const STORE_PASSES = 6; // bound on plan/act passes per store visit

export type StoreStep = { op: 'buy' | 'sell'; n: number } | { op: 'done' };

export function planStoreStep(stock: number, noted: number, unnoted: number): StoreStep {
    const need = TRADE_CAP - unnoted;
    if (need <= 0) {
        return { op: 'done' };
    }
    if (stock > BUY_ONLY_STOCK) {
        return { op: 'buy', n: need };
    }
    const toSell = Math.min(noted, Math.max(0, need - stock));
    if (toSell > 0) {
        return { op: 'sell', n: toSell };
    }
    if (stock > 0) {
        return { op: 'buy', n: Math.min(need, stock) };
    }
    return { op: 'done' };
}

export function offerCount(unnoted: number): number {
    return Math.max(0, Math.min(TRADE_CAP, unnoted));
}
