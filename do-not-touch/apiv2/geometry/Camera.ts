import type { WorldTile } from '../snapshots/GameSnapshot.js';

export function yawTo(from: WorldTile, to: WorldTile): number {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    if (dx === 0 && dz === 0) return 0;
    return Math.trunc((Math.atan2(dx, dz) * 1024) / Math.PI) & 0x7ff;
}

export function angularDistance(from: number, to: number): number {
    const distance = Math.abs((from & 0x7ff) - (to & 0x7ff));
    return distance > 1024 ? 2048 - distance : distance;
}

export function signedAngularDelta(from: number, to: number): number {
    const delta = ((to & 0x7ff) - (from & 0x7ff) + 2048) % 2048;
    return delta > 1024 ? delta - 2048 : delta;
}
