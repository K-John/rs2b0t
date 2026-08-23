[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Legends Quest (from the runs)

Fifteen that only a live run could find, and most of them cost a run apiece.

- **The tidy-up on the way out is not on the path the loop takes when it wins.** Chopping
  into the jungle leaves logs the pack has no slot for, so the chop loop drops them before
  it returns, except the loop's success is an early `return true` from the top of the next
  iteration, which walks past the drop. Every failed crossing tidied up and the one that
  worked did not, so the reed at the pool was cut with nought free. A clean-up belongs in
  the loop's exit condition, not after its body.

- **A random event's gift is a slot, and the pack has not got one.** Whatever hands out the
  king's message hands it out mid-walk, and the reed at the pool wants one free slot. The bank-at-the-booth rescue only fires for a step that was already going to a
  bank, so a custom step met a full pack and retried it eight times. The whitelist that
  decides what a deposit would take is the same list that says what may be dropped where
  the character stands.

- **"Already in the right area" is not "able to walk there".** Every trials pocket answers
  `shamanCaves`, so the leg that came back up out of the gem room holding the book found
  its cave check satisfied and walked at an octagram twenty tiles and four sealed pockets
  away, "unreachable from here", for ever. A stage-jumped leg never sees it, because it
  starts on the surface; only the continuous run does. Where the area is one name and the
  map is many rooms, the pocket is what the guard has to read.

- **A pack of twenty-eight wanted things still has no room.** The trials kit, the armour,
  the coin and three lobsters come to twenty-eight slots, every one of them on the
  keep list, so nothing is spent, nothing is junk, and the reed that the quest cannot go
  on without has nowhere to land. The seeded leg never showed it: a random event had taken
  a slot, and dropping that gift left the one the reed needed. The lobster count is the
  only number in the pack that is a float rather than a requirement, so the leg eats one.
  Fixing it at the reed fixed it only at the reed: the herb, one stage later, met the same
  full pack. The valve belongs where every step passes through it, not in the step that
  happened to hit it first.

- **The floor below a shop is four tiles from it.** `Tile.distanceTo` is a plan distance
  with no storey in it, so `ensureAt` let the walker stop underneath the Magic Guild
  counter and call itself arrived; the buy then failed in under a millisecond, twenty-three
  times and counting, with the anchor directly overhead. Any "am I there yet" that compares
  tiles has to compare the level too, and this one is shared by every quest rather than
  this one alone.

- **The chat shuts between a page and the option list behind it.** Three quiet ticks read
  as "the conversation ended", and at 200ms ticks three ticks is most of the gap the modal
  leaves while it swaps a `chatnpc` page for the `multi2` after it, so Gujuo's chain
  called it a day one option short of the rescue, four times running. The step recovered
  on the fifth pass, which is the tell: a race, not a wrong list. Ten ticks of silence is
  an ending; three is a blink.

- **A float the pack cannot hold is a loop, not a shortfall.** Dying to the octagram demon
  brings the trials kit back at once, and the fight float of ten lobsters then has
  nowhere to go: the withdraw fills the last slot, the pack-space valve eats one to make
  room, and the top-up asks for it straight back. Two steps, forever. The ask is what the
  pack can take, and the valve only ever eats the surplus above the float's own threshold.
- **A box that suspends the script is not a box you can wait out.** `~doubleobjbox` pauses
  `opheldu` where it stands and the germinated seeds are added *after* it, so waiting twelve
  seconds for them without clearing the box waits for something the server will never do,
  ten times over, in silence, with both items in the pack and the use-on accepted. The
  stage-jumped leg passed the same code because the fill before it left a driver running.
  Every wait that follows a box has to drive it.
- **`opheldu` runs on the item clicked second, and the pair is not symmetric.** The bowl
  carries the handler and wants the seeds as `last_useitem`, so seeds-on-bowl germinates and
  bowl-on-seeds is "nothing interesting happens", the script says so in a comment, and
  eleven attempts twelve seconds apart said it in the log. The ardrigal and the snakeweed
  mixture are the same shape and happen to be written the right way round. Which of the two
  items holds the handler is worth reading before either is clicked.
- **The use-on packet does not walk.** Gujuo stood five tiles off, the bowl was offered to
  him from where the character happened to be, and the offer was accepted and answered with
  nothing at all, `opnpcu` never runs for an npc out of reach. Two live runs died in that
  silence before a single log line named it: *sent at 2821,2925, chat ""*. Four npc use-ons
  in this quest had the same shape and only worked because the step before them happened to
  finish adjacent. They all go through one helper now, and it walks first.
- **One long wait on a chat that is not coming teaches you nothing.** Gujuo takes the
  golden bowl, the greeting that should follow sometimes never arrives, and a
  hundred-and-fifty-second `driveUntil` sits through all of it in silence before the engine
  retries the identical thing. Four offers of forty seconds cost the same wall clock and
  each one is a fresh throw. Where the opening move is cheap and the wait is long, retry
  the move.

- **A protected item can be junk, and a deposit will not take it.** The gem rock rolls opal
  60 times in 128 and diamond 4, so the wait for the last two gems buried the pack in nine
  uncut opals, every one of them on the keep list, so nothing read as junk, and the food
  float was already below its own threshold, so no lobster could be eaten either. Mining
  with nought free lands nothing, forever. The seeded bank hid it: the first pass withdrew
  seven cut gems and never touched the rock, and only a death made the module mine them.
  What the drop may shed and what a deposit would take are two lists, not one.

- **A skill check that spends the skill can spend its way past its own gate.** Gujuo's
  blessing rolls `stat_random(prayer, 80, 250)` and takes five points on every miss, which
  at seventy is a four-in-five chance each throw, so six misses walk the prayer from
  seventy down to forty, one under the forty-two the same script demands, and from then on
  the answer is "you are too inexperienced" for ever. Three live offers went by with
  `chat ""` in the log, because the driver had already closed the refusal by the time the
  wait gave up. The flask the demon needs, this leg needs too.

- **A shop counter is not a booth, and the pack-space valve only knew booths.** A full pack
  going to a *withdraw* has a bank to shed into; a full pack going to a *buy* at the Magic
  Guild has nothing but the floor. The valve handed the buy straight back when there was
  nothing a deposit would take, and the water runes failed a hundred and thirty times in
  ten minutes with an explicit warning in the log that the no-progress watchdog would never
  fire, because a failure is not a stall. Every step kind needs the same last resort, and
  the two things filling the pack were both receipts: the sketch of a bowl that had already
  been forged, and the flask the blessing had already drunk.

- **A use-on sent while a page is still up is dropped without a word.** The seeds arrive on
  the last page of Ungadulu's chat, and the germinate step clicked them into the bowl before
  that page had closed: accepted by the client, discarded by the server, twenty seconds of
  silence, five times over. Two earlier legs had already been fixed for the same shape, the
  bowl offered to a Gujuo too far away, the wait that never drove its box, and this is the
  third face of it. The stage-jumped leg passed every time, because there the seeds came out
  of a bank rather than out of a conversation.

- **The item a stage hands you is kit for every stage after it.** Swinging the bull roarer
  is what summons Gujuo, and Gujuo is wanted at the bowl, the recipe and the gilded totem,
  but the branch that trades a map copy for a roarer runs at stage three and nowhere else.
  A Jungle Savage takes a dislike to the noise the roarer makes, and the death that follows
  drops the roarer and the map together at stage fourteen, where nothing looks for either.
  Radimus sells a replacement map for thirty coins, but only while neither map is held, so
  the recovery is three legs deep: buy the map, redraw all three thirds, trade it again. A
  quest is resumable from any point only if every consumable it was ever handed can be got
  back from wherever the run is standing.

## See also

- [Quest pitfalls: Legends Quest (from the content)](quest-pitfalls-36.md)
- [Quest pitfalls: Witch's House](quest-pitfalls-38.md)
- [Quest pitfalls](quest-pitfalls.md)
- [More pitfalls](quest-pitfalls-2.md)
- [Legends Quest's harness recipe](../reference/quest-harness-recipes-20.md)
- [Add a quest](../how-to/add-a-quest.md)
