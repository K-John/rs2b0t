#!/usr/bin/env bun

import { routerReport } from './router';
import { idxOf, tileStr, type RouteLeg } from './types';

const USAGE = 'usage: bun apiv2/nav/cli.ts <fromX> <fromZ> <fromLevel> <toX> <toZ> <toLevel>';

function main(argv: readonly string[]): number {
    if (argv.length !== 6) {
        console.error(USAGE);
        return 1;
    }

    const n = argv.map(arg => Number(arg));
    if (n.some(v => !Number.isInteger(v))) {
        console.error(`${USAGE}\nall six arguments must be whole numbers`);
        return 1;
    }

    const [fromX, fromZ, fromLevel, toX, toZ, toLevel] = n as [number, number, number, number, number, number];
    const from = idxOf(fromLevel, fromX, fromZ);
    const to = idxOf(toLevel, toX, toZ);
    if (from < 0) {
        console.error(`(${fromX},${fromZ},L${fromLevel}) is outside the world box`);
        return 1;
    }
    if (to < 0) {
        console.error(`(${toX},${toZ},L${toLevel}) is outside the world box`);
        return 1;
    }

    const report = routerReport();
    console.log(
        `graph: ${report.ms.toFixed(0)}ms  (grid ${report.gridMs.toFixed(0)}, doors ${report.doorMs.toFixed(0)},` +
            ` transports ${report.transportMs.toFixed(0)}, arrays ${report.arrayMs.toFixed(0)})`,
    );
    console.log(`       ${report.doorSteps} door steps, ${report.transportEdges} transports, ${report.doorStepsUnpriced} door steps unpriced and left shut`);
    console.log();

    const route = report.router.route(from, to);
    console.log(`${tileStr(from)} -> ${tileStr(to)}`);
    console.log();

    if (!route.ok) {

        console.log(`  ${route.reason}`);
        console.log();
        console.log(`  ${route.expanded.toLocaleString()} tiles expanded in ${route.ms.toFixed(2)}ms`);
        return 2;
    }

    const width = String(route.legs.length).length;
    route.legs.forEach((leg, at) => {
        console.log(`  ${String(at + 1).padStart(width)}  ${describe(leg)}`);
    });
    if (route.legs.length === 0) console.log('  already there');

    console.log();
    console.log(`  ${route.ticks} ticks, ${route.tiles} tiles, ${route.legs.length} legs`);
    console.log(`  ${route.expanded.toLocaleString()} tiles expanded in ${route.ms.toFixed(2)}ms`);
    return 0;
}

function describe(leg: RouteLeg): string {
    const head = `${leg.kind.padEnd(6)} ${tileStr(leg.from).padEnd(17)} -> ${tileStr(leg.to).padEnd(17)}`;
    const cost = `${String(leg.tiles).padStart(4)} tiles ${String(leg.ticks).padStart(4)} ticks`;
    if (leg.locId === undefined) return `${head} ${cost}`;
    return `${head} ${cost}  ${leg.locName} (loc ${leg.locId}) option ${leg.option}`;
}

process.exit(main(process.argv.slice(2)));
