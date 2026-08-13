import { N, type DoorPlacement, type Transport } from './types';
import type { DoorStep, RouterGraph } from './RouterCore';

const MAGIC = 0x4e475248;
const VERSION = 1;

interface Wire {
    readonly version: number;
    readonly perStep: number;
    readonly unpricedDoorSteps: number;
    readonly doors: readonly DoorPlacement[];
    readonly doorOption: readonly number[];
    readonly doorTicks: readonly number[];
    readonly doorSteps: readonly (readonly number[])[];
    readonly transportEdges: readonly Transport[];
    readonly transportFrom: readonly (readonly number[])[];
    readonly ladderIds: readonly number[];
}

export function encodeGraph(graph: RouterGraph): Uint8Array {
    const doorSteps: number[][] = [];
    for (const [tile, steps] of graph.doorStepsFrom) {
        for (const s of steps) doorSteps.push([tile, s.dir, s.to, s.cost, ...s.doors]);
    }

    const transportFrom: number[][] = [];
    for (const [tile, edges] of graph.transportFrom) transportFrom.push([tile, ...edges]);

    const head: Wire = {
        version: VERSION,
        perStep: graph.perStep,
        unpricedDoorSteps: graph.unpricedDoorSteps,
        doors: graph.doors,
        doorOption: graph.doorOption,
        doorTicks: graph.doorTicks,
        doorSteps,
        transportEdges: graph.transportEdges,
        transportFrom,
        ladderIds: [...graph.ladderIds],
    };

    const headBytes = new TextEncoder().encode(JSON.stringify(head));
    const out = new Uint8Array(12 + headBytes.length + graph.steps.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, MAGIC, true);
    view.setUint32(4, VERSION, true);
    view.setUint32(8, headBytes.length, true);
    out.set(headBytes, 12);
    out.set(graph.steps, 12 + headBytes.length);
    return out;
}

export function decodeGraph(bytes: Uint8Array): RouterGraph {
    if (bytes.length < 12) throw new Error('nav/graphPack: too short to hold a header');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== MAGIC) throw new Error('nav/graphPack: not a graph pack');
    const version = view.getUint32(4, true);
    if (version !== VERSION) throw new Error(`nav/graphPack: version ${version}, expected ${VERSION}`);

    const headLength = view.getUint32(8, true);
    const head = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + headLength))) as Wire;

    const steps = bytes.subarray(12 + headLength);
    if (steps.length !== N) throw new Error(`nav/graphPack: step grid is ${steps.length} bytes, expected ${N}`);

    const doorStepsFrom = new Map<number, DoorStep[]>();
    for (const run of head.doorSteps) {
        const [tile, dir, to, cost, ...doors] = run as [number, number, number, number, ...number[]];
        const step: DoorStep = { dir, to, cost, doors };
        const list = doorStepsFrom.get(tile);
        if (list) list.push(step);
        else doorStepsFrom.set(tile, [step]);
    }

    const transportFrom = new Map<number, number[]>();
    for (const run of head.transportFrom) {
        const [tile, ...edges] = run as [number, ...number[]];
        transportFrom.set(tile, edges);
    }

    return {
        steps,
        perStep: head.perStep,
        doors: head.doors,
        doorOption: head.doorOption,
        doorTicks: head.doorTicks,
        doorStepsFrom,
        unpricedDoorSteps: head.unpricedDoorSteps,
        transportEdges: head.transportEdges,
        transportFrom,
        ladderIds: new Set(head.ladderIds),
    };
}
