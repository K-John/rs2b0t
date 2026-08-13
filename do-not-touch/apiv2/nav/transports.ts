import { readFileSync } from 'fs';
import { join } from 'path';

import {
    CONTENT_ROOT,
    locIdsByName,
    locPositions,
    packCoord,
    readLocDefs,
    type LocDef,
    type LocPlacement,
} from './content';
import { tickCosts } from './costs';
import { buildWorldCollision, rsmod } from './grid';
import { idxOf, tileOf, type StepGrid, type TickCosts, type Transport, type TransportTable } from './types';

const CELLAR_SHIFT = 6400;

const SKIP_PLAYER_RELATIVE = 'player-relative destination with a horizontal shift';
const SKIP_DIALOG = 'destination is behind a dialog';

const SKIP_HANDOFF = 'destination handed to another script';
const SKIP_RANDOM = 'destination is randomised';
const SKIP_NO_RULE = 'no rule for this placement (script reports it unhandled)';
const SKIP_UNPARSED = 'destination expression not understood';
const SKIP_DEST_OUTSIDE = 'destination outside the grid box';
const SKIP_UNPRICED = 'no measured tick cost for this loc type';
const SKIP_NO_STANDING = 'no walkable tile beside the loc';
const SKIP_DEST_BLOCKED = 'destination tile not walkable';
const DROP_DEST_BLOCKED = 'standing tile dropped: its destination is not walkable';
const DROP_NOT_OPERABLE = 'standing tile dropped: the game refuses the op from there';

type Landing =
    | { readonly kind: 'abs'; readonly level: number; readonly x: number; readonly z: number }
    | { readonly kind: 'locDelta'; readonly dx: number; readonly dLevel: number; readonly dz: number }
    | { readonly kind: 'fromLevel'; readonly d: number }
    | { readonly kind: 'fromZ'; readonly d: number };

type Outcome = { readonly ok: true; readonly landing: Landing } | { readonly ok: false; readonly reason: string };

interface ScriptRule {
    readonly byLocCoord: Map<number, Outcome>;
    readonly byAngle: Map<number, Outcome>;
    fallback: Outcome | null;
}

function parseCoordLiteral(text: string): { level: number; x: number; z: number } | null {
    const m = /^(\d+)_(\d+)_(\d+)_(\d+)_(\d+)$/.exec(text.trim());
    if (!m) return null;
    return { level: +m[1]!, x: (+m[2]! << 6) | +m[4]!, z: (+m[3]! << 6) | +m[5]! };
}

function callArgs(text: string, name: string): string[] | null {
    const at = text.indexOf(name + '(');
    if (at < 0) return null;
    if (at > 0 && /[A-Za-z0-9_]/.test(text[at - 1]!)) return null;

    const args: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = at + name.length; i < text.length; i++) {
        const ch = text[i]!;
        if (ch === '(') {
            depth++;
            if (depth === 1) start = i + 1;
        } else if (ch === ')') {
            depth--;
            if (depth === 0) {
                args.push(text.slice(start, i));
                return args;
            }
        } else if (ch === ',' && depth === 1) {
            args.push(text.slice(start, i));
            start = i + 1;
        }
    }
    return null;
}

function intOrNull(text: string): number | null {
    const m = /^-?\d+$/.exec(text.trim());
    return m ? +text.trim() : null;
}

