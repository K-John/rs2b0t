import { LoopingBot, type LoopCadence } from '../../api/bot/Bot.js';
import { reader, actions, type WorldTile } from '../../adapter/ClientAdapter.js';
import { Game } from '../../api/game/Game.js';
import { Bank, withdrawOp } from '../../api/bank/Bank.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Locs } from '../../api/locs/Locs.js';
import { Skills } from '../../api/skills/Skills.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Execution } from '../../api/execution/Execution.js';
import { Paint } from '../../paint/Paint.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import Tile from '../../geometry/Tile.js';
import type { Loc } from '../../api/model/Loc.js';

export interface CookingSpot {
    name: string;
    bankTile: Tile;
    rangeTile: Tile;
    rangeLocNames: string[];
    isCatherbyDoor?: boolean;
}

export const COOKING_SPOTS: Record<string, CookingSpot> = {
    'Catherby (Range)': {
        name: 'Catherby (Range)',
        bankTile: new Tile(2809, 3441, 0),
        rangeTile: new Tile(2817, 3443, 0),
        rangeLocNames: ['Range', 'Cooking range', 'Stove'],
        isCatherbyDoor: true
    },
    'Al Kharid (Range)': {
        name: 'Al Kharid (Range)',
        bankTile: new Tile(3269, 3167, 0),
        rangeTile: new Tile(3273, 3180, 0),
        rangeLocNames: ['Range', 'Cooking range', 'Stove']
    },
    'Lumbridge Castle (Range)': {
        name: 'Lumbridge Castle (Range)',
        bankTile: new Tile(3208, 3220, 0), // Cellar chest
        rangeTile: new Tile(3211, 3215, 0), // Cook's range
        rangeLocNames: ['CooksQuestRange', 'Range', 'Cooking range', 'Stove']
    }
};

export const RAW_FOOD_OPTIONS = [
    'Auto-detect',
    'Raw lobster',
    'Raw swordfish',
    'Raw shark',
    'Raw salmon',
    'Raw trout',
    'Raw tuna',
    'Raw monkfish',
    'Raw karambwan',
    'Raw bass',
    'Raw anchovies',
    'Raw shrimps',
    'Raw pike',
    'Raw herring',
    'Raw sardine',
    'Raw meat',
    'Raw chicken',
    'Bread dough'
];

export const TICK_COOKER_SETTINGS: SettingsSchema = {
    location: {
        type: 'string',
        default: 'Catherby (Range)',
        options: Object.keys(COOKING_SPOTS),
        label: 'Location',
        help: 'Select the cooking spot (Catherby includes 1-tick anti-troll door bypass)'
    },
    rawFood: {
        type: 'string',
        default: 'Auto-detect',
        options: RAW_FOOD_OPTIONS,
        label: 'Raw food',
        help: 'Select the raw food to cook, or Auto-detect to find any raw food in your bank'
    }
};

enum BotState {
    BANKING = 'Banking',
    WALKING_TO_RANGE = 'Walking to Range',
    COOKING = 'Cooking',
    WALKING_TO_BANK = 'Walking to Bank'
}

export default class TickCooker extends LoopingBot {
    override loopCadence: LoopCadence = { kind: 'server-tick', ticks: 1 };

    private spot: CookingSpot = COOKING_SPOTS['Catherby (Range)']!;
    private configuredFood = 'Auto-detect';
    private activeRawName: string | null = null;

    private state: BotState = BotState.BANKING;

    private cookedCount = 0;
    private burntCount = 0;
    private trips = 0;

    private lastCookXp = 0;
    private lastBurntInPack = 0;
    private lastCookTick = 0;
    private emptyBankRetries = 0;
    private startCookXp = 0;
    private startedAt = Date.now();

