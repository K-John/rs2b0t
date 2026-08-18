import { LoopingBot } from '../../../src/bot/api/bot/Bot.js';
import { Paint } from '../../../src/bot/paint/Paint.js';
import { ScriptRunner } from '../../../src/bot/runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../../src/bot/runtime/Settings.js';
import { fmtDuration } from '../../../src/bot/paint/paintLogic.js';

import { LiveSnapshotSource } from '../../apiv2/snapshots/LiveSnapshotSource.js';
import { createInteractions } from '../../apiv2/interaction/createInteractions.js';
import { liveDriver } from '../../apiv2/interaction/LiveInteractionDriver.js';
import { Traveller } from '../../apiv2/travel/Traveller.js';
import { browserRouter } from '../../apiv2/nav/browserRouter.js';
import { idxOf } from '../../apiv2/nav/types.js';
import { DESTINATION_LABELS, destinationByLabel } from './destinations.js';

export const TRAVEL_SETTINGS: SettingsSchema = {
    destination: {
        type: 'string',
        default: DESTINATION_LABELS[0]!,
        options: [...DESTINATION_LABELS],
        label: 'Destination',
        help: 'every entry is proved routable by tools/nav/verify-destinations.ts'
    }
};

export default class TravelBot extends LoopingBot {
    override loopDelay = 600;

    private status = 'starting';
    private target = '';
    private legsDone = 0;
    private legsTotal = 0;
    private startedAt = 0;
    private running = false;

    override async onStart(): Promise<void> {
        this.startedAt = Date.now();
        this.running = true;

        const label = this.settings.str('destination', DESTINATION_LABELS[0]!);
        const destination = destinationByLabel(label);
        if (destination === null) {
            this.log(`unknown destination '${label}'`);
            this.status = 'unknown destination';
            this.running = false;
            return;
        }
        this.target = label;

        const source = new LiveSnapshotSource();
        const { interactions, settle } = createInteractions({ source, driver: liveDriver });
        const traveller = new Traveller(source, interactions, settle);

        this.status = 'loading route planner';
        let planner;
        try {
            planner = await browserRouter();
        } catch (error) {
            this.log(`the route planner did not load: ${error instanceof Error ? error.message : String(error)}`);
            this.status = 'no planner';
            this.running = false;
            return;
        }

        const here = source.read().localPlayer?.tile ?? null;
        if (here === null) {
            this.log('no world tile — not ingame yet');
            this.status = 'not ingame';
            this.running = false;
            return;
        }

        this.status = 'planning';
        const route = planner.route(
            idxOf(here.level, here.x, here.z),
            idxOf(destination.tile.level, destination.tile.x, destination.tile.z)
        );
        if (!route.ok) {
            this.log(`no route from ${here.x},${here.z} to ${label}`);
            this.status = 'no route';
            this.running = false;
            return;
        }

        this.legsTotal = route.legs.length;
        this.log(`travelling to ${label}: ${route.legs.length} legs, ${route.tiles} tiles`);
        this.status = `walking to ${label}`;

        const outcome = await traveller.follow(route, {
            onLeg: (leg, phase, detail) => {
                if (phase === 'done') {
                    this.legsDone++;
                    this.log(`leg ${this.legsDone}/${this.legsTotal} (${leg.kind}) done`);
                } else if (phase === 'failed') {
                    this.log(`leg ${this.legsDone + 1} (${leg.kind}) failed: ${detail ?? ''}`);
                }
            }
        });

        if (outcome.kind === 'arrived') {
            this.log(`arrived at ${label} (${outcome.at.x},${outcome.at.z})`);
            this.status = `arrived at ${label}`;
        } else {
            this.log(`travel ended: ${outcome.kind}`);
            this.status = `${outcome.kind}`;
        }
        this.running = false;
    }

    override onStop(): void {
        this.running = false;
    }

    async loop(): Promise<number | void> {
        if (!this.running) {
            ScriptRunner.stop('journey finished');
        }
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#66b0ff' });
        p.title(`Travel — ${this.status}`);

        const mins = (Date.now() - this.startedAt) / 60_000;
        p.row(`Runtime: ${fmtDuration(mins)}`, `To: ${this.target || '—'}`, `Legs: ${this.legsDone}/${this.legsTotal}`);

        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}
