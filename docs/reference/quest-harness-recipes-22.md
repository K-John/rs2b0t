[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (Ea)

## Eadgar's Ruse, harness recipes

[`e2e/eadgar-ruse-241-live.ts`](../../e2e/eadgar-ruse-241-live.ts), base `:8890`.
The bank gets coins, food, a rune kit and **one ranarr weed**, no 2004 shop sells a
ranarr or a ranarr potion (unf), and everything else the quest wants (the boots, the
knife, the pineapple, the vodka, the axe, the pestle, the tinderbox, the logs, the
chickens, the grain) has to be sourced by the run.

| Flag | What it changes |
|---|---|
| `--stage N` | `%eadgar_quest`, then relogs so the journal recolours |
| `--until N` | stop at that stage; `>= 110` waits for the journal to go green |
| `--at x,z,level` | start tile, so an inner leg skips the walk in |
| `--pack` | boots, food, a scimitar and coins straight to the inventory |
| `--unfreed` | leaves `troll_freed_eadgar` clear, so the free-Eadgar recovery runs |
| `--paint` | draws the planned route in red and the client's own leg in cyan |

```sh
HEADED=1 bun e2e/eadgar-ruse-241-live.ts --stage 0 --minutes 180 --tick 200
HEADED=1 bun e2e/eadgar-ruse-241-live.ts --stage 25 --until 50 --at 2890,10086,2 --pack --minutes 45 --tick 200
HEADED=1 bun e2e/eadgar-ruse-241-live.ts --stage 70 --until 110 --minutes 90 --tick 200
```

Measured at `--tick 200`, with 70 in every skill and the bank seed above:

| Leg | What it proves | Time |
|---|---|---|
| `--stage 0 --until 10` | Sanfew's offer, and buying the boots from Tenzing | 3 min |
| `--stage 10 --until 15` | the walk onto Trollheim and into Mad Eadgar's cave | 5 min |
| `--stage 15 --until 25` | the stronghold kitchen and Burntmeat | 2 min |
| `--stage 25 --until 50` | the parrot chain end to end, three counters and two kingdoms | 16 min |
| `--stage 70 --until 110` | robe, potion, parrot back, fake man, storeroom, Sanfew | 42 min |

It deploys its own copy of the client through
[`deployIsolatedClient`](../../e2e/lib/harness.ts), which this quest needs more than most:
it adds three transport edges, and a neighbouring session's deploy landing in the shared
`public/bot` shows up only as `no path to (2890,10086,2): unreachable`.

## See also

- [Quest harness recipes (A–D)](quest-harness-recipes.md)
- [Quest harness recipes (Big)](quest-harness-recipes-17.md)
- [Quest harness recipes (Dig)](quest-harness-recipes-15.md)
- [Quest harness recipes (El–Er)](quest-harness-recipes-4.md)
- [Quest harness recipes (Fam–Figh)](quest-harness-recipes-2.md)
- [Quest harness recipes (Fis)](quest-harness-recipes-21.md)
- [Quest harness recipes (Fre)](quest-harness-recipes-18.md)
- [Quest harness recipes (G)](quest-harness-recipes-11.md)
- [Quest harness recipes (Haz–Hol)](quest-harness-recipes-8.md)
- [Quest harness recipes (Her)](quest-harness-recipes-19.md)
- [Quest harness recipes (Hor)](quest-harness-recipes-10.md)
- [Quest harness recipes (I–L)](quest-harness-recipes-3.md)
- [Quest harness recipes (Leg)](quest-harness-recipes-20.md)
- [Quest harness recipes (M)](quest-harness-recipes-6.md)
- [Quest harness recipes (N–O)](quest-harness-recipes-14.md)
- [Quest harness recipes (P–R)](quest-harness-recipes-5.md)
- [Quest harness recipes (Sea–Shades)](quest-harness-recipes-7.md)
- [Quest harness recipes (Sheep–Shield)](quest-harness-recipes-12.md)
- [Quest harness recipes (Tai–Temple)](quest-harness-recipes-9.md)
- [Quest harness recipes (Tree–Tribal)](quest-harness-recipes-13.md)
- [Quest harness recipes (U)](quest-harness-recipes-16.md)
- [Quest harness method](quest-harness-method.md)
- [Seeding test accounts](seeding-test-accounts.md)
