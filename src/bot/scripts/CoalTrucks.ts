import { LoopingBot } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { EventSignal } from '../api/EventSignal.js';
import { Game } from '../api/Game.js';
import type Tile from '../api/Tile.js';
import { Traversal } from '../api/Traversal.js';
import { depositMatcher } from '../api/Banking.js';
import { Bank } from '../api/hud/Bank.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Equipment } from '../api/hud/Equipment.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Paint } from '../api/hud/Paint.js';
import { Skills } from '../api/hud/Skills.js';
import { fmtDuration } from '../api/hud/paintLogic.js';
import { Locs, type Loc } from '../api/queries/Locs.js';
import { GameMessages } from '../events/gameMessages.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import { GAS_ROCK_IDS } from './MiningRocks.js';
import { bestPickaxe } from './Tools.js';
import {
    COAL,
    COAL_MINING_LEVEL,
    COAL_ROCK_IDS,
    MINE_ANCHOR,
    MINE_OP,
    MINE_TRUCK,
    MINE_TRUCK_STAND,
    REMOVE_OP,
    ROCK_LOC,
    SEERS_BANK,
    SEERS_TRUCK,
    SEERS_TRUCK_STAND,
    TRUCK_LEASH,
    TRUCK_LOC,
    TRUCK_MAX,
    classifyDeposit,
    classifyRemove,
    decide,
    phaseAfterDeposit,
    truckEmptyAfterRemove,
    type DepositResult,
    type Phase,
    type RemoveResult
} from './CoalTrucksLogic.js';

const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };
const MESSAGE_WAIT_MS = 5000;
const MINE_STALL_MS = 20_000;
const RESPAWN_WAIT_TICKS = 5;
const ROCK_LEASH = 12;
const MAX_BANK_FAILS = 6;

export default class CoalTrucks extends LoopingBot {
    override loopDelay = 0;

    private phase: Phase = 'fill';
    private truckEmpty = false;
    private depositedEstimate = 0;
    private banked = 0;
    private trips = 0;
    private bankFails = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpStart = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.startedAt = Date.now();
        this.xpStart = Skills.xp('mining');

        const level = Skills.level('mining');
        if (level < COAL_MINING_LEVEL) {
            this.log(`CoalTrucks: Mining ${COAL_MINING_LEVEL} required to mine coal (have ${level}). Stopping.`);
            throw new Error('CoalTrucks: Mining level too low');
        }

