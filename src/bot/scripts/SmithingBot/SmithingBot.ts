import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import Tile from '../../geometry/Tile.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Inventory, InvItem } from '../../api/inventory/Inventory.js';
import { Bank, withdrawOp } from '../../api/bank/Bank.js';
import { Skills } from '../../api/skills/Skills.js';
import { Paint } from '../../paint/Paint.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { Locs } from '../../api/locs/Locs.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { walkOpening } from '../../event/webwalk/walkOpening.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { reader, actions, type WorldTile } from '../../adapter/ClientAdapter.js';
import type { Loc } from '../../api/model/Loc.js';

export interface SmithingLocation {
    name: string;
    anvilStand: Tile;
    bankStand: Tile;
    hasDoor?: boolean;
    doorInside?: Tile;
    doorOutside?: Tile;
    roomBounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export const SMITHING_LOCATIONS: Record<string, SmithingLocation> = {
    'Varrock West': {
        name: 'Varrock West',
        anvilStand: new Tile(3188, 3427, 0),
        bankStand: new Tile(3185, 3436, 0),
        hasDoor: true,
        doorInside: new Tile(3187, 3427, 0),
        doorOutside: new Tile(3187, 3428, 0),
        roomBounds: { minX: 3185, maxX: 3190, minZ: 3420, maxZ: 3427 }
    },
    'Varrock East': {
        name: 'Varrock East',
        anvilStand: new Tile(3227, 3438, 0),
        bankStand: new Tile(3253, 3420, 0),
        hasDoor: false
    }
};

const BOOTH = { op: 'Use-quickly' };
const HAMMER = 'Hammer';
const ANVIL = 'Anvil';
const OPENABLE_OBSTACLES = ['door', 'gate'];
const BAR_OPTIONS = ['Bronze', 'Iron', 'Steel', 'Mithril', 'Adamant', 'Rune'];

const PRODUCT_OPTIONS = ['Dagger', 'Sword', 'Scimitar', 'Longsword', '2h sword', 'Axe', 'Mace', 'Warhammer', 'Battleaxe', 'Chainbody', 'Platelegs', 'Plateskirt', 'Platebody', 'Med helm', 'Full helm', 'Sq shield', 'Kiteshield', 'Nails', 'Dart tip', 'Arrowtips', 'Knife', 'Wire', 'Claws'];

export const SETTINGS: SettingsSchema = {
    location: {
        type: 'string',
        default: 'Varrock West',
        options: [...Object.keys(SMITHING_LOCATIONS), 'Custom Coordinates'],
        label: 'Location',
        help: 'Select pre-configured smithing location (Varrock West includes 1-tick anti-troll door bypass) or Custom Coordinates'
    },
    bar: { type: 'string', default: 'Bronze', options: BAR_OPTIONS, label: 'Bar tier' },
    product: {
        type: 'string',
        default: 'Dagger',
        options: PRODUCT_OPTIONS,
        label: 'Item to smith',
        help: 'matched against the anvil panel by keyword (the panel names are tier-specific, e.g. "Bronze dagger")'
    },
    anvilStand: { type: 'tile', default: new Tile(3188, 3427, 0), label: 'Custom Anvil stand tile (x,z)' },
    bankStand: { type: 'tile', default: new Tile(3185, 3436, 0), label: 'Custom Bank stand tile (x,z)' },
    bankBooth: { type: 'string', default: 'Bank booth', label: 'Bank booth loc name' },
    leashRadius: { type: 'number', default: 6, min: 2, max: 20, label: 'Anvil search radius (tiles)' }
};

export default class SmithingBot extends TaskBot {
    override loopDelay = 600;

    private made = 0;
    private trips = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;

    private locationName = 'Varrock West';
    private currentLoc: SmithingLocation | null = SMITHING_LOCATIONS['Varrock West']!;
    private bar = 'Bronze';
    private product = 'Dagger';
    private anvilStand = new Tile(3188, 3427, 0);
    private bankStand = new Tile(3185, 3436, 0);
    private boothName = 'Bank booth';
    private leash = 6;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.locationName = this.settings.str('location', 'Varrock West');
        if (this.locationName in SMITHING_LOCATIONS) {
            this.currentLoc = SMITHING_LOCATIONS[this.locationName]!;
            this.anvilStand = this.currentLoc.anvilStand;
            this.bankStand = this.currentLoc.bankStand;
        } else {
            this.currentLoc = null;
            this.anvilStand = this.settings.tile('anvilStand', new Tile(3188, 3427, 0));
            this.bankStand = this.settings.tile('bankStand', new Tile(3185, 3436, 0));
        }

