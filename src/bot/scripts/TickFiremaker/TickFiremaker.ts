import { reader, type WorldTile } from '../../adapter/ClientAdapter.js';
import { depositAllExcept } from '../../api/bank/Banking.js';
import { LoopingBot, type LoopCadence } from '../../api/bot/Bot.js';
import { Game } from '../../api/game/Game.js';
import { Bank } from '../../api/bank/Bank.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { GameMessages } from '../../api/chatbox/gameMessages.js';
import { CANT_LIGHT } from '../../api/firemaking/Firemaking.js';
import { Paint } from '../../paint/Paint.js';
import { Skills } from '../../api/skills/Skills.js';
import { Locs } from '../../api/locs/Locs.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Execution } from '../../api/execution/Execution.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import Tile from '../../geometry/Tile.js';
import { Traversal } from '../../api/walking/Traversal.js';

export interface FiremakingSpot {
    name: string;
    bankTile: Tile;
    laneStarts: Tile[];
    minX: number;
}

export const FIREMAKING_SPOTS: Record<string, FiremakingSpot> = {
    'Varrock West': {
        name: 'Varrock West',
        bankTile: new Tile(3185, 3436, 0),
        laneStarts: [
            new Tile(3209, 3430, 0),
            new Tile(3209, 3429, 0),
            new Tile(3209, 3428, 0)
        ],
        minX: 3168
    },
    'Varrock East': {
        name: 'Varrock East',
        bankTile: new Tile(3253, 3420, 0),
        laneStarts: [
            new Tile(3284, 3430, 0),
            new Tile(3284, 3429, 0),
            new Tile(3284, 3428, 0)
        ],
        minX: 3232
    }
};

export const LOG_REQUIREMENTS: Record<string, number> = {
    Logs: 1,
    'Oak logs': 15,
    'Willow logs': 30,
    'Maple logs': 45,
    'Yew logs': 60,
    'Magic logs': 75
};

export const TICK_FIREMAKER_SETTINGS: SettingsSchema = {
    location: {
        type: 'string',
        default: 'Varrock West',
        options: Object.keys(FIREMAKING_SPOTS),
        label: 'Location',
        help: 'Select the firemaking spot to train at'
    },
    logType: {
        type: 'string',
        default: 'Logs',
        options: Object.keys(LOG_REQUIREMENTS),
        label: 'Log type',
        help: 'The log type to withdraw and burn'
    }
};

enum BotState {
    BANKING = 'Banking',
    WALKING_TO_LANE = 'Walking to lane',
    BURNING = 'Burning'
}

export default class TickFiremaker extends LoopingBot {
    override loopCadence: LoopCadence = { kind: 'server-tick', ticks: 1 };

    private spot: FiremakingSpot = FIREMAKING_SPOTS['Varrock West']!;
    private logName = 'Logs';
    private state: BotState = BotState.BANKING;

    private lastFmXp = 0;
    private lightStartTick = 0;
    private isLighting = false;
    private messageMark = 0;
    private activeLaneStart: Tile | null = null;

    private firesLit = 0;
    private trips = 0;
    private startXp = 0;
    private startedAt = Date.now();

    override onStart(): void {
        const spotName = this.settings.str('location', 'Varrock West');
        this.spot = FIREMAKING_SPOTS[spotName] ?? FIREMAKING_SPOTS['Varrock West']!;
        this.logName = this.settings.str('logType', 'Logs');

        this.startXp = Skills.xp('firemaking');
        this.lastFmXp = this.startXp;
        this.messageMark = GameMessages.mark();
        this.startedAt = Date.now();

        this.log(`TickFiremaker started at ${this.spot.name} using ${this.logName}`);
    }

    async loop(): Promise<void> {
        const currentTick = Game.tick();
        const here = Game.tile();
        if (!here) return;

        switch (this.state) {
            case BotState.BANKING:
                await this.handleBanking(here);
                break;

            case BotState.WALKING_TO_LANE:
                await this.handleWalkingToLane(here);
                break;

            case BotState.BURNING:
                await this.handleBurning(here, currentTick);
                break;
        }
    }

