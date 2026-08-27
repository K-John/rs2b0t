import { LoopingBot, type LoopCadence } from '../../api/bot/Bot.js';
import { Bank } from '../../api/bank/Bank.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Players } from '../../api/players/Players.js';
import { Trade } from '../../api/trade/Trade.js';
import { isConfiguredPartner, namesMatch, parsePartnerList } from '../../api/trade/PartnerTrade.js';
import { Paint } from '../../paint/Paint.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { offerCount, offerMatchesExactly, parseTradeSpecs, type TradeSpec } from './MuleTraderLogic.js';

const TRADE_RANGE = 2;
const REQUEST_RETRY_TICKS = 5;
const HEADER_WAIT_TICKS = 8;

export const MULE_TRADER_SETTINGS: SettingsSchema = {
    role: {
        type: 'string', default: 'Distributor', options: ['Distributor', 'Receiver'], label: 'Role',
        help: 'Distributor gives the bundle to every partner. Receiver accepts the bundle from every partner.'
    },
    partners: {
        type: 'string', default: '', label: 'Partner account(s)',
        help: 'Comma-separated display names. Each account is traded once per script run.'
    },
    items: {
        type: 'string', default: 'Rune essence:5000, Lobster:1000', label: 'Trade bundle',
        help: 'Comma-separated Item name:quantity entries. Example: Rune essence:5000, Lobster:1000'
    }
};

type Role = 'Distributor' | 'Receiver';

export default class MuleTrader extends LoopingBot {
    override loopCadence: LoopCadence = { kind: 'server-tick', ticks: 1 };

    private role: Role = 'Distributor';
    private partners: string[] = [];
    private specs: TradeSpec[] = [];
    private completed = new Set<string>();
    private status = 'starting';
    private startedAt = Date.now();
    private lastRequestTick = -REQUEST_RETRY_TICKS;
    private headerWaitTicks = 0;
    private snapshot = new Map<string, number>();
    private pendingPartner: string | null = null;

    override onStart(): void {
        this.role = this.settings.str('role', 'Distributor') === 'Receiver' ? 'Receiver' : 'Distributor';
        this.partners = parsePartnerList(this.settings.str('partners', ''))
            .filter((name, index, all) => all.findIndex(other => namesMatch(name, other)) === index);
        this.specs = parseTradeSpecs(this.settings.str('items', ''));
        if (this.partners.length === 0 || this.specs.length === 0) {
            throw new Error('MuleTrader requires at least one partner and one Item name:quantity entry');
        }
        this.startedAt = Date.now();
        this.log(`${this.role} started — bundle ${this.bundleLabel()} — partners [${this.partners.join(', ')}]`);
    }

    async loop(): Promise<void> {
        if (!Game.ingame() || !Game.tile()) return;
        if (Trade.active()) {
            await this.driveTrade();
            return;
        }

        if (this.pendingPartner !== null) this.verifyClosedTrade();
        if (this.completed.size === this.partners.length) {
            ScriptRunner.stop(`MuleTrader complete: traded all ${this.completed.size} account(s)`);
            return;
        }

        if (this.role === 'Distributor' && !this.bundleInInventory()) {
            await this.loadBundle();
            return;
        }
        await this.findAndRequestPartner();
    }

    private async loadBundle(): Promise<void> {
        this.status = 'loading bundle at bank';
        if (!Bank.isOpen()) {
            await Bank.openNearest('Bank booth', 'Use-quickly');
            return;
        }
        await Bank.setNoteMode(true);
        for (const spec of this.specs) {
            const held = Inventory.count(spec.name);
            if (held >= spec.quantity) continue;
            const needed = spec.quantity - held;
            if (Bank.count(spec.name) < needed) {
                ScriptRunner.stop(`MuleTrader: need ${needed} more ${spec.name} for the next trade`);
                return;
            }
            await Bank.withdrawX(spec.name, needed);
            return;
        }
        await Bank.setNoteMode(false);
        await Bank.close();
    }

    private async findAndRequestPartner(): Promise<void> {
        const remaining = this.partners.filter(name => !this.completed.has(name.toLowerCase()));
        const player = Players.query().name(...remaining).within(TRADE_RANGE).nearest();
        if (!player?.name) {
            this.status = `waiting nearby (${remaining.length} remaining)`;
            return;
        }
        const tick = Game.tick();
        if (tick - this.lastRequestTick < REQUEST_RETRY_TICKS) return;
        this.status = `requesting ${player.name}`;
        await Trade.request(player.name);
        this.lastRequestTick = tick;
    }

