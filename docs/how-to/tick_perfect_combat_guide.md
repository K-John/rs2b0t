# Tick-Perfect Combat Architecture Guide

An engineering reference for building responsive, tick-perfect combat bots in the 2004 RS2 / `rs2b0t` environment.

---

## 1. Why Traditional Combat Bots Are Inefficient

Most combat bots suffer from **3–7 seconds of dead time per kill** due to three common architectural anti-patterns:

```
Traditional Combat Flow (Laggy & Inefficient):
[ Monster Hits 0 HP ] ──► [ Wait 2-3s for Corpse Despawn ] ──► [ Wait 2s for Hitbar to Fade ] ──► [ Search Next Target ] ──► (3-6s Wasted!)

Tick-Perfect Combat Flow (Zero Dead Ticks):
[ Monster Hits 0 HP ] ──► [ Exact-Tick Kill Detected (Tick T) ] ──► [ Click Next Target (Tick T) ] ──► (0 Dead Ticks!)
```

### The 3 Core Bottlenecks:
1. **The Hitbar (`combatCycle`) Trap**:
   - When damage is dealt, the game client displays a health bar by setting `combatCycle` for ~30–50 client cycles (~1.5–3.0 seconds).
   - Scripts that check `Game.inCombat()` or `npc.inCombat` read this visual hitbar. When the monster dies, the script idles until the bar disappears.
2. **Corpse Despawn Polling (`delayUntil(() => npc === null)`)**:
   - The monster's 3D model remains visible for 2–4 ticks playing a death animation and fading out. Waiting for `npc === null` wastes multiple ticks per monster.
3. **Spam-Clicking Mid-Fight**:
   - Sending `Attack` packets every tick on an active target resets the client's pathing and combat animation timers, causing stuttering and delayed weapon swings.

---

## 2. Authoritative Tick-by-Tick Combat State

Every 600ms server tick, the server sends `PLAYER_INFO` and `NPC_INFO` packets containing exact entity targets (`faceEntity`):

| Entity | `faceEntity` Field | Meaning |
| :--- | :--- | :--- |
| **Local Player** | `0 <= faceEntity < 32768` | You are locked onto the NPC at index `faceEntity`. |
| **Local Player** | `-1` | You are not locked onto any target (idle, moving, or disengaged). |
| **NPC** | `faceEntity - 32768 === selfSlot` | The NPC is actively attacking **you** (`npc.targetsMe()`). |
| **NPC** | `faceEntity >= 32768 && faceEntity - 32768 !== selfSlot` | The NPC is attacking **another player** (`npc.targetsAnotherPlayer()`). |

### Authoritative Target Extraction:
```typescript
import { reader } from '../../adapter/ClientAdapter.js';

const me = reader.localPlayer();
const currentTargetIndex = (me && me.target?.kind === 'npc') ? me.target.index : -1;
```

---

## 3. Instant 0-Tick Kill Detection

Do not wait for health bars to clear or models to despawn. Evaluate these **4 concurrent signals** every tick:

```typescript
function isNpcDead(npc: Npc): boolean {
    // 1. Hitpoint Depletion: Health hit 0 on totalHealth pool
    if (npc.snap.health <= 0 && npc.snap.totalHealth > 0) {
        return true;
    }

    // 2. Death Animation: Specific death sequence active
    // 836: Humanoid / Guard / Man | 426: Goblin | 131: Cow | 28: Chicken
    if (npc.snap.animation === 836 || npc.snap.animation === 426) {
        return true;
    }

    // 3. Scene Removal: NPC no longer exists in scene query
    if (!npc.valid()) {
        return true;
    }

    return false;
}
```

When an NPC dies, your character’s `me.target` reverts to `null` and combat XP increases on the **exact same tick** ($T$). Catch this on tick $T$ to immediately acquire your next target.

---

## 4. Priority-Queue Target Selection

When selecting a new target on tick $T$, execute this priority hierarchy:

```mermaid
graph TD
    A[Search Valid Targets] --> B{Any NPC targeting me?}
    B -- Yes (npc.targetsMe()) --> C[Attack Aggro'd NPC (Priority 1)]
    B -- No --> D{Any unengaged NPC alive?}
    D -- Yes --> E[Sort by Distance / Line of Sight]
    E --> F[Attack Nearest NPC (Priority 2)]
    D -- No --> G[Yield / Stand at Anchor Tile]
```

### Filtering Rules:
1. **Alive**: `!isNpcDead(npc)`
2. **Single-Combat Valid**: `!npc.targetsAnotherPlayer()` (prevents "*Someone else is fighting that*" packet rejections)
3. **Within Leash Area**: `npc.tile().distanceTo(anchor) <= leashRadius`
4. **Reachable**: `Reachability.canReach(npc.tile())`