    private async handleBanking(here: WorldTile): Promise<void> {
        if (Inventory.count(this.logName) > 0 && Inventory.contains('Tinderbox')) {
            this.state = BotState.WALKING_TO_LANE;
            return;
        }

        const distToBank = Math.max(
            Math.abs(here.x - this.spot.bankTile.x),
            Math.abs(here.z - this.spot.bankTile.z)
        );

        if (distToBank > 3) {
            await Traversal.walkTo(this.spot.bankTile, { radius: 2 });
            return;
        }

        if (!Bank.isOpen()) {
            const opened = await this.openBankFast();
            if (!opened) {
                this.log('Could not open bank booth — retrying.');
                return;
            }
        }

        await Bank.depositAllMatching(depositAllExcept(['Tinderbox']));

        if (!Inventory.contains('Tinderbox')) {
            if (Bank.count('Tinderbox') === 0) {
                this.log('Out of Tinderboxes in bank! Stopping.');
                return;
            }
            await Bank.withdraw('Tinderbox', 'Withdraw-1');
            return;
        }

        if (Bank.count(this.logName) === 0) {
            this.log(`Out of ${this.logName} in bank! Stopping.`);
            return;
        }

        const freeSlots = Inventory.free();
        if (freeSlots > 0) {
            await Bank.withdrawX(this.logName, freeSlots);
        }
        await Bank.close();

        this.trips++;
        this.isLighting = false;
        this.lastFmXp = Skills.xp('firemaking');
        this.messageMark = GameMessages.mark();
        this.state = BotState.WALKING_TO_LANE;
    }

    private async handleWalkingToLane(here: WorldTile): Promise<void> {
        const currentLogs = Inventory.count(this.logName);
        if (currentLogs === 0) {
            this.state = BotState.BANKING;
            return;
        }

        const bestLane = this.findBestLaneStart(currentLogs);
        if (!bestLane) {
            this.log('All lanes currently blocked with fires. Waiting for fires to burn out...');
            return;
        }

        this.activeLaneStart = bestLane;

        // Walk directly to lane start tile if not standing on it
        if (here.x !== bestLane.x || here.z !== bestLane.z) {
            await Traversal.walkTo(bestLane, { radius: 0 });
            return;
        }

        // Arrived at start tile — begin burning!
        this.state = BotState.BURNING;
        this.lastFmXp = Skills.xp('firemaking');
        this.lightStartTick = Game.tick();
        this.isLighting = true;
        this.messageMark = GameMessages.mark();
        await this.dispatchLightAction();
    }

    private async handleBurning(here: WorldTile, currentTick: number): Promise<void> {
        const currentLogs = Inventory.count(this.logName);
        const currentXp = Skills.xp('firemaking');

        // 1. If 0 logs left -> Transition to Bank
        if (currentLogs === 0) {
            this.isLighting = false;
            this.state = BotState.BANKING;
            return;
        }

        // 2. Check if blocked message received from server
        if (GameMessages.sawSince(this.messageMark, CANT_LIGHT)) {
            this.log(`Cannot light fire at ${here.x},${here.z} (blocked message). Finding next lane.`);
            this.isLighting = false;
            this.state = BotState.WALKING_TO_LANE;
            return;
        }

        // 3. SUCCESS (Fire lit! XP gained)
        const fireCompleted = currentXp > this.lastFmXp;
        if (fireCompleted) {
            this.firesLit++;
            this.lastFmXp = currentXp;
            this.isLighting = false;

            const occupied = this.occupied();
            // The player has just stepped 1 tile West to `here`.
            // Check if there are remaining logs and if this new tile is clear to light immediately!
            if (currentLogs > 0 && this.isTileClear(here, occupied)) {
                // INSTANT 0-TICK CHAIN DISPATCH
                await this.dispatchLightAction();
                this.isLighting = true;
                this.lightStartTick = currentTick;
                this.messageMark = GameMessages.mark();
                return;
            } else {
                // Lane completed, blocked by an obstacle/fire, or out of logs
                this.state = currentLogs > 0 ? BotState.WALKING_TO_LANE : BotState.BANKING;
                return;
            }
        }

        // 4. Actively in progress: player is animating or in active lighting window
        const elapsedTicks = currentTick - this.lightStartTick;
        if (Game.animating() || (this.isLighting && elapsedTicks < 30)) {
            // Player is actively striking tinderbox - yield to next tick
            return;
        }

        // 5. Stalled / Idle recovery (no animation and >= 30 ticks passed)
        const occupied = this.occupied();
        if (!this.isTileClear(here, occupied)) {
            this.isLighting = false;
            this.state = BotState.WALKING_TO_LANE;
            return;
        }

        // Re-dispatch lighting attempt
        this.log(`Attempt timed out at ${here.x},${here.z}. Retrying light.`);
        await this.dispatchLightAction();
        this.isLighting = true;
        this.lightStartTick = currentTick;
        this.messageMark = GameMessages.mark();
    }