function parseLanding(expr: string): Outcome {
    const lit = parseCoordLiteral(expr);
    if (lit) return { ok: true, landing: { kind: 'abs', ...lit } };

    const mv = callArgs(expr, 'movecoord');
    if (!mv || mv.length !== 4) return { ok: false, reason: SKIP_UNPARSED };

    const dx = intOrNull(mv[1]!);
    const dLevel = intOrNull(mv[2]!);
    const dz = intOrNull(mv[3]!);
    if (dx === null || dLevel === null || dz === null) return { ok: false, reason: SKIP_RANDOM };

    const base = mv[0]!.trim().replace(/\(\)$/, '');
    if (base === 'loc_coord') return { ok: true, landing: { kind: 'locDelta', dx, dLevel, dz } };

    if (base === 'coord') {
        if (dx === 0 && dz === 0) return { ok: true, landing: { kind: 'fromLevel', d: dLevel } };
        if (dx === 0 && dLevel === 0 && Math.abs(dz) === CELLAR_SHIFT) {
            return { ok: true, landing: { kind: 'fromZ', d: dz } };
        }
        return { ok: false, reason: SKIP_PLAYER_RELATIVE };
    }

    const baseLit = parseCoordLiteral(base);
    if (baseLit) {
        return {
            ok: true,
            landing: { kind: 'abs', level: baseLit.level + dLevel, x: baseLit.x + dx, z: baseLit.z + dz },
        };
    }
    return { ok: false, reason: SKIP_UNPARSED };
}

function parseStatement(line: string): Outcome | null {
    for (const fn of ['p_telejump', 'p_teleport', '~climb_ladder']) {
        const args = callArgs(line, fn);
        if (args && args.length > 0) return parseLanding(args[0]!);
    }
    if (/p_choice2_header/.test(line)) return { ok: false, reason: SKIP_DIALOG };

    const label = /(?:^|[\s:])@(\w+)/.exec(line);
    if (label) {
        const name = label[1]!;
        if (name === 'stair_options' || name === 'ladder_options') return { ok: false, reason: SKIP_DIALOG };
        if (name === 'unhandled_stairs' || name === 'unhandled_ladder') return null;
        return { ok: false, reason: SKIP_HANDOFF };
    }
    return null;
}

type Guard =
    | { readonly kind: 'coord'; readonly packed: number }
    | { readonly kind: 'angle'; readonly n: number }
    | { readonly kind: 'default' }
    | { readonly kind: 'unknown' };

function parseScript(text: string, out: Map<string, ScriptRule>): void {
    let rule: ScriptRule | null = null;
    let aliases = new Set<string>();
    let guard: Guard | null = null;
    let guardBrace = -1;
    let switchOn: 'coord' | 'angle' | 'unknown' | null = null;
    let switchBrace = -1;
    let depth = 0;
    let lastIfWasCoord = false;

    const record = (outcome: Outcome): void => {
        if (!rule) return;
        if (guard?.kind === 'coord') {
            if (!rule.byLocCoord.has(guard.packed)) rule.byLocCoord.set(guard.packed, outcome);
        } else if (guard?.kind === 'angle') {
            if (!rule.byAngle.has(guard.n)) rule.byAngle.set(guard.n, outcome);
        } else if (guard?.kind !== 'unknown') {
            if (!rule.fallback) rule.fallback = outcome;
        }
    };

    for (const raw of text.split('\n')) {
        const comment = raw.indexOf('//');
        const line = (comment < 0 ? raw : raw.slice(0, comment)).trim();
        if (!line) continue;

        const header = /^\[(\w+),(\w+)\]$/.exec(line);
        if (header) {
            const op = /^oploc(\d)$/.exec(header[1]!);
            rule = op ? { byLocCoord: new Map(), byAngle: new Map(), fallback: null } : null;
            if (rule) out.set(`${header[2]!}:${op![1]!}`, rule);
            aliases = new Set();
            guard = null;
            guardBrace = -1;
            switchOn = null;
            switchBrace = -1;
            depth = 0;
            continue;
        }
        if (!rule) continue;

        const alias = /^def_coord\s+(\$\w+)\s*=\s*loc_coord/.exec(line);
        if (alias) {
            aliases.add(alias[1]!);
            continue;
        }

        const before = depth;
        let body = line;

        const sw = /^switch_(coord|int)\s*\(\s*(\$?\w+)\s*\)/.exec(line);
        const caseLine = /^case\s+(default|\d+(?:_\d+){4}|\d+)\s*:\s*(.*)$/.exec(line);
        const elseIf = /^\}\s*else\s+if\s*\(/.test(line);
        const elseLine = !elseIf && /^\}\s*else\s*\{/.test(line);
        const ifLine = /^if\s*\(\s*(\$?\w+)\s*=\s*(\d+(?:_\d+){4})\s*\)/.exec(line);

        if (sw) {
            const target = sw[2]!;
            switchOn =
                sw[1] === 'int' && target === 'loc_angle'
                    ? 'angle'
                    : sw[1] === 'coord' && (target === 'loc_coord' || aliases.has(target))
                        ? 'coord'
                        : 'unknown';
            switchBrace = before;
            guard = null;
            guardBrace = -1;
            body = '';
        } else if (caseLine) {
            const key = caseLine[1]!;
            if (key === 'default') guard = { kind: 'default' };
            else if (switchOn === 'coord') {
                const c = parseCoordLiteral(key);
                guard = c ? { kind: 'coord', packed: packCoord(c.level, c.x, c.z) } : { kind: 'unknown' };
            } else if (switchOn === 'angle') guard = { kind: 'angle', n: +key };
            else guard = { kind: 'unknown' };
            guardBrace = -1;
            body = caseLine[2]!;
        } else if (elseIf) {
            guard = { kind: 'unknown' };
            body = '';
        } else if (elseLine) {
            guard = lastIfWasCoord ? { kind: 'default' } : { kind: 'unknown' };
            body = '';
        } else if (line.startsWith('if') && line.includes('(')) {
            lastIfWasCoord = ifLine !== null && (ifLine[1] === 'loc_coord' || aliases.has(ifLine[1]!));
            if (lastIfWasCoord) {
                const c = parseCoordLiteral(ifLine![2]!);
                guard = c ? { kind: 'coord', packed: packCoord(c.level, c.x, c.z) } : { kind: 'unknown' };
            } else {
                guard = { kind: 'unknown' };
            }
            guardBrace = before;
            body = '';
        }

        if (body) {
            const outcome = parseStatement(body);
            if (outcome) record(outcome);
        }

        depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);

        if (switchOn !== null && depth <= switchBrace) {
            switchOn = null;
            guard = null;
            guardBrace = -1;
        } else if (guard !== null && guardBrace >= 0 && depth <= guardBrace) {
            guard = null;
            guardBrace = -1;
        }
    }
}

