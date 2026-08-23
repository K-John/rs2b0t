# The Tick-Perfect Scripting Handbook

A master engineering reference for designing, building, and optimizing tick-perfect automation scripts in `rs2b0t` and RS2-like game engines.

---

## 1. Core Philosophy: Reactive State Machine vs. Sleep Loops

The fundamental difference between amateur bots and tick-perfect bots is how they handle time:

```
Amateur Bot (Sleep Loop - Fragile & Slow):
[ Click Tree ] ──► [ Hard Sleep 3000ms ] ──► [ Check Inv ] ──► [ Hard Sleep 2000ms ] (Stuck on misclicks or server lag!)

Tick-Perfect Bot (Reactive State Machine - Resilient & Fast):
[ Server Tick T ] ──► [ Inspect State ] ──► [ Dispatch Action ] ──► [ Yield to Engine ] (Adapts every 600ms instantly!)
```

### The 3 Core Tenets:
1. **Never use hard sleeps in the main loop**: Every iteration runs on an incoming `PLAYER_INFO` packet (~600ms). Inspect the world, send at most one action, and yield.
2. **Use authoritative server feedback as triggers**: Never assume an action succeeded. Verify via XP deltas (`Skills.xp()`), inventory deltas (`Inventory.count()`), or position changes (`Game.tile()`).
3. **Respect engine action cooldowns**: Track `lastActionTick` to synchronize with server cooldowns (e.g., 3 ticks for Superheat, 4 ticks for Scimitars, 3 ticks for Eating).

---

## 2. Setting Up the Server-Tick Cadence

In `rs2b0t`, configuring a bot to run tick-perfect is as simple as overriding `loopCadence`:

```typescript
import { LoopingBot, type LoopCadence } from '../../api/bot/Bot.js';

export default class MyTickBot extends LoopingBot {
    // Schedules the next loop() on the exact next incoming server tick
    override loopCadence: LoopCadence = { kind: 'server-tick', ticks: 1 };

    async loop(): Promise<void> {
        const currentTick = Game.tick();
        const here = Game.tile();
        if (!here) return;

        // Reactive state machine executes here every 600ms
    }
}
```

---

## 3. Authoritative Completion Signals (XP vs. Inventory)

In RS2, relying on inventory count changes for skill completion can lead to severe bugs because **items leave your inventory at the start of an animation, not the end**.

| Skill / Action | Start of Attempt | Completion of Attempt | Correct Completion Signal |
| :--- | :--- | :--- | :--- |
| **Firemaking** | Log drops to ground under player feet | Fire appears; player steps 1 tile West | `Skills.xp('firemaking') > lastFmXp` |
| **Superheating** | Ore is targeted | Ore turns into Bar | `Skills.xp('magic') > lastMagicXp` |
| **Woodcutting** | Axe swings | Log added to inventory | `Inventory.count(log) > lastCount` |
| **Cooking** | Raw food used on fire | Cooked/Burnt food produced | `Skills.xp('cooking') > lastCookingXp` |
| **Crafting (Leather)** | Needle used on leather | Item created | `Skills.xp('crafting') > lastCraftXp` |

> [!IMPORTANT]
> **XP Drop is King**: In 2004 RS2, skill XP is awarded on the **exact server tick** an action finishes. Comparing `currentXp > lastXp` gives 100% false-positive-free completion detection.

---

## 4. Case Study 1: 0-Tick Chain Firemaking (`TickFiremaker.ts`)

### Mechanics:
1. Using a Tinderbox on a Log places the log on the ground and starts the lighting animation.
2. Lighting can take 1 to 10+ strikes depending on level.
3. The moment the fire catches:
   - XP increases.
   - The fire loc is spawned.
   - The player automatically steps 1 tile West (`x - 1`).

### The 0-Tick Optimization:
Instead of waiting for the step animation to complete, the bot intercepts the XP delta on tick $T$, verifies that the new tile `(x - 1, z)` has no existing fire, and immediately dispatches `tinderbox.useOn(nextLog)` on tick $T$!

```typescript
// SUCCESS: Fire lit on this exact tick!
const fireCompleted = currentXp > this.lastFmXp;
if (fireCompleted) {
    this.firesLit++;
    this.lastFmXp = currentXp;

    // Player is now at `here` (1 tile West)
    const occupied = new Set(reader.locs().map(l => `${l.tile.x},${l.tile.z}`));
    if (currentLogs > 0 && !occupied.has(`${here.x},${here.z}`) && here.x >= minX) {
        // INSTANT 0-TICK CHAIN DISPATCH
        await tinderbox.useOn(nextLog);
        this.lastActionTick = currentTick;
        return;
    }
}
```

---

## 5. Case Study 2: 3-Tick Superheating (`Superheater.ts`)

### Mechanics:
1. `Superheat Item` costs 1 Nature rune + 4 Fire runes (or a Fire staff).
2. Casting takes exactly **3 server ticks** (1800ms).
3. The converted bar appears in inventory on tick $T+1$, but the player remains locked in the casting cooldown through tick $T+2$.

### The 3-Tick Cadence Gate:
```typescript
// Cooldown Gate: Enforce exact 3-tick interval
const elapsed = currentTick - this.lastCastTick;
if (this.lastCastTick > 0 && elapsed < 3) {
    return; // Tick 1 or 2 of 3 — yield to engine
}

// Tick 3: Cooldown finished! Cast immediately on next primary ore
const success = castSuperheatOn(primaryOre);
if (success) {
    this.lastCastTick = currentTick;
    this.barsMade++;
}
```

