import {
    DIRS,
    LEVELS,
    N,
    PLANE,
    XSPAN,
    X0,
    X1,
    Z0,
    Z1,
    idxOf,
    tileOf,
    tileStr,
    type DoorPlacement,
    type RouteLeg,
    type RouteResult,
    type StepGrid,
    type Transport,
} from './types';

const INF = 0xffff;

const DELTA = Int32Array.from(DIRS.map(d => d.delta));

export interface DoorStep {
    readonly dir: number;
    readonly to: number;
    readonly cost: number;
    readonly doors: readonly number[];
}

export const HALVES = 2;

export interface RouterGraph {
    readonly steps: Uint8Array;
    readonly perStep: number;
    readonly doors: readonly DoorPlacement[];
    readonly doorOption: readonly number[];
    readonly doorTicks: readonly number[];
    readonly doorStepsFrom: ReadonlyMap<number, readonly DoorStep[]>;
    readonly unpricedDoorSteps: number;
    readonly transportEdges: readonly Transport[];
    readonly transportFrom: ReadonlyMap<number, readonly number[]>;
    readonly ladderIds: ReadonlySet<number>;
}

export class Router {
    private readonly steps: Uint8Array;

    private readonly doors: readonly DoorPlacement[];
    private readonly doorOption: readonly number[];
    private readonly doorTicks: readonly number[];

    private readonly doorBits: Uint8Array;
    private readonly doorStepsFrom: ReadonlyMap<number, readonly DoorStep[]>;
    private readonly transportBits: Uint8Array;
    private readonly transportFrom: ReadonlyMap<number, readonly number[]>;
    private readonly transportEdges: readonly Transport[];

    private readonly ladderIds: ReadonlySet<number>;

    readonly maxEdgeCost: number;
    readonly unpricedDoorSteps: number;
    readonly transportEdgeCount: number;
    readonly arrayMs: number;

    private readonly width: number;
    private readonly buckets: Int32Array[];
    private readonly counts: Int32Array;

    private readonly dist: Uint16Array;
    private readonly via: Uint16Array;

    private touched: Int32Array;
    private touchedCount = 0;

    private readonly perStep: number;

    constructor(graph: RouterGraph) {
        this.steps = graph.steps;
        this.perStep = graph.perStep;
        this.doors = graph.doors;
        this.doorOption = graph.doorOption;
        this.doorTicks = graph.doorTicks;
        this.doorStepsFrom = graph.doorStepsFrom;
        this.unpricedDoorSteps = graph.unpricedDoorSteps;
        this.transportEdges = graph.transportEdges;
        this.transportEdgeCount = graph.transportEdges.length;
        this.transportFrom = graph.transportFrom;
        this.ladderIds = graph.ladderIds;

        this.doorBits = new Uint8Array((N + 7) >> 3);
        for (const i of graph.doorStepsFrom.keys()) this.doorBits[i >> 3]! |= 1 << (i & 7);
        this.transportBits = new Uint8Array((N + 7) >> 3);
        for (const i of graph.transportFrom.keys()) this.transportBits[i >> 3]! |= 1 << (i & 7);

        if (this.transportEdges.length + 8 > 0x10000) {
            throw new Error(`nav/router: ${this.transportEdges.length} transports do not fit the via encoding`);
        }

        let longest = 1;
        for (const steps of graph.doorStepsFrom.values()) {
            for (const step of steps) longest = Math.max(longest, step.cost);
        }
        for (const edge of this.transportEdges) longest = Math.max(longest, edge.ticks * HALVES);
        this.maxEdgeCost = longest;

        this.width = longest + 1;
        this.buckets = Array.from({ length: this.width }, () => new Int32Array(1024));
        this.counts = new Int32Array(this.width);

        const arrayStarted = performance.now();
        this.dist = new Uint16Array(N).fill(INF);
        this.via = new Uint16Array(N);
        this.touched = new Int32Array(1 << 16);
        this.arrayMs = performance.now() - arrayStarted;
    }

    private walkTicks(tiles: number): number {
        return Math.ceil(tiles * this.perStep);
    }

    doorStepCount(): number {
        let n = 0;
        for (const steps of this.doorStepsFrom.values()) n += steps.length;
        return n;
    }