    override onStart(): void {
        const spotName = this.settings.str('location', 'Catherby (Range)');
        this.spot = COOKING_SPOTS[spotName] ?? COOKING_SPOTS['Catherby (Range)']!;
        this.configuredFood = this.settings.str('rawFood', 'Auto-detect');
        this.activeRawName = this.configuredFood === 'Auto-detect' ? null : this.configuredFood;

        this.startCookXp = Skills.xp('cooking');
        this.lastCookXp = this.startCookXp;
        this.lastBurntInPack = this.countBurntInPack();
        this.emptyBankRetries = 0;
        this.startedAt = Date.now();

        this.log(`TickCooker started at ${this.spot.name}. Target Food: ${this.configuredFood}`);
    }

    async loop(): Promise<void> {
        const currentTick = Game.tick();
        const here = Game.tile();
        if (!here) return;

        switch (this.state) {
            case BotState.BANKING:
                await this.handleBanking(here);
                break;

            case BotState.WALKING_TO_RANGE:
                await this.handleWalkingToRange(here);
                break;

            case BotState.COOKING:
                await this.handleCooking(currentTick, here);
                break;

            case BotState.WALKING_TO_BANK:
                await this.handleWalkingToBank(here);
                break;
        }
    }

    // ------------------------------------------------------------------------
    // 1. Banking
    // ------------------------------------------------------------------------
    private async handleBanking(here: WorldTile): Promise<void> {
        const distToBank = Math.max(
            Math.abs(here.x - this.spot.bankTile.x),
            Math.abs(here.z - this.spot.bankTile.z)
        );

        if (distToBank > 5) {
            this.state = BotState.WALKING_TO_BANK;
            return;
        }

        if (!Bank.isOpen()) {
            const opened = await this.openBankFast();
            if (!opened) return;
        }

        // Ensure bank item array is populated
        if (!Bank.loaded() || !Bank.snapshotReady()) {
            await Execution.delayUntilTicks(() => Bank.loaded() && Bank.snapshotReady(), 3);
        }

        // Deposit all non-raw items (cooked food, burnt food, caskets, etc.)
        const hasFinishedItems = Inventory.items().some(i => i.name && !i.name.toLowerCase().startsWith('raw '));
        if (hasFinishedItems) {
            await Bank.depositAllMatching(name => !name.toLowerCase().startsWith('raw '));
        }

        // Resolve raw food to withdraw
        let targetRaw = this.activeRawName;
        if (!targetRaw || this.configuredFood === 'Auto-detect') {
            const rawInBank = Bank.items().find(i => {
                if (!i.name) return false;
                const n = i.name.toLowerCase();
                return n.startsWith('raw ') || n === 'bread dough';
            });
            if (rawInBank && rawInBank.name) {
                targetRaw = rawInBank.name;
                this.activeRawName = targetRaw;
            }
        }

        const rawInPack = this.countRawInPack();
        if (rawInPack === 0) {
            // If target raw food count reads 0, wait up to 3 ticks in case bank snapshot is refreshing
            if (!targetRaw || Bank.count(targetRaw) === 0) {
                await Execution.delayUntilTicks(() => {
                    if (targetRaw && Bank.count(targetRaw) > 0) return true;
                    return Bank.items().some(i => i.name && (i.name.toLowerCase().startsWith('raw ') || i.name.toLowerCase() === 'bread dough'));
                }, 3);

                if (!targetRaw || this.configuredFood === 'Auto-detect') {
                    const rawInBank = Bank.items().find(i => i.name && (i.name.toLowerCase().startsWith('raw ') || i.name.toLowerCase() === 'bread dough'));
                    if (rawInBank && rawInBank.name) {
                        targetRaw = rawInBank.name;
                        this.activeRawName = targetRaw;
                    }
                }
            }

            // Retry guard before stopping permanently
            if (!targetRaw || Bank.count(targetRaw) === 0) {
                if (this.emptyBankRetries < 3) {
                    this.emptyBankRetries++;
                    this.log(`Bank raw food scan read 0 — retrying (attempt ${this.emptyBankRetries}/3)...`);
                    await Execution.delayTicks(2);
                    return;
                }
                ScriptRunner.stop(`No raw food found in bank to cook!`);
                return;
            }

            this.emptyBankRetries = 0;
            const item = Bank.items().find(i => i.name && i.name.toLowerCase() === targetRaw!.toLowerCase());
            const allOp = item ? withdrawOp(item.ops, 'all') ?? 'Withdraw-All' : 'Withdraw-All';
            await Bank.withdraw(targetRaw, allOp);
            await Execution.delayUntilTicks(() => this.countRawInPack() > 0, 3);
        }

        await Bank.close();

        this.trips++;
        this.lastBurntInPack = 0;
        this.lastCookTick = 0;
        this.lastCookXp = Skills.xp('cooking');
        this.state = BotState.WALKING_TO_RANGE;
    }

