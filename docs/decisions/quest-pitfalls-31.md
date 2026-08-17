[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Underground Pass, what the live legs paid for

The six the per-leg runs found after the module was written; the map and the traps are on the
[first page](quest-pitfalls-29.md) and reaching a seam on the [second](quest-pitfalls-30.md).

- **A region test and a step's own oracle have to agree.** The Ardougne wall gate leaves the character
  standing in the gateway, and `upassArea` counts x 2557 and 2558 as neither side — so the crossing step
  reported success, the queue asked for it again, and its second attempt walked back east to a gate that had
  shut behind it. Fifty seconds and a stack of "unreachable" lines per run. The crossing now steps onto the
  far stand and answers with the same region test the caller reads.
- **A telejump is not a seam, and its direction is in the map rather than in the script.**
  `@upass_area_2_3_entrance` branches on `loc_angle`: the unicorn doors at (2370,9665) and (2371,9665) are
  angle 1 and land the player at (2401,9610), four tiles from the loose railings, while all four doors at
  z 9611 are angle 3 and land them at (2371,9666) in the first cavern. A guard that asked whether the
  JOURNEY crossed the caverns therefore hid the one door that goes where leg 3 is going, because the slave
  cages (z 9655) and the railings (z 9606) sit on the same side of a split at z 9664. Ask where the door
  leads, which its own tile answers.
- **Rank a telejump above every seam that gains.** The door that lands beside the railings stands
  fifty-nine tiles from them, so every distance heuristic puts it last and the search spends a leg crossing
  stone bridges to prove the near ones lead nowhere.
- **A crossing that can be re-crossed turns a maze into a pendulum.** Spending a seam from the side it was
  crossed from is what lets a character out of a cul-de-sac, but offered as an equal candidate it swings the
  route between two sides of the same bridge — nine minutes of it in one run. The way back belongs in its
  own tier, after every fresh seam and every item-use.
- **"Nowhere to stand" has three causes and one message.** The ring can be off the loaded scene, the scene
  can call every tile of it blocked, or the flood can be unable to walk there from this pocket. Only the
  third is a seam in another pocket; the first two are bugs. The count of each is one line and saves a run
  per diagnosis.
- **The offline seam graph cannot be transcribed into a route.** Every crossing that is not a loc op is
  absent from it — the spade dig, the rope swing and both telejumps — so a breadth-first search over the
  report answers NO ROUTE between the well bottom and the railings, which the module walks. Read the report
  for what joins what, and let the runtime search choose.

## See also

- [Quest pitfalls](quest-pitfalls.md)
- [Underground Pass: the map and the traps](quest-pitfalls-29.md)
- [Underground Pass: reach and the temple](quest-pitfalls-30.md)
- [Underground Pass's harness recipe](../reference/quest-harness-recipes-16.md)
- [Add a quest](../how-to/add-a-quest.md)
