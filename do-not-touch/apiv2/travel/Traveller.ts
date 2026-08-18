import { tileOf } from '../nav/types.js';
import type { RouteLeg, RouteResult } from '../nav/types.js';
import { ReadContext } from '../ReadApi.js';
import type { LocSnapshot, WorldTile } from '../snapshots/GameSnapshot.js';
import type { SnapshotSource } from '../snapshots/SnapshotSource.js';
import { CANNOT_REACH, arrived, optionGone, said, sceneReady, serverRefused } from '../interaction/Evidence.js';
import type { Interactions } from '../interaction/Interactions.js';
import type { Settle } from '../interaction/Settle.js';

export interface TravelOptions {
    readonly closeEnough?: number;
    readonly budgetTicksPerHop?: number;
    readonly budgetMsPerHop?: number;
    readonly maxHops?: number;
    readonly onLeg?: (leg: RouteLeg, phase: 'start' | 'done' | 'failed', detail?: string) => void;
    readonly retriesPerHop?: number;
}

export type HopFailure =
    | 'expired'
    | 'dropped';

export type TravelOutcome =
    | { readonly kind: 'arrived'; readonly at: WorldTile }
    | { readonly kind: 'stalled'; readonly at: WorldTile; readonly aiming: WorldTile; readonly why: HopFailure; readonly tries: number }
    | { readonly kind: 'refused'; readonly at: WorldTile; readonly reason: string }
    | { readonly kind: 'blocked'; readonly at: WorldTile; readonly leg: RouteLeg; readonly detail: string }
    | { readonly kind: 'gave-up'; readonly at: WorldTile; readonly hops: number };

const toWorld = (index: number): WorldTile => {
    const { level, x, z } = tileOf(index);
    return { x, z, level };
};

export class Traveller {
    constructor(
        private readonly source: SnapshotSource,
        private readonly interactions: Interactions,
        private readonly settle: Settle
    ) {}

    private read(): ReadContext {
        return new ReadContext(this.source.read());
    }

    async follow(route: RouteResult, options: TravelOptions = {}): Promise<TravelOutcome> {
        if (!route.ok) {
            return { kind: 'refused', at: this.here(), reason: 'the planner found no route' };
        }

        const closeEnough = options.closeEnough ?? 2;

        const budgetTicksPerHop = options.budgetTicksPerHop ?? 60;
        const budgetMsPerHop = options.budgetMsPerHop;
        const maxHops = options.maxHops ?? 60;
        const retriesPerHop = options.retriesPerHop ?? 2;

        let hops = 0;
        for (const leg of route.legs) {
            options.onLeg?.(leg, 'start');
            const result = leg.kind === 'walk' ? await this.walkLeg(leg, { closeEnough, budgetTicksPerHop, budgetMsPerHop, maxHops, retriesPerHop }, () => ++hops) : await this.crossLeg(leg, budgetTicksPerHop, budgetMsPerHop);
            options.onLeg?.(leg, result === null ? 'done' : 'failed', result === null ? undefined : JSON.stringify(result));
            if (result !== null) return result;
            if (hops > maxHops) return { kind: 'gave-up', at: this.here(), hops };
        }

        return { kind: 'arrived', at: this.here() };
    }

    private here(): WorldTile {
        return this.read().snapshot.localPlayer?.tile ?? { x: 0, z: 0, level: 0 };
    }

    private async walkLeg(
        leg: RouteLeg,
        limits: Required<Pick<TravelOptions, 'closeEnough' | 'budgetTicksPerHop' | 'maxHops' | 'retriesPerHop'>> & Pick<TravelOptions, 'budgetMsPerHop'>,
        countHop: () => number
    ): Promise<TravelOutcome | null> {
        const path = leg.path;
        if (path === undefined || path.length === 0) {
            const goal = toWorld(leg.to);
            const outcome = await this.settle.perform(api => api.walk(goal), { arms: { there: arrived(goal, 1), unreachable: said(CANNOT_REACH) }, budgetTicks: limits.budgetTicksPerHop });
            return outcome.kind === 'matched' && outcome.arm === 'there' ? null : { kind: 'blocked', at: this.here(), leg, detail: 'the leg carries no path, so it could not be split into hops' };
        }

        let next = 0;
        let rebuilds = 0;
        let tries = 0;
        let reach = Number.POSITIVE_INFINITY;
        while (next < path.length) {
            if (countHop() > limits.maxHops) return { kind: 'gave-up', at: this.here(), hops: limits.maxHops };

            const aimIndex = this.furthestClickable(path, next, reach);
            if (aimIndex === null) {
                return { kind: 'blocked', at: this.here(), leg, detail: `no tile of the remaining ${path.length - next} is inside the loaded scene` };
            }

            const aim = toWorld(path[aimIndex]!);
            const before = this.read();
            const sent = this.interactions.walk(aim);
            if (!sent.sent) {

                const moved = sent.reason === 'scene-unavailable' || sent.reason === 'off-scene' || sent.reason === 'level-mismatch';
                if (moved && rebuilds < 12) {
                    rebuilds++;
                    await this.settle.until({ arms: { ready: sceneReady() }, budgetTicks: 30 });
                    continue;
                }

                if (sent.reason === 'unreachable') {
                    const span = aimIndex - next;
                    if (span > 1) {
                        reach = Math.max(1, span >> 1);
                        continue;
                    }
                    return { kind: 'blocked', at: this.here(), leg, detail: `the client will not walk even one tile to ${aim.x},${aim.z}` };
                }

                return { kind: 'refused', at: this.here(), reason: `${sent.reason} walking to ${aim.x},${aim.z}` };
            }

            const outcome = await this.settle.until({
                since: before,
                arms: { close: arrived(aim, limits.closeEnough), unreachable: said(CANNOT_REACH), dropped: serverRefused() },
                budgetTicks: limits.budgetTicksPerHop,
                budgetMs: limits.budgetMsPerHop
            });

            if (outcome.kind === 'matched' && outcome.arm === 'unreachable') {
                const span = aimIndex - next;
                if (span > 1) {
                    reach = Math.max(1, span >> 1);
                    continue;
                }
                return { kind: 'refused', at: this.here(), reason: `the game said it cannot reach ${aim.x},${aim.z}` };
            }

            if (!(outcome.kind === 'matched' && outcome.arm === 'close')) {

                if (tries++ < limits.retriesPerHop) continue;
                const why: HopFailure = outcome.kind === 'expired' ? 'expired' : 'dropped';
                return { kind: 'stalled', at: this.here(), aiming: aim, why, tries };
            }

            tries = 0;
            reach = Number.POSITIVE_INFINITY;
            next = aimIndex + 1;
        }
        return null;
    }