    route(from: number, to: number): RouteResult {
        const started = performance.now();

        if (from < 0 || from >= N) return this.failed(`start ${from} is outside the world box`, null, 0, 0, started);
        if (to < 0 || to >= N) return this.failed(`goal ${to} is outside the world box`, null, 0, 0, started);
        if (from === to) return { ok: true, legs: [], ticks: 0, tiles: 0, expanded: 0, ms: performance.now() - started };

        this.reset();
        this.dist[from] = 0;
        this.remember(from);
        this.push(0, from);

        let queued = 1;
        let expanded = 0;
        let d = 0;
        let found = false;

        while (queued > 0 && !found) {
            let scanned = 0;
            while (this.counts[d % this.width] === 0) {
                d++;
                if (++scanned > this.width) throw new Error('nav/router: the queue says it holds tiles and every bucket is empty');
            }

            const b = d % this.width;

            const bucket = this.buckets[b]!;
            while (this.counts[b]! > 0) {
                const n = this.counts[b]! - 1;
                this.counts[b] = n;
                queued--;

                const i = bucket[n]!;
                if (this.dist[i] !== d) continue;
                expanded++;

                if (i === to) {
                    found = true;
                    break;
                }

                queued += this.expand(i, d);
            }
            d++;
        }

        if (!found) {
            const near = this.closestReached(to);
            const where =
                near === null
                    ? `nothing on level ${tileOf(to).level} was reached, and the search started at ${tileStr(from)}`
                    : `nearest reached ${tileStr(near.tile)}, ${near.tiles} tiles away`;
            return this.failed(
                `no route to ${tileStr(to)}: ${where}`,
                near === null ? from : near.tile,
                near === null ? chebyshev(from, to) : near.tiles,
                expanded,
                started,
            );
        }

        return this.build(from, to, expanded, started);
    }

    routeBetween(
        from: { level: number; x: number; z: number },
        to: { level: number; x: number; z: number },
    ): RouteResult {
        return this.route(idxOf(from.level, from.x, from.z), idxOf(to.level, to.x, to.z));
    }

    private expand(i: number, d: number): number {
        let queued = 0;
        const dist = this.dist;
        const via = this.via;

        const mask = this.steps[i]!;
        if (mask !== 0) {
            const nd = d + 1;
            for (let k = 0; k < 8; k++) {
                if ((mask & (1 << k)) === 0) continue;
                const j = i + DELTA[k]!;
                const was = dist[j]!;
                if (nd >= was) continue;
                if (was === INF) this.remember(j);
                dist[j] = nd;
                via[j] = k;
                this.push(nd, j);
                queued++;
            }
        }

        if ((this.doorBits[i >> 3]! & (1 << (i & 7))) !== 0) {
            for (const step of this.doorStepsFrom.get(i)!) {
                const nd = d + step.cost;
                if (nd >= this.dist[step.to]!) continue;
                if (this.dist[step.to] === INF) this.remember(step.to);
                this.dist[step.to] = nd;
                this.via[step.to] = step.dir;
                this.push(nd, step.to);
                queued++;
            }
        }

        if ((this.transportBits[i >> 3]! & (1 << (i & 7))) !== 0) {
            for (const e of this.transportFrom.get(i)!) {
                const edge = this.transportEdges[e]!;
                const nd = d + edge.ticks * HALVES;
                if (nd >= this.dist[edge.to]!) continue;
                if (this.dist[edge.to] === INF) this.remember(edge.to);
                this.dist[edge.to] = nd;
                this.via[edge.to] = 8 + e;
                this.push(nd, edge.to);
                queued++;
            }
        }

        return queued;
    }

    private push(d: number, i: number): void {
        if (d >= INF) throw new Error(`nav/router: distance ${d} half ticks does not fit the queue's ceiling of ${INF - 1}`);
        if (i < 0 || i >= N) throw new Error(`nav/router: queued tile ${i}, outside [0, ${N})`);

        const b = d % this.width;
        let bucket = this.buckets[b]!;
        const n = this.counts[b]!;
        if (n >= bucket.length) {
            const bigger = new Int32Array(bucket.length * 2);
            bigger.set(bucket);
            this.buckets[b] = bigger;
            bucket = bigger;
            if (n >= bucket.length) throw new Error(`nav/router: bucket ${b} would not grow past ${bucket.length}`);
        }
        bucket[n] = i;
        this.counts[b] = n + 1;
    }

    private remember(i: number): void {
        if (this.touchedCount >= this.touched.length) {
            const bigger = new Int32Array(this.touched.length * 2);
            bigger.set(this.touched);
            this.touched = bigger;
            if (this.touchedCount >= this.touched.length) throw new Error('nav/router: the touched list would not grow');
        }
        this.touched[this.touchedCount++] = i;
    }

