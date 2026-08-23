import { LoopingBot, type LoopCadence } from '../../api/bot/Bot.js';
import { reader, type WorldTile } from '../../adapter/ClientAdapter.js';
import { Game } from '../../api/game/Game.js';
import { Bank } from '../../api/bank/Bank.js';
import { depositAllExcept } from '../../api/bank/Banking.js';
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
import { TickCombatEngine, CombatTickResult } from '../../api/combat/TickCombatEngine.js';
import type { CombatProfile } from '../../api/combat/CombatProfile.js';
import { FOOD_OPTIONS } from '../../api/combat/food.js';
import type { GroundItem } from '../../api/model/GroundItem.js';

export interface ChaosDruidSpot {
    name: string;
    field: Tile;
    radius: number;
    bankStand: Tile;
    monsterNames: string[];
    isLockedDoorSpot?: boolean;
}

export const CHAOS_DRUID_SPOTS: Record<string, ChaosDruidSpot> = {
    'Edgeville Dungeon': {
        name: 'Edgeville Dungeon',
        field: new Tile(3110, 9936, 0),
        radius: 14,
        bankStand: new Tile(3094, 3491, 0),
        monsterNames: ['Chaos druid']
    },
    'Chaos Druid Tower': {
        name: 'Chaos Druid Tower',
        field: new Tile(2562, 3356, 0),
        radius: 6,
        bankStand: new Tile(2616, 3332, 0),
        monsterNames: ['Chaos druid']
    },
    'Yanille Dungeon (Druids)': {
        name: 'Yanille Dungeon (Druids)',
        field: new Tile(2611, 9485, 0),
        radius: 8,
        bankStand: new Tile(2612, 3092, 0),
        monsterNames: ['Chaos druid'],
        isLockedDoorSpot: true
    },
    'Yanille Dungeon (Warriors)': {
        name: 'Yanille Dungeon (Warriors)',
        field: new Tile(2580, 9501, 0),
        radius: 8,
        bankStand: new Tile(2612, 3092, 0),
        monsterNames: ['Chaos druid warrior', 'Chaos druid']
    }
};

export const CHAOS_DRUID_SETTINGS: SettingsSchema = {
    location: {
        type: 'string',
        default: 'Edgeville Dungeon',
        options: Object.keys(CHAOS_DRUID_SPOTS),
        label: 'Location',
        help: 'Select the Chaos Druid training ground'
    },
    foodType: {
        type: 'string',
        default: 'Lobster',
        options: FOOD_OPTIONS,
        label: 'Food type',
        help: 'Food to withdraw and eat'
    },
    foodAmount: {
        type: 'number',
        default: 8,
        min: 0,
        max: 27,
        label: 'Food amount per trip',
        help: 'Quantity of food to withdraw at the bank'
    },
    eatHp: {
        type: 'number',
        default: 50,
        min: 15,
        max: 85,
        label: 'Eat at HP%',
        help: 'Eat food when HP drops to or below this percentage'
    },
    panicHp: {
        type: 'number',
        default: 30,
        min: 10,
        max: 60,
        label: 'Retreat / Panic HP% (when out of food)',
        help: 'Leave combat and return to bank if food is depleted and HP reaches this threshold'
    }
};

enum BotState {
    BANKING = 'Banking',
    TRAVELLING_TO_SPOT = 'Walking to spot',
    FIGHTING = 'Fighting',
    TRAVELLING_TO_BANK = 'Walking to bank'
}

export default class TickChaosDruid extends LoopingBot {
    override loopCadence: LoopCadence = { kind: 'server-tick', ticks: 1 };

    private spot: ChaosDruidSpot = CHAOS_DRUID_SPOTS['Edgeville Dungeon']!;
    private foodName = 'Lobster';
    private foodCountTarget = 8;
    private eatAtPercent = 50;
    private panicHpPercent = 30;

    private state: BotState = BotState.BANKING;
    private engine!: TickCombatEngine;

    private trips = 0;
    private herbsLooted = 0;
    private startAttackXp = 0;
    private startStrXp = 0;
    private startDefXp = 0;
    private startHpXp = 0;
    private startedAt = Date.now();

