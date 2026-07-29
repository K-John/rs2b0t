// docs/superpowers/specs/2026-07-29-shilo-village-design.md
import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { Sustain } from '../../../api/Sustain.js';
import { Equipment } from '../../../api/hud/Equipment.js';
import type { Npc } from '../../../api/entities/index.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import { SV_ITEM, SV_LOC, SV_NPC, SV_TILE } from './areas.js';
import { heldId, here, locNear, promptLoc, settleScene, useOnLoc } from './scene.js';

/** The doors hide themselves again about fifty ticks after the trees are searched. */
function carvedDoors(): ReturnType<typeof locNear> {
    return locNear(SV_LOC.CARVED_DOORS, 'Search', 10) ?? locNear(SV_LOC.CARVED_DOORS, 'Open', 10);
}

function hillsideEntrance(): ReturnType<typeof locNear> {
    return locNear(SV_LOC.HILLSIDE_ENTRANCE, 'Enter', 10);
}

export async function revealDoors(log: (m: string) => void): Promise<boolean> {
    if (carvedDoors() || hillsideEntrance()) {
        return true;
    }
    return promptLoc(
        {
            name: SV_LOC.PALM_TREE,
            op: 'Search',
            near: SV_TILE.PALM_TREES,
            expect: () => carvedDoors() !== null || hillsideEntrance() !== null,
            expectMs: 10_000
        },
        log
    );
}

/**
 * Searching the doors is what teaches the bone lock, and the engine only records it
 * while the stage is exactly `entered_tomb_bervirius` — so this runs after the
 * Bervirius dolmen and before the bone key is cut.
 */
export async function searchCarvedDoors(log: (m: string) => void): Promise<boolean> {
    if (!(await revealDoors(log))) {
        return false;
    }
    return promptLoc(
        {
            name: SV_LOC.CARVED_DOORS,
            op: 'Search',
            near: SV_TILE.CARVED_DOORS,
            // The bit lands with the message box; there is nothing else to observe.
            expect: () => true,
            expectMs: 3000
        },
        log
    );
}

export async function unlockCarvedDoors(log: (m: string) => void): Promise<boolean> {
    if (hillsideEntrance()) {
        return true;
    }
    if (!(await revealDoors(log))) {
        return false;
    }
    return useOnLoc(
        SV_ITEM.BONE_KEY.id,
        { name: SV_LOC.CARVED_DOORS, near: SV_TILE.CARVED_DOORS },
        [],
        () => hillsideEntrance() !== null,
        log
    );
}

export async function enterRashTomb(log: (m: string) => void): Promise<boolean> {
    if (here() === 'rashEntry' || here() === 'rashInner') {
        return true;
    }
    if (!(await revealDoors(log))) {
        return false;
    }
    const ok = await promptLoc(
        {
            name: SV_LOC.HILLSIDE_ENTRANCE,
            op: 'Enter',
            near: SV_TILE.CARVED_DOORS,
            expect: () => here() === 'rashEntry'
        },
        log
    );
    if (ok) {
        await settleScene();
    }
    return ok;
}

/**
 * `zq_open_tombexit` refuses to open for anyone carrying the bone key — the key has
 * to be *used on* the door instead. That inversion is the whole trick of the exit.
 */
export async function leaveRashTomb(log: (m: string) => void): Promise<boolean> {
    if (here() !== 'rashEntry') {
        return here() === 'rashInner' ? climbRashRocks('up', log) : true;
    }
    if (heldId(SV_ITEM.BONE_KEY.id) === 0) {
        const ok = await promptLoc(
            {
                name: SV_LOC.TOMB_EXIT,
                op: 'Open',
                near: SV_TILE.TOMB_EXIT,
                expect: () => here() !== 'rashEntry'
            },
            log
        );
        if (ok) {
            await settleScene();
        }
        return ok;
    }
    const ok = await useOnLoc(
        SV_ITEM.BONE_KEY.id,
        { name: SV_LOC.TOMB_EXIT, near: SV_TILE.TOMB_EXIT },
        [],
        () => here() !== 'rashEntry',
        log
    );
    if (ok) {
        await settleScene();
    }
    return ok;
}

/**
 * The gate only opens southbound for someone wearing the Beads of the Dead;
 * everyone else gets Rashiliyia instead. Northbound is free.
 */
