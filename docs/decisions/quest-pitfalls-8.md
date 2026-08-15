[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Underground Pass

Ten, and the first three are engine behaviour the quest only happens to expose.

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
- **Check connectivity before writing a single leg.** A component report over the pass's own seam endpoints
  answers FAIL for 10 of 14 anchors: the landing chamber is 119 tiles with no walkable exit, and the
  portcullis lever and the furnace are twelve tiles apart in different components. Every seam is a scripted
  obstacle whose tile the collision pack marks blocked, so `walkResilient` past one reports "unreachable" —
  which reads as a missing loc, not a missing route. Five legs were written against the opposite assumption
  before that was measured. `bun tools/nav/component-report.ts --seed …` costs a minute.
- **The obstacles are all one shape.** Rockslides, ledges, stone bridges, obstacle pipes, collapsed bridges
  and the rope swing are each a forced move over a blocked tile, so one loop crosses all of them: try the
  navigator, and when it has no route, cross the nearest obstacle that ends closer to the target than
  standing still does. An obstacle can be closer to the target than the player and still put them on its far
  side going backwards, so a crossing that does not shorten the distance has to be spent, or the loop walks
  between two sides of the same rock forever.
- **A missing collision pack does not look like a missing file.** It presents as a per-destination
  "no path to (x,z): unreachable" while short hops still work off the scene stepper. `out/collision.lcnav.gz`
  is a separate artefact that `build:bot` does not bake — a hand-rolled deploy copying only the four bundle
  files ships no graph at all. `deployIsolatedClient` copies the whole of `out/` and refuses to start without it.
- **A prerequisite quest with no module can never be satisfied.** `readPlayerState` built
  `completedQuests` from `QUEST_DEFS`, not from every known quest, so Biohazard — real,
  finished, green in the journal — was invisible and this quest reported BLOCKED forever.
  Eligibility is a property of the account, not of which modules happen to exist.
- **Two earlier crossings into West Ardougne are dead by the time this quest runs.** Koftik and the cave
  mouth are behind the wall, and the navigator has no edge through it. Plague City's garden dig is refused
  the moment Biohazard starts — `mud_patch.rs2` answers "the ground's been filled in and packed hard" for
  `%biohazard >= started` — and Omart will not re-hang Biohazard's rope ladder once that quest is finished,
  which is the state every account arriving here is in. What a completed Biohazard leaves is the city gates:
  `west_ardougne_open_city_doors` opens them outright at `%biohazard = complete`. Reusing Plague City's
  crossing looked like the reuse-not-rebuild call and was simply wrong.
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