    private async driveTrade(): Promise<void> {
        if (Trade.onConfirmScreen()) {
            const who = this.pendingPartner ?? Trade.partner();
            if (!who || !this.isRemainingPartner(who)) {
                await Trade.decline();
                return;
            }
            if (this.snapshot.size === 0) this.captureSnapshot();
            this.pendingPartner = who;
            this.status = `confirming with ${who}`;
            await Trade.accept();
            return;
        }
        if (!Trade.onOfferScreen()) return;

        const who = Trade.partner();
        if (who === null) {
            this.status = 'reading trade partner';
            if (++this.headerWaitTicks > HEADER_WAIT_TICKS) await Trade.decline();
            return;
        }
        this.headerWaitTicks = 0;
        if (!this.isRemainingPartner(who)) {
            this.log(`Declining ${who}: not an untraded configured partner`);
            await Trade.decline();
            return;
        }

        if (this.role === 'Distributor') await this.driveDistributor(who);
        else await this.driveReceiver(who);
    }

    private async driveDistributor(who: string): Promise<void> {
        if (Trade.theirOffer().length > 0) {
            this.log(`Declining ${who}: receiver unexpectedly offered items`);
            await Trade.decline();
            return;
        }
        const next = this.specs.find(spec => offerCount(Trade.myOffer(), spec.name) < spec.quantity);
        if (next) {
            const already = offerCount(Trade.myOffer(), next.name);
            const needed = next.quantity - already;
            this.status = `offering ${needed} ${next.name} to ${who}`;
            await Trade.offer(next.name, needed);
            return;
        }
        if (!offerMatchesExactly(Trade.myOffer(), this.specs)) {
            this.log(`Declining ${who}: own offer does not exactly match configured bundle`);
            await Trade.decline();
            return;
        }
        this.captureSnapshot();
        this.pendingPartner = who;
        this.status = `accepting offer with ${who}`;
        await Trade.accept();
    }

    private async driveReceiver(who: string): Promise<void> {
        if (Trade.myOffer().length > 0) {
            this.log(`Declining ${who}: receiver's own offer is not empty`);
            await Trade.decline();
            return;
        }
        if (!offerMatchesExactly(Trade.theirOffer(), this.specs)) {
            this.status = `waiting for exact bundle from ${who}`;
            return;
        }
        this.captureSnapshot();
        this.pendingPartner = who;
        this.status = `accepting bundle from ${who}`;
        await Trade.accept();
    }

    private verifyClosedTrade(): void {
        const who = this.pendingPartner;
        if (!who) return;
        const direction = this.role === 'Distributor' ? -1 : 1;
        const transferred = this.specs.every(spec =>
            Inventory.count(spec.name) - (this.snapshot.get(spec.name.toLowerCase()) ?? 0) === direction * spec.quantity
        );
        if (transferred) {
            this.completed.add(who.toLowerCase());
            this.log(`Completed ${this.role.toLowerCase()} trade with ${who} (${this.completed.size}/${this.partners.length})`);
        } else {
            this.log(`Trade with ${who} closed without the configured inventory delta; it remains pending`);
        }
        this.pendingPartner = null;
        this.snapshot.clear();
    }

    private captureSnapshot(): void {
        if (this.snapshot.size > 0) return;
        for (const spec of this.specs) this.snapshot.set(spec.name.toLowerCase(), Inventory.count(spec.name));
    }

    private bundleInInventory(): boolean {
        return this.specs.every(spec => Inventory.count(spec.name) >= spec.quantity);
    }

    private isRemainingPartner(name: string): boolean {
        return isConfiguredPartner(name, this.partners) && !this.completed.has(name.toLowerCase());
    }

    private bundleLabel(): string {
        return this.specs.map(spec => `${spec.quantity} ${spec.name}`).join(' + ');
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#d8b4fe' });
        p.title(`MuleTrader — ${this.role} — ${this.status}`);
        p.row(`Runtime: ${fmtDuration((Date.now() - this.startedAt) / 60_000)}`, `Done: ${this.completed.size}/${this.partners.length}`, `Remaining: ${this.partners.length - this.completed.size}`);
        p.row(`Bundle: ${this.bundleLabel()}`);
        ScriptRunner.paintControls(p);
        p.end();
    }
}
