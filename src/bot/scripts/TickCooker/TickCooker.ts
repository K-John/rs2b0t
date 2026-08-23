import { LoopingBot, type LoopCadence } from '../../api/bot/Bot.js';
import { reader, type WorldTile } from '../../adapter/ClientAdapter.js';
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
    private lastRawCount = 0;
    private lastActionTick = 0;
    private startCookXp = 0;
    private startedAt = Date.now();

    override onStart(): void {
        const spotName = this.settings.str('location', 'Catherby (Range)');
        this.spot = COOKING_SPOTS[spotName] ?? COOKING_SPOTS['Catherby (Range)']!;
        this.configuredFood = this.settings.str('rawFood', 'Auto-detect');
        this.activeRawName = this.configuredFood === 'Auto-detect' ? null : this.configuredFood;

        this.startCookXp = Skills.xp('cooking');
        this.lastCookXp = this.startCookXp;
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

        // Deposit all non-raw items (cooked food, burnt food, caskets, etc.)
        const hasFinishedItems = Inventory.items().some(i => i.name && !i.name.toLowerCase().startsWith('raw '));
        if (hasFinishedItems) {
            await Bank.depositAllMatching(name => !name.toLowerCase().startsWith('raw '));
        }

        // Resolve raw food to withdraw
        let targetRaw = this.activeRawName;
        if (!targetRaw || this.configuredFood === 'Auto-detect') {
            const rawInBank = Bank.items().find(i => i.name && i.name.toLowerCase().startsWith('raw '));
            if (rawInBank && rawInBank.name) {
                targetRaw = rawInBank.name;
                this.activeRawName = targetRaw;
            }
        }

        const rawInPack = this.countRawInPack();
        if (rawInPack === 0) {
            if (!targetRaw || Bank.count(targetRaw) === 0) {
                ScriptRunner.stop(`No raw food found in bank to cook!`);
                return;
            }

            const item = Bank.items().find(i => i.name && i.name.toLowerCase() === targetRaw!.toLowerCase());
            const allOp = item ? withdrawOp(item.ops, 'all') ?? 'Withdraw-All' : 'Withdraw-All';
            await Bank.withdraw(targetRaw, allOp);
        }

        await Bank.close();

        this.trips++;
        this.lastRawCount = this.countRawInPack();
        this.lastCookXp = Skills.xp('cooking');
        this.state = BotState.WALKING_TO_RANGE;
    }

    // ------------------------------------------------------------------------
    // 2. Walking To Range (with 1-Tick Door Bypass for Catherby)
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

        // Outside building: Walk to outside door tile (2816, 3438)
        const distToDoorStand = Math.max(Math.abs(here.x - 2816), Math.abs(here.z - 3438));
        if (distToDoorStand > 1) {
            await Traversal.walkResilient(new Tile(2816, 3438, 0), { radius: 0, timeoutMs: 30_000 });
            return;
        }

        // At or adjacent to (2816, 3438): Check door state
        const door = this.findCatherbyDoor();
        if (door) {
            const hasOpen = door.actions().some(a => /open/i.test(a));
            if (hasOpen) {
                // Door is closed: Send Open action on this tick, then yield
                this.log('Opening Catherby range door...');
                await door.interact('Open');
                return;
            } else {
                // Door is open: Send Walk action on this tick
                this.log('Door is open, walking straight into range...');
                await Traversal.walkTo(new Tile(2817, 3443, 0), { radius: 1 });
                return;
            }
        }

        // If door loc not found, attempt walk inside
        await Traversal.walkTo(new Tile(2817, 3443, 0), { radius: 1 });
    }

    // ------------------------------------------------------------------------
    // 3. Cooking (Tick-Perfect Execution)
    // ------------------------------------------------------------------------
    private async handleCooking(currentTick: number, here: WorldTile): Promise<void> {
        const rawCount = this.countRawInPack();

        // If all raw food is cooked/burnt -> Head to bank
        if (rawCount === 0) {
            this.state = BotState.WALKING_TO_BANK;
            return;
        }

        // Authoritative XP and inventory deltas
        const currentXp = Skills.xp('cooking');
        if (currentXp > this.lastCookXp) {
            this.cookedCount++;
            this.lastCookXp = currentXp;
        } else if (rawCount < this.lastRawCount) {
            // Raw count went down without XP increase = Burnt fish
            this.burntCount += (this.lastRawCount - rawCount);
        }
        this.lastRawCount = rawCount;

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

        // 1-Tick Manual Use Chaining: Dispatch raw item onto range
        await rawItem.useOn(range);
        this.lastActionTick = currentTick;
    }

    // ------------------------------------------------------------------------
    // 4. Walking To Bank (with 1-Tick Door Bypass for Catherby)
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
            // Walk to inside door stand tile (2816, 3439)
            const distToInsideDoor = Math.max(Math.abs(here.x - 2816), Math.abs(here.z - 3439));
            if (distToInsideDoor > 1) {
                await Traversal.walkTo(new Tile(2816, 3439, 0), { radius: 0 });
                return;
            }

            // At or adjacent to (2816, 3439): Check door
            const door = this.findCatherbyDoor();
            if (door) {
                const hasOpen = door.actions().some(a => /open/i.test(a));
                if (hasOpen) {
                    this.log('Opening Catherby door to exit...');
                    await door.interact('Open');
                    return;
                } else {
                    this.log('Door is open, stepping outside toward bank...');
                    await Traversal.walkTo(this.spot.bankTile, { radius: 2 });
                    return;
                }
            } else {
                await Traversal.walkTo(this.spot.bankTile, { radius: 2 });
                return;
            }
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

        await Traversal.walkResilient(this.spot.bankTile, { radius: 2, timeoutMs: 30_000 });
    }

    // ------------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------------
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

    private countRawInPack(): number {
        return Inventory.items().filter(i => i.name && i.name.toLowerCase().startsWith('raw ')).length;
    }

    private async openBankFast(): Promise<boolean> {
        if (Bank.isOpen()) return true;

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
            return Bank.isOpen();
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
