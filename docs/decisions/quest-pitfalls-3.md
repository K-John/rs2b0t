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
- **Clearing a blocker moves you off the tile the action needs.** The attack that
  removes the gardener walks the character to him, and `spade.rs2` fires only within
  one tile of the X, so the dig that follows answers "Nothing interesting happens." —
  and the retry kills the respawn and walks away again, a loop that never converges.
  It only looked fine on the first run because the gardener happened to be out of
  range. Anything that fights before acting has to walk back before it acts.
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
- **The same ambiguity turns up twice, and the same oracle settles it.** With the store
  job held, `hunt_journal.rs2` prints "I have the Karamja Rum. I should take it to
  Redbeard Frank." for *any* bottle in the pack — including one bought minutes earlier on Karamja
  that has never been smuggled. Following it walks the rum onto the boat, where the
  customs officer confiscates it, and the journal then reads lost-rum and buys another
  forever. Standing on the island is what separates the two, the same way it does for
  `store-job`. A journal line describes the varps, not the history that produced them.
- **A permission the quest granted can be revoked by the quest's own progress.** Luthas
  clears the plantation bit every time he ships a crate, so a second smuggle finds the
  crate answering "Why would I want to do that?" to a rum it accepted an hour earlier.
  The refusal is the only signal, so the leg re-hires and retries rather than reading a
  bit it cannot see.
- **A loc's own message can carry the varps the client cannot see.** Searching the
  plantation crate prints both the rum and the banana count, which is what lets the
  smuggle resume from any interruption without the module keeping a tally.

Dwarf Cannon added seven, and the first three are engine behaviour rather than quest facts:

- **`GameMessages` records `MESSAGE_GAME` and nothing else, so a dialogue line is not an
  oracle.** `BotHost` feeds the ring from that one packet, which is what `mes` emits;
  `~chatplayer` and `~chatnpc` build a chat interface the ring never sees. The line that
  ends the cannon repair — "The Cannon seems to be in working order" — is a `~chatplayer`,
  so watching for it would have run the loop through every attempt and then declared
  success on a timeout. Read the `.rs2` and see which call prints a line before making it
  a test.
- **A stage-gated door in a dead-end room is load-bearing as a baked edge, not a hazard.**
  The instinct after Melzar's is that a door whose script can refuse belongs in
  `SCRIPT_REFUSED`. Both Dwarf Cannon doors refuse below their stage and open above it,
  and the route needs both: the shed leg and the Nulodion leg each cross one, and nothing
  else reaches either room. The question is not whether a door can refuse, but whether the
  refusal outlasts the quest.
- **A ladder whose transport is disabled has no descent edge either.** `transports.json`
  carries the watchtower's ground ladder with `disabled: true` — "no statically
  identifiable movement destination" — and carries nothing at all for the two floors above
  or for either `laddertop` back down. A step that climbs up and stops therefore strands
  the walker on a floor it cannot route off, holding the quest item it went up for.
  Anything that climbs an unbaked ladder owns the descent too.
- **Two stages that render identical journal text are one branch, not a defect.**
  `mcannon_journal.rs2` prints the same page for stages 6 and 7, and reporting one stage
  for both is right because the same step drives them: at 6 the first Inspect flips to 7,
  at 7 Inspect opens the repair menu. Telling them apart would need a varp the client
  cannot read.
- **A repair loop whose last unit of work sets no state needs one more pass.** Fixing the
  fourth cannon component leaves the stage at 7; the *next* Inspect, finding all four bits
  set, is what flips it to 8. A loop that stops when it runs out of parts stops one action
  early and parks.
- **A count of held quest items is a lie when the quest giver tops it up.** The Commander
  hands over six railings and another whenever the pack runs dry, so "six minus what I am
  carrying" is not how many are fixed. The oracle is per-railing: act on each of the six
  locs by id and read the "You have already fixed this railing." refusal, and let the
  journal's all-six line end the leg.

- **A module's `coinFloat` was not the only thing withdrawing coin.** `AIOQuester`'s
  `StartupWithdraw` ran a generic 1000gp withdrawal against the pinned bank before the
  first `decide()`, skipping only for `ownsInventory`. Resumed inside the goblin cave that
  is a route which does not exist, and it spent 84 seconds and three retries proving so
  before the quest could start. It now honours the declared float, which also silences the
  same waste in Dragon Slayer — the other module that declares `coinFloat: 0`.

The camp is also worth stating on its own: plain walking never enters it. It is a
1294-tile compound whose perimeter is the railings themselves, and every route in
crosses the Coal trucks log balance — an Agility shortcut, not a door. A flood over the
collision pack therefore reports the Commander and all six railings unreachable, and
`findPath` with the baked edges loaded reports them fine. Probe with the pathfinder, not
with a flood.

Shield of Arrav added fourteen, and only the first two are quest facts:

- **A reward that deletes one of two is not a reward that needs two.** `king_roald.rs2`
  tests `inv_total(inv, arravcertificate) > 0` and deletes one, gated on nothing
  but having *joined* either gang. A certificate obtained by trade finishes the quest for
  a character that never saw a shield half. Read what the completion script consumes
  before designing around what the guide says it wants.
- **A pickup gated on the bank cannot be stockpiled.** The chest and the cupboard refuse
  while a copy sits in inventory *or* bank, so a spare half is impossible and only the
  certificate — checked in neither — banks. Which item is farmable is a property of the
  gate, not of the item.
- **`~objbox` and `~mesbox` build a main modal, not a chat line.** "You find half a
  shield, which you take." never reaches `GameMessages`, so a `sawSince` oracle on it is
  dead code that always reads false. Read `reader.mainModalTexts()`, or count the item.
- **A loc that transforms keeps its old id for a tick.** The chest and the cupboard are
  each a shut loc and an open loc; checking for the open id immediately after the Open
  lands reads the shut one and calls a successful open a failure. Poll it.
- **`Reach` reporting `retry` is not a crossing that failed.** The cellar ladder lands
  the character underground and still returns `retry`. Where the character is standing is
  the oracle; the status is a hint.
- **A pre-walk in front of `Reach` doubles the budget and wedges.** `Reach.locOp` walks,
  opens the blocking door and retries on its own 90s budget; a `walkResilient` in front of
  it spends a second one, and the pair sat at the Phoenix cellar for two and a half
  minutes. Let `Reach` own the approach.
- **A leg that did its work and failed to leave should report the work.** Taking the half
  and then failing the climb out returned false, which threw away a shield half the pack
  was holding. The next pass's early branch retries the exit for free.
- **Putting a door in `SCRIPT_REFUSED` makes whatever it guards a one-way trap.** All
  three hideout doors had to be removed from the graph, and each sealed a pocket the bot
  then could not leave: the Phoenix chest room, the weapon store's ten-tile ground floor,
  and the Black Arm stairs. Every one showed up only once a bot was inside *holding the
  quest item*, because until then nothing needed to walk out. Removing a door is half the
  work; the module owes both directions.
- **A component test, not a distance test, says which side of a door you are on.** The two
  sides of a one-tile wall are two tiles apart, so a proximity check calls a character
  standing at the door already through it. Flood the pack once and box each side.
- **`ownsInventory` means nothing ever opens a booth.** No banked item is visible at all —
  `snap.bankIds` stays empty all run — so a quest that reads the bank has to ask
  for a `scanBank` itself. Ours parked beside a bank holding the key it was waiting for.
- **An npc's display name comes from the `.npc` config, never from a guide.** The curator
  is `Curator`; every walkthrough calls him Curator Haig Halen, and a name that matches
  nothing makes `Reach` report a bare `retry` with no hint that the name is the problem.

Three came from stockpiling, and none of them is reachable at the default target — one
cycle hides every one of them, so the loop needs its own run:

- **A predicate that reads where an item sits, rather than how many there are, makes two
  branches undo each other.** "Minting is done" tested the split between pack and bank, so
  banking the surplus flipped it true, the withdraw pulled the same pair straight back, and
  the pair took turns every 1.2 seconds. This is the coin-float lesson again: a threshold
  on a total is stable, a target on a location is not.
- **A trade offers from the pack, so a stockpile in the bank is not offerable.** The bot
  reached the hand-over holding zero and reported "nothing to give" while its own bank held
  six. Whatever a handoff needs has to be withdrawn before the handoff decides.
- **A flag where the work is a count stops the supplier after one unit.** Each shield half
  buys the pair two certificates, so a boolean "I gave my half" left the supplier waiting
  for a certificate while its partner waited for the second half.

Four more came from the two-account trade, and they generalise to any partner handoff:

- **The engine shuts the offer screen a tick before it opens the confirm.** A loop gated on
  "is a trade open" exits on that one frame, reads a pack view that is still swapped, and
  walks away — which closes the window the partner is confirming in. Tolerate the gap.
- **The pack view hides whatever is sitting in the offer.** A giver that counts its own
  items mid-trade sees them already gone and calls the trade done before the partner has
  confirmed. Measure once the window is shut.
- **A giver that keeps one of two is still a giver.** "Gone from the pack" is the wrong
  test wherever the giver keeps one — one fewer than the baseline is the test, and the
  baseline can only be taken with no window open. Taking it by declining an open trade
  kills the partner's handshake, and two bots then deadlock closing each other's windows.
- **A main modal swallows the Trade-with click.** A conversation driver that returns the
  moment its goal lands leaves the closing mesbox up, and the next leg's trade never opens
  for either side — with no refusal to say why.

## See also

- [Quest pitfalls](quest-pitfalls.md)
- [Per-quest](quest-pitfalls-2.md)
- [Engine behaviour](quest-pitfalls-engine.md)
- [Add a quest](../how-to/add-a-quest.md)