    private closestReached(to: number): { tile: number; tiles: number } | null {
        const goal = tileOf(to);
        const lo = goal.level * PLANE;
        const hi = lo + PLANE;

        let tile = -1;
        let best = Infinity;
        for (let n = 0; n < this.touchedCount; n++) {
            const i = this.touched[n]!;
            if (i < lo || i >= hi) continue;
            const rem = i - lo;
            const z = (rem / XSPAN) | 0;
            const tiles = Math.max(Math.abs(rem - z * XSPAN + X0 - goal.x), Math.abs(z + Z0 - goal.z));
            if (tiles >= best) continue;
            best = tiles;
            tile = i;
        }

        return tile < 0 ? null : { tile, tiles: best };
    }

    private reset(): void {
        for (let n = 0; n < this.touchedCount; n++) this.dist[this.touched[n]!] = INF;
        this.touchedCount = 0;
        this.counts.fill(0);
    }

    private build(from: number, to: number, expanded: number, started: number): RouteResult {
        const back: RouteLeg[] = [];
        let cur = to;
        let guard = 0;

        let walkTo = -1;
        let walkPath: number[] = [];
        const flush = (at: number): void => {
            if (walkPath.length === 0) return;

            const path = walkPath.slice().reverse();
            back.push({ kind: 'walk', from: at, to: walkTo, ticks: this.walkTicks(path.length), tiles: path.length, path });
            walkPath = [];
        };

        while (cur !== from) {
            if (++guard > N) throw new Error('nav/router: the predecessor chain does not reach the start');

            const v = this.via[cur]!;
            if (v >= 8) {
                flush(cur);
                const edge = this.transportEdges[v - 8]!;
                back.push({
                    kind: this.ladderIds.has(edge.locId) ? 'ladder' : 'stairs',
                    from: edge.from,
                    to: cur,
                    ticks: edge.ticks,
                    tiles: 0,
                    at: edge.from,
                    locId: edge.locId,
                    locName: edge.locName,
                    option: edge.option,
                });
                cur = edge.from;
                continue;
            }

            const prev = cur - DELTA[v]!;
            if ((this.steps[prev]! & (1 << v)) !== 0) {
                if (walkPath.length === 0) walkTo = cur;
                walkPath.push(cur);
                cur = prev;
                continue;
            }

            flush(cur);
            const step = this.doorStepsFrom.get(prev)!.find(s => s.dir === v)!;
            for (let n = step.doors.length - 1; n >= 0; n--) {
                const di = step.doors[n]!;
                const last = n === step.doors.length - 1;
                back.push({
                    kind: 'door',
                    from: prev,

                    to: last ? cur : prev,
                    ticks: this.doorTicks[di]! + (last ? this.walkTicks(1) : 0),
                    tiles: last ? 1 : 0,
                    at: idxOf(this.doors[di]!.level, this.doors[di]!.x, this.doors[di]!.z),
                    locId: this.doors[di]!.locId,
                    locName: this.doors[di]!.locName,
                    option: this.doorOption[di]!,
                });
            }
            cur = prev;
        }
        flush(from);

        const legs = back.reverse();
        let ticks = 0;
        let tiles = 0;
        for (const leg of legs) {
            ticks += leg.ticks;
            tiles += leg.tiles;
        }

        return { ok: true, legs, ticks, tiles, expanded, ms: performance.now() - started };
    }

    private failed(reason: string, closest: number | null, closestDistance: number, expanded: number, started: number): RouteResult {
        return { ok: false, reason, closest, closestDistance, expanded, ms: performance.now() - started };
    }
}

export function assertStepsStayInTheBox(grid: StepGrid): void {
    const outward = (level: number, x: number, z: number): void => {
        const mask = grid.steps[idxOf(level, x, z)]!;
        for (const dir of DIRS) {
            if (!(mask & dir.bit)) continue;
            const nx = x + dir.dx;
            const nz = z + dir.dz;
            if (nx < X0 || nx >= X1 || nz < Z0 || nz >= Z1) {
                throw new Error(`nav/router: (${x},${z},L${level}) steps ${dir.name} out of the box in types.ts`);
            }
        }
    };

    for (let level = 0; level < LEVELS; level++) {
        for (let z = Z0; z < Z1; z++) {
            outward(level, X0, z);
            outward(level, X1 - 1, z);
        }
        for (let x = X0; x < X1; x++) {
            outward(level, x, Z0);
            outward(level, x, Z1 - 1);
        }
    }
}

function chebyshev(a: number, b: number): number {
    const p = tileOf(a);
    const q = tileOf(b);
    return Math.max(Math.abs(p.x - q.x), Math.abs(p.z - q.z));
}

