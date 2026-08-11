import { reader } from '../adapter/ClientAdapter.js';

/**
 * Item icon as a data URL. Null when the cache is not loaded or the id has no
 * sprite, so callers fall back to the item's name.
 *
 * The adapter hands over raw pixels rather than a canvas: DOM is fenced to this
 * directory, and the client stores icons as an `Int32Array` of 0xRRGGBB with 0
 * meaning transparent.
 */
/**
 * Encoded icons, by item id.
 *
 * `toDataURL` is a PNG encode — about 1ms each. The picker draws up to two
 * hundred rows and every click re-renders, so uncached this costs the better
 * part of a game tick per click, and it gets worse the more items the client
 * has seen. Failures are deliberately not cached: a sprite the client has not
 * streamed yet must be retried, which is what fills icons in later.
 */
const encoded = new Map<number, string>();

export function itemIconDataUrl(id: number): string | null {
    const hit = encoded.get(id);
    if (hit !== undefined) {
        return hit;
    }
    const sprite = reader.itemIconPixels(id);
    if (!sprite || sprite.width <= 0 || sprite.height <= 0) {
        return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = sprite.width;
    canvas.height = sprite.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        return null;
    }
    const image = ctx.createImageData(sprite.width, sprite.height);
    for (let i = 0; i < sprite.data.length; i++) {
        const rgb = sprite.data[i]!;
        image.data[i * 4] = (rgb >> 16) & 0xff;
        image.data[i * 4 + 1] = (rgb >> 8) & 0xff;
        image.data[i * 4 + 2] = rgb & 0xff;
        image.data[i * 4 + 3] = rgb === 0 ? 0 : 0xff;
    }
    ctx.putImageData(image, 0, 0);
    const url = canvas.toDataURL('image/png');
    encoded.set(id, url);
    return url;
}