function scriptRules(contentRoot?: string): Map<string, ScriptRule> {
    const dir = join(
        contentRoot ?? CONTENT_ROOT,
        'scripts',
        'ladders+stairs',
        'scripts',
    );
    const rules = new Map<string, ScriptRule>();
    for (const file of ['ladders.rs2', 'stairs.rs2']) {
        parseScript(readFileSync(join(dir, file), 'utf-8'), rules);
    }
    return rules;
}

export type Destination =
    | { readonly kind: 'fixed'; readonly to: number }
    | { readonly kind: 'levelDelta'; readonly d: number }
    | { readonly kind: 'zDelta'; readonly d: number };

export interface PlacementLink {
    readonly loc: LocPlacement;
    readonly locName: string;
    readonly option: number;
    readonly dest: Destination;
}

export interface PlacementLinks {
    readonly links: readonly PlacementLink[];

    readonly candidates: number;

    readonly placementsResolved: number;

    readonly placementsSeen: number;
    readonly skipped: ReadonlyMap<string, number>;
}

function bump(counts: Map<string, number>, reason: string, n = 1): void {
    if (n > 0) counts.set(reason, (counts.get(reason) ?? 0) + n);
}

export function resolvePlacements(contentRoot?: string): PlacementLinks {
    const rules = scriptRules(contentRoot);
    const ids = locIdsByName(contentRoot);
    const defs = readLocDefs(contentRoot);
    const positions = locPositions(contentRoot);

    const links: PlacementLink[] = [];
    const skipped = new Map<string, number>();
    const resolved = new Set<number>();
    const seen = new Set<number>();
    let candidates = 0;

    for (const [key, rule] of rules) {
        const [locName, optionText] = key.split(':') as [string, string];
        const option = +optionText;
        const id = ids.get(locName);
        if (id === undefined) continue;
        if (!defs.has(locName)) continue;

        for (const loc of positions.get(id) ?? []) {
            const at = packCoord(loc.level, loc.x, loc.z);
            seen.add(at);
            candidates++;

            const outcome = rule.byLocCoord.get(at) ?? rule.byAngle.get(loc.angle) ?? rule.fallback;
            if (!outcome) {
                bump(skipped, SKIP_NO_RULE);
                continue;
            }
            if (!outcome.ok) {
                bump(skipped, outcome.reason);
                continue;
            }

            const l = outcome.landing;
            let dest: Destination;
            if (l.kind === 'fromLevel') {
                dest = { kind: 'levelDelta', d: l.d };
            } else if (l.kind === 'fromZ') {
                dest = { kind: 'zDelta', d: l.d };
            } else {
                const level = l.kind === 'abs' ? l.level : loc.level + l.dLevel;
                const x = l.kind === 'abs' ? l.x : loc.x + l.dx;
                const z = l.kind === 'abs' ? l.z : loc.z + l.dz;
                const to = idxOf(level, x, z);
                if (to < 0) {
                    bump(skipped, SKIP_DEST_OUTSIDE);
                    continue;
                }
                dest = { kind: 'fixed', to };
            }

            links.push({ loc, locName, option, dest });
            resolved.add(at);
        }
    }

    return {
        links,
        candidates,
        placementsResolved: resolved.size,
        placementsSeen: seen.size,
        skipped,
    };
}

