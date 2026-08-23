import { actions, reader } from '../../adapter/ClientAdapter.js';
import { MiniMenuAction } from '#/client/shell/MiniMenuAction.js';
import { depositAllExcept } from '../../api/bank/Banking.js';
import { LoopingBot, type LoopCadence } from '../../api/bot/Bot.js';
import { Game } from '../../api/game/Game.js';
import { Bank } from '../../api/bank/Bank.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Inventory, type InvItem } from '../../api/inventory/Inventory.js';
import { Paint } from '../../paint/Paint.js';
import { Skills } from '../../api/skills/Skills.js';
import { Locs } from '../../api/locs/Locs.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Execution } from '../../api/execution/Execution.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';

// ============================================================================
// 1. Data Structures & Bar Recipes
// ============================================================================

export interface BarRecipe {
    name: string;
    primaryOre: string;
    secondaryOre: string | null;
    secondaryPerPrimary: number;
    smithingLevel: number;
}

export const RECIPES: Record<string, BarRecipe> = {
    Bronze: {
        name: 'Bronze',
        primaryOre: 'Copper ore',
        secondaryOre: 'Tin ore',
        secondaryPerPrimary: 1,
        smithingLevel: 1
    },
    Iron: {
        name: 'Iron',
        primaryOre: 'Iron ore',
        secondaryOre: null,
        secondaryPerPrimary: 0,
        smithingLevel: 15
    },
    Silver: {
        name: 'Silver',
        primaryOre: 'Silver ore',
        secondaryOre: null,
        secondaryPerPrimary: 0,
        smithingLevel: 20
    },
    Steel: {
        name: 'Steel',
        primaryOre: 'Iron ore',
        secondaryOre: 'Coal',
        secondaryPerPrimary: 2,
        smithingLevel: 30
    },
    Gold: {
        name: 'Gold',
        primaryOre: 'Gold ore',
        secondaryOre: null,
        secondaryPerPrimary: 0,
        smithingLevel: 40
    },
    Mithril: {
        name: 'Mithril',
        primaryOre: 'Mithril ore',
        secondaryOre: 'Coal',
        secondaryPerPrimary: 4,
        smithingLevel: 50
    },
    Adamantite: {
        name: 'Adamantite',
        primaryOre: 'Adamantite ore',
        secondaryOre: 'Coal',
        secondaryPerPrimary: 6,
        smithingLevel: 70
    },
    Runite: {
        name: 'Runite',
        primaryOre: 'Runite ore',
        secondaryOre: 'Coal',
        secondaryPerPrimary: 8,
        smithingLevel: 85
    }
};

export const FIRE_STAVES = [
    'Staff of fire',
    'Fire battlestaff',
    'Mystic fire staff',
    'Lava battlestaff',
    'Mystic lava staff',
    'Steam battlestaff',
    'Mystic steam staff',
    'Smoke battlestaff',
    'Mystic smoke staff'
];

export const SUPERHEATER_SETTINGS: SettingsSchema = {
    barType: {
        type: 'string',
        default: 'Steel',
        options: Object.keys(RECIPES),
        label: 'Bar type to make',
        help: 'Select which bar to smelt with Superheat Item'
    },
    natureQty: {
        type: 'number',
        default: 0,
        min: 0,
        label: 'Nature runes to carry',
        help: 'Amount of Nature runes to maintain in backpack. 0 = withdraw all available (always leaves 1 placeholder in bank).'
    }
};

enum BotState {
    BANKING = 'Banking',
    SUPERHEATING = 'Superheating'
}

function calculateWithdrawCounts(recipe: BarRecipe, freeSlots: number): { primary: number; secondary: number } {
    if (!recipe.secondaryOre || recipe.secondaryPerPrimary === 0) {
        return { primary: freeSlots, secondary: 0 };
    }
    const ratio = 1 + recipe.secondaryPerPrimary;
    const sets = Math.floor(freeSlots / ratio);
    return {
        primary: sets,
        secondary: sets * recipe.secondaryPerPrimary
    };
}

function getSuperheatComId(): number {
    const magicRoot = reader.sideTabInterface(6);
    if (magicRoot === -1) {
        return -1;
    }
    return reader.targetButtonByBase(magicRoot, 'Superheat Item');
}