    override onStart(): void {
        const spotName = this.settings.str('location', 'Edgeville Dungeon');
        this.spot = CHAOS_DRUID_SPOTS[spotName] ?? CHAOS_DRUID_SPOTS['Edgeville Dungeon']!;
        this.foodName = this.settings.str('foodType', 'Lobster');
        this.foodCountTarget = this.settings.num('foodAmount', 8);
        this.eatAtPercent = this.settings.num('eatHp', 50);
        this.panicHpPercent = this.settings.num('panicHp', 30);

        const profile: CombatProfile = {
            monsterNames: this.spot.monsterNames,
            deathAnimations: [836],
            anchorTile: this.spot.field,
            leashRadius: this.spot.radius,
            eatAtPercent: this.eatAtPercent,
            isWantedLoot: (item: GroundItem) => this.isDruidLoot(item),
            onKill: () => {}
        };

        this.engine = new TickCombatEngine(profile);

        this.startAttackXp = Skills.xp('attack');
        this.startStrXp = Skills.xp('strength');
        this.startDefXp = Skills.xp('defence');
        this.startHpXp = Skills.xp('hitpoints');
        this.startedAt = Date.now();

        this.log(`TickChaosDruid initialized at ${this.spot.name}. Food: ${this.foodName} (x${this.foodCountTarget})`);
    }

    async loop(): Promise<void> {
        const currentTick = Game.tick();
        const here = Game.tile();
        if (!here) return;

        switch (this.state) {
            case BotState.BANKING:
                await this.handleBanking(here);
                break;

            case BotState.TRAVELLING_TO_SPOT:
                await this.handleTravellingToSpot(here);
                break;

            case BotState.FIGHTING:
                await this.handleFighting(currentTick, here);
                break;

            case BotState.TRAVELLING_TO_BANK:
                await this.handleTravellingToBank(here);
                break;
        }
    }

    // ------------------------------------------------------------------------
    // 1. Banking
    // ------------------------------------------------------------------------
    private async handleBanking(here: WorldTile): Promise<void> {
        const distToBank = Math.max(
            Math.abs(here.x - this.spot.bankStand.x),
            Math.abs(here.z - this.spot.bankStand.z)
        );

        if (distToBank > 5) {
            this.state = BotState.TRAVELLING_TO_BANK;
            return;
        }

        if (!Bank.isOpen()) {
            const opened = await this.openBankFast();
            if (!opened) return;
        }

        // Deposit all loot (keep food and Lockpick if required)
        const keepItems = [this.foodName];
        if (this.spot.isLockedDoorSpot) {
            keepItems.push('Lockpick');
        }
        await Bank.depositAllMatching(depositAllExcept(keepItems));

        // Ensure Lockpick is in inventory if required
        if (this.spot.isLockedDoorSpot && !Inventory.contains('Lockpick')) {
            if (Bank.count('Lockpick') === 0) {
                ScriptRunner.stop('No Lockpick found in bank or inventory! Required for Yanille Dungeon door.');
                return;
            }
            await Bank.withdraw('Lockpick', 'Withdraw-1');
        }

        // Restock Food
        const currentFood = Inventory.count(this.foodName);
        if (currentFood < this.foodCountTarget) {
            const needed = this.foodCountTarget - currentFood;
            if (Bank.count(this.foodName) === 0 && currentFood === 0) {
                ScriptRunner.stop(`Out of food (${this.foodName}) in bank!`);
                return;
            }
            if (Bank.count(this.foodName) > 0) {
                await Bank.withdrawX(this.foodName, Math.min(needed, Bank.count(this.foodName)));
            }
        }

        await Bank.close();

        this.trips++;
        this.state = BotState.TRAVELLING_TO_SPOT;
    }

    // ------------------------------------------------------------------------
    // 2. Travel To Spot
    // ------------------------------------------------------------------------
    private async handleTravellingToSpot(here: WorldTile): Promise<void> {
        // Special manual door pick-lock routing for Yanille Dungeon (Druids)
        if (this.spot.isLockedDoorSpot) {
            await this.handleYanilleDoorTravelToSpot(here);
            return;
        }

        const distToField = Math.max(
            Math.abs(here.x - this.spot.field.x),
            Math.abs(here.z - this.spot.field.z)
        );

        if (distToField <= this.spot.radius && here.level === this.spot.field.level) {
            this.state = BotState.FIGHTING;
            return;
        }

        // Resilient walker navigates trapdoors, gates, ladders, and doors
        await Traversal.walkResilient(this.spot.field, { radius: 3, timeoutMs: 60_000 });
    }