### Direct Packet Dispatch (No UI Clicking Lag):
```typescript
function castSuperheatOn(item: InvItem): boolean {
    const magicRoot = reader.sideTabInterface(6);
    const spellComId = reader.targetButtonByBase(magicRoot, 'Superheat Item');
    if (spellComId === -1) return false;

    // 1. Arm target spell button
    // 2. Select held item in inventory
    return (
        actions.menuAction(MiniMenuAction.TGT_BUTTON, 0, 0, spellComId) &&
        actions.menuAction(MiniMenuAction.TGT_HELD, item.id, item.slot, item.snap.comId)
    );
}
```

---

## 6. High-Speed Banking Architecture (`openBankFast`)

### The Adjacency Problem
In RS2, interacting with a bank booth when you are $> 1$ tile away fails on the server if pathing is not open, triggering an 8-second internal timeout.

### The Fast Bank Opener Pattern:
```typescript
private async openBankFast(): Promise<boolean> {
    if (Bank.isOpen()) return true;

    const booth = Locs.query().name('Bank booth').where(l => l.actions().length > 0).nearest();
    if (!booth) return Bank.openNearest('Bank booth', 'Use-quickly');

    // 1. Step adjacent first if distance > 1
    if (booth.distance() > 1) {
        await Traversal.walkTo(booth.tile(), { radius: 1, timeoutMs: 5000 });
    }

    // 2. Interact immediately
    const op = booth.actions().find(a => /use-quickly|^bank/i.test(a)) ?? 'Bank';
    await booth.interact(op);

    // 3. Short 4-tick wait (~2.4s) instead of 8000ms
    const opened = await Execution.delayUntilTicks(() => Bank.isOpen() || ChatDialog.canContinue(), 4);
    if (opened && ChatDialog.canContinue()) {
        await ChatDialog.continue();
        await Execution.delayUntilTicks(() => Bank.isOpen(), 3);
    }

    return Bank.isOpen();
}
```

### Dynamic Item Ratio Calculations:
Never hardcode fixed withdrawal amounts. Calculate them dynamically based on available backpack slots:

```typescript
function calculateWithdrawCounts(ratioPrimary: number, ratioSecondary: number, freeSlots: number) {
    const setSize = ratioPrimary + ratioSecondary;
    const sets = Math.floor(freeSlots / setSize);
    return {
        primary: sets * ratioPrimary,
        secondary: sets * ratioSecondary
    };
}
// Example Steel (1 Iron : 2 Coal): calculateWithdrawCounts(1, 2, 27) -> { primary: 9, secondary: 18 }
```

---

## 7. Reusable Tick-Bot State Machine Blueprint

```typescript
import { LoopingBot, type LoopCadence } from '../../api/bot/Bot.js';
import { Game } from '../../api/game/Game.js';
import { Bank } from '../../api/bank/Bank.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Skills } from '../../api/skills/Skills.js';

enum State {
    BANKING = 'Banking',
    TRAINING = 'Training'
}

export default class TickBotTemplate extends LoopingBot {
    override loopCadence: LoopCadence = { kind: 'server-tick', ticks: 1 };

    private state: State = State.BANKING;
    private lastActionTick = 0;
    private lastSkillXp = 0;

    override onStart(): void {
        this.lastSkillXp = Skills.xp('smithing');
    }

    async loop(): Promise<void> {
        const currentTick = Game.tick();
        if (!Game.ingame() || !Game.tile()) return;

        switch (this.state) {
            case State.BANKING:
                await this.handleBanking(currentTick);
                break;

            case State.TRAINING:
                await this.handleTraining(currentTick);
                break;
        }
    }

    private async handleBanking(currentTick: number): Promise<void> {
        // 1. Guard: Ensure previous action cooldown/animation finished
        if (currentTick - this.lastActionTick < 3 || Game.animating()) {
            return;
        }

        // 2. Open Bank Fast
        if (!Bank.isOpen()) {
            await this.openBankFast();
            return;
        }

        // 3. Deposit / Restock / Withdraw
        // ... (Execute banking operations)
        await Bank.close();

        this.lastActionTick = 0;
        this.state = State.TRAINING;
    }

    private async handleTraining(currentTick: number): Promise<void> {
        // 1. Out of supplies check -> Transition to banking
        if (Inventory.free() === 28 || !Inventory.contains('PrimaryItem')) {
            this.state = State.BANKING;
            return;
        }

        // 2. XP Completion Delta
        const currentXp = Skills.xp('smithing');
        if (currentXp > this.lastSkillXp) {
            this.lastSkillXp = currentXp;
            // Immediate on-tick chaining logic here
        }

        // 3. Cooldown check
        if (currentTick - this.lastActionTick < 3) {
            return; // In active cooldown
        }

        // 4. Dispatch action
        // await dispatchAction();
        this.lastActionTick = currentTick;
    }

    private async openBankFast(): Promise<boolean> {
        // Fast adjacent bank open implementation
        return true;
    }
}
```

---

## 8. Tick-Perfect Performance Checklist

Before releasing any bot, run through this checklist:

- [ ] **No `sleep()` or `delay(ms)` in the main loop**: Every loop tick corresponds to 1 server cycle.
- [ ] **Authoritative completion checks**: Skill progress is validated via `Skills.xp()`, not assumed.
- [ ] **Zero input flooding**: Does not spam click on entities while in an active animation or swing timer.
- [ ] **Action cooldown awareness**: Explicitly gates next actions by `currentTick - lastActionTick >= cooldownTicks`.
- [ ] **Placeholder protection**: Caps rune/stack withdrawals at `Bank.count() - 1` to preserve bank slots.
- [ ] **Adjacency before interaction**: Moves within 1 tile of booths/chests before sending menu actions.
- [ ] **Instant next-target selection**: Dispatches the next attack or interaction on the exact tick the previous completes.