    // ------------------------------------------------------------------------
    // 2. Walking To Range (with Anti-Troll Door Threshold Direct Step)
    // ------------------------------------------------------------------------
    private async handleWalkingToRange(here: WorldTile): Promise<void> {
        if (this.spot.isCatherbyDoor) {
            await this.handleCatherbyDoorWalkToRange(here);
            return;
        }

        // Standard Location Traversal
        const distToRange = Math.max(
            Math.abs(here.x - this.spot.rangeTile.x),
            Math.abs(here.z - this.spot.rangeTile.z)
        );

        if (distToRange <= 1) {
            this.state = BotState.COOKING;
            return;
        }

        await Traversal.walkResilient(this.spot.rangeTile, { radius: 1, timeoutMs: 30_000 });
    }

    private async handleCatherbyDoorWalkToRange(here: WorldTile): Promise<void> {
        // Building interior bounds: 2815..2818, 3439..3444
        const isInside = here.x >= 2815 && here.x <= 2818 && here.z >= 3439 && here.z <= 3444;

        if (isInside) {
            // Inside: walk up to range stand tile (2817, 3443)
            const distToRange = Math.max(Math.abs(here.x - 2817), Math.abs(here.z - 3443));
            if (distToRange <= 1) {
                this.state = BotState.COOKING;
                return;
            }
            await Traversal.walkTo(new Tile(2817, 3443, 0), { radius: 1 });
            return;
        }

        // If door is ALREADY open: Walk straight into range room without stopping!
        if (!this.isCatherbyDoorClosed()) {
            this.log('Door is open, walking straight into range...');
            await Traversal.walkTo(new Tile(2817, 3443, 0), { radius: 1 });
            return;
        }

        // Door is closed: Walk towards outside door tile (2816, 3438)
        const distToDoorStand = Math.max(Math.abs(here.x - 2816), Math.abs(here.z - 3438));
        if (distToDoorStand > 1) {
            await Traversal.walkTo(new Tile(2816, 3438, 0), { radius: 0 });
            return;
        }

        // At outside door tile (2816, 3438):
        const door = this.findCatherbyDoor();
        if (door && door.actions().some(a => /open/i.test(a))) {
            this.log('Door is closed, interacting Open...');
            await door.interact('Open');
            await Execution.delayTicks(1);
        }

        // Send 1 direct local step through doorway to (2816, 3439)
        this.log('Stepping through doorway into (2816, 3439)...');
        this.directStep(2816, 3439);

        // Wait up to 2 ticks to confirm transition inside (z >= 3439)
        await Execution.delayUntilTicks(() => {
            const t = Game.tile();
            return t !== null && t.z >= 3439;
        }, 2);
    }