        this.bar = this.settings.str('bar', 'Bronze');
        this.product = this.settings.str('product', 'Dagger');
        this.boothName = this.settings.str('bankBooth', 'Bank booth');
        this.leash = this.settings.num('leashRadius', 6);

        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('smithing');

        this.log(
            `SmithingBot smithing ${this.bar} → ${this.product} at ${this.locationName} — anvil ${this.anvilStand}, bank ${this.bankStand}`
        );
        this.add(new ContinueDialog(), new SmithPanel(this), new BankTrip(this), new Smith(this));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#ffb066' });
        p.title(`SmithingBot — ${this.status} (${this.locationName})`);

        const mins = (Date.now() - this.startedAt) / 60_000;
        const xph = mins > 0.5 ? `${(((Skills.xp('smithing') - this.xpAtStart) / mins) * 60 / 1000).toFixed(1)}k` : '—';
        p.row(`Runtime: ${fmtDuration(mins)}`, `Bars used: ${this.made}`, `XP/hr: ${xph}`);
        p.row(`${this.bar} ${this.product}`, `Bars left: ${this.barCount()}`, `Bank trips: ${this.trips}`);

        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }

    setStatus(s: string): void { this.status = s; }
    recordMade(n: number): void { this.made += n; }
    countTrip(): void { this.trips++; }
    productName(): string { return this.product; }
    hammerName(): string { return HAMMER; }
    barItemName(): string { return `${this.bar} bar`; }
    anvilLocName(): string { return ANVIL; }
    anvilTile(): Tile { return this.anvilStand; }
    bankTile(): Tile { return this.bankStand; }
    boothLocName(): string { return this.boothName; }
    obstacleList(): string[] { return OPENABLE_OBSTACLES; }
    leashRadius(): number { return this.leash; }
    getLocation(): SmithingLocation | null { return this.currentLoc; }

    directStep(worldX: number, worldZ: number): boolean {
        const loc = reader.toLocal(worldX, worldZ);
        if (!loc) return false;
        return actions.walkTo(loc.lx, loc.lz);
    }

    isInsideRoom(tile: WorldTile | null): boolean {
        if (!tile || !this.currentLoc?.roomBounds) return false;
        const { minX, maxX, minZ, maxZ } = this.currentLoc.roomBounds;
        return tile.x >= minX && tile.x <= maxX && tile.z >= minZ && tile.z <= maxZ && tile.level === 0;
    }

    findDoor(): Loc | null {
        if (!this.currentLoc?.hasDoor || !this.currentLoc.doorInside || !this.currentLoc.doorOutside) return null;
        const dx = this.currentLoc.doorInside.x;
        const dz1 = this.currentLoc.doorInside.z;
        const dz2 = this.currentLoc.doorOutside.z;
        return Locs.query()
            .where(l => {
                if (!l.name) return false;
                const n = l.name.toLowerCase();
                if (!n.includes('door') && !n.includes('gate')) return false;
                const t = l.tile();
                return Math.abs(t.x - dx) <= 1 && (t.z === dz1 || t.z === dz2);
            })
            .first();
    }

