[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (S)

Per-quest seed and stage commands, with what each recipe has proven.

## Sea Slug — stage-scoped harness

[`e2e/sea-slug-259-live.ts`](../../e2e/sea-slug-259-live.ts) drives the quest from a
clean account or from any point inside it. `--stage N` writes `%seaslugquest`
straight, 0 to 11, then relogs so the quest list recolours.

```sh
HEADED=1 bun e2e/sea-slug-259-live.ts --stage 0 --until 12 --minutes 40 --tick 200  # end to end
HEADED=1 bun e2e/sea-slug-259-live.ts --stage 0 --until 3 --minutes 15 --tick 200   # Caroline, Holgart, the Khazard paste
HEADED=1 bun e2e/sea-slug-259-live.ts --stage 3 --until 6 --minutes 15 --tick 200   # the ladder, the crates, Kent
HEADED=1 bun e2e/sea-slug-259-live.ts --stage 6 --until 8 --minutes 20 --tick 200   # Bailey's torch and the rub
HEADED=1 bun e2e/sea-slug-259-live.ts --stage 8 --until 12 --minutes 20 --tick 200  # the panel, the crane, the reward
```

The bank holds coins and food alone. The swamp paste is bought at the Khazard
counter, and the torch, the damp sticks and the broken glass all have sources on the
platform.

Measured at `--tick 200`, no parks: **5 minutes** from a clean account to quest
complete. Per leg — stages 3 to 6 in 2 minutes, stage 6 to complete in 3.

Four details govern this harness:

- **`--stage` is the raw varp.** Every step of this quest is a `%seaslugquest` write
  and nothing else, so one `setvar` seeds any point in it. The relog is what makes the
  quest list agree with the varp.
- **Stages 7-10 are seeded with an unlit torch.** Bailey replaces a lost torch on
  stages 7-9 and has no line at all on stage 10, so a torchless seed there can neither
  climb the ladder nor ask for a replacement.
- **Stats are 70 rather than maxed.** Nothing on this quest fights — every sea slug
  and fisherman is `vislevel=hide` — and the only damage in it is the 4 for climbing
  the ladder without a lit torch.
- **It fails in the first minute if the loaded bundle has no Sea Slug in its queue.**
  The engine serves one `public/bot`, and a concurrent session that deploys while this
  harness boots hands the run their branch instead.

## Shades of Mort'ton — stage-scoped harness

[`e2e/mortton-255-live.ts`](../../e2e/mortton-255-live.ts), members-only, so `:8890`:

```sh
HEADED=1 bun e2e/mortton-255-live.ts --stage 0 --until 85 --minutes 180 --tick 200  # end to end
HEADED=1 bun e2e/mortton-255-live.ts --stage 0 --until 15 --minutes 45 --tick 200   # diary, serum, Razmire
HEADED=1 bun e2e/mortton-255-live.ts --stage 15 --until 47 --minutes 45 --tick 200  # five shades and the handover
HEADED=1 bun e2e/mortton-255-live.ts --stage 47 --until 65 --minutes 60 --tick 200  # the temple and the flame
HEADED=1 bun e2e/mortton-255-live.ts --stage 65 --until 85 --minutes 45 --tick 200  # the cremation
```

Every mid-quest leg wants `--stocked`: the coins, food, tinderbox, ashes, spare
log and melee kit are all assembled around Varrock, and a leg that only means to
test Mort'ton otherwise spends its budget walking there and back. Leave it off
for anything claiming the quest works from nothing.

Five things it does that the Nature Spirit shape does not:

- **Levels, not `~maxme`.** `--levels 70` (the default) walks every skill up with
  `~addxp`, because the temple's build rolls and its resource bands are all
  `stat_random(crafting, …)` — a maxed account rebuilds it on numbers the module
  is not claiming. `~addxp` takes **plain xp**, not the engine's internal tenths,
  even though the `stat_advance` it wraps takes tenths.
- **Sets three prerequisites.** Priest in Peril walls Morytania off, and the
  Mort Myre gate guard refuses while `%druidspirit` is 0, so `prieststart`,
  `priestperil` and `druidspirit` all go in and the run relogs.
- **Gives five sets of remains from `--stage 40` on.** Razmire wants five in one
  pack before he takes any, so a stage seeded past the hunt otherwise describes a
  state the quest cannot reach.
- **Prints the three flamtaer meters on every poll** (`temple=repaired%/pool%/sanctity%`).
  They are the only transmitted varps this quest has — `%morttonquest` is not one —
  and they are what the temple leg reads.
- **`--stocked` gives a mid-quest start the approach pack.** Coins, food, a
  tinderbox, two ashes, the pyre log and the melee kit, which is what the Varrock
  leg of a stage-0 run assembles.

The bank holds coins, food and a melee kit. Everything else has a source in the
world: the diary and the two tarromin are in Herbi Flax's house, the empty vials
are ground spawns beside them, the water is the Mort'ton sink, the logs are the
two spawns beside the Varrock east bank, the tinderbox is the Varrock general
store, and every building material is Razmire's.

## Shield of Arrav

Two harnesses, because one account cannot finish the quest.

[`e2e/shield-of-arrav-232-live.ts`](../../e2e/shield-of-arrav-232-live.ts) drives one gang
side. Two varps, seeded one at a time — `~completequests` opens a gang-choice dialog
nothing answers and completes nothing:

```
--gang phoenix|blackarm   which side to run
--phoenix N --blackarm N  seed both varps, then relog
--until N                 target varp value
--want-half               assert a Broken shield lands in the pack instead
```

`--want-half` exists because the half-farming legs move no varp: the chest and the
cupboard hand over an object and nothing else changes. Asserting the varp there passes
before the leg has run.

It must **not** assert `journal === 'complete'` — a lone account can never redeem. At
`--gang blackarm --blackarm 2` it seeds a `phoenixkey2` into the bank and says so: only
Straven issues one, and joining Phoenix makes Katrine refuse you, so that stage is not
self-sufficient by construction.

[`e2e/shield-of-arrav-pair-232-live.ts`](../../e2e/shield-of-arrav-pair-232-live.ts) is the
only run that turns the journal green. One `browser.newContext()` per account, because
settings live in `sessionStorage` keyed `rs2b0t:set:<Script>:<key>` and a shared context
cross-contaminates the two bots. PASS wants all four: `phoenixgang = 10`,
`blackarmgang = 4`, and both journals green.

## See also

- [Quest harness recipes (A–D)](quest-harness-recipes.md)
- [Quest harness recipes (E)](quest-harness-recipes-4.md)
- [Quest harness recipes (F)](quest-harness-recipes-2.md)
- [Quest harness recipes (Haz–Hol)](quest-harness-recipes-8.md)
- [Quest harness recipes (Hor)](quest-harness-recipes-10.md)
- [Quest harness recipes (I–L)](quest-harness-recipes-3.md)
- [Quest harness recipes (M–O)](quest-harness-recipes-6.md)
- [Quest harness recipes (P–R)](quest-harness-recipes-5.md)
- [Quest harness recipes (T)](quest-harness-recipes-9.md)
- [Quest harness method](quest-harness-method.md)
- [Seeding test accounts](seeding-test-accounts.md)