    private async dispatchLightAction(): Promise<boolean> {
        const tinder = Inventory.first('Tinderbox');
        const logs = Inventory.first(this.logName);
        if (!tinder || !logs) return false;

        return tinder.useOn(logs);
    }

    private occupied(): Set<string> {
        return new Set(reader.locs().map(l => `${l.tile.x},${l.tile.z}`));
    }

    private isTileClear(tile: WorldTile, occupied: Set<string>): boolean {
        if (tile.x < this.spot.minX) return false;
        if (occupied.has(`${tile.x},${tile.z}`)) return false;
        return true;
    }

    private findBestLaneStart(logsCount: number): Tile | null {
        const occupied = this.occupied();
        let bestStart: Tile | null = null;
        let bestRun = 0;

        for (const start of this.spot.laneStarts) {
            // If the start tile itself has a fire, we cannot start at this lane
            if (!this.isTileClear(start, occupied)) {
                continue;
            }

            // Count how many consecutive clear tiles run West from this start tile
            let run = 0;
            for (let x = start.x; x >= this.spot.minX; x--) {
                const checkTile = { x, z: start.z, level: start.level };
                if (this.isTileClear(checkTile, occupied)) {
                    run++;
                } else {
                    break;
                }
            }

            // If this lane fits our entire remaining load, choose it immediately
            if (run >= logsCount) {
                return start;
            }

            // Otherwise keep track of the lane with the longest clear run
            if (run > bestRun) {
                bestRun = run;
                bestStart = start;
            }
        }

        return bestStart;
    }

    private async openBankFast(): Promise<boolean> {
        if (Bank.isOpen()) {
            return true;
        }

        const booth = Locs.query().name('Bank booth').where(l => l.actions().length > 0).nearest();
        if (!booth) {
            return Bank.openNearest('Bank booth', 'Use-quickly');
        }

        if (booth.distance() > 1) {
            await Traversal.walkTo(booth.tile(), { radius: 1, timeoutMs: 5000 });
        }

        const op = booth.actions().find(a => /use-quickly|^bank/i.test(a)) ?? booth.actions()[0] ?? 'Bank';
        await booth.interact(op);

        const opened = await Execution.delayUntilTicks(() => Bank.isOpen() || ChatDialog.canContinue(), 5);
        if (opened) {
            if (ChatDialog.canContinue()) {
                await ChatDialog.continue();
                await Execution.delayUntilTicks(() => Bank.isOpen(), 3);
            }
            return Bank.isOpen();
        }

        return Bank.openNearest('Bank booth', 'Use-quickly');
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#ff9900' });
        const mins = (Date.now() - this.startedAt) / 60_000;
        const xp = Skills.xp('firemaking') - this.startXp;
        const perHour = mins > 0.5 ? Math.round((this.firesLit / mins) * 60) : 0;
        const xpPerHour = mins > 0.5 ? Math.round((xp / mins) * 60) : 0;

        p.title(`TickFiremaker — ${this.state} (${this.spot.name})`);
        p.row(`Runtime: ${fmtDuration(mins)}`, `Fires: ${this.firesLit} (${perHour}/hr)`, `Trips: ${this.trips}`);
        p.row(`FM XP: +${xp.toLocaleString()}`, `XP/hr: ${xpPerHour.toLocaleString()}`, `Pack: ${Inventory.count(this.logName)}`);
        p.row(`Log: ${this.logName}`);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}
