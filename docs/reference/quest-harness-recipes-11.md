[Manual](../README.md) › [Testing](../TESTING.md) › Quest harness recipes

# Quest harness recipes (L)

## Legends Quest — stage-scoped harness

[`e2e/legends-quest-253-live.ts`](../../e2e/legends-quest-253-live.ts), members-only,
so `:8890`:

```sh
HEADED=1 bun e2e/legends-quest-253-live.ts --stage 0 --minutes 180 --tick 200          # end to end
HEADED=1 bun e2e/legends-quest-253-live.ts --stage 0 --until 2 --minutes 30 --kit      # guild and the map
HEADED=1 bun e2e/legends-quest-253-live.ts --stage 5 --until 12 --minutes 60 --kit     # the cave, the bowl, the trials
HEADED=1 bun e2e/legends-quest-253-live.ts --stage 15 --until 25 --minutes 60 --kit    # the Viyeldi caves
HEADED=1 bun e2e/legends-quest-253-live.ts --stage 25 --until 45 --minutes 45 --kit    # the totem pole
```

Four things it does beyond the Family Crest shape:

- **Sets seven prerequisite varps and the quest-point total.** The Legends guard checks
  Family Crest, Heroes' Quest, Shilo Village, Underground Pass and Waterfall Quest before
  he opens the gate, and 107 quest points on top; two of those quests have no module yet.
  The run sets all of them and relogs — `update_questlist` only recolours at login, and
  eligibility reads the tab.
- **`setstat` rather than `~maxme`.** Every skill goes to 70, which clears all ten of the
  quest's own gates with headroom and is the only combat profile a headed run has proved.
  `setstat` is an engine branch with no level-up cascade, so unlike `~maxme` it leaves the
  player undelayed and the next command lands.
- **Banks at Ardougne West, not on Karamja.** Nothing on the island banks in this content:
  the map icon in Shilo Village has no booth and no banker behind it, and every tile of
  that village is behind Vigroy's cart anyway.
- **Seeds only what has no source.** The rune axe, the lockpick, the unpowered orb, three
  cosmic runes and the seven gems have neither a counter nor a rock the walker can reach.
  Everything else — papyrus, charcoal, the machete, the knife, the rope, the five wall
  runes, thirty water runes and two gold bars — the module buys at Jiminua's or the Magic
  Guild, or mines at Brimhaven and smelts at Ardougne. `--kit` seeds those too, which makes
  a stage leg the thing under test; leave it off for anything claiming the quest works.

The pack is full to its last slot through the trials, so a stage jump that seeds more than
the leg needs will fail to withdraw rather than fail to walk.

Measured on `:8890` at 200ms ticks, 70 in every skill, lobsters for food. The wall clock is
the elapsed time of one continuous `--stage 0 --until 75` run, which finished at t=5010s:

| Leg | Varp | First sample | Leg |
| --- | --- | --- | --- |
| Guild, machete, three thirds of the map | 0 → 2 | 340s | 262s |
| Bullroarer, Gujuo, the cave mouth | 2 → 7 | 449s | 109s |
| Gujuo names the sacred water | 7 → 8 | 667s | 218s |
| Two gold bars, the anvil, the bless, the trials kit, the syphon | 8 → 10 | 2072s | 1405s |
| Trials descent, seven gems, the book | 10 → 11 | 2497s | 425s |
| Nezikchened at the octagram | 11 → 12 | 2563s | 66s |
| Ungadulu's seeds, germinated, the pool found fouled | 12 → 14 | 2595s | 32s |
| Gujuo's bravery recipe | 14 → 15 | 2661s | 66s |
| Two herbs, the potion, the winch | 15 → 16 | 3197s | 536s |
| Three guardians, the dragon's eye | 16 → 18 | 3655s | 458s |
| The spirit roused, Echned's dagger | 18 → 20 | 3688s | 33s |
| The Holy Force, the demon at the source, the water | 20 → 25 | 4463s | 775s |
| The Yommi tree grown, carved, and the evil totem replaced | 25 → 32 | 4660s | 197s |
| Nezikchened for the last time | 32 → 35 | 4714s | 54s |
| Gujuo's gilded totem | 35 → 45 | 4725s | 11s |
| Radimus takes the totem | 45 → 50 | 4999s | 274s |
| Four training sessions, quest complete | 50 → 75 | 5010s | 11s |

The trials descent is the longest single step in the quest: the outer gate rolls against
thieving, three boulders roll against mining, the jagged wall rolls against agility, and
every one of them is retried rather than parked.

## See also

- [Quest harness recipes (A–D)](quest-harness-recipes.md)
- [Quest harness recipes (E)](quest-harness-recipes-4.md)
- [Quest harness recipes (F)](quest-harness-recipes-2.md)
- [Quest harness recipes (Haz–Hol)](quest-harness-recipes-8.md)
- [Quest harness recipes (Hor)](quest-harness-recipes-10.md)
- [Quest harness recipes (I–N)](quest-harness-recipes-3.md)
- [Quest harness recipes (M–O)](quest-harness-recipes-6.md)
- [Quest harness recipes (P–R)](quest-harness-recipes-5.md)
- [Quest harness recipes (S)](quest-harness-recipes-7.md)
- [Quest harness recipes (T)](quest-harness-recipes-9.md)
- [Quest harness method](quest-harness-method.md)
- [Seeding test accounts](seeding-test-accounts.md)