    private async handleYanilleDoorTravelToSpot(here: WorldTile): Promise<void> {
        // 1. If already north of the door (z >= 9482)
        if (here.z >= 9482 && here.x >= 2560 && here.x <= 2623) {
            // If inside the druid area (2606..2619, 9481..9489)
            if (here.x >= 2606 && here.x <= 2619 && here.z >= 9481 && here.z <= 9489) {
                this.state = BotState.FIGHTING;
                return;
            }
            await Traversal.walkResilient(this.spot.field, { radius: 2, timeoutMs: 60_000 });
            return;
        }

        // 2. Approach south side of door (2601, 9481)
        const inSouthApproach = here.x >= 2599 && here.x <= 2605 && here.z >= 9476 && here.z <= 9481;
        const distToSouthDoor = Math.max(Math.abs(here.x - 2601), Math.abs(here.z - 9481));

        if (!inSouthApproach && (distToSouthDoor > 1 || here.z < 6400)) {
            await Traversal.walkResilient(new Tile(2601, 9481, 0), { radius: 1, timeoutMs: 60_000 });
            return;
        }

        // 3. In the picklock approach area: pick-lock the door at (2601, 9481)
        const door = Locs.query()
            .withinOf({ x: 2601, z: 9481, level: 0 }, 2)
            .where(l => l.name === 'Door' || l.actions().some(a => /pick/i.test(a)))
            .first();

        if (door) {
            const op = door.actions().find(a => /pick/i.test(a)) ?? 'Pick-lock';
            this.log('Interacting Pick-lock on door at (2601, 9481)...');
            await door.interact(op);
            await Execution.delayUntilTicks(() => {
                const t = Game.tile();
                return t !== null && t.z >= 9482;
            }, 4);
        } else {
            const currentZ = Game.tile()?.z ?? 0;
            if (currentZ >= 9482) {
                this.state = BotState.FIGHTING;
            } else {
                await Traversal.walkTo(new Tile(2601, 9481, 0), { radius: 0 });
            }
        }
    }

    // ------------------------------------------------------------------------
    // 3. Fighting (Tick-Perfect Execution)
    // ------------------------------------------------------------------------
    private async handleFighting(currentTick: number, here: WorldTile): Promise<void> {
        const currentFood = Inventory.count(this.foodName);
        const hpPercent = Skills.hpFraction() * 100;

        // Trip End Conditions:
        // a) Inventory full of loot and no food left to consume for room
        // b) Food depleted and HP reaching panic threshold
        const isPackFull = Inventory.isFull() && currentFood === 0;
        const isPanic = currentFood === 0 && hpPercent <= this.panicHpPercent;

        if (isPackFull || isPanic) {
            this.log(`Trip finished (${isPackFull ? 'Pack full of loot' : 'Food depleted, low HP'}). Heading to bank.`);
            this.state = BotState.TRAVELLING_TO_BANK;
            return;
        }

        // If drifted too far outside leash area, step back toward anchor
        const distToAnchor = Math.max(
            Math.abs(here.x - this.spot.field.x),
            Math.abs(here.z - this.spot.field.z)
        );
        if (distToAnchor > this.spot.radius + 4) {
            await Traversal.walkTo(this.spot.field, { radius: 2 });
            return;
        }

        // Run shared tick combat engine
        const beforeHerbs = this.countHerbsInPack();
        const result = await this.engine.tick(currentTick);
        const afterHerbs = this.countHerbsInPack();
        if (afterHerbs > beforeHerbs) {
            this.herbsLooted += (afterHerbs - beforeHerbs);
        }
    }