    // ------------------------------------------------------------------------
    // 3. Cooking (Tick-Perfect Execution with 2-Tick Cadence Gate)
    // ------------------------------------------------------------------------
    private async handleCooking(currentTick: number, here: WorldTile): Promise<void> {
        const rawCount = this.countRawInPack();

        // If all raw food is cooked/burnt -> Head to bank
        if (rawCount === 0) {
            this.state = BotState.WALKING_TO_BANK;
            return;
        }

        // 1. Authoritative Cooked Count from XP delta
        const currentXp = Skills.xp('cooking');
        if (currentXp > this.lastCookXp) {
            this.cookedCount++;
            this.lastCookXp = currentXp;
            this.lastCookTick = 0; // Finished!
        }

        // 2. Authoritative Burnt Count from actual 'Burnt' items appearing in backpack
        const burntInPack = this.countBurntInPack();
        if (burntInPack > this.lastBurntInPack) {
            this.burntCount += (burntInPack - this.lastBurntInPack);
            this.lastBurntInPack = burntInPack;
            this.lastCookTick = 0; // Finished!
        }

        // 3. Cadence Gate: Cooking takes 2 ticks per fish in RS2
        // Never spam useOn while in active cooking delay
        if (this.lastCookTick > 0 && currentTick - this.lastCookTick < 2) {
            return;
        }

        // 0. Location Recovery Guard:
        // If outside the building in Catherby or far from range (e.g. after random event/teleport),
        // revert to WALKING_TO_RANGE so door bypass and pathfinding handle re-entry properly.
        if (this.spot.isCatherbyDoor) {
            const isInside = here.x >= 2815 && here.x <= 2818 && here.z >= 3439 && here.z <= 3444;
            if (!isInside) {
                this.log('Detected outside cooking building — transitioning to Walking to Range to re-enter...');
                this.state = BotState.WALKING_TO_RANGE;
                return;
            }
        } else {
            const distToRange = Math.max(
                Math.abs(here.x - this.spot.rangeTile.x),
                Math.abs(here.z - this.spot.rangeTile.z)
            );
            if (distToRange > 3) {
                this.state = BotState.WALKING_TO_RANGE;
                return;
            }
        }

        // Ensure we are standing near the cooking range
        const distToRange = Math.max(
            Math.abs(here.x - this.spot.rangeTile.x),
            Math.abs(here.z - this.spot.rangeTile.z)
        );
        if (distToRange > 2) {
            await Traversal.walkTo(this.spot.rangeTile, { radius: 1 });
            return;
        }

        const range = Locs.query()
            .where(l => {
                if (!l.name) return false;
                const n = l.name.toLowerCase();
                return this.spot.rangeLocNames.some(r => n.includes(r.toLowerCase()));
            })
            .withinOf(this.spot.rangeTile, 3)
            .first();

        if (!range) {
            this.log('Waiting for range object...');
            return;
        }

        // Find next raw food in inventory
        const rawItem = Inventory.items().find(i => i.name && i.name.toLowerCase().startsWith('raw '));
        if (!rawItem) {
            this.state = BotState.WALKING_TO_BANK;
            return;
        }

        // Dispatch raw item on range every 2 ticks
        await rawItem.useOn(range);
        this.lastCookTick = currentTick;
    }

    // ------------------------------------------------------------------------
    // 4. Walking To Bank (with Anti-Troll Door Threshold Direct Step)
    // ------------------------------------------------------------------------
    private async handleWalkingToBank(here: WorldTile): Promise<void> {
        if (this.spot.isCatherbyDoor) {
            await this.handleCatherbyDoorWalkToBank(here);
            return;
        }

        // Standard Location Traversal
        const distToBank = Math.max(
            Math.abs(here.x - this.spot.bankTile.x),
            Math.abs(here.z - this.spot.bankTile.z)
        );

        if (distToBank <= 3) {
            this.state = BotState.BANKING;
            return;
        }

        await Traversal.walkResilient(this.spot.bankTile, { radius: 2, timeoutMs: 30_000 });
    }

