import { LoopingBot, type LoopCadence } from '../../api/bot/Bot.js';
import type { WorldTile } from '../../adapter/ClientAdapter.js';
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
import { TickCombatEngine } from '../../api/combat/TickCombatEngine.js';
import type { CombatProfile } from '../../api/combat/CombatProfile.js';
import { FOOD_OPTIONS } from '../../api/combat/food.js';
import type { GroundItem } from '../../api/model/GroundItem.js';

const HOBGOBLIN_FIELD = new Tile(2906, 3294, 0);
const HOBGOBLIN_BANK_STAND = new Tile(3012, 3355, 0);
const MONSTER_NAMES = ['Hobgoblin'];

// Why: exact match on the drop table's own casing, not a substring, so "Nature rune"
// picks up without also grabbing something unrelated that merely contains "rune".
const WANTED_LOOT = ['law rune', 'nature rune', 'chaos rune', 'limpwurt root'];

export const HOBGOBLIN_SETTINGS: SettingsSchema = {
    leashRadius: {
        type: 'number',
        default: 10,
        min: 3,
        max: 25,
        label: 'Fighting radius (tiles)',
        help: 'How far from the hobgoblin spot (2906, 3294) to hunt and loot before stepping back'
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

export default class TickHobgoblin extends LoopingBot {
    override loopCadence: LoopCadence = { kind: 'server-tick', ticks: 1 };

    private radius = 10;
    private foodName = 'Lobster';
    private foodCountTarget = 8;
    private eatAtPercent = 50;
    private panicHpPercent = 30;

    private state: BotState = BotState.BANKING;
    private engine!: TickCombatEngine;

    private trips = 0;
    private lootCount = 0;
    private startAttackXp = 0;
    private startStrXp = 0;
    private startDefXp = 0;
    private startHpXp = 0;
    private startedAt = Date.now();

    override onStart(): void {
        this.radius = this.settings.num('leashRadius', 10);
        this.foodName = this.settings.str('foodType', 'Lobster');
        this.foodCountTarget = this.settings.num('foodAmount', 8);
        this.eatAtPercent = this.settings.num('eatHp', 50);
        this.panicHpPercent = this.settings.num('panicHp', 30);

        const profile: CombatProfile = {
            monsterNames: MONSTER_NAMES,
            deathAnimations: [836],
            anchorTile: HOBGOBLIN_FIELD,
            leashRadius: this.radius,
            eatAtPercent: this.eatAtPercent,
            isWantedLoot: (item: GroundItem) => this.isHobgoblinLoot(item),
            onKill: () => {}
        };

        this.engine = new TickCombatEngine(profile);

        this.startAttackXp = Skills.xp('attack');
        this.startStrXp = Skills.xp('strength');
        this.startDefXp = Skills.xp('defence');
        this.startHpXp = Skills.xp('hitpoints');
        this.startedAt = Date.now();

        this.log(`TickHobgoblin initialized at ${HOBGOBLIN_FIELD}. Food: ${this.foodName} (x${this.foodCountTarget})`);
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
            Math.abs(here.x - HOBGOBLIN_BANK_STAND.x),
            Math.abs(here.z - HOBGOBLIN_BANK_STAND.z)
        );

        if (distToBank > 5) {
            this.state = BotState.TRAVELLING_TO_BANK;
            return;
        }

        if (!Bank.isOpen()) {
            const opened = await this.openBankFast();
            if (!opened) return;
        }

        // Deposit all loot, keep only the food.
        await Bank.depositAllMatching(depositAllExcept([this.foodName]));

        // Restock food
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
        const distToField = Math.max(
            Math.abs(here.x - HOBGOBLIN_FIELD.x),
            Math.abs(here.z - HOBGOBLIN_FIELD.z)
        );

        if (distToField <= this.radius && here.level === HOBGOBLIN_FIELD.level) {
            this.state = BotState.FIGHTING;
            return;
        }

        // No doors/gates on this route, so the resilient walker handles it in one hop.
        await Traversal.walkResilient(HOBGOBLIN_FIELD, { radius: 3, timeoutMs: 60_000 });
    }

    // ------------------------------------------------------------------------
    // 3. Fighting (Tick-Perfect Execution)
    // ------------------------------------------------------------------------
    private async handleFighting(currentTick: number, here: WorldTile): Promise<void> {
        const currentFood = Inventory.count(this.foodName);
        const hpPercent = Skills.hpFraction() * 100;

        // Trip End Conditions:
        // a) Inventory full (cannot pick up any more loot)
        // b) Food depleted and HP reaching panic threshold
        const isPackFull = Inventory.isFull();
        const isPanic = currentFood === 0 && hpPercent <= this.panicHpPercent;

        if (isPackFull || isPanic) {
            this.log(`Trip finished (${isPackFull ? 'Inventory full' : 'Food depleted, low HP'}). Heading to bank.`);
            this.state = BotState.TRAVELLING_TO_BANK;
            return;
        }

        // If drifted too far outside leash area, step back toward anchor
        const distToAnchor = Math.max(
            Math.abs(here.x - HOBGOBLIN_FIELD.x),
            Math.abs(here.z - HOBGOBLIN_FIELD.z)
        );
        if (distToAnchor > this.radius + 4) {
            await Traversal.walkTo(HOBGOBLIN_FIELD, { radius: 2 });
            return;
        }

        // Run shared tick combat engine
        const beforeLoot = this.countWantedLootInPack();
        await this.engine.tick(currentTick);
        const afterLoot = this.countWantedLootInPack();
        if (afterLoot > beforeLoot) {
            this.lootCount += (afterLoot - beforeLoot);
        }
    }

    // ------------------------------------------------------------------------
    // 4. Travel To Bank
    // ------------------------------------------------------------------------
    private async handleTravellingToBank(here: WorldTile): Promise<void> {
        const distToBank = Math.max(
            Math.abs(here.x - HOBGOBLIN_BANK_STAND.x),
            Math.abs(here.z - HOBGOBLIN_BANK_STAND.z)
        );

        if (distToBank <= 3 && here.level === HOBGOBLIN_BANK_STAND.level) {
            this.state = BotState.BANKING;
            return;
        }

        // No doors/gates on this route either, straight walk back.
        await Traversal.walkResilient(HOBGOBLIN_BANK_STAND, { radius: 2, timeoutMs: 60_000 });
    }

    // ------------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------------
    private isHobgoblinLoot(item: GroundItem): boolean {
        if (!item.name) return false;
        return WANTED_LOOT.includes(item.name.trim().toLowerCase());
    }

    private countWantedLootInPack(): number {
        return Inventory.items()
            .filter(i => i.name !== null && WANTED_LOOT.includes(i.name.trim().toLowerCase()))
            .reduce((sum, i) => sum + Math.max(1, i.count), 0);
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
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#c87137' });
        const mins = (Date.now() - this.startedAt) / 60_000;
        const killsPerHour = mins > 0.5 ? Math.round((this.engine.kills / mins) * 60) : 0;
        const lootPerHour = mins > 0.5 ? Math.round((this.lootCount / mins) * 60) : 0;

        const attGained = Skills.xp('attack') - this.startAttackXp;
        const strGained = Skills.xp('strength') - this.startStrXp;
        const defGained = Skills.xp('defence') - this.startDefXp;
        const hpGained = Skills.xp('hitpoints') - this.startHpXp;
        const totalXp = attGained + strGained + defGained + hpGained;
        const xpPerHour = mins > 0.5 ? Math.round((totalXp / mins) * 60) : 0;

        p.title(`TickHobgoblin — ${this.state}`);
        p.row(`Runtime: ${fmtDuration(mins)}`, `Kills: ${this.engine.kills} (${killsPerHour}/hr)`, `Trips: ${this.trips}`);
        p.row(`Loot: ${this.lootCount} (${lootPerHour}/hr)`, `Food: ${Inventory.count(this.foodName)} left`);
        p.row(`Total XP: +${totalXp.toLocaleString()} (${xpPerHour.toLocaleString()}/hr)`);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}