export function resolveShortcutPlacements(contentRoot?: string): PlacementLinks {
    const ids = locIdsByName(contentRoot);
    const positions = locPositions(contentRoot);
    const skipped = new Map<string, number>();

    const links: PlacementLink[] = [];
    const resolved = new Set<number>();
    const seen = new Set<number>();
    let candidates = 0;

    function addLinks(locName: string, emitter: (loc: LocPlacement) => Destination[]): void {
        const id = ids.get(locName);
        if (id === undefined) return;
        for (const loc of positions.get(id) ?? []) {
            const at = packCoord(loc.level, loc.x, loc.z);
            seen.add(at);
            for (const dest of emitter(loc)) {
                candidates++;
                links.push({ loc, locName, option: 1, dest });
                resolved.add(at);
            }
        }
    }

    const fixed = (level: number, x: number, z: number): Destination | null => {
        const to = idxOf(level, x, z);
        return to >= 0 ? { kind: 'fixed' as const, to } : null;
    };

    addLinks('fullstyle', loc => {
        const eastWest = loc.angle === 0 || loc.angle === 2;
        const a = eastWest ? fixed(loc.level, loc.x, loc.z + 1) : fixed(loc.level, loc.x + 1, loc.z);
        const b = eastWest ? fixed(loc.level, loc.x, loc.z - 1) : fixed(loc.level, loc.x - 1, loc.z);
        return [a, b].filter((d): d is Destination => d !== null);
    });

    addLinks('watchshortcut', loc => {
        const d = fixed(loc.level, loc.x, loc.z + 3);
        return d !== null ? [d] : [];
    });

    addLinks('castlecrumbly', loc => {
        const d = fixed(loc.level, loc.x + 1, loc.z);
        return d !== null ? [d] : [];
    });

    return { links, candidates, placementsResolved: resolved.size, placementsSeen: seen.size, skipped };
}

function operable(loc: LocPlacement, def: LocDef | undefined, x: number, z: number): boolean {
    return rsmod.reached(
        loc.level, x, z,
        loc.x, loc.z,
        def?.width ?? 1, def?.length ?? 1,
        1,
        loc.angle, loc.shape,
        def?.forceapproach ?? 0,
    );
}

function standingTiles(loc: LocPlacement, width: number, length: number): { x: number; z: number }[] {
    const turned = loc.angle === 1 || loc.angle === 3;
    const w = turned ? length : width;
    const l = turned ? width : length;

    const out: { x: number; z: number }[] = [];
    for (let dx = 0; dx < w; dx++) {
        out.push({ x: loc.x + dx, z: loc.z - 1 });
        out.push({ x: loc.x + dx, z: loc.z + l });
    }
    for (let dz = 0; dz < l; dz++) {
        out.push({ x: loc.x - 1, z: loc.z + dz });
        out.push({ x: loc.x + w, z: loc.z + dz });
    }
    return out;
}

