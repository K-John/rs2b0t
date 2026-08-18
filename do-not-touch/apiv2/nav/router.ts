import { locIdsByName, readLocDefs } from './content';
import { HALVES, Router, assertStepsStayInTheBox, type DoorStep, type RouterGraph } from './RouterCore';

import { tickCosts } from './costs';
import { buildDoorTable, findDoors, openDoors } from './doors';
import { rsmod, stepGrid } from './grid';
import { buildTransportTable } from './transports';
import {
    DIRS,
    N,
    edgeKey,
    idxOf,
    tileOf,
    tileStr,
    type DoorPlacement,
    type RouteResult,
    type StepGrid,
    type TickCosts,
} from './types';

export interface RouterReport {
    readonly router: Router;
    readonly ms: number;
    readonly gridMs: number;
    readonly doorMs: number;
    readonly transportMs: number;
    readonly arrayMs: number;
    readonly doorSteps: number;
    readonly doorStepsUnpriced: number;
    readonly transportEdges: number;
    readonly maxEdgeCost: number;
}

function buildDoorSteps(
    table: { doors: readonly DoorPlacement[]; blockedBy: ReadonlyMap<number, readonly number[]> },
    doorTicks: readonly number[],
    steps: Uint8Array,
): { from: Map<number, DoorStep[]>; unpriced: number } {
    const from = new Map<number, DoorStep[]>();
    let unpriced = 0;

    for (const [key, doors] of table.blockedBy) {
        const i = (key / 8) | 0;
        const dir = key % 8;
        if (edgeKey(i, dir) !== key) throw new Error(`nav/router: edge key ${key} does not unpack to ${i} and ${dir}`);

        if ((steps[i]! & (1 << dir)) !== 0) {
            throw new Error(`nav/router: ${tileStr(i)} ${DIRS[dir]!.name} is barred by a door and legal in the step grid`);
        }

        let ticks = 0;
        let priced = true;
        for (const di of doors) {
            if (doorTicks[di]! < 0) {
                priced = false;
                break;
            }
            ticks += doorTicks[di]!;
        }
        if (!priced) {
            unpriced++;
            continue;
        }

        const here = tileOf(i);
        const to = idxOf(here.level, here.x + DIRS[dir]!.dx, here.z + DIRS[dir]!.dz);
        if (to < 0) continue;

        const step: DoorStep = { dir, to, cost: 1 + ticks * HALVES, doors };
        const list = from.get(i);
        if (list) list.push(step);
        else from.set(i, [step]);
    }

    return { from, unpriced };
}

export function buildGraph(grid: StepGrid, costs: TickCosts): { graph: RouterGraph; doorMs: number; transportMs: number } {
    assertStepsStayInTheBox(grid);

    const doorStarted = performance.now();
    const census = findDoors();
    openDoors(census.doors);
    const table = buildDoorTable(census.doors);

    for (const door of census.doors) {
        rsmod.changeWall(door.x, door.z, door.level, door.angle, door.shape, door.blockrange, false, true);
    }

    const defs = readLocDefs();
    const doorOption: number[] = [];
    const doorTicks: number[] = [];
    for (const door of table.doors) {
        const ops = defs.get(door.locName)?.ops ?? [];
        const at = ops.findIndex(op => /^open$/i.test(op));
        if (at < 0) throw new Error(`nav/router: ${door.locName} is in the door table with no Open option`);
        doorOption.push(at + 1);

        const extra = costs.byLoc.get(door.locName);
        doorTicks.push(extra === undefined ? -1 : costs.opBase + extra);
    }

    const { from: doorStepsFrom, unpriced } = buildDoorSteps(table, doorTicks, grid.steps);
    const doorMs = performance.now() - doorStarted;

    const transportStarted = performance.now();
    const transports = buildTransportTable(grid, costs);
    const transportMs = performance.now() - transportStarted;

    const ladderIds = new Set<number>();
    for (const [name, id] of locIdsByName()) {
        if (/ladder/i.test(name)) ladderIds.add(id);
    }

    return {
        graph: {
            steps: grid.steps,
            perStep: costs.perStep,
            doors: table.doors,
            doorOption,
            doorTicks,
            doorStepsFrom,
            unpricedDoorSteps: unpriced,
            transportEdges: transports.edges,
            transportFrom: transports.from,
            ladderIds,
        },
        doorMs,
        transportMs,
    };
}

let memo: RouterReport | null = null;

export function routerReport(): RouterReport {
    if (memo) return memo;

    const started = performance.now();

    const gridStarted = performance.now();
    const grid = stepGrid();

    const gridMs = performance.now() - gridStarted;

    const costs = tickCosts();
    const built = buildGraph(grid, costs);
    const router = new Router(built.graph);

    memo = {
        router,
        ms: performance.now() - started,
        gridMs,
        doorMs: built.doorMs,
        transportMs: built.transportMs,
        arrayMs: router.arrayMs,
        doorSteps: router.doorStepCount(),
        doorStepsUnpriced: router.unpricedDoorSteps,
        transportEdges: router.transportEdgeCount,
        maxEdgeCost: router.maxEdgeCost,
    };
    return memo;
}

export function router(): Router {
    return routerReport().router;
}

export function findRoute(from: number, to: number): RouteResult {
    return router().route(from, to);
}

export { Router } from './RouterCore';
export type { RouterGraph, DoorStep } from './RouterCore';
