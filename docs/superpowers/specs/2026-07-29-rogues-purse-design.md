# RoguesPurse — Design

2026-07-29. A single-purpose Herblore grinder on branch `rogues-purse` cut from `main`.
Closes [#178](https://github.com/rs2b2t/rs2b0t/issues/178).

The fungus-covered cavern wall under the Karamja jungle hands out unidentified Rogues purse
forever — no respawn timer, no depletion. Identifying one is 2.5 Herblore xp. The bot parks
at the wall and searches, identifies, and drops on a per-tick cycle.

## Engine facts this design is built on

Verified against `lostcity-dev/content`:
`scripts/quests/quest_junglepotion/scripts/quest_junglepotion.rs2`,
`scripts/skill_herblore/scripts/identifying/identify.rs2`,
`scripts/skill_herblore/scripts/herblore.rs2`,
`scripts/skill_herblore/configs/herbs.obj`,
`engine/src/network/game/client/{ClientGameProtCategory,ClientGameProtRepository}.ts`, and
`engine/src/network/game/client/handler/OpHeldHandler.ts`.

### The wall never depletes

```
[oploc2,rogues_purse_cave_full]
if(%junglepotion < ^junglepotion_get_rogues_purse) {
	mes("Unfortunately, you find nothing of interest.");
	return;
}
~junglepotion_pick_herb("wall", unidentified_rogues_purse, null);
```

`junglepotion_pick_herb` only calls `loc_change` when its `$loc` argument is non-null. Every
other jungle herb passes an `_empty` loc and so has to respawn; the wall passes `null`. It is
the only infinite herb source in the game.

The proc also raises `~objbox($unid, "You find a herb.", ...)`, which is a chatbox modal
suspended on `p_pausebutton` — so **every search leaves a continue pending**.

If the pack is full it returns early with "You find a herb, but you have no place to store
it" and adds nothing, so the loop must always leave a free slot.

### Two hard gates

| Gate | Source | Failure |
|---|---|---|
| `%junglepotion >= 9` (`^junglepotion_get_rogues_purse`) | `[oploc2,rogues_purse_cave_full]` | `mes("Unfortunately, you find nothing of interest.")`, no herb |
| Herblore ≥ 3 | `attempt_identify_herb` → `oc_param(rogues_purse, identified_herb_level)` = 3 | `mes("You cannot identify this herb.")`, no xp |

Stage 9 is `get_rogues_purse` — Trufitus has *asked* for the purse. "Started Jungle Potion"
is not enough. `^junglepotion_complete` is 12, so a completed quest also passes; completion
awards `stat_advance(herblore, 7750)` = 775 xp, which lands a fresh account at Herblore 8, so
in practice any JP-complete account clears both gates.

`attempt_identify_herb` also early-returns on `map_members = ^false`. The cave is a members
area and the dev world is a members world, so this is not a runtime concern.

### Identify is 2.5 xp and instant

`param=identified_herb_level,3` / `param=identified_herb_exp,25` on `[rogues_purse]`.
`identify_herb` is `inv_setslot` + `mes` + `stat_advance` — no `anim`, no `p_delay`. Drop
(`opheld5`) is likewise instant. Only the search's `objbox` costs a beat.

### Five user events per tick, and opheld executes during decode

`ClientGameProtCategory.USER_EVENT` has `limit = 5`: `NetworkPlayer.decodeIn` keeps reading
packets until it has decoded five user events, then defers the rest to the next tick.
`OPLOC2`, `OPHELD1` and `OPHELD5` are all bound as user events.

`OpHeldHandler.handle` runs the `opheld` trigger script *inline during decode*.
`OpLocHandler` instead sets up an interaction resolved later, in the tick's movement phase.
So a single tick's burst of `search + identify + drop` does not race: the two `opheld`s act on
what the pack already holds, and the search lands afterwards.

`OpHeldHandler` contains `if (com.rootLayer != player.modalMain) player.clearPendingAction()`.
Whether that cancels a wall interaction queued in the same tick cannot be settled statically —
see *Throughput* below for why the design does not depend on the answer.

## Data already in the repo

`src/bot/quests/defs/junglepotion.ts` holds every constant this bot needs:

- `JUNGLE_HERBS` row `rogues purse`: `id 1534`, `unidId 1533`, loc `Fungus covered Cavern wall`,
  op `Search`, `at (2850, 9476, 0)`, `stand (2850, 9477, 0)`
- `JP_STAGE.GET_ROGUES_PURSE` = 9, `JP_STAGE.COMPLETE` = 12
- `parseJungleJournal` / `readJungleProgress`
- `enterPothole` — currently private; this change exports it

Nothing is re-typed. The pothole entrance (`Rocks` / `Search` at `(2823,3119)`, prompt
"Yes, I'll enter the cave.") and the `z >= 9400` underground test come from the same module.

## Shape

`src/bot/scripts/RoguesPurse.ts` — a `LoopingBot`. Not a `TaskBot`: task hand-off costs
~600ms per hop, which is fatal to a cycle whose whole point is one game tick.

`src/bot/scripts/RoguesPurseLogic.ts` — pure functions, no client: the per-tick action
planner, the gate decision, and the refusal-message test. Unit-tested standalone, the
`CakeStallLogic` / `EssMinerLogic` split.

Registered in `src/bot/scripts/index.ts` under a new `Herblore` category. `docs/SCRIPTS.md`
is generated and drift-gated, so `bun run gen:scriptdocs` runs as part of the change.

**No settings.** One wall, one herb, one action, and the product is untradeable and worth 5gp.
There is nothing to configure.

## Startup

Cheap local checks first — a failed gate must not cost a walk to Karamja.

1. `Skills.level('herblore') < 3` → log the level and stop.
2. Jungle Potion: `Quests.status('Jungle Potion')`. `complete` passes. `inProgress` must
   `parseJungleJournal` to stage ≥ 9. Anything else stops with the fix named: *"Trufitus
   hasn't asked for the Rogues purse yet — run AIOQuester with Jungle Potion first."*
3. Travel. Underground already (`z >= 9400`) → `Traversal.walkResilient` to the wall stand.
   Otherwise world-walk to `(2823,3119)`, `enterPothole`, `settleScene`, then walk to the
   stand.

### Karamja costs 30gp, and the navigator says "unreachable" instead

The two ship crossings in `nav/data/specialCrossings.ts` are `Pay-fare` and
`requires: { item: 'Coins', count: 30 }`. `WalkExecutor.resetAvoids` prunes every crossing
whose requirement the pack does not meet, so an account with no coins does not get told it is
broke — it gets told the entire island is `unreachable`. Confirmed live: the cold-start run
sat at Al Kharid cycling `expansion budget exceeded` → `unreachable`, while the same route
probed offline (where the fare is not modelled) solved in 100,111 expansions, well inside the
300,000 budget.

So travel is not self-sufficient without a fare. Rather than guess at geography — "am I on
Karamja yet?" — the bot acts on the navigator's own verdict: a walk that fails with
`lastOutcome === 'unreachable'` while holding fewer than 30 coins triggers one bank trip for
a 100gp float, then the walk retries. An empty bank stops the script naming the amount. On
the island (or already carrying coins) the leg never fires.

### The bank has to be on the way, not merely nearby

Ranking banks by distance from the player is the wrong metric, and it picks badly here.
`nearestUsableBank` would send the Lumbridge death spawn to **Al Kharid**, which really is the
closest bank to the corpse — and 50 tiles in the wrong direction, so the walk to Karamja then
comes straight back west past Draynor's door. The first live deathwalk did exactly that,
passing within 15 tiles of the Draynor booth at `(3106,3268)` on its way to Port Sarim, having
already paid the 10gp toll to get out of Al Kharid again.

So candidates are ranked by the detour they add to the journey —
`detourCost = dist(here → bank) + dist(bank → pothole)` — which from the death spawn gives:

| Detour | Bank |
|---|---|
| 428 | Draynor |
| 519 | Al Kharid |
| 552 | Falador East |

Draynor wins on the rule rather than by being hardcoded, so a death anywhere else still routes
through whatever bank is genuinely on the way. Measured saving: recovery took 91s against 130s
via Al Kharid (at `--speed 100`, ±10s poll granularity — call it ~4 minutes of real time per
death on a 600ms world), plus the toll.

Ranking alone is still affordability-blind, so the chosen bank is then probed with
`WalkExecutor.probeDest`, which calls `resetAvoids()` itself and so sees exactly the pruning a
real walk would; up to four candidates are tried. That guard is insurance rather than a fix for
an observed failure — the case it covers is dying with the cheapest-detour bank across a ferry,
Karamja ranking Ardougne being the obvious one.

One expectation of mine was wrong and is worth recording: I assumed the 10gp toll gate made Al
Kharid unreachable while broke. It does not — the first run walked in down the east bank of the
Lum, `(3238,3303) → (3275,3269) → (3276,3172)`. The gate is only a shortcut, and the bot paid it
on the way back *out* with the float it had just withdrawn.

## Deathwalk

Death is not incidental here. `player_death` teleports to `map_findsquare(0_50_50_21_18)` —
Lumbridge `(3221,3218)` — and `player_death_lose_items` calls
`move_priciest_item_on_hero_to_death` three times. That proc moves **one** of the priciest item
(`inv_moveitem(..., 1)`), so the pack that comes back holds one unid, one purse and a *single*
coin — never a payable fare, whatever the float was. Everything else drops at the wall.

The shared `DeathRecovery` task owns detection (`/oh dear.*you are dead/i`, exactly what
`mes("Oh dear you are dead!")` emits) and the "recovered once near the anchor" test. Its
`walkBack` hook runs `travel({ needFare: true })`, which banks *first* rather than spending the
whole walk ladder rediscovering that Karamja is unreachable. The death branch is checked ahead
of the ordinary `atWall()` walk in the loop for the same reason.

Deaths are counted in the paint beside the carried fare.

Verified live by killing the account mid-grind with `::~death` rather than posing a post-death
state: it respawned, banked at **Draynor**, withdrew 100gp, sailed from Port Sarim, climbed back
into the pothole and resumed at the wall. The pack came back `0u/1p` — the purse (cost 5)
survived, the cost-0 unids did not — and the coins were short of the fare, which is the premise
this leg rests on.

Two harness lessons, both of which produced a false pass first:

- **Debugprocs need the `~` prefix.** `ClientCheatHandler` only dispatches one when the command
  starts with `Environment.node.debugProcChar`. `::death` and `::bank_f2p` are silently dropped;
  `::~death` and `::~bank_f2p` work. `setvar`/`give`/`tele`/`speed` are separate built-ins, which
  is why those worked and hid the problem.
- **"xp resumed" is not evidence of recovery.** A bot that never died keeps grinding, so the
  first version of this assertion passed while the deathwalk had never run. The test now requires
  seeing the account *out of the caves* after the kill before it will accept resumed xp.

## The grind loop

One `loop()` iteration issues at most one tick's worth of packets and then waits a tick. In
order — each line is one user event, four total, inside the engine's budget of five:

1. `ChatDialog.canContinue()` → continue. Clears the previous search's `objbox`.
2. An unid (`1533`) in the pack → `Identify`.
3. An identified purse (`1534`) in the pack → `Drop`.
4. At least one free slot → `Search` the wall.

This is a pipeline, not a sequence. `opheld` runs during decode and `oploc` resolves in the
movement phase, so at steady state one tick identifies the previous tick's unid, drops the
previous tick's herb, and searches for the next: 1 herb/tick, which at a 600ms tick is
6000 herbs and **15k Herblore xp per hour**.

### Throughput

Two alternatives were considered and rejected. A strict sequence (search → continue →
identify → drop, each awaiting its own effect) is 4–5 ticks per herb for no benefit. Batching
— fill 27 unids, identify all, drop all — needs the same number of searches while adding
pack-full edge cases.

The pipeline's real advantage is that it **degrades gracefully**. If part of a tick's burst is
dropped (the `clearPendingAction` question above, or a modal state change eating a beat), the
identical loop still makes progress at 2–4 ticks per herb. There is no "safe mode" toggle to
pick wrong. Real throughput is measured, not assumed: the paint reports herbs/hr and xp/hr.

Measured on the local sim: **1.00 herbs/tick** over 834 ticks, steady state holding exactly
one unid and one identified purse in the pack. `clearPendingAction` does not cancel the
same-tick wall interaction. No tuning was needed.

## Staying at the wall

- The wall stand is the anchor. Off it by more than a tile or two — random-event teleport,
  a stray walk — re-runs the travel step rather than clicking at nothing.
- `EventSignal.pending()` is polled every iteration so the Supervisor gets its turn to handle
  a random event instead of the loop talking over it.
- The wall missing from `Locs` is not evidence it is absent for about a tick after a level
  change (`docs/NAV.md#level-change-loc-lag`) — `settleScene()` then re-query.
- Searches stop at zero free slots, so the pack never fills.
- Consecutive searches that yield no unid *and* a "you find nothing of interest" chat line
  mean the stage gate is genuinely unmet — stop with that message. This is the authoritative
  check standing behind the startup journal read.
- "You cannot identify this herb" at runtime stops the same way.

## Paint

Chatbox-docked, the house style: status line, runtime, Herblore level, xp gained, xp/hr,
identified count, herbs/hr, pack contents, then `ScriptRunner.paintControls`.

## Testing

`test/scripts/RoguesPurseLogic.test.ts`:

- planner — empty pack → search only; unid held → identify + search; both held → identify +
  drop + search; zero free slots → no search; continue pending → continue first
- gates — Herblore 1/2/3/8 × JP stage 0/8/9/10/12, including `unknown` journal
- refusal detection — the two `mes` strings above, and near-misses that must not match
- fare — `FARE` still equals what every ship crossing charges, and the float still covers the
  fare plus the Al Kharid gate, so the constants cannot drift from the nav data unnoticed
- bank choice — Al Kharid *is* the nearer bank to the death spawn and still loses on detour
  cost, so the trap cannot return by anyone "optimising" the ranking back to nearest-first

`bun test`, `bun run lint`, `bun run typecheck`, and `bun tools/gen-scriptdocs.ts --check`
all clean.

Live, via `tools/roguespurse-test.ts` against the local sim. `herbs/tick` is the metric that
matters — it is immune to `::speed`, and 1.0 is the ceiling:

| `--at` | Proves |
|---|---|
| `cave` | seated on the stand, the cycle alone |
| `pothole` | the `Rocks` climb + the in-cave walk to the wall |
| `mainland` | the whole travel leg, Karamja crossing included (needs `--fare`) |

Plus `--bank-coins --die-after N` for the deathwalk, and two refusal runs that must leave the
script stopped rather than running: `--stage 0` (the JP gate) and `--no-maxme` (Herblore 1).

`::give` reaches the pack and never the bank, so `--fare` seeds coins directly. The bank
*withdraw* inside the fare leg is therefore not live-seeded — it is the same `Bank.withdrawX`
every other bot uses, but that one step rests on the unit suite, not on a live run.

## Out of scope

- Bootstrapping Herblore 1 → 3 (guam identifies elsewhere) and running Jungle Potion itself.
  Both stop with a message naming the fix.
- Keeping or banking the herbs. `rogues_purse` is `tradeable=no`, `cost=5`.
- Any other herb source. The `JUNGLE_HERBS`-row shape leaves room for one later; nothing is
  built for it now.