function landingOf(dest: Destination, at: number): number {
    if (dest.kind === 'fixed') return dest.to;
    const t = tileOf(at);
    if (dest.kind === 'levelDelta') return idxOf(t.level + dest.d, t.x, t.z);
    return idxOf(t.level, t.x, t.z + dest.d);
}

export function buildTransportTable(grid: StepGrid, costs?: TickCosts, contentRoot?: string): TransportTable {

    buildWorldCollision();

    const placements = resolvePlacements(contentRoot);
    const priced = costs ?? tickCosts(contentRoot);
    const defs = readLocDefs(contentRoot);
    const ids = locIdsByName(contentRoot);

    const edges: Transport[] = [];
    const from = new Map<number, number[]>();
    const skipped = new Map<string, number>(placements.skipped);

    for (const link of placements.links) {
        const extra = priced.byLoc.get(link.locName);
        if (extra === undefined) {
            bump(skipped, SKIP_UNPRICED);
            continue;
        }

        const def = defs.get(link.locName);
        const ticks = priced.opBase + extra;
        const locId = ids.get(link.locName)!;

        const standing: number[] = [];
        for (const t of standingTiles(link.loc, def?.width ?? 1, def?.length ?? 1)) {
            const idx = idxOf(link.loc.level, t.x, t.z);
            if (idx < 0 || grid.steps[idx] === 0) continue;
            if (!operable(link.loc, def, t.x, t.z)) {
                bump(skipped, DROP_NOT_OPERABLE);
                continue;
            }
            standing.push(idx);
        }
        if (standing.length === 0) {
            bump(skipped, SKIP_NO_STANDING);
            continue;
        }

        if (link.dest.kind === 'fixed' && grid.steps[link.dest.to] === 0) {
            bump(skipped, SKIP_DEST_BLOCKED);
            continue;
        }

        const usable: { at: number; to: number }[] = [];
        for (const at of standing) {
            const to = landingOf(link.dest, at);
            if (to >= 0 && grid.steps[to] !== 0) usable.push({ at, to });
        }
        if (usable.length === 0) {
            bump(skipped, SKIP_DEST_BLOCKED);
            continue;
        }
        bump(skipped, DROP_DEST_BLOCKED, standing.length - usable.length);

        for (const { at, to } of usable) {
            const edge = edges.length;
            edges.push({ from: at, to, locId, locName: link.locName, option: link.option, ticks });
            const list = from.get(at);
            if (list) list.push(edge);
            else from.set(at, [edge]);
        }
    }

    const shortcuts = resolveShortcutPlacements(contentRoot);
    for (const link of shortcuts.links) {
        const extra = priced.byLoc.get(link.locName);
        if (extra === undefined) {
            bump(skipped, SKIP_UNPRICED);
            continue;
        }

        const def = defs.get(link.locName);
        const ticks = priced.opBase + extra;
        const locId = ids.get(link.locName)!;

        const standing: number[] = [];
        for (const t of standingTiles(link.loc, def?.width ?? 1, def?.length ?? 1)) {
            const idx = idxOf(link.loc.level, t.x, t.z);
            if (idx < 0 || grid.steps[idx] === 0) continue;
            if (!operable(link.loc, def, t.x, t.z)) continue;
            standing.push(idx);
        }
        if (standing.length === 0) continue;

        if (link.dest.kind === 'fixed' && grid.steps[link.dest.to] === 0) continue;

        for (const at of standing) {
            const to = landingOf(link.dest, at);
            if (to < 0 || grid.steps[to] === 0) continue;
            const edge = edges.length;
            edges.push({ from: at, to, locId, locName: link.locName, option: link.option, ticks });
            const list = from.get(at);
            if (list) list.push(edge);
            else from.set(at, [edge]);
        }
    }

    return { edges, from, skipped };
}
