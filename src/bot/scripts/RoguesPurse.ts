import { actions } from '../adapter/ClientAdapter.js';
import { Banking } from '../api/Banking.js';
import { LoopingBot } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import type Tile from '../api/Tile.js';
import { Traversal } from '../api/Traversal.js';
import { Bank } from '../api/hud/Bank.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Paint } from '../api/hud/Paint.js';
import { Skills } from '../api/hud/Skills.js';
import { fmtDuration } from '../api/hud/paintLogic.js';
import { Locs, type Loc } from '../api/queries/Locs.js';
import { WalkExecutor } from '../nav/WalkExecutor.js';
import {
    JUNGLE_HERBS,
    JUNGLE_POTION_QUEST,
    POTHOLE_ENTRANCE,
    enterPothole,
    inCaves,
    readJungleProgress
} from '../quests/defs/junglepotion.js';
import { settleScene } from '../quests/exec/prompts.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import {
    COINS,
    DROP_OP,
    FARE,
    FARE_FLOAT,
    IDENTIFY_OP,
    IDENTIFY_XP,
    checkGates,
    isLevelRefusal,
    isStageRefusal,
    planCycle
} from './RoguesPurseLogic.js';

const PURSE = JUNGLE_HERBS.find(h => h.key === 'rogues purse')!;
const WALL = { name: PURSE.loc, op: PURSE.op, at: PURSE.at, stand: PURSE.stand };

/** Off the stand by more than this and the wall click would walk us, so re-anchor. */
const ANCHOR_SLACK = 3;
/** Consecutive searches that yielded no unid before we accept the wall is dead to us. */
const DEAD_SEARCHES = 30;

export default class RoguesPurse extends LoopingBot {
    // The loop paces itself off the game tick; a loopDelay on top would halve throughput.
    override loopDelay = 0;

    private status = 'starting';
    private startedAt = Date.now();
    private xpStart = 0;
    private searches = 0;
    private deadSearches = 0;
    private refusal: string | null = null;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.startedAt = Date.now();
        this.xpStart = Skills.xp('herblore');

        // The journal read opens a modal, so it happens once — before the walk to Karamja.
        const gate = checkGates({
            herbloreLevel: Skills.level('herblore'),
            stage: (await readJungleProgress())?.stage
        });
        if (!gate.ok) {
            this.log(`RoguesPurse: ${gate.reason}. Stopping.`);
            throw new Error(`RoguesPurse: ${gate.reason}`);
        }

        this.on('chat.message', line => {
            if (isStageRefusal(line.text)) {
                this.refusal = `the wall found nothing — ${JUNGLE_POTION_QUEST} is not far enough along`;
            } else if (isLevelRefusal(line.text)) {
                this.refusal = 'the herb refused to identify — Herblore level too low';
            }
        });