    // ------------------------------------------------------------------------
    // 4. Travel To Bank
    // ------------------------------------------------------------------------
    private async handleTravellingToBank(here: WorldTile): Promise<void> {
        // Special manual door exit routing for Yanille Dungeon (Druids)
        if (this.spot.isLockedDoorSpot) {
            await this.handleYanilleDoorTravelToBank(here);
            return;
        }

        const distToBank = Math.max(
            Math.abs(here.x - this.spot.bankStand.x),
            Math.abs(here.z - this.spot.bankStand.z)
        );

        if (distToBank <= 3 && here.level === this.spot.bankStand.level) {
            this.state = BotState.BANKING;
            return;
        }

        await Traversal.walkResilient(this.spot.bankStand, { radius: 2, timeoutMs: 60_000 });
    }

    private async handleYanilleDoorTravelToBank(here: WorldTile): Promise<void> {
        // 1. If on north side of door (z >= 9482), step to door and open normally
        if (here.z >= 9482 && here.x >= 2560 && here.x <= 2623) {
            const distToNorthDoor = Math.max(Math.abs(here.x - 2601), Math.abs(here.z - 9482));
            if (distToNorthDoor > 1) {
                await Traversal.walkResilient(new Tile(2601, 9482, 0), { radius: 1, timeoutMs: 60_000 });
                return;
            }

            // At north stand tile (2601, 9482): Open door (no picklock required to leave)
            const door = Locs.query()
                .withinOf({ x: 2601, z: 9482, level: 0 }, 2)
                .where(l => l.name === 'Door' || l.actions().some(a => /open|walk/i.test(a)))
                .first();

            if (door) {
                const op = door.actions().find(a => /open|walk/i.test(a)) ?? 'Open';
                this.log('Opening door at (2601, 9482) to exit...');
                await door.interact(op);
                await Execution.delayUntilTicks(() => {
                    const t = Game.tile();
                    return t !== null && t.z <= 9481;
                }, 4);
            }
            return;
        }

        // 2. Once south of door (or on surface), walk to Yanille Bank
        const distToBank = Math.max(
            Math.abs(here.x - this.spot.bankStand.x),
            Math.abs(here.z - this.spot.bankStand.z)
        );

        if (distToBank <= 3 && here.level === this.spot.bankStand.level) {
            this.state = BotState.BANKING;
            return;
        }

        await Traversal.walkResilient(this.spot.bankStand, { radius: 2, timeoutMs: 60_000 });
    }

    // ------------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------------
    private isDruidLoot(item: GroundItem): boolean {
        if (!item.name) return false;
        const n = item.name.toLowerCase();
        // Herbs
        if (n.includes('herb') || n.includes('grimy') || n.includes('ranarr') || n.includes('avantoe') || n.includes('kwuarm')) {
            return true;
        }
        // Runes
        if (n.includes('law rune') || n.includes('nature rune')) {
            return true;
        }
        // Valuables
        if (n.includes('snape grass') || n.includes('mithril bolts') || n === 'coins') {
            return true;
        }
        return false;
    }

    private countHerbsInPack(): number {
        return Inventory.items().filter(i => {
            if (!i.name) return false;
            const n = i.name.toLowerCase();
            return n.includes('herb') || n.includes('grimy') || n.includes('ranarr');
        }).length;
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
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#00cc66' });
        const mins = (Date.now() - this.startedAt) / 60_000;
        const killsPerHour = mins > 0.5 ? Math.round((this.engine.kills / mins) * 60) : 0;
        const herbsPerHour = mins > 0.5 ? Math.round((this.herbsLooted / mins) * 60) : 0;

        const attGained = Skills.xp('attack') - this.startAttackXp;
        const strGained = Skills.xp('strength') - this.startStrXp;
        const defGained = Skills.xp('defence') - this.startDefXp;
        const hpGained = Skills.xp('hitpoints') - this.startHpXp;
        const totalXp = attGained + strGained + defGained + hpGained;
        const xpPerHour = mins > 0.5 ? Math.round((totalXp / mins) * 60) : 0;

        p.title(`TickChaosDruid — ${this.state} (${this.spot.name})`);
        p.row(`Runtime: ${fmtDuration(mins)}`, `Kills: ${this.engine.kills} (${killsPerHour}/hr)`, `Trips: ${this.trips}`);
        p.row(`Herbs: ${this.herbsLooted} (${herbsPerHour}/hr)`, `Food: ${Inventory.count(this.foodName)} left`);
        p.row(`Total XP: +${totalXp.toLocaleString()} (${xpPerHour.toLocaleString()}/hr)`);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}
