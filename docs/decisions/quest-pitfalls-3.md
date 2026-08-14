[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: later quests

Pirate's Treasure added five, and the first three are not quest facts:

- **An NPC that blocks an action cannot always be waited out — check the arithmetic
  before writing a wait.** `dig.rs2` abandons the dig whenever
  `npc_find(coord, falador_gardener, 10, 0)` hits. The gardener spawns three tiles from
  the dig site with `wanderrange=5` and `maxrange=7`, so his distance from it never
  exceeds ten and there is no moment to wait for. Killing him is the only route, and
  the dig has to land inside his fifty-tick respawn. Read the spawn offset against
  `maxrange` before assuming patience is a strategy.
- **Same-named locs are the rule, and `nearest()` picks the wrong one.** Four ordinary
  crates answer `Search` within six tiles of Wydin's grocery crate, and three more
  stand beside the Blue Moon chest, so `Locs.query().name('Crate')` searches an empty
  one forever. `Reach.locOp` and `useOnLoc` take an optional exact `id`; anything whose
  display name is shared inside its own search radius has to pass it.
- **A loc that changes stage keeps its name and its op.** A banana tree renders "Banana
  Tree" with `op1=Search` from full down to `bananatreeempty`, so a name-matched pick
  re-clicks the tree it has already stripped. The five bearing ids are the filter; walking
  away to re-roll which one is nearest is not.
- **One journal page can describe two states when the varp behind it is a bitfield.**
  `%hunt_store_employed` is two bits, and `hunt_journal.rs2` prints "I have taken a job
  at Wydin's store" both when the rum is waiting in the back room and when it is still
  in the plantation crate mid-re-smuggle. Nothing in the text separates them. The module
  searches the back room and treats the rum arriving as the proof, falling through to
  the island when it does not — and each side's leg ends by crossing back, so the next
  `decide()` is never stranded on the wrong side of the water.
- **A loc's own message can carry the varps the client cannot see.** Searching the
  plantation crate prints both the rum and the banana count, which is what lets the
  smuggle resume from any interruption without the module keeping a tally.

## See also

- [Per-quest](quest-pitfalls-2.md)
- [Engine behaviour](quest-pitfalls-engine.md)
- [Add a quest](../how-to/add-a-quest.md)
