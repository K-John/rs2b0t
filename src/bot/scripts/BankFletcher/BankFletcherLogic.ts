export const LOG_OPTIONS = ['Logs', 'Oak logs', 'Willow logs', 'Maple logs', 'Yew logs', 'Magic logs'];

export function logNameMatches(itemName: string | null | undefined, material: string): boolean {
    if (itemName === null || itemName === undefined) {
        return false;
    }
    return itemName.trim().toLowerCase() === material.trim().toLowerCase();
}

/** Find a content item by its exact display name. */
export function exactName<T extends { name: string | null }>(items: readonly T[], query: string): T | null {
    const wanted = query.trim().toLowerCase();
    if (!wanted) {
        return null;
    }
    const normalized = (item: T): string | null => item.name?.trim().toLowerCase() ?? null;
    return items.find(item => normalized(item) === wanted) ?? null;
}

export function productNeedsDifferentLog(product: string, material: string): boolean {
    return product.trim().toLowerCase() === 'arrow shafts' && material.trim().toLowerCase() !== 'logs';
}

const PRODUCT_KEYWORDS: Record<string, string[]> = {
    'arrow shafts': ['shaft', 'arrow'],
    'short bow': ['short'],
    'long bow': ['long']
};

export function productKeywords(product: string): string[] {
    const key = product.trim().toLowerCase();
    return PRODUCT_KEYWORDS[key] ?? (key.length > 0 ? [key] : []);
}

export function matchProduct(options: readonly string[], product: string): string | null {
    const keys = productKeywords(product);
    if (keys.length === 0) {
        return null;
    }
    for (const opt of options) {
        const lc = (opt ?? '').toLowerCase();
        if (keys.some(k => lc.includes(k))) {
            return opt;
        }
    }
    return null;
}

interface AttachPlan {
    inputs: [string, string];
    product: string;
    level: number;
}

const ATTACH_PRODUCTS: Record<string, AttachPlan> = {
    'headless arrows': { inputs: ['Feather', 'Arrow shaft'], product: 'Headless arrow', level: 1 },
    'bronze arrows': { inputs: ['Bronze arrowtips', 'Headless arrow'], product: 'Bronze arrow', level: 1 },
    'iron arrows': { inputs: ['Iron arrowtips', 'Headless arrow'], product: 'Iron arrow', level: 15 },
    'steel arrows': { inputs: ['Steel arrowtips', 'Headless arrow'], product: 'Steel arrow', level: 30 },
    'mithril arrows': { inputs: ['Mithril arrowtips', 'Headless arrow'], product: 'Mithril arrow', level: 45 },
    'adamant arrows': { inputs: ['Adamant arrowtips', 'Headless arrow'], product: 'Adamant arrow', level: 60 },
    'rune arrows': { inputs: ['Rune arrowtips', 'Headless arrow'], product: 'Rune arrow', level: 75 }
};

export function attachPlanFor(product: string): AttachPlan | null {
    return ATTACH_PRODUCTS[product.trim().toLowerCase()] ?? null;
}

/** Material option that switches the script into bow-stringing mode. */
export const BOW_STRING = 'Bow string';

export function isBowStringMaterial(material: string): boolean {
    return material.trim().toLowerCase() === BOW_STRING.toLowerCase();
}

/**
 * Strung and unstrung bows share a display name in this revision (e.g. both read
 * "Magic longbow"), so the id is the only thing that tells a finished bow from
 * a stringing blank — see docs' HighAlcher UNSTRUNG_BOW_IDS/STRUNG_BOW_IDS note.
 */
export interface BowIds {
    name: string;
    unstrungId: number;
    strungId: number;
}

const BOW_TYPES: readonly BowIds[] = [
    { name: 'Shortbow', unstrungId: 50, strungId: 841 },
    { name: 'Longbow', unstrungId: 48, strungId: 839 },
    { name: 'Oak shortbow', unstrungId: 54, strungId: 843 },
    { name: 'Oak longbow', unstrungId: 56, strungId: 845 },
    { name: 'Willow longbow', unstrungId: 58, strungId: 847 },
    { name: 'Willow shortbow', unstrungId: 60, strungId: 849 },
    { name: 'Maple longbow', unstrungId: 62, strungId: 851 },
    { name: 'Maple shortbow', unstrungId: 64, strungId: 853 },
    { name: 'Yew longbow', unstrungId: 66, strungId: 855 },
    { name: 'Yew shortbow', unstrungId: 68, strungId: 857 },
    { name: 'Magic longbow', unstrungId: 70, strungId: 859 },
    { name: 'Magic shortbow', unstrungId: 72, strungId: 861 }
];

export const BOW_OPTIONS = BOW_TYPES.map(b => b.name);

export function bowIdsFor(product: string): BowIds | null {
    const wanted = product.trim().toLowerCase();
    return BOW_TYPES.find(b => b.name.toLowerCase() === wanted) ?? null;
}
