[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Underground Pass

Seven, and the first three are engine behaviour the quest only happens to expose.

- **An open modal suspends every NORMAL timer.** `Player.busy()` is
  `delayed || containsModalInterface()`, and `processTimers` runs a `[timer,…]` only under
  `canAccess()`. Holding the quest journal open therefore walks the character through the
  spiked grid and the spear and spring traps untouched — the combination in `%ibanmulti`
  bits 22-31 never has to be guessed, and it could not be anyway, because the varp is
  `scope=perm` with no `transmit`. `[softtimer,…]` is unaffected and still fires.
- **The walk under a modal has to be an op-click.** `MoveClickHandler` calls
  `clearPendingAction()` — which closes the modal — for every move except `opClick`. A
  plain walk click cancels the stall on the first step, which is why the trick is
  "click the lever", not "click the ground".
- **The op-click and the modal must land in separate server ticks.** `moveClickRequest`
  is settled after a whole tick is decoded: an op-click alone leaves it false and the walk
  survives an open modal, while a modal opened in that same tick latches it true, and
  `updateMovement` then freezes at the first 8×8 zone boundary *permanently*, because the
  engine queue it waits on cannot drain while busy either. Proved by disabling the trap —
  the character still froze at the boundary and resumed the instant the modal closed.
  A bare tick delay does not prove the split; the client can flush both packets into one
  tick. Wait for the first step, which means staging far enough back that the character is
  still on safe ground by then.
- **A prerequisite quest with no module can never be satisfied.** `readPlayerState` built
  `completedQuests` from `QUEST_DEFS`, not from every known quest, so Biohazard — real,
  finished, green in the journal — was invisible and this quest reported BLOCKED forever.
  Eligibility is a property of the account, not of which modules happen to exist.
- **The quest's own map is behind another quest's crossing.** Koftik and the cave mouth are
  in West Ardougne, which the navigator has no edge into; the wall is only passed through
  Plague City's dig, pipe and manhole. Reuse that crossing rather than growing a second
  copy of it, and carry the Gas mask and Spade it needs.
- **Nothing records which orbs are already dark.** The varp is untransmitted and the
  journal only says "after destroying four orbs" once the well has been used, so an orb
  that is neither in the pack nor on its own floor tile has already been burned. The well
  is the oracle for the sweep: it only descends once all four are out, and blasts the
  character back with damage otherwise.
- **Five separate NPCs are all called "Koftik".** `caveguide1` through `caveguide5` render
  the same display name at five different points in the quest, and each has its own
  dialogue. Match the guide by id. The same holds for the four "Orb of light" and two of
  the three "Paladin's badge".

## See also

- [Quest pitfalls: the map](quest-pitfalls.md)
- [Quest pitfalls: engine behaviour](quest-pitfalls-engine.md)