function castSuperheatOn(item: InvItem): boolean {
    const comId = getSuperheatComId();
    if (comId === -1) {
        return false;
    }
    return (
        actions.menuAction(MiniMenuAction.TGT_BUTTON, 0, 0, comId) &&
        actions.menuAction(MiniMenuAction.TGT_HELD, item.id, item.slot, item.snap.comId)
    );
}

// ============================================================================
// 2. Tick-Perfect Superheater Bot
// ============================================================================

export default class Superheater extends LoopingBot {
    override loopCadence: LoopCadence = { kind: 'server-tick', ticks: 1 };

    private recipe: BarRecipe = RECIPES.Steel!;
    private state: BotState = BotState.BANKING;
    private lastCastTick = 0;
    private natureQty = 0;

    private barsMade = 0;
    private trips = 0;
    private startMagicXp = 0;
    private startSmithXp = 0;
    private startedAt = Date.now();

    override onStart(): void {
        const barName = this.settings.str('barType', 'Steel');
        this.recipe = RECIPES[barName] ?? RECIPES.Steel!;
        this.natureQty = this.settings.num('natureQty', 0);

        const magicLevel = Skills.level('magic');
        if (magicLevel < 43) {
            ScriptRunner.stop(`Superheat Item requires Magic level 43 (you have ${magicLevel}).`);
            return;
        }

        const smithLevel = Skills.level('smithing');
        if (smithLevel < this.recipe.smithingLevel) {
            ScriptRunner.stop(`${this.recipe.name} bars require Smithing level ${this.recipe.smithingLevel} (you have ${smithLevel}).`);
            return;
        }

        this.startMagicXp = Skills.xp('magic');
        this.startSmithXp = Skills.xp('smithing');
        this.startedAt = Date.now();

        this.log(`Superheater started — making ${this.recipe.name} bars. Nature target: ${this.natureQty === 0 ? 'All (leaving 1 placeholder in bank)' : this.natureQty}`);
    }

    async loop(): Promise<void> {
        const currentTick = Game.tick();
        if (!Game.ingame() || Game.tile() === null) {
            return;
        }

        switch (this.state) {
            case BotState.BANKING:
                await this.handleBanking(currentTick);
                break;

            case BotState.SUPERHEATING:
                await this.handleSuperheating(currentTick);
                break;
        }
    }

    // ------------------------------------------------------------------------
    // Superheating (3-Tick Execution)
    // ------------------------------------------------------------------------
    private async handleSuperheating(currentTick: number): Promise<void> {
        // 1. Verify required runes
        const hasNature = Inventory.contains('Nature rune');
        const hasFire = this.isFireCovered();
        if (!hasNature || !hasFire) {
            this.log('Missing runes for Superheat. Heading to bank.');
            this.state = BotState.BANKING;
            return;
        }

        // 2. Find primary ore in inventory
        const primaryOre = Inventory.items().find(
            i => i.name !== null && i.name.toLowerCase() === this.recipe.primaryOre.toLowerCase()
        );

        // If out of primary ore or insufficient secondary ore -> Bank
        if (!primaryOre || !this.hasEnoughSecondary()) {
            this.state = BotState.BANKING;
            return;
        }

        // 3. 3-Tick Cadence Gate
        // Casting takes exactly 3 server ticks. Wait until 3 ticks have elapsed since last cast.
        const elapsed = currentTick - this.lastCastTick;
        if (this.lastCastTick > 0 && elapsed < 3) {
            return; // In active cast cooldown (1st or 2nd tick) — yield to engine
        }

        // 4. Dispatch Superheat on the primary ore!
        const success = castSuperheatOn(primaryOre);
        if (success) {
            this.lastCastTick = currentTick;
            this.barsMade++;
        } else {
            this.log('Could not cast Superheat Item — checking Magic tab.');
        }
    }