        this.log(`CoalTrucks — mine ${MINE_ANCHOR}, truck ${MINE_TRUCK}, Seers truck ${SEERS_TRUCK}, bank ${SEERS_BANK}`);
        this.log('no combat handling: the level-27 giant bats here are aggressive below 55 combat');
    }

    override grindTargets(): string[] {
        return [ROCK_LOC];
    }

    override recoveryAnchor(): Tile {
        return MINE_ANCHOR;
    }

    override async loop(): Promise<void> {
        const action = decide({
            phase: this.phase,
            packFull: Inventory.isFull(),
            coalHeld: Inventory.count(COAL),
            rockAvailable: this.findRock() !== null,
            truckEmpty: this.truckEmpty
        });

        switch (action.kind) {
            case 'mine':
                await this.mine();
                break;
            case 'await-rocks':
                this.status = 'waiting for a coal respawn';
                await Execution.delayTicks(RESPAWN_WAIT_TICKS);
                break;
            case 'deposit':
                await this.deposit();
                break;
            case 'travel-to-seers':
                this.status = 'running the coal to Seers';
                if (await this.walkTo(SEERS_TRUCK_STAND, 1)) {
                    this.phase = 'drain';
                    this.truckEmpty = false;
                }
                break;
            case 'remove':
                await this.remove();
                break;
            case 'bank':
                await this.bank();
                break;
            case 'travel-to-mine':
                this.status = 'walking back to the mine';
                if (await this.walkTo(MINE_ANCHOR, 4)) {
                    this.phase = 'fill';
                    this.truckEmpty = false;
                    this.depositedEstimate = 0;
                    this.trips++;
                }
                break;
        }

        await Execution.delayTicks(1);
    }

    private findRock(): Loc | null {
        return Locs.query()
            .name(ROCK_LOC)
            .action(MINE_OP)
            .where(loc => COAL_ROCK_IDS.includes(loc.id) && !GAS_ROCK_IDS.has(loc.id))
            .where(loc => loc.tile().distanceTo(MINE_ANCHOR) <= ROCK_LEASH)
            .nearest();
    }

    private truckAt(expected: Tile): Loc | null {
        return Locs.query()
            .name(TRUCK_LOC)
            .where(loc => loc.tile().distanceTo(expected) <= TRUCK_LEASH)
            .nearest();
    }

    private async mine(): Promise<void> {
        const rock = this.findRock();
        if (!rock) {
            await Execution.delayTicks(2);
            return;
        }
        this.status = 'mining coal';
        if (!(await rock.interact(MINE_OP))) {
            await Execution.delayTicks(2);
            return;
        }
        let count = Inventory.count(COAL);
        let lastGain = performance.now();
        while (!Inventory.isFull()) {
            if (EventSignal.pending() || ChatDialog.canContinue()) {
                return;
            }
            const now = Inventory.count(COAL);
            if (now > count) {
                count = now;
                lastGain = performance.now();
            }
            if (performance.now() - lastGain > MINE_STALL_MS) {
                return;
            }
            await Execution.delayTicks(2);
        }
    }

    private async deposit(): Promise<void> {
        this.status = 'loading the truck';
        if (!(await this.walkTo(MINE_TRUCK_STAND, 1))) {
            return;
        }
        const truck = this.truckAt(MINE_TRUCK);
        const coal = Inventory.first(COAL);
        if (!truck || !coal) {
            await Execution.delayTicks(2);
            return;
        }
        const held = Inventory.count(COAL);
        const mark = GameMessages.mark();
        if (!(await coal.useOn(truck))) {
            await Execution.delayTicks(2);
            return;
        }
        const result = await this.awaitDeposit(mark);
        if (result === 'none') {
            this.log('deposit produced no message — retrying');
            return;
        }
        if (result === 'wrong-item') {
            this.log('CoalTrucks: the truck refused the item we used on it. Stopping.');
            this.status = 'wrong item used — stopped';
            ScriptRunner.stop();
            return;
        }
        const moved = result === 'all' ? held : held - Inventory.count(COAL);
        this.depositedEstimate = Math.min(TRUCK_MAX, this.depositedEstimate + moved);
        this.log(`put ${moved} coal in the truck (${result})`);
        this.phase = phaseAfterDeposit(result);
    }

    private async remove(): Promise<void> {
        this.status = 'unloading the truck';
        if (!(await this.walkTo(SEERS_TRUCK_STAND, 1))) {
            return;
        }
        const truck = this.truckAt(SEERS_TRUCK);
        if (!truck) {
            await Execution.delayTicks(2);
            return;
        }
        const mark = GameMessages.mark();
        if (!(await truck.interact(REMOVE_OP))) {
            await Execution.delayTicks(2);
            return;
        }
        const result = await this.awaitRemove(mark);
        if (result === 'none') {
            this.log('Remove-coal produced no message — retrying');
            return;
        }
        if (result === 'no-space') {
            return;
        }
        this.log(`took ${Inventory.count(COAL)} coal from the truck (${result})`);
        this.truckEmpty = truckEmptyAfterRemove(result);
    }

    private async bank(): Promise<void> {
        this.status = 'banking the coal';
        if (!(await this.walkTo(SEERS_BANK, 4))) {
            return;
        }
        if (!(await Bank.openBooth(SEERS_BANK, BOOTH.name, BOOTH.op, m => this.log(`  ${m}`)))) {
            if (++this.bankFails >= MAX_BANK_FAILS) {
                this.log('CoalTrucks: could not open the Seers bank. Stopping.');
                this.status = 'cannot reach the bank — stopped';
                ScriptRunner.stop();
                return;
            }
            this.log('could not open the bank — will retry');
            return;
        }
        this.bankFails = 0;
        try {
            const held = Inventory.count(COAL);
            await Bank.depositAllMatching(depositMatcher(name => name.toLowerCase() === COAL.toLowerCase(), true));
            await Execution.delayTicks(1);
            this.banked += held - Inventory.count(COAL);
            await this.ensurePickaxe();
        } finally {
            await Bank.close();
        }
    }

    private async ensurePickaxe(): Promise<void> {
        const heldNames = [...Equipment.items(), ...Inventory.items()].map(i => i.name ?? '');
        const has = (name: string): boolean => heldNames.some(n => n.toLowerCase() === name.toLowerCase());
        if (bestPickaxe(Skills.level('mining'), has) !== null) {
            return;
        }
        const fromBank = bestPickaxe(Skills.level('mining'), name => Bank.count(name) > 0);
        if (!fromBank) {
            this.log('CoalTrucks: no usable pickaxe held or banked. Stopping.');
            this.status = 'no pickaxe — stopped';
            ScriptRunner.stop();
            return;
        }
        if (await Bank.withdraw(fromBank)) {
            this.log(`withdrew a ${fromBank}`);
        }
    }

    private async awaitDeposit(mark: number): Promise<DepositResult> {
        let out: DepositResult = 'none';
        await Execution.delayUntil(() => {
            out = classifyDeposit(GameMessages.since(mark).map(m => m.text));
            return out !== 'none';
        }, MESSAGE_WAIT_MS);
        return out;
    }

    private async awaitRemove(mark: number): Promise<RemoveResult> {
        let out: RemoveResult = 'none';
        await Execution.delayUntil(() => {
            out = classifyRemove(GameMessages.since(mark).map(m => m.text));
            return out !== 'none';
        }, MESSAGE_WAIT_MS);
        return out;
    }

    private async walkTo(dest: Tile, radius: number): Promise<boolean> {
        const here = Game.tile();
        if (here && dest.distanceTo(here) <= radius) {
            return true;
        }
        return Traversal.walkResilient(dest, { radius, attempts: 6, timeoutMs: 300_000, log: m => this.log(`  ${m}`) });
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#d0d0d0' });
        p.title(`CoalTrucks — ${this.status}`);

        const mins = (Date.now() - this.startedAt) / 60_000;
        const xp = Skills.xp('mining') - this.xpStart;
        const xpHour = mins > 0.5 ? `${((xp / mins) * 60 / 1000).toFixed(1)}k` : '—';

        p.row(`Runtime: ${fmtDuration(mins)}`, `Mining: ${Skills.level('mining')}`, `XP/hr: ${xpHour}`);
        p.row(`Phase: ${this.phase}`, `Banked: ${this.banked}`, `Trips: ${this.trips}`);
        p.row(`Pack: ${Inventory.count(COAL)} coal`, `Truck: ~${this.depositedEstimate}/${TRUCK_MAX} (est)`);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}
