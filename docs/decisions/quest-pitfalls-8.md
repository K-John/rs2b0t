[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Temple of Ikov

Twenty-two, and the first seven are engine behaviour rather than quest facts.

- **A weight check is a loadout constraint the pathfinder cannot see.** The lava bridge
  runs `if (weight >= 0) @ikov_bridgefail`, so the crossing is a property of what the
  pack is carrying rather than of where it is standing. Boots of lightness are -10lb
  worn, a yew shortbow is 3lb, an iron axe is 5lb and a lobster is 350g. The first live
  crossing went into the lava carrying the axe and the bow it had fletched a minute earlier, which
  is why the module banks everything outside the crossing kit *before* it goes
  underground — there is no booth past the ladder.
- **Only non-stackables weigh anything, and the client is told a truncated kilogram.**
  `calculateRunWeight` skips `type.stackable`, so coins and ice arrows are free, and
  `UpdateRunWeight` sends `trunc(grams / 1000)` — a client reading 0 is anywhere from
  -999g to +999g. The server tests grams, so the guard demands a client-visible
  *negative* rather than a non-positive.
- **A use-on sent while a booth is still closing opens nothing.** The first knife-on-logs
  after a withdraw failed on three separate runs and the retry worked every time, so the
  fletch closes whatever main modal is up and settles before it sends the op.
- **A shop behind a quest gate is not a shop.** The Ardougne Armoury stocks the iron
  axe the yew needs and sits inside the Combat Training Camp, whose gates answer "This
  is a restricted area" until Biohazard is complete. They are baked as ordinary door
  edges, so the pathfinder routes at them and the walker spends its three strikes
  proving otherwise. Aemad's Adventuring Supplies, in East Ardougne, stocks the same axe.
- **A crossing with no op is still a crossing.** The bridge is a `mapzoneenter` timer
  plus `inzone`, so there is nothing to click: walking onto (2648–2650, 9828–9829)
  *is* the action, and the direction comes from a bit that toggles on every crossing
  rather than from which bank you started on. Two consequences — the far side is the
  only oracle, and every other walk in the dungeon has to exclude those six tiles or
  the pathfinder ferries the bot across in the middle of an unrelated leg.
- **A `~slash_checker` reads the equipped weapon and nothing else.** The web sealing the
  boots alcove answers `Slash` with "Only a sharp blade can cut through this sticky
  web" to a character holding a knife in the pack — the `oplocu` branch is the one that
  names the knife explicitly, so cutting it is a use-on, not an op. It also succeeds one
  attempt in two, so the leg retries rather than reading one failure as a wall.
- **Two stages can render one journal page, and the fix is idempotence rather than a
  finer oracle.** `%ikov` 20 (trap disarmed) and 30 (lever pulled) print the same lines,
  and nothing else the client can see separates them. Both ops live on the same lever
  and neither does harm when repeated, so the module searches and pulls on every pass
  through that stage instead of trying to tell them apart.

Eight are the quest's own shape:

- **The quest has two endings, and only one of them is a fight a bot should take.**
  Lucien's ending needs the staff carried out past five Guardians of Armadyl — level 45,
  50 hitpoints, 55 slash defence. Armadyl's needs Lucien dead: level 14, 17 hitpoints,
  and he is only attackable at all while the Armadyl pendant is worn. The module takes
  Armadyl's, never touches the staff, and `obj_gettotal` is why — the guardians turn on
  anyone whose *bank* holds one.
- **The pendant that opens the door also marks you.** Lucien's pendant has to be worn to
  open the Door of Fear from the south, and worn in front of a guardian it is what makes
  them attack. The module wears it for every dungeon leg and stows it before the
  guardian conversation.
- **A conversation that ends in a teleport is not over when the chat closes.** Winelda's
  `if_close` runs five ticks before her `p_teleport`, so the guardian leg started while
  the bot was still on her ledge — where the shiny key is a McGrubor round trip away
  rather than seventy tiles, and the walker said as much. The leg waits the ferry
  out and asks her again if it never came; she repeats it for nothing.
- **Winelda's ferry is one-way, and the way back is an item on the far side.** She
  teleports the player to (2664,9876), a pocket whose only exits are a ladder into
  McGrubor's Wood and the door at the top of it — which answers "The door is locked." to
  anyone without the shiny key lying at (2628,9859). The key is therefore not optional
  content; it is the exit, and it is picked up before the guardians are spoken to.
- **That door belongs in `specialCrossings`, not in `SCRIPT_REFUSED`.** Removing it
  seals the pocket for good; leaving it bare walks a keyless bot into McGrubor's Wood
  for a door it cannot open. Keyed on `requires: { item: 'Shiny key' }` the pathfinder
  prunes it until the key is held and routes through it afterwards, which is both
  behaviours at once.
- **The bow is a fletching chain, not a purchase.** Ice arrows carry
  `param=levelrequire,40`, and the ammo check refuses any bow whose own `levelrequire`
  is lower — so yew or magic, and no shop in the game stocks either. A yew shortbow is
  woodcutting 60 for the log, crafting 10 to spin a flax into a bow string and fletching
  65 twice. None of those is a quest requirement, which is what `warnReadiness` is for.
- **Ice arrows are one chest at a time.** Six chests share the ice cavern and
  `%ikov_icearrowchest_coord` names the one holding arrows, re-rolled after every find,
  so the search is a circuit rather than a chest. Each find is one to five arrows, 80%
  of every shot lands recoverable on the floor, and the Fire Warrior has 59 hitpoints —
  the module holds twenty before it opens his door, sweeps the spent ones afterwards,
  and sweeps mid-fight rather than walking out if the quiver empties. Twenty is a floor
  rather than a stockpile on purpose: one circuit of the six chests takes three minutes
  and clears it, where a target of thirty spent a second circuit collecting one arrow.
- **All six chests are `forceapproach=north`, and each placement rotates that.** Walking
  to within two tiles of the chest and clicking Open worked for the ones whose legal side
  the walk happened to land on and was dropped in silence for the rest — two of six on the
  first run. Every chest carries its own stand, one tile off, and the leg walks onto it
  rather than near it.
- **A bow over an empty quiver is not a weapon, and nothing says so but the chat box.**
  The warrior fight ends with the yew shortbow still worn and every ice arrow spent, and
  two legs later the hobgoblin farm answered every Attack click with "There is no ammo
  left in your quiver" until the camp killed the bot and its kit hit the floor. The arm
  check tests the quiver behind the bow rather than the weapon slot alone, and both
  fights take the bow off on the way out. A near-empty quiver counts as unarmed too:
  the four arrows the warrior fight left over bought one timed-out hobgoblin and a walk
  back to the booth for the axe.
- **The engine's food float is provisioned once, not maintained.** `provisioned.add(id)`
  retires the withdrawal for the run, so a module whose grind outlasts six lobsters has
  to ask for more itself. The roots farm restocks below three and takes ten, because the
  nearest booth is a minute's round trip from the camp, and the leg before the Fire
  Warrior takes eight, because the ice-chest circuit spends the float underground.
- **A hunger branch that yields the tick is a stall once the food runs out.** `Sustain.run()`
  returns nothing whether it ate or found an empty pack, so `if (hungry()) { await
  Sustain.run(); continue; }` spun the Fire Warrior guard out at 30 hitpoints without
  a single click — three minutes of a fight that never started. Both fight loops test
  the pack before they yield to it.
- **A fight loop that counts its own Attack clicks misses a kill it did not click for.**
  Auto-retaliate fought the Fire Warrior to death while every `interact('Attack')` came
  back false — he stands behind the door that summoned him and the path to him is
  through it — so a "down after N shots" test gated on N spun out the full guard twice
  over a corpse. `Game.inCombat()` is what proves the fight happened.
- **The hobgoblin camp is a crowd, and the bot fights it in boots.** Nothing this quest
  sources is armour, so three level-42 attackers take 38 hitpoints off faster than one
  lobster puts them back: an `eatBelowHp` of 0.55 died at twelve roots with food still in
  the pack. The farm eats at 0.75, walks back to the booth at five lobsters rather than
  three, and abandons a kill outright below 45% with nothing left to eat — the walk to
  the booth is also the walk out of the camp. Twenty roots cost about sixty lobsters at
  70 stats, so the harness seeds three hundred; no shop is a way out, as every cooked
  lobster in the shop database has a baseline of zero and the one armoury near Ardougne
  is inside the Biohazard-gated training camp.
- **Aggression outlives the decision to stop fighting.** A farm that runs out of food and
  stands still is still standing in the camp: the retreat has to clear the aggro
  radius, so the module walks to the Ardougne road before it hands the tick back.
- **The food that survives one leg is what blocks the next.** Winelda's twenty roots are
  twenty unstackable slots, and the fifteen lobsters the farm was carrying left nineteen
  free — the withdraw retried for five minutes without ever fitting. The trim before that
  withdraw keeps the roots, the coins and the pendant and nothing else, because the fight
  the food was for is over by the time it runs.

## See also

- [Quest pitfalls](quest-pitfalls.md)
- [Shield of Arrav](quest-pitfalls-7.md)
- [Temple of Ikov's harness recipe](../reference/quest-harness-recipes-6.md)
- [Add a quest](../how-to/add-a-quest.md)
