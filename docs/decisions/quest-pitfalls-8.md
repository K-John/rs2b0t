[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Legends Quest

Twenty-five, and the first three are map and engine facts rather than quest ones.

- **Overlapping component boxes cannot be told apart by a rectangle, and this quest is
  eighteen of them.** The trials corridor floods to `x 2789-2814, z 9281-9318` and the gem
  room to `x 2754-2785, z 9282-9312`; every Viyeldi descent ledge sits inside the main
  cave's box. Every hand-written boundary was wrong at some z. The flood is not: the tile
  sets are small enough to bake, so [`tools/nav/legends-pockets.ts`](../../tools/nav/legends-pockets.ts)
  emits them as `[z, xFrom, xTo]` runs and the module asks which pocket a tile is in
  rather than which rectangle contains it.
- **`huntall` iterates players, not npcs.** `~player_in_fire_octagram` looks like a guard
  saying the flames refuse anyone while Ungadulu stands inside them — which would make the
  quest unfinishable, since he never leaves. It is a multiplayer courtesy check: another
  *player* mid-cutscene inside the octagram is what it looks for. Read the op's handler
  before concluding a script contradicts itself.
- **A spell aimed at scenery is `oploct`, and the client had no route to it.** The magic
  trial gate opens for a charge-orb spell and nothing else — no op, no use-on, no npc.
  `Input.castOnLoc` and `Game.castOnLoc` are the same `TGT_BUTTON` + `TGT_LOC` pair
  `castOnNpc` already used for npcs; without them the leg is not expressible.
- **Two gates advertise Open and answer something else.** The outer ancient gate replies
  "You push on the doors, they're really shut" to every Open from the entering side and
  yields only to a *Search* with a lockpick; the inner one raises a brute-strength prompt
  and a roll. Both were baked into `doors.json`, so the pathfinder routed straight at them
  and the walker looped a tile short. They belong in `SCRIPT_REFUSED`, with the last tile a
  `DirectNavigator` scene step — and removing them splits two more pockets, which is why
  the pocket table is regenerated after the door bake rather than before it.
- **The Kharazi Jungle is sealed by blocked ground with plants standing on it.** The jungle
  band is `blockwalk=no` scenery over map-blocked tiles, and `chop_jungle` teleports the
  chopper two tiles towards whatever it fells — `map_blocked($dest)` is allowed exactly
  when another jungle plant stands there. Nothing walks in. `(2816,2940)` is the one
  mainland tile with an unbroken two-plant column south of it, and a diagonal chop lands on
  blocked ground and answers "This way is blocked off".
- **Planting the seed before the sacred water is collected always destroys it.** The soil
  rolls `stat_random(herblore, 40, 243) = false | %legendsquest < ^legends_sacred_water_collected`,
  so between germinating at stage 13 and bottling the source at stage 25 every attempt
  withers a seed and Ungadulu only hands out three. The journal reads "I just need to plant
  them now", which is the state, not the instruction.
- **Five loc stages in a row expire fifty-one ticks after they grow.** Sapling, adult,
  felled, trimmed and carved each `loc_change` back to a rotten twin on a timer, so
  planting, watering, felling, trimming, carving and lifting cannot be six `decide()`
  ticks — a resume that arrives late finds a stump. They are one step whose oracle is the
  totem pole in the pack.
- **Killing Viyeldi is a trap the content cannot spring.** Taking his hat summons him for a
  hundred ticks and immediately runs a conversation that ends in `npc_del`, so the dagger
  never reaches him. Ungadulu's Holy Force is the route the quest is built around, and it
  costs a full climb back up the trials and down again — which the module has to be able to
  do anyway, since the sacred water has to come home the same way.
- **A bank the map claims is not a bank the content built.** Shilo Village carries a bank
  icon and a `BANK_LOCATIONS` entry, and has neither a booth nor a banker — so
  `reachableBank`, which picks by walking cost, chose it from Karamja and the buy step sat
  at the icon answering "no 'Bank booth' in the scene" until the run was killed. A `buy`
  step now carries the booth its module named rather than letting the walk decide.
- **The pack is full to the last slot through the trials.** Map, machete, rune axe,
  lockpick, pickaxe, rope, unpowered orb, five rune stacks, seven gems and the bowl is
  twenty-one slots before a single lobster. The food float is a per-leg number rather than
  a constant, and the gems and runes are consumed on the way in, which is what makes room
  for the Book of Binding on the way out.
- **Chopping into the jungle boils the golden bowl dry.** `jungle_tree` empties every
  filled state of the bowl — plain, pure, blessed, blessed-pure — before it looks at the
  tree, and the only way back into the Kharazi Jungle is a chop. So the bank and both
  counters have to be visited *before* the pool rather than after it, and a run that ends
  up on the mainland holding water has already lost it. The module's last errand off the
  island is the trials kit, and the fill is what waits.
- **A kit that has been spent is not a kit that is missing.** The seven gems, the five wall
  runes, the lockpick and the orb are all consumed by the descent, so the checklist that
  bought them reads as "nothing in the pack, nothing in the bank" the moment the Book of
  Binding lands — and sends the run back out of the caves for things no shop stocks. The
  one-time kit is asked for only while the book is still missing; the orb and its cast are
  a separate kit, because the magic gate eats one every time it is crossed downwards.
- **Opening the Book of Binding drains nine tenths of your prayer.** `stat_sub(prayer, 0, 90)`
  fires in the same breath as the demon spawns, so Protect from Melee goes out at the moment
  it is needed against a level-187 demon with 150 hitpoints that casts from any range beyond
  one tile. Five lobsters and no flasks is what the first headed attempt died to. The float
  is twelve and two, and the pack is kitted for it *before* the pool is syphoned, since the
  bowl is still empty there and a bank trip is free.
- **Everything the descent spends, it spends again.** The outer gate swings shut behind
  whoever picked it, the three boulders drop back down behind whoever mined them, and the
  magic gate shatters the orb as it lets you through. Only the marked wall stays solved. So
  the lockpick, the pickaxe, the orb and its cast are a per-descent kit rather than a
  one-time one — and asking for them from *below* the gate reads as "no orb" and turns a
  finished descent straight back round.
- **The spirit's only polite goodbye deletes him.** Pushing the source boulder opens a
  conversation, and "I have to be going..." ends in `npc_del` — so a leg that answers
  politely and then reaches for the Holy Force finds nobody to cast it at. The rude
  answers, "I don't have the dagger." and "I haven't slayed Viyeldi yet.", close the chat
  and leave him standing. He spawns within three tiles of whoever pushed the boulder, so
  walking to him is not wanted either: walking off closes the chat and takes him with it.
- **An op that is not there fails in a tick and says nothing.** The Holy Force scroll's own
  op is "Cast Spell"; Read is what the Book of Binding takes. `interact('Read')` returned
  false in twenty milliseconds and the leg retried a hundred and ten times over eight
  minutes with not one line in the log to say why. Every `interact` whose op name came from
  a guide rather than from the `.obj` is worth checking twice.
- **Both ancient gates lie about having opened.** The lockpick chain is seven message
  boxes and the driver clears each one the tick after it lands, so the success line is gone
  before the next sample; the strength gate keeps its Open op after it is forced, because
  that op is also how it is shut. Neither the text nor the loc is an oracle. The crossing
  is: walk the last tile, read the pocket, and try again up to ten times.

- **The tidy-up on the way out is not on the path the loop takes when it wins.** Chopping
  into the jungle leaves logs the pack has no slot for, so the chop loop drops them before
  it returns — except the loop's success is an early `return true` from the top of the next
  iteration, which walks past the drop. Every failed crossing tidied up and the one that
  worked did not, so the reed at the pool was cut with nought free. A clean-up belongs in
  the loop's exit condition, not after its body.

- **A random event's gift is a slot, and the pack has not got one.** Whatever hands out the
  king's message hands it out mid-walk, and the reed at the pool wants exactly one free
  slot. The bank-at-the-booth rescue only fires for a step that was already going to a
  bank, so a custom step met a full pack and retried it eight times. The whitelist that
  decides what a deposit would take is the same list that says what may be dropped where
  the character stands.

- **"Already in the right area" is not "able to walk there".** Every trials pocket answers
  `shamanCaves`, so the leg that came back up out of the gem room holding the book found
  its cave check satisfied and walked at an octagram twenty tiles and four sealed pockets
  away — "unreachable from here", for ever. A stage-jumped leg never sees it, because it
  starts on the surface; only the continuous run does. Where the area is one name and the
  map is many rooms, the pocket is what the guard has to read.

- **A pack of twenty-eight wanted things still has no room.** The trials kit, the armour,
  the coin and three lobsters come to exactly twenty-eight slots, every one of them on the
  keep list — so nothing is spent, nothing is junk, and the reed that the quest cannot go
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
  tiles has to compare the level too — and this one is shared by every quest, not just
  this one.

- **The chat shuts between a page and the option list behind it.** Three quiet ticks read
  as "the conversation ended", and at 200ms ticks three ticks is most of the gap the modal
  leaves while it swaps a `chatnpc` page for the `multi2` after it — so Gujuo's chain
  called it a day one option short of the rescue, four times running. The step recovered
  on the fifth pass, which is the tell: a race, not a wrong list. Ten ticks of silence is
  an ending; three is a blink.

- **The use-on packet does not walk.** Gujuo stood five tiles off, the bowl was offered to
  him from where the character happened to be, and the offer was accepted and answered with
  nothing at all — `opnpcu` never runs for an npc out of reach. Two live runs died in that
  silence before a single log line named it: *sent at 2821,2925, chat ""*. Four npc use-ons
  in this quest had the same shape and only worked because the step before them happened to
  finish adjacent. They all go through one helper now, and it walks first.
- **One long wait on a chat that is not coming teaches you nothing.** Gujuo takes the
  golden bowl, the greeting that should follow sometimes never arrives, and a
  hundred-and-fifty-second `driveUntil` sits through all of it in silence before the engine
  retries the identical thing. Four offers of forty seconds cost the same wall clock and
  each one is a fresh throw. Where the opening move is cheap and the wait is long, retry
  the move.

## See also

- [Quest pitfalls](quest-pitfalls.md)
- [More pitfalls](quest-pitfalls-2.md)
- [Legends Quest's harness recipe](../reference/quest-harness-recipes-3.md)
- [Add a quest](../how-to/add-a-quest.md)
