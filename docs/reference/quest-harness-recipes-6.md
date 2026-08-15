[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (T–Z)

Per-quest seed and stage commands, with what each recipe has proven.

## Temple of Ikov — stage-scoped harness

[`e2e/temple-of-ikov-250-live.ts`](../../e2e/temple-of-ikov-250-live.ts), members-only,
so `:8890`:

```sh
HEADED=1 bun e2e/temple-of-ikov-250-live.ts --until 100 --tick 200 --minutes 180              # end to end
HEADED=1 bun e2e/temple-of-ikov-250-live.ts --stage 10 --kit dungeon --until 30 --minutes 45  # boots, lever, arrows
HEADED=1 bun e2e/temple-of-ikov-250-live.ts --stage 30 --kit warrior --until 40 --minutes 30  # the Fire Warrior
HEADED=1 bun e2e/temple-of-ikov-250-live.ts --stage 40 --kit roots --until 60 --minutes 30    # Winelda
HEADED=1 bun e2e/temple-of-ikov-250-live.ts --stage 60 --kit guardian --until 100 --minutes 45 # guardians and Lucien
```

`--stage N` sets `%ikov` and relogs. `--lever` sets bit 0 of `%ikov_dungeon`, the
permanent unlock the south gate reads, so a stage test can skip the lava bridge.
`--until 100` asserts the journal is green rather than a varp value — the Armadyl
ending leaves `%ikov` at 80, not 100.

`--kit` is the seeding dial, and every step up it is a claim the run no longer makes:

| Kit | Adds | What it stops proving |
|---|---|---|
| `none` | — | nothing; the default |
| `dungeon` | pendant, candle, tinderbox, knife | the Catherby shops and the Seers knife spawn |
| `warrior` | + yew shortbow, 40 ice arrows, boots of lightness | the fletching chain, the ice chests, the webbed alcove |
| `roots` | + 20 limpwurt roots | the hobgoblin farm |
| `guardian` | + shiny key | Winelda's ferry — the key is what walks a seeded stage-60 run in through McGrubor's Wood |

The bank holds two million coins and sixty lobsters at every kit. Nothing else is
seeded by default: the axe, the knife, the flax, the yew logs, the bow string, the
candle, the arrows, the boots and the roots each have a source the bot walks to, and
seeding one hides whether it can find it.

Five facts govern this harness:

- **`--stats 70` is the default**, not 99. Thieving 42 and Ranged 40 are the server
  gates; woodcutting 60, fletching 65 and crafting 10 are what the yew shortbow costs,
  and the module warns rather than blocks below them.
- **The lava bridge fails at any non-negative weight.** The boots are -10lb worn, so
  the leg that crosses carries the candle, the pendant and food and nothing else — the
  bow is 3lb and never goes near it.
- **The Fire Warrior refuses anything but ranged with ice arrows in the quiver.** A run
  that reaches him without both stands there swinging and never lands a hit.
- **A seeded stage never walked the sourcing leg.** A run started at 50 has no axe
  banked, and bare fists against level-42 hobgoblins is what killed the first attempt,
  so the farm's arm check falls through to Aemad's counter when the bank is empty.
- **Winelda's teleport is one-way.** Past it the shiny key is the only way out, so a
  stage test seeded at 60 or 70 has to let the bot pick the key up before it can walk
  to Lucien.

## See also

- [Quest harness recipes (A–D)](quest-harness-recipes.md)
- [Quest harness recipes (E)](quest-harness-recipes-4.md)
- [Quest harness recipes (F–H)](quest-harness-recipes-2.md)
- [Quest harness recipes (I–O)](quest-harness-recipes-3.md)
- [Quest harness recipes (P–S)](quest-harness-recipes-5.md)
- [Quest harness method](quest-harness-method.md)
- [Seeding test accounts](seeding-test-accounts.md)