    async openBankFast(): Promise<boolean> {
        if (Bank.isOpen() && Bank.loaded()) {
            return true;
        }

        const booth = Locs.query().name(this.boothName).where(l => l.actions().length > 0).nearest();
        if (!booth) {
            return Bank.openNearest(this.boothName, BOOTH.op);
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

        return Bank.openNearest(this.boothName, BOOTH.op);
    }

    barCount(): number {
        const pat = this.barItemName().toLowerCase();
        return Inventory.items().filter(i => i.name?.toLowerCase().includes(pat)).reduce((n, i) => n + Math.max(1, i.count), 0);
    }

    lastBar(): InvItem | null {
        const pat = this.barItemName().toLowerCase();
        const items = Inventory.items();
        for (let i = items.length - 1; i >= 0; i--) {
            if (items[i].name?.toLowerCase().includes(pat)) {
                return items[i];
            }
        }
        return null;
    }

    hammerItem(): InvItem | null {
        const pat = HAMMER.toLowerCase();
        return Inventory.items().find(i => i.name?.toLowerCase().includes(pat)) ?? null;
    }
}

class SmithPanel implements Task {
    constructor(private bot: SmithingBot) {}
    validate(): boolean { return ChatDialog.isMainMakePanel(); }
    async execute(): Promise<void> {
        this.bot.setStatus('choosing item');
        const start = this.bot.barCount();
        if (!(await ChatDialog.makeFromPanelMax(this.bot.productName()))) {
            const products = ChatDialog.mainMakeProducts().filter(Boolean);
            if (products.length === 0) { await Execution.delayTicks(1); return; }
            this.bot.setStatus(`'${this.bot.productName()}' not available — stopped`);
            ScriptRunner.stop(`'${this.bot.productName()}' isn't on the ${this.bot.barItemName()} anvil panel — available: [${products.join(', ')}] — pick a listed item`);
            return;
        }
        await Execution.delayUntil(() => Game.animating() || this.bot.barCount() < start || ChatDialog.isMainMakePanel() || ChatDialog.canContinue(), 3000);
        let mark = this.bot.barCount();
        for (let guard = 0; guard < 200; guard++) {
            if (this.bot.barCount() === 0 || ChatDialog.isMainMakePanel() || ChatDialog.canContinue()) { return; }
            const progressed = await Execution.delayUntil(() => this.bot.barCount() < mark || ChatDialog.isMainMakePanel() || ChatDialog.canContinue(), 4000);
            const now = this.bot.barCount();
            if (now < mark) {
                this.bot.recordMade(mark - now);
                mark = now;
            } else if (!progressed || !Game.animating()) {
                return;
            }
        }
    }
}

class BankTrip implements Task {
    constructor(private bot: SmithingBot) {}
    validate(): boolean { return this.bot.barCount() === 0; }
    async execute(): Promise<void> {
        this.bot.setStatus('banking');
        const here = Game.tile();
        if (!here) return;

        const loc = this.bot.getLocation();

        // 1. Anti-Troll Door Handling (e.g. Varrock West)
        if (loc?.hasDoor && loc.doorInside && loc.doorOutside && this.bot.isInsideRoom(here)) {
            const distToDoor = Math.max(Math.abs(here.x - loc.doorInside.x), Math.abs(here.z - loc.doorInside.z));
            if (distToDoor > 1) {
                await Traversal.walkTo(loc.doorInside, { radius: 0 });
                return;
            }

            // At inside door tile: Check door state
            const door = this.bot.findDoor();
            if (door) {
                const hasOpen = door.actions().some(a => /open/i.test(a));
                if (hasOpen) {
                    this.bot.log('Opening door to exit...');
                    await door.interact('Open');
                    await Execution.delayTicks(1);
                }
            }

            // Direct local step through doorway to outside
            this.bot.log(`Stepping outside through doorway to (${loc.doorOutside.x}, ${loc.doorOutside.z})...`);
            this.bot.directStep(loc.doorOutside.x, loc.doorOutside.z);

            // Wait up to 2 ticks to confirm transition outside
            await Execution.delayUntilTicks(() => {
                const t = Game.tile();
                return t !== null && !this.bot.isInsideRoom(t);
            }, 2);
            return;
        }

        // 2. Outside building: Walk to bank stand
        const distToBank = Math.max(Math.abs(here.x - this.bot.bankTile().x), Math.abs(here.z - this.bot.bankTile().z));
        if (distToBank > 2) {
            if (loc?.hasDoor) {
                await Traversal.walkTo(this.bot.bankTile(), { radius: 1 });
            } else {
                await walkOpening(this.bot.bankTile(), 0, this.bot.obstacleList(), m => this.bot.log(m));
            }
            return;
        }

        // 3. Open bank fast
        if (!Bank.isOpen()) {
            const opened = await this.bot.openBankFast();
            if (!opened) {
                this.bot.log('could not open the bank — will retry');
                return;
            }
        }

        // Ensure bank item array is populated
        if (!Bank.loaded() || !Bank.snapshotReady()) {
            await Execution.delayUntilTicks(() => Bank.loaded() && Bank.snapshotReady(), 3);
        }

        const hammerPat = this.bot.hammerName().toLowerCase();
        await Bank.depositAllMatching(name => !name.toLowerCase().includes(hammerPat));
        await Execution.delayTicks(1);
        this.bot.countTrip();

        // Ensure hammer in backpack
        if (!this.bot.hammerItem()) {
            const hammerBank = Bank.items().find(i => i.name !== null && i.name.toLowerCase().includes(hammerPat));
            if (!hammerBank || hammerBank.name === null) {
                this.bot.log(`no '${this.bot.hammerName()}' carried or in the bank — idling`);
                await Execution.delayTicks(5);
                return;
            }
            const hammerName = hammerBank.name;
            const hOps = hammerBank.ops.filter((o): o is string => o !== null);
            const oneOp = withdrawOp(hOps, '1') ?? withdrawOp(hOps, 'any') ?? 'Withdraw-1';
            await Bank.withdraw(hammerName, oneOp);
            await Execution.delayUntilTicks(() => this.bot.hammerItem() !== null, 3);
        }

        // Withdraw bars
        const barBank = Bank.items().find(i => i.name !== null && i.name.toLowerCase().includes(this.bot.barItemName().toLowerCase()));
        if (!barBank || barBank.name === null) {
            this.bot.log(`no '${this.bot.barItemName()}' in the bank — idling`);
            await Execution.delayTicks(5);
            return;
        }
        const barName = barBank.name;
        const allOp = withdrawOp(barBank.ops, 'all');
        if (allOp) {
            this.bot.log(`withdrawing all ${barName} ('${allOp}')`);
            await Bank.withdraw(barName, allOp);
            await Execution.delayUntilTicks(() => this.bot.barCount() > 0, 3);
        } else {
            const tenOp = withdrawOp(barBank.ops, '10') ?? withdrawOp(barBank.ops, 'any') ?? 'Withdraw-10';
            for (let n = 0; n < 4 && !Inventory.isFull() && Bank.count(barName) > 0; n++) {
                const before = this.bot.barCount();
                await Bank.withdraw(barName, tenOp);
                if (!(await Execution.delayUntil(() => this.bot.barCount() > before || Inventory.isFull(), 3000))) { break; }
            }
        }

        await Bank.close();
    }
}

class Smith implements Task {
    constructor(private bot: SmithingBot) {}
    validate(): boolean { return this.bot.barCount() > 0 && !ChatDialog.isOpen() && !ChatDialog.isMainMakePanel(); }
    async execute(): Promise<void> {
        const here = Game.tile();
        if (!here) return;

        const loc = this.bot.getLocation();

        // 1. Anti-Troll Door Handling (e.g. Varrock West)
        if (loc?.hasDoor && loc.doorInside && loc.doorOutside && !this.bot.isInsideRoom(here)) {
            const distToDoor = Math.max(Math.abs(here.x - loc.doorOutside.x), Math.abs(here.z - loc.doorOutside.z));
            if (distToDoor > 1) {
                this.bot.setStatus('walking to anvil door');
                await Traversal.walkTo(loc.doorOutside, { radius: 0 });
                return;
            }

            // At outside door tile: Check door state
            const door = this.bot.findDoor();
            if (door) {
                const hasOpen = door.actions().some(a => /open/i.test(a));
                if (hasOpen) {
                    this.bot.log('Opening door to enter anvil room...');
                    await door.interact('Open');
                    await Execution.delayTicks(1);
                }
            }

            // Direct local step through doorway into room
            this.bot.log(`Stepping through doorway into (${loc.doorInside.x}, ${loc.doorInside.z})...`);
            this.bot.directStep(loc.doorInside.x, loc.doorInside.z);

            // Wait up to 2 ticks to confirm transition inside
            await Execution.delayUntilTicks(() => {
                const t = Game.tile();
                return t !== null && this.bot.isInsideRoom(t);
            }, 2);
            return;
        }

        // 2. Inside room (or location without door): Check distance to anvil stand
        const anvil = () =>
            Locs.query().name(this.bot.anvilLocName()).withinOf(this.bot.anvilTile(), this.bot.leashRadius()).nearest();

        const distToAnvil = Math.max(Math.abs(here.x - this.bot.anvilTile().x), Math.abs(here.z - this.bot.anvilTile().z));
        if (distToAnvil > 1 || !anvil()) {
            this.bot.setStatus('walking to the anvil');
            if (loc?.hasDoor) {
                await Traversal.walkTo(this.bot.anvilTile(), { radius: 1 });
            } else {
                await walkOpening(this.bot.anvilTile(), 0, this.bot.obstacleList(), m => this.bot.log(m));
            }
            return;
        }

        if (!this.bot.hammerItem()) {
            this.bot.log('no hammer in the pack — idling (need a hammer to smith)');
            await Execution.delayTicks(5);
            return;
        }

        const bar = this.bot.lastBar();
        const av = anvil();
        if (!bar || !av) { await Execution.delayTicks(2); return; }
        this.bot.setStatus(`smithing ${this.bot.productName()}`);
        if (!(await bar.useOn(av))) { await Execution.delayTicks(2); return; }
        await Execution.delayUntil(() => ChatDialog.isMainMakePanel() || ChatDialog.canContinue() || this.bot.barCount() === 0, 6000);
    }
}
