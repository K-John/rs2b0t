import { actions, reader } from '../../adapter/ClientAdapter.js';
import { MiniMenuAction } from '#/client/shell/MiniMenuAction.js';
import { depositAllExcept } from '../../api/bank/Banking.js';
import { LoopingBot, type LoopCadence } from '../../api/bot/Bot.js';
import { Game } from '../../api/game/Game.js';
import { Bank, withdrawOp } from '../../api/bank/Bank.js';
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
// 1. Data Structures & Constants
// ============================================================================

/**
 * Known Unstrung Bow Item IDs in 2004Scape / RS2.
 * Unstrung and strung longbows share the exact same display name (e.g. "Magic longbow").
 * These IDs must NEVER be withdrawn or alched.
 */
export const UNSTRUNG_BOW_IDS = new Set<number>([
    48, // Longbow (u)
    50, // Shortbow (u)
    54, // Oak shortbow (u)
    56, // Oak longbow (u)
    58, // Willow longbow (u)
    60, // Willow shortbow (u)
    62, // Maple longbow (u)
    64, // Maple shortbow (u)
    66, // Yew longbow (u)
    68, // Yew shortbow (u)
    70, // Magic longbow (u)
    72  // Magic shortbow (u)
]);

export const STRUNG_BOW_IDS = new Set<number>([
    839, // Longbow
    841, // Shortbow
    843, // Oak shortbow
    845, // Oak longbow
    847, // Willow longbow
    849, // Willow shortbow
    851, // Maple longbow
    853, // Maple shortbow
    855, // Yew longbow
    857, // Yew shortbow
    859, // Magic longbow
    861  // Magic shortbow
]);

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

