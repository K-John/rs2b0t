import { deflateSync } from 'node:zlib';

import type { GameSnapshot, WorldTile } from '../../do-not-touch/apiv2/snapshots/GameSnapshot.js';
import { ReadContext } from '../../do-not-touch/apiv2/ReadApi.js';

const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c;
    }
    return table;
})();

function crc32(bytes: Uint8Array): number {
    let c = 0xffffffff;
    for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
    const out = new Uint8Array(body.length + 12);
    const view = new DataView(out.buffer);
    view.setUint32(0, body.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(body, 8);
    view.setUint32(body.length + 8, crc32(out.subarray(4, body.length + 8)));
    return out;
}

export function encodePng(pixels: Int32Array, width: number, height: number): Uint8Array {
    const raw = new Uint8Array(height * (width * 3 + 1));
    let at = 0;
    for (let y = 0; y < height; y++) {
        raw[at++] = 0;
        for (let x = 0; x < width; x++) {
            const rgb = pixels[y * width + x] ?? 0;
            raw[at++] = (rgb >> 16) & 0xff;
            raw[at++] = (rgb >> 8) & 0xff;
            raw[at++] = rgb & 0xff;
        }
    }

    const ihdr = new Uint8Array(13);
    const header = new DataView(ihdr.buffer);
    header.setUint32(0, width);
    header.setUint32(4, height);
    ihdr[8] = 8;
    ihdr[9] = 2;

    const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(deflateSync(raw))), chunk('IEND', new Uint8Array(0))];
    const total = parts.reduce((sum, p) => sum + p.length, 0);
    const png = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        png.set(part, offset);
        offset += part.length;
    }
    return png;
}

export async function screenshot(path: string): Promise<{ width: number; height: number } | null> {
    const { default: Pix2D } = (await import('#/client/graphics/Pix2D.js')) as never as { default: { pixels: Int32Array; width: number; height: number } };
    const { pixels, width, height } = Pix2D;
    if (width === 0 || height === 0 || pixels.length < width * height) return null;
    await Bun.write(path, encodePng(pixels, width, height));
    return { width, height };
}

const ESCAPE: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escape = (s: string): string => s.replace(/[&<>"]/g, c => ESCAPE[c]!);

export function sceneMapSvg(snapshot: GameSnapshot, options: { radius?: number; cell?: number } = {}): string {
    const radius = options.radius ?? 16;
    const cell = options.cell ?? 18;
    const read = new ReadContext(snapshot);
    const scene = read.scene();
    const me = read.worldTile();
    if (me === null) return '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40"><text x="8" y="24">no world tile</text></svg>';

    const span = radius * 2 + 1;
    const size = span * cell;
    const pad = 34;
    const px = (x: number): number => (x - (me.x - radius)) * cell + pad;
    const py = (z: number): number => (me.z + radius - z) * cell + pad;

    const parts: string[] = [];
    parts.push(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${size + pad * 2}" height="${size + pad * 2 + 26}" viewBox="0 0 ${size + pad * 2} ${size + pad * 2 + 26}" font-family="ui-monospace,monospace">`
    );
    parts.push('<rect width="100%" height="100%" fill="#11151c"/>');

    for (let x = me.x - radius; x <= me.x + radius; x++) {
        for (let z = me.z - radius; z <= me.z + radius; z++) {
            const tile: WorldTile = { x, z, level: me.level };
            const inScene = scene.contains(tile);
            const walkable = inScene && scene.walkable(tile);
            const fill = !inScene ? '#0b0e13' : walkable ? '#243347' : '#5b2330';
            parts.push(`<rect x="${px(x)}" y="${py(z)}" width="${cell - 1}" height="${cell - 1}" fill="${fill}"/>`);
        }
    }

    for (const loc of read.locs().results()) {
        if (loc.tile.level !== me.level) continue;
        if (Math.abs(loc.tile.x - me.x) > radius || Math.abs(loc.tile.z - me.z) > radius) continue;
        const isDoor = /door|gate/i.test(loc.name ?? '');
        if (!loc.blockWalk && !isDoor) continue;
        const colour = isDoor ? '#e0a03a' : '#8a3a4a';
        parts.push(
            `<rect x="${px(loc.tile.x)}" y="${py(loc.tile.z)}" width="${cell - 1}" height="${cell - 1}" fill="none" stroke="${colour}" stroke-width="2"><title>${escape(loc.name ?? '?')} [${loc.layer}] ${loc.tile.x},${loc.tile.z}</title></rect>`
        );
    }

    for (const npc of read.npcs().results()) {
        if (npc.tile.level !== me.level) continue;
        if (Math.abs(npc.tile.x - me.x) > radius || Math.abs(npc.tile.z - me.z) > radius) continue;
        parts.push(
            `<circle cx="${px(npc.tile.x) + cell / 2 - 0.5}" cy="${py(npc.tile.z) + cell / 2 - 0.5}" r="${cell / 3}" fill="#4fb286"><title>${escape(npc.name ?? '?')} ${npc.tile.x},${npc.tile.z}</title></circle>`
        );
    }

    for (const item of read.groundItems().results()) {
        if (item.tile.level !== me.level) continue;
        if (Math.abs(item.tile.x - me.x) > radius || Math.abs(item.tile.z - me.z) > radius) continue;
        parts.push(
            `<rect x="${px(item.tile.x) + cell / 3}" y="${py(item.tile.z) + cell / 3}" width="${cell / 3}" height="${cell / 3}" fill="#d6d05a"><title>${escape(item.name ?? '?')} x${item.count}</title></rect>`
        );
    }

    parts.push(`<circle cx="${px(me.x) + cell / 2 - 0.5}" cy="${py(me.z) + cell / 2 - 0.5}" r="${cell / 2.4}" fill="#f2f4f8" stroke="#11151c" stroke-width="2"><title>you: ${me.x},${me.z} level ${me.level}</title></circle>`);

    parts.push(`<text x="${pad}" y="${pad - 12}" fill="#7d8898" font-size="11">x ${me.x - radius} → ${me.x + radius}   (north is up)</text>`);
    parts.push(`<text x="${pad}" y="${size + pad * 2 + 6}" fill="#7d8898" font-size="11">z ${me.z - radius} → ${me.z + radius}   standing at ${me.x},${me.z} level ${me.level}</text>`);
    parts.push(
        `<text x="${pad}" y="${size + pad * 2 + 22}" fill="#7d8898" font-size="11">` +
            '<tspan fill="#243347">■</tspan> walkable  <tspan fill="#5b2330">■</tspan> blocked  ' +
            '<tspan fill="#e0a03a">□</tspan> door  <tspan fill="#8a3a4a">□</tspan> blocking scenery  ' +
            '<tspan fill="#4fb286">●</tspan> creature  <tspan fill="#d6d05a">■</tspan> floor item</text>'
    );
    parts.push('</svg>');
    return parts.join('\n');
}
