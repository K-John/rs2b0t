[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Witch's House

Five from rewriting the module against `quest_ball`, and the first of them is the quest.

- **A varp that goes backwards makes an inventory-only `decide` unwritable.** `witch.rs2`
  catches you in the garden, deletes the shed key and the ball and rewinds `%ballquest`
  from 3 to 1. Branching on what the pack holds cannot see that: the same empty pack means
  "have not started the cellar" and "did the cellar, was caught, lost everything after it".
  A module that reads its stage every pass recovers by re-deriving; a module that reads its
  pack keeps making the same wrong move. This is the reason the ladder exists, not a
  refinement of it.

- **One journal page can be two stages, and the difference is what saves the run.**
  `witches_diary.rs2` moves the varp 3 to 5 when the diary is read after the mouse door
  opens, and `witch.rs2` rewinds only from 3. So reading a book turns a catch from
  "redo the cellar, the cheese and the mouse" into "walk back and check the fountain again".
  `ball_journal.rs2` renders 3 and 5 from one branch, so the client cannot see the
  difference and the module carries the bit itself, with a try counter, because a book on
  a bedroom floor must never be what blocks a quest.

- **`~mesbox` sits on either side of the thing it announces.** The flower pot prints its box
  and then does `inv_add`, so the key lands only after the box is clicked. Fitting the
  magnet does `inv_del` and then prints, so the pack has already changed while the box is
  still up. The same "wait for the item count" oracle is right in one and wrong in the
  other; what settles it is reading which line comes first in the script.

- **An obj on a tile nothing can stand on is still takeable.** The ball sits at (2935,3460)
  under a `crate`, which is shape 11 and fills its tile, so a flood over the collision pack
  says the ball is unreachable. `reachedObj` calls `rsmod.reached` with shape -1, which is
  the adjacent-tile rule, so standing beside it is enough. Do not read an obj's tile as its
  stand.

- **The witch is survivable without pacing the walk.** The garden ring runs three tiles from
  her patrol lane and the hedges block line of sight except at the maze gaps, so a crossing
  gets caught roughly every other attempt. `Traversal.walkResilient` already handles it: the
  teleport reads as a deviation, it repaths through the front door and tries again. Two
  catches and eighty-three seconds got the shed key in the live run. Once the stage cannot
  rewind, a catch costs a walk, and a retry loop that converges beats hard-coded timing
  windows over hedge geometry.

## See also

- [Quest pitfalls: Legends Quest (from the runs)](quest-pitfalls-37.md)
- [Quest pitfalls](quest-pitfalls.md)
- [More pitfalls](quest-pitfalls-2.md)
- [Add a quest](../how-to/add-a-quest.md)