export async function openAncientGate(log: (m: string) => void): Promise<boolean> {
    if (here() !== 'rashEntry') {
        return true;
    }
    if (!Equipment.contains(SV_ITEM.DEAD_BEADS.name)) {
        log('the Beads of the Dead are not worn — the gate would summon Rashiliyia');
        return false;
    }
    const gate = locNear(SV_LOC.ANCIENT_GATE, 'Open', 12);
    if (!gate) {
        // Not in range yet: walk in and let the next pass click it.
        return promptLoc(
            {
                name: SV_LOC.ANCIENT_GATE,
                op: 'Open',
                near: SV_TILE.ANCIENT_GATE,
                expect: () => Game.tile() !== null && (Game.tile()!.z <= 9515 || locNear(SV_LOC.ANCIENT_GATE, 'Open', 6) !== null)
            },
            log
        );
    }
    if (!(await gate.interact('Open'))) {
        return false;
    }
    return Execution.delayUntil(() => (Game.tile()?.z ?? 9999) <= 9515, 12_000);
}

/**
 * The rocks are clicked from wherever the gate dropped us — the landing tile is
 * unwalkable in the baked pack, so nothing may try to walk to it first.
 */
export async function climbRashRocks(dir: 'down' | 'up', log: (m: string) => void): Promise<boolean> {
    const want = dir === 'down' ? 'rashInner' : 'rashEntry';
    if (here() === want) {
        return true;
    }
    const rocks = locNear(SV_LOC.RASH_ROCKS, 'Climb', 8);
    if (!rocks) {
        log(`no climbable rocks in range going ${dir}`);
        return false;
    }
    if (!(await rocks.interact('Climb'))) {
        return false;
    }
    const ok = await Execution.delayUntil(() => here() === want, 20_000);
    if (ok) {
        await settleScene();
    }
    return ok;
}

/** Three plain bones, one recess at a time; the third opens the doors and walks you in. */
export async function placeBone(log: (m: string) => void): Promise<boolean> {
    if (heldId(SV_ITEM.BONES.id) === 0) {
        log('no bones left for the door recesses');
        return false;
    }
    const before = heldId(SV_ITEM.BONES.id);
    return useOnLoc(
        SV_ITEM.BONES.id,
        { name: SV_LOC.TOMB_DOORS, near: SV_TILE.TOMB_DOORS },
        [],
        () => heldId(SV_ITEM.BONES.id) < before,
        log
    );
}

export async function enterTombRoom(log: (m: string) => void): Promise<boolean> {
    const tile = Game.tile();
    if (tile && tile.z < 9480) {
        return true;
    }
    const ok = await promptLoc(
        {
            name: SV_LOC.TOMB_DOORS,
            op: 'Open',
            near: SV_TILE.TOMB_DOORS,
            expect: () => (Game.tile()?.z ?? 9999) < 9480
        },
        log
    );
    if (ok) {
        await settleScene();
    }
    return ok;
}

const FIGHT_MS = 240_000;

/**
 * Searching the dolmen either summons the next Nazastarool or, once all three are
 * down, yields the remains. Driving both from one step keeps the state machine
 * honest when the journal still claims kills the engine has already reset.
 */
export async function workTheDolmen(log: (m: string) => void): Promise<boolean> {
    if (heldId(SV_ITEM.RASH_CORPSE.id) > 0) {
        return true;
    }
    const boss = (): Npc | null => Npcs.query().name(SV_NPC.NAZASTAROOL).action('Attack').within(14).nearest();
    if (boss()) {
        return fightNazastarool(log);
    }
    const searched = await promptLoc(
        {
            name: SV_LOC.RASH_DOLMEN,
            op: 'Search',
            near: SV_TILE.RASH_DOLMEN,
            expect: () => heldId(SV_ITEM.RASH_CORPSE.id) > 0 || boss() !== null,
            // The summon is deliberately delayed five to eight ticks.
            expectMs: 20_000
        },
        log
    );
    if (!searched) {
        return false;
    }
    if (heldId(SV_ITEM.RASH_CORPSE.id) > 0) {
        return true;
    }
    return fightNazastarool(log);
}

export async function fightNazastarool(log: (m: string) => void): Promise<boolean> {
    const deadline = performance.now() + FIGHT_MS;
    while (performance.now() < deadline) {
        const target = Npcs.query().name(SV_NPC.NAZASTAROOL).action('Attack').within(14).nearest();
        if (!target) {
            return true;
        }
        await Sustain.run();
        if (!Game.inCombat()) {
            await target.interact('Attack');
            await Execution.delayUntil(() => Game.inCombat(), 5000);
        }
        await Execution.delayTicks(2);
    }
    log('Nazastarool outlasted the fight budget');
    return false;
}

export function beadsOn(): boolean {
    return Equipment.contains(SV_ITEM.DEAD_BEADS.name);
}
