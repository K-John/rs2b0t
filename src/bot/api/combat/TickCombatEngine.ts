import { reader } from '../../adapter/ClientAdapter.js';
import { Game } from '../game/Game.js';
import { Npcs } from '../npcs/Npcs.js';
import type { Npc } from '../model/Npc.js';
import { GroundItems } from '../grounditems/GroundItems.js';
import { Skills } from '../skills/Skills.js';
import { Inventory } from '../inventory/Inventory.js';
import { Traversal } from '../walking/Traversal.js';
import type { CombatProfile } from './CombatProfile.js';

export enum CombatTickResult {
    ENGAGED = 'engaged',
    TARGET_KILLED = 'killed',
    ACQUIRED_TARGET = 'acquired',
    LOOTING = 'looting',
    NO_TARGETS = 'no_targets'
}

export class TickCombatEngine {
    private currentTargetIndex = -1;
    public kills = 0;

    constructor(public readonly profile: CombatProfile) {}

    /**
     * Executes the combat tick logic. Run once per server tick (~600ms).
     */
    async tick(currentTick: number): Promise<CombatTickResult> {
        const me = reader.localPlayer();
        if (!me) return CombatTickResult.NO_TARGETS;

        // 1. Maintain Health (Eat food on-tick if low)
        this.handleEating();

        // 2. 0-Tick Kill Detection
        const currentNpc = this.getNpcByIndex(this.currentTargetIndex);
        const isDead = !currentNpc || this.isNpcDead(currentNpc);

        if (isDead && this.currentTargetIndex !== -1) {
            this.kills++;
            if (currentNpc) {
                this.profile.onKill?.(currentNpc);
            }
            this.currentTargetIndex = -1;
        }

        // 3. Looting Check (During combat gaps or when free)
        if (this.currentTargetIndex === -1 && this.shouldLoot()) {
            const looted = await this.handleLooting();
            if (looted) {
                return CombatTickResult.LOOTING;
            }
        }

        // 4. Bone Burying Check (During combat gaps)
        if (this.profile.buryBones && this.currentTargetIndex === -1) {
            const bones = Inventory.first('Bones');
            if (bones) {
                await bones.interact('Bury');
            }
        }

        // 5. In-Combat State Check (Prevent spam clicking while active)
        if (this.currentTargetIndex !== -1 && currentNpc && !isDead) {
            const playerLocked = me.target?.kind === 'npc' && me.target.index === this.currentTargetIndex;
            if (playerLocked || currentNpc.targetsMe()) {
                return CombatTickResult.ENGAGED;
            }
        }

        // 6. Instant 0-Tick Next Target Acquisition
        const nextTarget = this.findBestTarget();
        if (!nextTarget) {
            return isDead ? CombatTickResult.TARGET_KILLED : CombatTickResult.NO_TARGETS;
        }

        // Safespot Hook
        if (this.profile.getSafespotTile) {
            const safespot = this.profile.getSafespotTile(nextTarget);
            if (safespot && (me.tile.x !== safespot.x || me.tile.z !== safespot.z)) {
                await Traversal.walkTo(safespot, { radius: 0 });
            }
        }

        // Pre-Attack Hook (Shields, Prayers, etc.)
        if (this.profile.beforeAttack) {
            const ok = await this.profile.beforeAttack(nextTarget);
            if (!ok) {
                return CombatTickResult.NO_TARGETS;
            }
        }

        this.currentTargetIndex = nextTarget.index;
        await nextTarget.interact('Attack');
        return isDead ? CombatTickResult.TARGET_KILLED : CombatTickResult.ACQUIRED_TARGET;
    }

    public isNpcDead(npc: Npc): boolean {
        if (npc.snap.health <= 0 && npc.snap.totalHealth > 0) return true;
        if (this.profile.deathAnimations?.includes(npc.snap.animation)) return true;
        if (npc.snap.animation === 836) return true; // Generic humanoid death
        return false;
    }

    public findBestTarget(): Npc | null {
        const candidates = Npcs.query()
            .action('Attack')
            .where((n: Npc) => {
                if (!n.name || !this.profile.monsterNames.some(name => name.toLowerCase() === n.name!.toLowerCase())) {
                    return false;
                }
                if (this.isNpcDead(n)) return false;
                if (n.targetsAnotherPlayer()) return false;
                if (n.tile().distanceTo(this.profile.anchorTile) > this.profile.leashRadius) return false;
                return true;
            })
            .results();

        if (candidates.length === 0) return null;

        // 1. Aggro'd enemies attacking player take highest priority
        const aggro = candidates.find((n: Npc) => n.targetsMe());
        if (aggro) return aggro;

        // 2. Nearest unengaged valid enemy
        candidates.sort((a: Npc, b: Npc) => a.distance() - b.distance());
        return candidates[0] ?? null;
    }

    public getNpcByIndex(index: number): Npc | null {
        if (index === -1) return null;
        return Npcs.query().where((n: Npc) => n.index === index).first();
    }

    private handleEating(): void {
        const hpPercent = Skills.hpFraction() * 100;
        const threshold = this.profile.eatAtPercent ?? 50;
        if (hpPercent <= threshold) {
            const food = Inventory.items().find(i => i.actions().some(a => /^(eat|drink)$/i.test(a)));
            if (food) {
                const op = food.actions().find(a => /^(eat|drink)$/i.test(a));
                if (op) food.interact(op);
            }
        }
    }

    private shouldLoot(): boolean {
        if (Inventory.free() === 0) return false;
        return (this.profile.lootNames && this.profile.lootNames.length > 0) || !!this.profile.isWantedLoot;
    }

    private async handleLooting(): Promise<boolean> {
        if (Inventory.free() === 0) return false;

        const groundItems = GroundItems.query()
            .where(g => {
                if (g.tile().distanceTo(this.profile.anchorTile) > this.profile.leashRadius + 3) {
                    return false;
                }
                if (this.profile.isWantedLoot) {
                    return this.profile.isWantedLoot(g);
                }
                if (this.profile.lootNames && g.name) {
                    const gName = g.name.toLowerCase();
                    return this.profile.lootNames.some(l => gName.includes(l.toLowerCase()));
                }
                return false;
            })
            .results();

        if (groundItems.length === 0) return false;

        groundItems.sort((a, b) => a.distance() - b.distance());
        const item = groundItems[0];
        if (item) {
            return item.interact('Take');
        }
        return false;
    }
}