        this.log(`RoguesPurse — ${WALL.name} at ${WALL.at}, standing ${WALL.stand}; search/identify/drop on the tick`);
    }

    override recoveryAnchor(): Tile {
        return WALL.stand;
    }

    override async loop(): Promise<void> {
        if (this.refusal) {
            this.status = 'refused';
            this.log(`RoguesPurse: ${this.refusal}. Stopping.`);
            ScriptRunner.stop();
            return;
        }

        if (!this.atWall()) {
            await this.travel();
        } else {
            const wall = this.wallLoc();
            if (wall) {
                await this.cycle(wall);
            } else {
                // Blank scene is not evidence the wall is gone (docs/NAV.md#level-change-loc-lag).
                this.status = 'waiting for the scene';
                await settleScene();
            }
        }
        // loopDelay is 0 — every path pays a tick here, so a fast-failing walk cannot spin.
        await Execution.delayTicks(1);
    }

    /**
     * One tick of packets. Both `opheld`s run inline as the server decodes them while the
     * search resolves in the movement phase, so this pipelines: identify and drop clear
     * what the last tick produced and the search stocks the next.
     */
    private async cycle(wall: Loc): Promise<void> {
        const unid = Inventory.items().find(item => item.id === PURSE.unidId) ?? null;
        const herb = Inventory.items().find(item => item.id === PURSE.id) ?? null;
        const plan = planCycle({
            continuePending: ChatDialog.canContinue(),
            unids: unid ? 1 : 0,
            identified: herb ? 1 : 0,
            freeSlots: Inventory.free()
        });

        // Either form in the pack proves the wall is still handing herbs over. Read the pack
        // rather than the inventory.changed stream — a slot that fills and empties inside one
        // tick can diff to no change at all.
        if (unid || herb) {
            this.deadSearches = 0;
        }
        this.status = `identifying (${this.identifiedCount()} done)`;
        for (const action of plan) {
            if (action === 'continue') {
                actions.continueDialog();
            } else if (action === 'identify' && unid) {
                await unid.interact(IDENTIFY_OP);
            } else if (action === 'drop' && herb) {
                await herb.interact(DROP_OP);
            } else if (action === 'search') {
                if (await wall.interact(WALL.op)) {
                    this.searches++;
                    if (++this.deadSearches >= DEAD_SEARCHES) {
                        this.refusal = `${DEAD_SEARCHES} searches in a row found no herb`;
                    }
                }
            }
        }
    }

    /**
     * Identifying is the only thing here that grants xp, so the xp counter is the honest
     * count — a sent `Identify` packet is not proof the engine accepted it. The client is
     * told xp/10 truncated, so this is off by at most one herb.
     */
    private identifiedCount(): number {
        return Math.round((Skills.xp('herblore') - this.xpStart) / IDENTIFY_XP);
    }

    private wallLoc(): Loc | null {
        return Locs.query()
            .name(WALL.name)
            .action(WALL.op)
            .where(loc => loc.tile().distanceTo(WALL.at) <= 2)
            .nearest();
    }

    private atWall(): boolean {
        const here = Game.tile();
        return here !== null && inCaves(here) && WALL.stand.distanceTo(here) <= ANCHOR_SLACK;
    }

    private async travel(): Promise<void> {
        const log = (m: string): void => this.log(`  ${m}`);
        if (!inCaves(Game.tile())) {
            this.status = 'walking to the pothole';
            this.log(`heading for the ${POTHOLE_ENTRANCE.loc} at ${POTHOLE_ENTRANCE.stand}`);
            if (!(await Traversal.walkResilient(POTHOLE_ENTRANCE.stand, { radius: 2, attempts: 4, timeoutMs: 300_000, log }))) {
                // Take the navigator's word for it rather than guessing at geography: an
                // unreachable island with no fare in the pack is a banking problem.
                if (WalkExecutor.lastOutcome === 'unreachable' && Inventory.count(COINS) < FARE) {
                    await this.fetchFare(log);
                }
                return;
            }
            this.status = 'entering the caves';
            // The climb telejumps first and answers its prompt after, so a false return
            // with our feet already underground means it worked — check, don't trust.
            if (!(await enterPothole(log)) && !inCaves(Game.tile())) {
                this.log('could not climb into the caves — retrying');
                return;
            }
        }

        this.status = 'walking to the wall';
        this.log(`walking to the ${WALL.name}`);
        if (await Traversal.walkResilient(WALL.stand, { radius: 1, attempts: 4, timeoutMs: 180_000, log })) {
            await settleScene();
            this.log('at the wall');
        }
    }

    /** Withdraw the boat fare so the ship crossings stop being pruned from the graph. */
    private async fetchFare(log: (m: string) => void): Promise<void> {
        this.status = 'banking for the boat fare';
        this.log(`Karamja is unreachable without the ${FARE}gp ship fare — going to the bank`);
        if (!(await Banking.bankNearest({ deposit: () => false, commonJunk: false, log }))) {
            this.log('could not open a bank for the fare — retrying');
            return;
        }
        // An open bank modal would block the walk that follows, on every exit from here.
        try {
            if (!(await Execution.delayUntil(() => Bank.loaded(), 4000))) {
                this.log('bank contents never loaded — retrying');
                return;
            }
            const have = Bank.count(COINS);
            if (have < FARE) {
                this.refusal = `no boat fare — needs ${FARE}gp for the Karamja ship (bank has ${have})`;
                return;
            }
            await Bank.withdrawX(COINS, Math.min(FARE_FLOAT, have));
            if (await Execution.delayUntil(() => Inventory.count(COINS) >= FARE, 4000)) {
                this.log(`withdrew ${Inventory.count(COINS)}gp for the crossing`);
            }
        } finally {
            await Bank.close();
        }
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#b7e88a' });
        const mins = (Date.now() - this.startedAt) / 60_000;
        const xp = Skills.xp('herblore') - this.xpStart;
        const identified = this.identifiedCount();
        const perHour = mins > 0.5 ? Math.round((identified / mins) * 60) : 0;
        const xpHour = mins > 0.5 ? `${((xp / mins) * 60 / 1000).toFixed(1)}k` : '—';

        p.title(`RoguesPurse — ${this.status}`);
        p.row(`Runtime: ${fmtDuration(mins)}`, `Herblore: ${Skills.level('herblore')}`, `XP: +${xp}`);
        p.row(`Identified: ${identified}`, `Herbs/hr: ${perHour}`, `XP/hr: ${xpHour}`);
        p.row(`Searches: ${this.searches}`, `Per herb: ${IDENTIFY_XP}xp`, `Pack: ${Inventory.used()}/28`);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}
