[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Underground Pass

Twenty-two, and the first three are engine behaviour the quest only happens to expose.

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
- **Watch what the script consumed, never where the character is standing.** Three separate steps here read
  position as their oracle and all three lied. The guide rope answered "I can't reach that!" and never fired,
  which looked like eight missed shots. The rock swing's op-click walks the player to the rock before the use
  resolves, so "the tile changed" reported a swing that had not happened. An obstacle hop has the same shape.
  Every one of these scripts deletes something first — the arrow, the rope — so the inventory delta is the
  honest signal, and `GameMessages.since(mark)` is what separates a refusal from a failure.
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
  crossing looked like the reuse-not-rebuild call and was wrong.
- **Nothing records which orbs are already dark.** The varp is untransmitted and the
  journal only says "after destroying four orbs" once the well has been used, so an orb
  that is neither in the pack nor on its own floor tile has already been burned. The well
  is the oracle for the sweep: it only descends once all four are out, and blasts the
  character back with damage otherwise.
- **Five separate NPCs are all called "Koftik".** `caveguide1` through `caveguide5` render
  the same display name at five different points in the quest, and each has its own
  dialogue. Match the guide by id. The same holds for the four "Orb of light" and two of
  the three "Paladin's badge".
- **The corridor traps cannot be routed around, only suspended.** `[timer,upass_trap]` is set to one tick
  across map squares `0_37_151` and `0_38_151` and takes `hp/10 + 1` on a spear or 8% of base hitpoints on a
  spring for every tick ended on one. Twenty trap tiles were lifted out of the map and given to the
  pathfinder as avoid-zones: every route failed, and probing them one at a time showed each tile alone severs
  a route — the corridor is a single tile wide at every trap. Three runs died there with a full pack. A
  normal `[timer,…]` only runs under `canAccess()`, so an open quest journal stops all of it.
- **An op-click can only name what the client already has in its build area.** That area is 104x104 but it
  lags the player by up to two zones, so a target forty tiles off reads as absent and the click never sends —
  one run stood still for six minutes clicking at a loc it could not see. Absence at range is therefore not
  evidence of anything: reading "no orb on that tile" from across the corridor as "already burned" was about
  to skip three of the four. Long stalled walks have to be chained over stepping stones instead, and down
  here the stones are the traps' own `Search` and the two stone tablets.
- **Two pockets of the first cavern share a rectangle.** A flood fill on foot gives the orb corridor as
  x 2380-2466 / z 9664-9698 and the bridge-and-rope shelf as x 2431-2464 / z 9686-9731. A plain bounding box
  therefore reads the shelf as the corridor, and a run that drifted onto the shelf declared the spiked grid
  crossed while it was still on the wrong side of it. Bound a pocket by what is left after its neighbours are
  taken out, not by its own extent.
- **A seam vocabulary keyed on loc id alone is not enough.** The same id appears in both caverns and the same
  op means different things at each end: taking `upass_swampbubbles1` for a crossing walked a route twenty
  tiles off its approach before the script behind it was read. The unicorn tunnel is the sharper case — it is
  a real seam, sixteen tiles from the boulder with a gain that reads as progress, and it telejumps to the
  paladins' shelf four seams and a well behind. It is only worth offering when the journey crosses between
  the caverns, which is the one thing it joins.
- **The way back up to the paladins is the unicorn tunnel, not the mud pile.** `mudpile_upass` climbs into
  the orb corridor, on the far side of the well and behind every trap already crossed.
  `upass_area_2_3_entrance` is the one that telejumps between the second cavern and the paladins' shelf.
- **This quest is fought, not walked.** Three paladins at level 62 for their crests, three demons for their
  amulets and Kalrag for the blood. The kit's shortbow exists for one shot at one rope, so a module that
  packs it and nothing else descends a one-way dungeon bare-handed — and `armFireArrow` leaves any melee
  weapon in the pack, where it stays unless something puts it back on.

- **A `Cross` op is not a promise of a crossing.** `upass_swampbubbles1` offers one and then drags the player
  into a crevasse at (2485,9649) for fifteen per cent of their hitpoints, and `caverockpile` climbs honestly
  but out to the first cavern's landing chamber, behind the bridge and the grid — a way home, not a way on.
  Both sit on the route to the boulder with a gain that reads as progress. Read the script behind every op
  before it joins a seam vocabulary.
- **A seam's own tile is blocked — that is what makes it a seam.** A reachability flood asked about the loc's
  tile answers no, and where the near side is a single walkable column (the second cavern's ledge is six such
  tiles in a row) it answers no for every one. Ask about the cardinal neighbours, which are where a player
  would stand.
- **Every obstacle here rolls a skill, so one attempt is not a verdict.** The rockslide, the ledge, the stone
  bridges, the collapsed bridge and the rope swing roll agility; the two locked cages roll thieving. A
  failure leaves the player short — the ledge in a rat pit — and spending the obstacle on it is how a leg ran
  out of ledges to try while standing at the door of the room it could not leave.
- **Drops are not deliveries.** `ai_queue3` puts the paladin's coat of arms on its own tile, so a step waiting
  for it to appear in the pack waits forever. The kill and the pickup are two separate things.

- **An op-click on a ground-decor seam has to be sent from beside it.** The ledge is shape 22 on a tile the
  collision pack calls blocked, so the server paths toward that tile, dead-ends, and answers "I can't reach
  that!" — the crossing script never runs, and the step reads it as the agility roll failing. Twenty rolls at
  ninety-five per cent each "failed" before the refusal was logged. `inOperableDistance` is
  `reachedEntity || reachedObj`, which a cardinal neighbour satisfies: walk there at radius 0 first.

## See also

- [Quest pitfalls: the map](quest-pitfalls.md)
- [Quest pitfalls: engine behaviour](quest-pitfalls-engine.md)