    // ------------------------------------------------------------------------
    // Banking & Auto-restock
    // ------------------------------------------------------------------------
    private async handleBanking(currentTick: number): Promise<void> {
        // 1. Wait for last Superheat cast (3 ticks) and active animation to complete before clicking bank
        const elapsed = currentTick - this.lastCastTick;
        if (this.lastCastTick > 0 && (elapsed < 3 || Game.animating())) {
            return; // Still in the 3-tick superheat animation/cooldown — yield to engine
        }

        // 2. If we already have the required ores and runes in backpack, resume superheating immediately
        const hasPrimary = Inventory.contains(this.recipe.primaryOre);
        const hasRunes = Inventory.contains('Nature rune') && this.isFireCovered();
        if (hasPrimary && hasRunes && this.hasEnoughSecondary()) {
            this.state = BotState.SUPERHEATING;
            this.lastCastTick = 0;
            return;
        }

        // 3. Open nearest bank booth fast (adjacent-first, 0-1 tick response)
        if (!Bank.isOpen()) {
            const opened = await this.openBankFast();
            if (!opened) {
                this.log('Could not open nearest bank booth — retrying.');
                return;
            }
        }

        // Deposit everything except runes and staves
        const keepList = this.getKeepList();
        await Bank.depositAllMatching(depositAllExcept(keepList));

        // Calculate how many bars fit in a full trip load
        const approxFree = Inventory.contains('Nature rune') ? 27 : 26;
        const maxBars = calculateWithdrawCounts(this.recipe, approxFree).primary;

        // Auto-detect and equip/withdraw Fire Staff or Fire Runes (only if < needed)
        await this.ensureFireSource(maxBars);

        // Restock Nature Runes (only if < needed for the full next trip)
        await this.restockNatureRunes(maxBars);

        // Calculate exact ore ratios based on remaining free inventory slots
        const freeSlots = Inventory.free();
        if (freeSlots <= 0) {
            this.log('No free inventory slots for ores after runes/gear.');
            return;
        }

        const { primary: pCount, secondary: sCount } = calculateWithdrawCounts(this.recipe, freeSlots);

        // Verify bank stock
        if (pCount > 0 && Bank.count(this.recipe.primaryOre) < pCount) {
            ScriptRunner.stop(`Out of ${this.recipe.primaryOre} in bank!`);
            return;
        }
        if (sCount > 0 && this.recipe.secondaryOre && Bank.count(this.recipe.secondaryOre) < sCount) {
            ScriptRunner.stop(`Out of ${this.recipe.secondaryOre} in bank!`);
            return;
        }

        // Withdraw Secondary ore first (e.g. Coal), then Primary ore
        if (sCount > 0 && this.recipe.secondaryOre) {
            await Bank.withdrawX(this.recipe.secondaryOre, sCount);
        }
        if (pCount > 0) {
            await Bank.withdrawX(this.recipe.primaryOre, pCount);
        }

        // Close bank
        await Bank.close();

        this.trips++;
        this.lastCastTick = 0;
        this.state = BotState.SUPERHEATING;
    }

    // ------------------------------------------------------------------------
    // Equipment & Rune Helpers
    // ------------------------------------------------------------------------
    private isFireStaffEquipped(): boolean {
        return Equipment.items().some(
            i => i.name !== null && FIRE_STAVES.some(s => s.toLowerCase() === i.name!.toLowerCase())
        );
    }

    private isFireCovered(): boolean {
        if (this.isFireStaffEquipped()) {
            return true;
        }
        return Inventory.count('Fire rune') >= 4;
    }

    private async restockNatureRunes(neededForTrip: number): Promise<void> {
        const held = Inventory.count('Nature rune');

        // If we already have enough Nature runes for the full next load of ores, do not touch the bank!
        if (held >= neededForTrip) {
            return;
        }

        const banked = Bank.count('Nature rune');
        // Always preserve at least 1 in the bank so the bank placeholder slot is never lost
        const availableInBank = Math.max(0, banked - 1);

        if (held + banked === 0) {
            ScriptRunner.stop('No Nature runes in bank or inventory!');
            return;
        }

        if (this.natureQty <= 0) {
            // Mode 0: Withdraw all available Nature runes (leaving 1 in bank)
            if (availableInBank > 0) {
                await Bank.withdrawX('Nature rune', availableInBank);
            } else if (held < neededForTrip) {
                ScriptRunner.stop('Insufficient Nature runes in bank (leaving 1 placeholder in bank).');
            }
        } else {
            // Configured target: Top-up to natureQty
            const shortfall = Math.max(0, this.natureQty - held);
            if (shortfall > 0) {
                const withdrawCount = Math.min(shortfall, availableInBank);
                if (withdrawCount > 0) {
                    await Bank.withdrawX('Nature rune', withdrawCount);
                } else if (held < neededForTrip) {
                    ScriptRunner.stop(`Cannot restock Nature runes: only ${banked} in bank (leaving 1 placeholder).`);
                }
            }
        }
    }

