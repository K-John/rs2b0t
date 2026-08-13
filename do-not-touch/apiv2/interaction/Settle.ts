import { ReadContext } from '../ReadApi.js';
import type { SnapshotSource } from '../snapshots/SnapshotSource.js';
import type { Interactions } from './Interactions.js';
import type { Outcome, SettleOptions } from './Outcome.js';
import type { SendResult } from './WireCommand.js';

const LIVE_TICK_MS = 600;

const BACKSTOP_MULTIPLIER = 4;

export class Settle {
    constructor(
        private readonly source: SnapshotSource,
        private readonly sleep: (ms: number) => Promise<void>,
        private readonly pollMs: number
    ) {}

    async perform(send: (api: Interactions) => SendResult, options: SettleOptions): Promise<Outcome> {
        const before = options.since ?? new ReadContext(this.source.read());
        const sent = send(this.interactions);
        if (!sent.sent) {
            return { kind: 'refused', reason: sent.reason, tick: sent.tick };
        }
        return this.watch(before, options);
    }

    async until(options: SettleOptions): Promise<Outcome> {
        const before = options.since ?? new ReadContext(this.source.read());
        return this.watch(before, options);
    }

    async ticks(count: number): Promise<void> {
        const start = this.source.read().tick;
        const deadline = Date.now() + count * LIVE_TICK_MS * BACKSTOP_MULTIPLIER;
        while (Date.now() < deadline) {
            const snapshot = this.source.read();
            if (!snapshot.attached || !snapshot.ingame) return;
            if (snapshot.tick - start >= count) return;
            await this.sleep(this.pollMs);
        }
    }

    interactions!: Interactions;

    private async watch(before: ReadContext, options: SettleOptions): Promise<Outcome> {
        const startTick = before.tick();
        const wallDeadline = Date.now() + (options.budgetMs ?? options.budgetTicks * LIVE_TICK_MS * BACKSTOP_MULTIPLIER);

        for (;;) {
            const now = new ReadContext(this.source.read());

            for (const [arm, evidence] of Object.entries(options.arms)) {
                if (evidence(now, before)) {
                    return { kind: 'matched', arm, now, before, tick: now.tick() };
                }
            }

            if (!now.attached() || !now.ingame()) {
                return { kind: 'expired', now, before, tick: now.tick() };
            }

            if (now.tick() - startTick >= options.budgetTicks || Date.now() >= wallDeadline) {
                return { kind: 'expired', now, before, tick: now.tick() };
            }

            await this.sleep(this.pollMs);
        }
    }
}