export const HIGH_ALCHER_SETTINGS: SettingsSchema = {
    items: {
        type: 'string',
        default: 'Magic longbow, Yew longbow, Maple longbow, Rune 2h sword, Steel platebody',
        label: 'Items to high alch',
        help: 'Comma-separated list of item names to alch in priority order (e.g. "Magic longbow, Yew longbow, Maple longbow"). Advances to the next item when one runs out.'
    },
    chunkSize: {
        type: 'number',
        default: 100,
        min: 0,
        max: 100000,
        label: 'Batch / Chunk size',
        help: 'Maximum number of items to withdraw as noted per bank trip to limit risk on death (0 = withdraw all available).'
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
    ALCHING = 'High Alching'
}

export function isUnstrungBow(id: number, name: string | null): boolean {
    if (UNSTRUNG_BOW_IDS.has(id)) {
        return true;
    }
    if (name && /unstrung|\(u\)/i.test(name)) {
        return true;
    }
    return false;
}

export function matchesAlchTarget(
    item: { id: number; name: string | null; ops?: readonly (string | null)[] },
    targetName: string
): boolean {
    if (!item.name) return false;
    const targetClean = targetName.trim().toLowerCase();
    const itemClean = item.name.trim().toLowerCase();

    if (itemClean !== targetClean) return false;

    // Safety guard: If targeting a bow, NEVER match unstrung bow IDs!
    if (targetClean.includes('bow')) {
        if (UNSTRUNG_BOW_IDS.has(item.id)) {
            return false;
        }
        if (isUnstrungBow(item.id, item.name)) {
            return false;
        }
    }

    return true;
}

function getHighAlchComId(): number {
    const magicRoot = reader.sideTabInterface(6);
    if (magicRoot === -1) {
        return -1;
    }
    const comId = reader.targetButtonByBase(magicRoot, 'High Level Alchemy');
    if (comId !== -1) return comId;
    return reader.targetButtonByBase(magicRoot, 'High level alchemy');
}

function castHighAlchOn(item: InvItem): boolean {
    const comId = getHighAlchComId();
    if (comId === -1) {
        return false;
    }
    return (
        actions.menuAction(MiniMenuAction.TGT_BUTTON, 0, 0, comId) &&
        actions.menuAction(MiniMenuAction.TGT_HELD, item.id, item.slot, item.snap.comId)
    );
}

// ============================================================================
// 2. HighAlcher Bot Implementation
// ============================================================================

export default class HighAlcher extends LoopingBot {
    override loopCadence: LoopCadence = { kind: 'server-tick', ticks: 1 };

    private state: BotState = BotState.BANKING;
    private itemTargets: string[] = [];
    private activeTargetIndex = 0;
    private chunkSize = 100;
    private natureQty = 0;

    private lastCastTick = 0;
    private emptyBankRetries = 0;
    private alchedCount = 0;
    private trips = 0;

    private startMagicXp = 0;
    private startCoins = 0;
    private startedAt = Date.now();

    override onStart(): void {
        const itemsSetting = this.settings.str('items', 'Magic longbow, Yew longbow, Maple longbow');
        this.itemTargets = itemsSetting
            .split(',')
            .map(s => s.trim())
            .filter(s => s.length > 0);

        this.chunkSize = this.settings.num('chunkSize', 100);
        this.natureQty = this.settings.num('natureQty', 0);
        this.activeTargetIndex = 0;
        this.emptyBankRetries = 0;

        const magicLevel = Skills.level('magic');
        if (magicLevel < 55) {
            ScriptRunner.stop(`High Level Alchemy requires Magic level 55 (you have ${magicLevel}).`);
            return;
        }

        if (this.itemTargets.length === 0) {
            ScriptRunner.stop('No items specified to high alch in settings!');
            return;
        }

        this.startMagicXp = Skills.xp('magic');
        this.startCoins = Inventory.count('Coins');
        this.startedAt = Date.now();

        this.log(
            `HighAlcher started — Targets: [${this.itemTargets.join(', ')}]. Chunk size: ${
                this.chunkSize === 0 ? 'All' : this.chunkSize
            } (Noted). Nature target: ${this.natureQty === 0 ? 'All (leaving 1 placeholder)' : this.natureQty}`
        );
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

            case BotState.ALCHING:
                await this.handleAlching(currentTick);
                break;
        }
    }

    // ------------------------------------------------------------------------
    // High Alchemy (5-Tick Execution)
    // ------------------------------------------------------------------------
    private async handleAlching(currentTick: number): Promise<void> {
        // 1. Verify required runes (1 Nature + 5 Fire per cast)
        const hasNature = Inventory.contains('Nature rune');
        const hasFire = this.isFireCovered();
        if (!hasNature || !hasFire) {
            this.log('Missing runes for High Level Alchemy. Heading to bank.');
            this.state = BotState.BANKING;
            return;
        }

        // 2. Find next valid item in backpack to alch
        const itemToAlch = this.findAlchItemInPack();
        if (!itemToAlch) {
            this.log('No alchable items left in backpack. Heading to bank.');
            this.state = BotState.BANKING;
            return;
        }

        // 3. 5-Tick Cadence Gate
        // High Level Alchemy takes exactly 5 server ticks (3.0s).
        const elapsed = currentTick - this.lastCastTick;
        if (this.lastCastTick > 0 && elapsed < 5) {
            return; // In active cast cooldown — yield to engine
        }

        // 4. Dispatch High Level Alchemy on the target item
        const success = castHighAlchOn(itemToAlch);
        if (success) {
            this.lastCastTick = currentTick;
            this.alchedCount++;
        } else {
            this.log('Could not cast High Level Alchemy — checking Magic tab.');
        }
    }

    // ------------------------------------------------------------------------
    // Banking & Auto-restock
    // ------------------------------------------------------------------------
    private async handleBanking(currentTick: number): Promise<void> {
        // 1. Wait for last High Alch cast (5 ticks) and active animation to complete before clicking bank
        const elapsed = currentTick - this.lastCastTick;
        if (this.lastCastTick > 0 && (elapsed < 5 || Game.animating())) {
            return; // Still in the 5-tick alch animation/cooldown — yield to engine
        }

        // 2. If we already have items to alch and runes in backpack, resume alching immediately
        const hasAlchItem = this.findAlchItemInPack() !== null;
        const hasRunes = Inventory.contains('Nature rune') && this.isFireCovered();
        if (hasAlchItem && hasRunes) {
            this.state = BotState.ALCHING;
            this.lastCastTick = 0;
            return;
        }

        // 3. Open nearest bank booth fast
        if (!Bank.isOpen()) {
            const opened = await this.openBankFast();
            if (!opened) {
                this.log('Could not open nearest bank booth — retrying.');
                return;
            }
        }

        // Ensure bank item array is populated
        if (!Bank.loaded() || !Bank.snapshotReady()) {
            await Execution.delayUntilTicks(() => Bank.loaded() && Bank.snapshotReady(), 3);
        }

        // 4. Deposit non-essential items (keep runes, fire staves, coins, and valid alch targets)
        const keepList = this.getKeepList();
        await Bank.depositAllMatching(depositAllExcept(keepList));
        await Execution.delayTicks(1);

        // Calculate maximum alchs possible based on nature runes and space
        const approxNeeded = this.chunkSize > 0 ? this.chunkSize : 500;

        // Auto-detect and equip/withdraw Fire Staff or Fire Runes (5 per alch)
        await this.ensureFireSource(approxNeeded);

        // Restock Nature Runes (1 per alch)
        await this.restockNatureRunes(approxNeeded);

        // 5. Select and withdraw next item target as NOTED
        const withdrawn = await this.withdrawNextAlchTarget();
        if (!withdrawn) {
            if (this.emptyBankRetries < 3) {
                this.emptyBankRetries++;
                this.log(`Bank scan for alch targets read 0 — retrying (attempt ${this.emptyBankRetries}/3)...`);
                await Execution.delayTicks(2);
                return;
            }
            ScriptRunner.stop('No items from the alch list remain in the bank or inventory!');
            return;
        }

        this.emptyBankRetries = 0;

        // Close bank
        await Bank.close();

        this.trips++;
        this.lastCastTick = 0;
        this.state = BotState.ALCHING;
    }

    private async withdrawNextAlchTarget(): Promise<boolean> {
        // If we already hold alch targets in backpack, proceed
        if (this.findAlchItemInPack() !== null) {
            return true;
        }

        const freeSlots = Inventory.free();
        if (freeSlots <= 0) {
            this.log('No free inventory slots for alch items.');
            return false;
        }

        // Search bank starting from activeTargetIndex through the end of the target list
        for (let i = 0; i < this.itemTargets.length; i++) {
            const targetIndex = (this.activeTargetIndex + i) % this.itemTargets.length;
            const targetName = this.itemTargets[targetIndex]!;

            // Find bank item by ID and ensure it is NOT an unstrung bow
            const bankItem = Bank.items().find(item => matchesAlchTarget(item, targetName));
            if (!bankItem || !bankItem.name) {
                continue;
            }

            // Authoritative count by specific item ID
            const inBank = Bank.countById(bankItem.id);
            if (inBank <= 0) {
                continue;
            }

            // Target found with stock! Update activeTargetIndex
            this.activeTargetIndex = targetIndex;

            let withdrawQty = inBank;
            if (this.chunkSize > 0) {
                withdrawQty = Math.min(this.chunkSize, inBank);
            }

            this.log(
                `Withdrawing ${withdrawQty}x '${bankItem.name}' (ID: ${bankItem.id}) as NOTED (Target ${targetIndex + 1}/${this.itemTargets.length})`
            );

            // Enable note mode in bank interface before withdrawing
            await Bank.setNoteMode(true);

            if (withdrawQty >= inBank || (this.chunkSize === 0 && withdrawQty > 28)) {
                const allOp = withdrawOp(bankItem.ops, 'all');
                if (allOp) {
                    await Bank.withdrawById(bankItem.id, allOp);
                } else {
                    await Bank.withdrawXById(bankItem.id, withdrawQty);
                }
            } else {
                await Bank.withdrawXById(bankItem.id, withdrawQty);
            }

            await Execution.delayUntilTicks(() => this.findAlchItemInPack() !== null, 3);
            return this.findAlchItemInPack() !== null;
        }

        return false;
    }

    private findAlchItemInPack(): InvItem | null {
        const packItems = Inventory.items();

        // 1. Try matching the current active target first
        if (this.itemTargets.length > 0) {
            const currentTarget = this.itemTargets[this.activeTargetIndex]!;
            const item = packItems.find(i => matchesAlchTarget(i, currentTarget));
            if (item) return item;
        }

        // 2. Fallback: match any target in the configured list
        for (const target of this.itemTargets) {
            const item = packItems.find(i => matchesAlchTarget(i, target));
            if (item) return item;
        }

        return null;
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
        return Inventory.count('Fire rune') >= 5;
    }

    private async restockNatureRunes(neededForTrip: number): Promise<void> {
        const held = Inventory.count('Nature rune');

        if (held >= neededForTrip) {
            return; // Already have enough Nature runes!
        }

        const banked = Bank.count('Nature rune');
        const availableInBank = Math.max(0, banked - 1); // Preserve 1 placeholder

        if (held + banked === 0) {
            if (this.emptyBankRetries < 3) {
                this.emptyBankRetries++;
                await Execution.delayTicks(2);
                return;
            }
            ScriptRunner.stop('No Nature runes in bank or inventory!');
            return;
        }

        if (this.natureQty <= 0) {
            // Mode 0: Withdraw all available Nature runes (leaving 1 in bank)
            if (availableInBank > 0) {
                await Bank.withdrawX('Nature rune', availableInBank);
                await Execution.delayUntilTicks(() => Inventory.count('Nature rune') > held, 3);
            } else if (held === 0) {
                if (this.emptyBankRetries < 3) {
                    this.emptyBankRetries++;
                    await Execution.delayTicks(2);
                    return;
                }
                ScriptRunner.stop('Insufficient Nature runes in bank (leaving 1 placeholder in bank).');
            }
        } else {
            // Configured target: Top-up to natureQty
            const shortfall = Math.max(0, this.natureQty - held);
            if (shortfall > 0) {
                const withdrawCount = Math.min(shortfall, availableInBank);
                if (withdrawCount > 0) {
                    await Bank.withdrawX('Nature rune', withdrawCount);
                    await Execution.delayUntilTicks(() => Inventory.count('Nature rune') > held, 3);
                } else if (held === 0) {
                    if (this.emptyBankRetries < 3) {
                        this.emptyBankRetries++;
                        await Execution.delayTicks(2);
                        return;
                    }
                    ScriptRunner.stop(`Cannot restock Nature runes: only ${banked} in bank (leaving 1 placeholder).`);
                }
            }
        }
    }

    private async ensureFireSource(neededForTrip: number): Promise<void> {
        if (this.isFireStaffEquipped()) {
            return;
        }

        // 1. Check if we have a fire staff in backpack
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
                await Bank.setNoteMode(false); // Staves must be unnoted to equip
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

        // 3. Fallback: Check Fire Runes (need 5 per alch)
        const fireNeeded = neededForTrip * 5;
        const heldFire = Inventory.count('Fire rune');
        if (heldFire >= fireNeeded) {
            return;
        }

        const bankedFire = Bank.count('Fire rune');
        const availableFire = Math.max(0, bankedFire - 1);

        if (availableFire > 0) {
            await Bank.withdrawX('Fire rune', availableFire);
            await Execution.delayUntilTicks(() => Inventory.count('Fire rune') > heldFire, 3);
        } else if (heldFire < 5) {
            if (this.emptyBankRetries < 3) {
                this.emptyBankRetries++;
                await Execution.delayTicks(2);
                return;
            }
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
        for (const item of this.itemTargets) {
            keep.push(item);
        }
        return keep;
    }

    private async openBankFast(): Promise<boolean> {
        if (Bank.isOpen() && Bank.loaded()) {
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
            if (Bank.isOpen()) {
                await Execution.delayUntilTicks(() => Bank.loaded() && Bank.snapshotReady(), 3);
                return true;
            }
        }

        return Bank.openNearest('Bank booth', 'Use-quickly');
    }

    // ------------------------------------------------------------------------
    // HUD / Overlay Paint
    // ------------------------------------------------------------------------
    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#ffcc00' });
        const mins = (Date.now() - this.startedAt) / 60_000;
        const magicXp = Skills.xp('magic') - this.startMagicXp;
        const perHour = mins > 0.5 ? Math.round((this.alchedCount / mins) * 60) : 0;
        const magePerHour = mins > 0.5 ? Math.round((magicXp / mins) * 60) : 0;
        const natureCount = Inventory.count('Nature rune');
        const coinsNow = Inventory.count('Coins');
        const coinsGained = Math.max(0, coinsNow - this.startCoins);

        const currentTarget = this.itemTargets[this.activeTargetIndex] ?? 'None';

        p.title(`HighAlcher — ${this.state}`);
        p.row(
            `Runtime: ${fmtDuration(mins)}`,
            `Alched: ${this.alchedCount} (${perHour}/hr)`,
            `Trips: ${this.trips}`
        );
        p.row(
            `Magic XP: +${magicXp.toLocaleString()} (${magePerHour.toLocaleString()}/hr)`,
            `Coins: +${coinsGained.toLocaleString()} gp`
        );
        p.row(
            `Target: ${currentTarget} (${this.activeTargetIndex + 1}/${this.itemTargets.length})`,
            `Natures: ${natureCount.toLocaleString()}`
        );
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}