    private async ensureFireSource(neededForTrip: number): Promise<void> {
        if (this.isFireStaffEquipped()) {
            return;
        }

        // 1. Check if we have a staff in backpack
        for (const staff of FIRE_STAVES) {
            if (Inventory.contains(staff)) {
                await Equipment.equip(staff);
                if (this.isFireStaffEquipped()) {
                    return;
                }
            }
        }

        // 2. Check if bank holds a fire staff
        for (const staff of FIRE_STAVES) {
            if (Bank.count(staff) > 0) {
                await Bank.withdraw(staff, 'Withdraw-1');
                await Equipment.equip(staff);
                if (this.isFireStaffEquipped()) {
                    if (!Bank.isOpen()) {
                        await this.openBankFast();
                    }
                    return;
                }
            }
        }

        // 3. Fallback: Check Fire Runes (need 4 per bar)
        const fireNeeded = neededForTrip * 4;
        const heldFire = Inventory.count('Fire rune');
        if (heldFire >= fireNeeded) {
            return; // Already have enough Fire runes for this trip!
        }

        const bankedFire = Bank.count('Fire rune');
        const availableFire = Math.max(0, bankedFire - 1);

        if (availableFire > 0) {
            await Bank.withdrawX('Fire rune', availableFire);
        } else if (heldFire < fireNeeded) {
            ScriptRunner.stop('No Fire staff and insufficient Fire runes (leaving 1 placeholder in bank).');
        }
    }

    private getKeepList(): string[] {
        const keep = ['Nature rune'];
        if (!this.isFireStaffEquipped()) {
            keep.push('Fire rune');
        }
        for (const staff of FIRE_STAVES) {
            keep.push(staff);
        }
        return keep;
    }

    private async openBankFast(): Promise<boolean> {
        if (Bank.isOpen()) {
            return true;
        }

        const booth = Locs.query().name('Bank booth').where(l => l.actions().length > 0).nearest();
        if (!booth) {
            return Bank.openNearest('Bank booth', 'Use-quickly');
        }

        // If not adjacent (distance > 1), walk right next to the booth first
        if (booth.distance() > 1) {
            await Traversal.walkTo(booth.tile(), { radius: 1, timeoutMs: 5000 });
        }

        // Interact directly with Use-quickly / Bank
        const op = booth.actions().find(a => /use-quickly|^bank/i.test(a)) ?? booth.actions()[0] ?? 'Bank';
        await booth.interact(op);
        
        const opened = await Execution.delayUntilTicks(() => Bank.isOpen() || ChatDialog.canContinue(), 2);
        if (opened) {
            if (ChatDialog.canContinue()) {
                await ChatDialog.continue();
                await Execution.delayUntilTicks(() => Bank.isOpen(), 3);
            }
            return Bank.isOpen();
        }

        return Bank.openNearest('Bank booth', 'Use-quickly');
    }

    private hasEnoughSecondary(): boolean {
        if (!this.recipe.secondaryOre || this.recipe.secondaryPerPrimary === 0) {
            return true;
        }
        return Inventory.count(this.recipe.secondaryOre) >= this.recipe.secondaryPerPrimary;
    }

    // ------------------------------------------------------------------------
    // HUD / Overlay Paint
    // ------------------------------------------------------------------------
    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#ff4444' });
        const mins = (Date.now() - this.startedAt) / 60_000;
        const magicXp = Skills.xp('magic') - this.startMagicXp;
        const smithXp = Skills.xp('smithing') - this.startSmithXp;
        const perHour = mins > 0.5 ? Math.round((this.barsMade / mins) * 60) : 0;
        const magePerHour = mins > 0.5 ? Math.round((magicXp / mins) * 60) : 0;
        const smithPerHour = mins > 0.5 ? Math.round((smithXp / mins) * 60) : 0;
        const natureCount = Inventory.count('Nature rune');

        p.title(`Tick Superheater — ${this.state} (${this.recipe.name})`);
        p.row(`Runtime: ${fmtDuration(mins)}`, `Bars: ${this.barsMade} (${perHour}/hr)`, `Trips: ${this.trips}`);
        p.row(`Mage XP: +${magicXp.toLocaleString()} (${magePerHour.toLocaleString()}/hr)`, `Smith XP: +${smithXp.toLocaleString()} (${smithPerHour.toLocaleString()}/hr)`);
        p.row(`Natures: ${natureCount.toLocaleString()} (${this.natureQty === 0 ? 'All' : `target ${this.natureQty}`})`, `Staff: ${this.isFireStaffEquipped() ? 'Equipped' : 'Fire runes'}`);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}
