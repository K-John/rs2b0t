import { ClientProt } from '#/client/io/ClientProt.js';

import type { GameSnapshot } from '../../do-not-touch/apiv2/snapshots/GameSnapshot.js';

interface Outbound {
    p1Enc(opcode: number): void;
    p1(value: number): void;
    pjstr(value: string): void;
}

export const DRAYNOR_BANK = { x: 3092, z: 3243, level: 0 } as const;

export const COMBAT_STATS = ['attack', 'strength', 'defence'] as const;

export function cheat(client: { out: Outbound }, command: string): void {
    const text = command.startsWith('::') ? command.slice(2) : command;
    client.out.p1Enc(ClientProt.CLIENT_CHEAT);
    client.out.p1(text.length + 1);
    client.out.pjstr(text);
}

export function teleport(client: { out: Outbound }, tile: { x: number; z: number; level: number }): void {
    cheat(client, `::tele ${tile.level},${tile.x >> 6},${tile.z >> 6},${tile.x & 63},${tile.z & 63}`);
}

export function setStat(client: { out: Outbound }, skill: string, level: number): void {
    cheat(client, `::setstat ${skill} ${level}`);
}

export function standardSetup(client: { out: Outbound }, level = 70): void {
    teleport(client, DRAYNOR_BANK);
    for (const skill of COMBAT_STATS) setStat(client, skill, level);
}

export async function teleportTo(
    client: { out: Outbound },
    tile: { x: number; z: number; level: number },
    readTile: () => { x: number; z: number; level: number } | null,
    options?: { patienceMs?: number; radius?: number }
): Promise<boolean> {
    const patience = options?.patienceMs ?? 10_000;
    const radius = options?.radius ?? 3;

    const near = (): boolean => {
        const pos = readTile();
        return pos !== null && Math.abs(pos.x - tile.x) <= radius && Math.abs(pos.z - tile.z) <= radius && pos.level === tile.level;
    };

    for (let attempt = 0; attempt < 2; attempt++) {
        teleport(client, tile);
        const deadline = performance.now() + patience;
        while (performance.now() < deadline) {
            if (near()) return true;
            await new Promise(r => setTimeout(r, 100));
        }
    }
    return near();
}

export function give(client: { out: Outbound }, item: string, amount = 1): void {
    cheat(client, `::give ${item} ${amount}`);
}

export function verify(snapshot: GameSnapshot, level = 70): { placed: boolean; stats: string; tile: string } {
    const tile = snapshot.localPlayer?.tile ?? null;
    const placed = tile !== null && Math.abs(tile.x - DRAYNOR_BANK.x) <= 2 && Math.abs(tile.z - DRAYNOR_BANK.z) <= 2 && tile.level === DRAYNOR_BANK.level;
    const stats = COMBAT_STATS.map(name => {
        const stat = snapshot.stats.find(s => s.name.toLowerCase() === name);
        return `${name}=${stat?.base ?? '?'}${(stat?.base ?? 0) >= level ? '' : ' (NOT SET)'}`;
    }).join(' ');
    return { placed, stats, tile: tile === null ? 'unknown' : `${tile.x},${tile.z} level ${tile.level}` };
}
