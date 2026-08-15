[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Temple of Ikov

Ten, and the first four are engine behaviour rather than quest facts.

- **A weight check is a loadout constraint the pathfinder cannot see.** The lava bridge
  runs `if (weight >= 0) @ikov_bridgefail`, so the crossing is a property of what the
  pack is carrying rather than of where it is standing. Boots of lightness are -10lb
  worn, a yew shortbow is 3lb and a lobster is 350g — which is why the bow and the
  arrows are fetched *after* the bridge leg rather than with it, and why the leg that
  crosses carries a candle, a pendant and food and nothing else.
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

Six are the quest's own shape:

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
  the module banks thirty before it opens his door and sweeps the spent ones afterwards.

## See also

- [Quest pitfalls](quest-pitfalls.md)
- [Shield of Arrav](quest-pitfalls-7.md)
- [Temple of Ikov's harness recipe](../reference/quest-harness-recipes-6.md)
- [Add a quest](../how-to/add-a-quest.md)