    private furthestClickable(path: readonly number[], from: number, reach = Number.POSITIVE_INFINITY): number | null {
        const scene = this.read().scene();
        let fallback: number | null = null;
        const ceiling = Math.min(path.length - 1, from + reach);
        for (let at = ceiling; at >= from; at--) {
            const tile = toWorld(path[at]!);
            if (!scene.contains(tile)) continue;
            if (scene.walkable(tile)) return at;
            if (fallback === null) fallback = at;
        }
        return fallback;
    }

    private async crossLeg(leg: RouteLeg, budgetTicks: number, budgetMs?: number): Promise<TravelOutcome | null> {
        const target = leg.at === undefined ? null : toWorld(leg.at);
        if (target === null || leg.locId === undefined) {
            return { kind: 'blocked', at: this.here(), leg, detail: 'the leg does not say what to click' };
        }

        const awaitScene = async (): Promise<void> => {
            if (!sceneReady()(this.read(), this.read())) {
                await this.settle.until({ arms: { ready: sceneReady() }, budgetTicks: 30 });
            }
        };
        await awaitScene();

        const stand = toWorld(leg.from);
        if (!arrived(stand, 2)(this.read(), this.read())) {
            const sent = this.interactions.walk(stand);
            if (sent.sent) {
                await this.settle.until({ arms: { close: arrived(stand, 2) }, budgetTicks, budgetMs });
            }
        }

        const findLoc = (): LocSnapshot | undefined =>
            this.read()
                .locs()
                .withId(leg.locId!)
                .results()
                .map(candidate => ({ candidate, gap: Math.max(Math.abs(candidate.tile.x - target.x), Math.abs(candidate.tile.z - target.z)) }))
                .filter(entry => entry.candidate.tile.level === target.level && entry.gap <= 3)
                .sort((a, b) => a.gap - b.gap)[0]?.candidate;

        await awaitScene();
        if (findLoc() === undefined) {
            await this.settle.until({ arms: { appeared: () => findLoc() !== undefined }, budgetTicks: 20 });
        }
        const loc = findLoc();
        const goal = toWorld(leg.to);

        if (loc === undefined) {
            if (leg.kind !== 'door') {
                return { kind: 'blocked', at: this.here(), leg, detail: `${leg.locName ?? leg.locId} is not within 3 tiles of ${target.x},${target.z} in the loaded scene` };
            }
            await awaitScene();
            const stepped = await this.settle.perform(api => api.walk(goal), { arms: { through: arrived(goal, 1) }, budgetTicks });
            if (stepped.kind === 'matched') return null;
            return { kind: 'blocked', at: this.here(), leg, detail: `${leg.locName ?? leg.locId} is gone and ${goal.x},${goal.z} is still not reachable` };
        }

        const option = leg.option ?? 1;
        const verb = loc.actions[option - 1] ?? 'Open';

        if (leg.kind === 'door' && !/^open$/i.test(verb.trim())) {
            const stepped = await this.settle.perform(api => api.walk(goal), { arms: { through: arrived(goal, 1) }, budgetTicks });
            if (stepped.kind === 'matched') return null;
            return { kind: 'blocked', at: this.here(), leg, detail: `${leg.locName ?? leg.locId} offers '${verb}', not 'Open', and ${goal.x},${goal.z} is not reachable` };
        }

        const through = leg.kind === 'door' ? optionGone(loc, verb) : arrived(goal, 1);
        const outcome = await this.settle.perform(api => api.interact(loc, option), {
            arms: { through, unreachable: said(CANNOT_REACH) },
            budgetTicks
        });

        if (outcome.kind === 'matched' && outcome.arm === 'through') return null;
        if (outcome.kind === 'refused') return { kind: 'refused', at: this.here(), reason: outcome.reason };
        return { kind: 'blocked', at: this.here(), leg, detail: `${leg.locName ?? leg.locId}: ended '${outcome.kind === 'matched' ? outcome.arm : outcome.kind}'` };
    }
}