---

## 5. Weapon Cadences & Zero-DPS-Loss Eating

### Weapon Speeds
| Speed (Ticks) | Real Time | Weapon Examples |
| :--- | :--- | :--- |
| **3 Ticks** | 1.8s | Shortbow (Rapid), Darts, Knives |
| **4 Ticks** | 2.4s | Scimitars, Daggers, Whips, Claws |
| **5 Ticks** | 3.0s | Longswords, Battleaxes, Warhammers |
| **6 Ticks** | 3.6s | 2h Swords, Halberds, Greataxes |

### Zero-DPS Eating
In RS2, eating food incurs a **3-tick action delay**. 
- If you eat on the tick **immediately after your weapon swing** (e.g. tick 1 of a 4-tick scimitar cycle), the 3-tick food delay overlaps completely with your remaining 3 ticks of weapon recovery.
- Result: **Zero lost attack ticks!**

---

## 6. Complete Reference Implementation

```typescript
import { LoopingBot, type LoopCadence } from '../../api/bot/Bot.js';
import { reader } from '../../adapter/ClientAdapter.js';
import { Game } from '../../api/game/Game.js';
import { Npcs, type Npc } from '../../api/npcs/Npcs.js';
import { Skills } from '../../api/skills/Skills.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import Tile from '../../geometry/Tile.js';

export default class TickFighter extends LoopingBot {
    override loopCadence: LoopCadence = { kind: 'server-tick', ticks: 1 };

    private targetName = 'Guard';
    private anchor: Tile = new Tile(3200, 3200, 0);
    private leashRadius = 15;
    private eatAtHpPercent = 50;

    private currentTargetIndex = -1;
    private kills = 0;

    async loop(): Promise<void> {
        const currentTick = Game.tick();
        const me = reader.localPlayer();
        if (!me) return;

        // 1. Maintain Health
        this.handleEating();

        // 2. Check Active Target Status
        const currentNpc = this.getNpcByIndex(this.currentTargetIndex);
        const isTargetDead = !currentNpc || this.isNpcDead(currentNpc);

        if (isTargetDead && this.currentTargetIndex !== -1) {
            this.kills++;
            this.currentTargetIndex = -1;
        }

        // 3. In-Combat State Check
        // If locked on alive target, let the swing cycle run (no spam clicks)
        if (this.currentTargetIndex !== -1 && currentNpc && !isTargetDead) {
            const isLockedOn = me.target?.kind === 'npc' && me.target.index === this.currentTargetIndex;
            if (isLockedOn || currentNpc.targetsMe()) {
                return; // Actively engaged — yield to engine
            }
        }

        // 4. Instant 0-Tick Next Target Acquisition
        const nextTarget = this.findBestTarget();
        if (nextTarget) {
            this.currentTargetIndex = nextTarget.index;
            await nextTarget.interact('Attack');
        }
    }

    private isNpcDead(npc: Npc): boolean {
        if (npc.snap.health <= 0 && npc.snap.totalHealth > 0) return true;
        if (npc.snap.animation === 836) return true; // Humanoid death
        return false;
    }

    private findBestTarget(): Npc | null {
        const candidates = Npcs.query()
            .name(this.targetName)
            .action('Attack')
            .where(n => {
                if (this.isNpcDead(n)) return false;
                if (n.targetsAnotherPlayer()) return false;
                if (n.tile().distanceTo(this.anchor) > this.leashRadius) return false;
                return true;
            })
            .all();

        if (candidates.length === 0) return null;

        // 1. Attackers already hitting us
        const aggro = candidates.find(n => n.targetsMe());
        if (aggro) return aggro;

        // 2. Nearest unengaged target
        candidates.sort((a, b) => a.distance() - b.distance());
        return candidates[0] ?? null;
    }

    private getNpcByIndex(index: number): Npc | null {
        if (index === -1) return null;
        return Npcs.query().where(n => n.index === index).first();
    }

    private handleEating(): void {
        const hp = Skills.level('hitpoints');
        const maxHp = Skills.maxLevel('hitpoints');
        if (maxHp > 0 && (hp / maxHp) * 100 <= this.eatAtHpPercent) {
            const food = Inventory.items().find(i => i.actions().some(a => /^(eat|drink)$/i.test(a)));
            if (food) {
                const op = food.actions().find(a => /^(eat|drink)$/i.test(a));
                if (op) food.interact(op);
            }
        }
    }
}
```