    private async handleCatherbyDoorWalkToBank(here: WorldTile): Promise<void> {
        const isInside = here.x >= 2815 && here.x <= 2818 && here.z >= 3439 && here.z <= 3444;

        if (isInside) {
            // If door is ALREADY open: Walk straight to bank without stopping!
            if (!this.isCatherbyDoorClosed()) {
                this.log('Door is open, stepping straight outside toward bank...');
                await Traversal.walkTo(this.spot.bankTile, { radius: 2 });
                return;
            }

            const distToInsideDoor = Math.max(Math.abs(here.x - 2816), Math.abs(here.z - 3439));
            if (distToInsideDoor > 1) {
                await Traversal.walkTo(new Tile(2816, 3439, 0), { radius: 0 });
                return;
            }

            // At inside door tile (2816, 3439):
            const door = this.findCatherbyDoor();
            if (door && door.actions().some(a => /open/i.test(a))) {
                this.log('Opening Catherby door to exit...');
                await door.interact('Open');
                await Execution.delayTicks(1);
            }

            // Send 1 direct local step through doorway to (2816, 3438)
            this.log('Stepping outside through doorway to (2816, 3438)...');
            this.directStep(2816, 3438);

            // Wait up to 2 ticks to confirm transition outside (z <= 3438)
            await Execution.delayUntilTicks(() => {
                const t = Game.tile();
                return t !== null && t.z <= 3438;
            }, 2);
            return;
        }

        // Outside building: Walk to Catherby bank booth
        const distToBank = Math.max(
            Math.abs(here.x - this.spot.bankTile.x),
            Math.abs(here.z - this.spot.bankTile.z)
        );

        if (distToBank <= 3) {
            this.state = BotState.BANKING;
            return;
        }

        await Traversal.walkTo(this.spot.bankTile, { radius: 2 });
    }

    // ------------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------------
    private directStep(worldX: number, worldZ: number): boolean {
        const loc = reader.toLocal(worldX, worldZ);
        if (!loc) return false;
        return actions.walkTo(loc.lx, loc.lz);
    }

    private findCatherbyDoor(): Loc | null {
        return Locs.query()
            .where(l => {
                if (!l.name) return false;
                const n = l.name.toLowerCase();
                if (!n.includes('door')) return false;
                const t = l.tile();
                return Math.abs(t.x - 2816) <= 1 && (t.z === 3438 || t.z === 3439);
            })
            .first();
    }

    private isCatherbyDoorClosed(): boolean {
        const door = this.findCatherbyDoor();
        if (!door) return false;
        return door.actions().some(a => /open/i.test(a));
    }

    private countRawInPack(): number {
        return Inventory.items().filter(i => i.name && i.name.toLowerCase().startsWith('raw ')).length;
    }

    private countBurntInPack(): number {
        return Inventory.items().filter(i => i.name && i.name.toLowerCase().includes('burnt')).length;
    }

    private async openBankFast(): Promise<boolean> {
        if (Bank.isOpen() && Bank.loaded()) return true;

        const booth = Locs.query().name('Bank booth').where(l => l.actions().length > 0).nearest();
        if (!booth) return Bank.openNearest('Bank booth', 'Use-quickly');

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
            if (Bank.isOpen()) {
                await Execution.delayUntilTicks(() => Bank.loaded() && Bank.snapshotReady(), 3);
                return true;
            }
        }

        return Bank.openNearest('Bank booth', 'Use-quickly');
    }

    // ------------------------------------------------------------------------
    // HUD / Paint
    // ------------------------------------------------------------------------
    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#ff9900' });
        const mins = (Date.now() - this.startedAt) / 60_000;
        const cookedPerHour = mins > 0.5 ? Math.round((this.cookedCount / mins) * 60) : 0;
        const burntPerHour = mins > 0.5 ? Math.round((this.burntCount / mins) * 60) : 0;

        const xpGained = Skills.xp('cooking') - this.startCookXp;
        const xpPerHour = mins > 0.5 ? Math.round((xpGained / mins) * 60) : 0;
        const successRate = (this.cookedCount + this.burntCount) > 0
            ? Math.round((this.cookedCount / (this.cookedCount + this.burntCount)) * 100)
            : 100;

        p.title(`TickCooker — ${this.state} (${this.spot.name})`);
        p.row(
            `Runtime: ${fmtDuration(mins)}`,
            `Cooked: ${this.cookedCount} (${cookedPerHour}/hr)`,
            `Burnt: ${this.burntCount} (${burntPerHour}/hr)`
        );
        p.row(
            `Success: ${successRate}%`,
            `Food: ${this.activeRawName ?? this.configuredFood}`,
            `Trips: ${this.trips}`
        );
        p.row(`Cooking XP: +${xpGained.toLocaleString()} (${xpPerHour.toLocaleString()}/hr)`);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}
