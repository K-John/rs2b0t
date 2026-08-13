# The interaction API for apiv2

This is the specification for the half of apiv2 that *acts*. The half that
*observes* already exists: `ReadApi.ts`, `queries/`, `snapshots/`. This document
says what to build so the two halves pair up, and it is meant to be followed
literally.

Every claim about how the game client behaves in this document was checked
against the client source and carries a `file:line` reference. Where a reference
points at `Client.ts`, `ClientAdapter.ts`, `Player.ts` or a `*Handler.ts`, it
means the game client this API is built for — the rs2b0t project, which is also
where apiv2 lives (§10). References are relative to that project's root.

---

## 1. Scope, and the one decision everything follows from

### What this is

A way to tell the game client to do something, and a way to find out whether it
happened. Nothing above that: no "go mine copper until the bag is full", no
"walk to Varrock". Those are jobs for code written *on top* of this.

### The one rule

**Sending and confirming are separate jobs.**

A send is answered immediately with a value. It never waits, never throws, and
never claims the action worked. Confirming is a separate loop that compares two
observations of the world.

The reason is arithmetic. The existing action layer (`sdk/actions.ts`) is 5,081
lines. Roughly 76 of those lines actually send anything. The rest is the same
waiting-and-checking logic written out again for each verb — about fifty
hand-written wait conditions, forty-nine fixed sleeps, and thirty-eight timeouts
that are silently swallowed. Splitting sending from confirming is what lets that
be written once.

### What "sent: true" means, exactly

**It means the client accepted the request. It does not mean a packet was
produced.** This distinction is not pedantry; it is a known hole.
`ClientAdapter.ts:1092-1103` returns `true` whenever the client is attached and
logged in, and there are six paths where the client then writes nothing at all:

| Path | Where |
|---|---|
| A scenery target whose packed scene word is stale | `Client.ts:5666-5669` |
| An NPC slot that is now empty | `Client.ts:8794` |
| A player slot that is now empty | `Client.ts:8938` |
| A button press whose `clientCode` is handled locally | `Client.ts:9261-9268` |
| A second "continue" press while one is pending | `Client.ts:9300` |
| A walk to the tile you are already standing on | `Client.ts:5990` |

Re-checking the target in the same instant as the send (§5.1) shrinks this
window. It does not close it. See §11 for the fix that would, and why it is not
in this version.

---

## 2. The types

### 2.1 `WireCommand` — eight shapes

A fully-resolved instruction. Everything above the seam has already decided the
operation number, the button route and the target's identity. The only thing
left to do below the seam is look up an opcode and convert coordinates.

```ts
export type WireCommand =
    | { kind: 'op';          target: OpTarget;   operation: number }
    | { kind: 'use-item';    select: ItemSnapshot; target: OpTarget }
    | { kind: 'use-widget';  componentId: number;  target: OpTarget }
    | { kind: 'button';      componentId: number;  buttonType: number }
    | { kind: 'continue';    componentId: number }
    | { kind: 'close' }
    | { kind: 'count';       value: number }
    | { kind: 'walk';        tile: WorldTile };

export type OpTarget =
    | NpcSnapshot | PlayerSnapshot | LocSnapshot | GroundItemSnapshot | ItemSnapshot;
```

Two things about this list are deliberate and easy to get wrong later.

**Every shape carries world tiles, never scene-relative ones.** The conversion
happens inside the driver, against the live scene, not against a snapshot. A
snapshot's `baseX`/`baseZ` is up to one tick old, and if the loaded area shifts
between reading and sending, a pre-converted local tile addresses a *different
world tile* with no error anywhere.

**Selecting and aiming are one shape, not two.** `use-item` and `use-widget`
each become two client calls. They can never be two public methods — see §5.2
for why.

### 2.2 `SendResult` — eighteen named refusals

```ts
export type SendResult =
    | { sent: true;  tick: number; command: WireCommand }
    | { sent: false; tick: number; reason: SendReason };
```

`tick` is the tick of the snapshot the decision was made against.

| Reason | Fires when |
|---|---|
| `not-attached` | No client is attached |
| `not-ingame` | Attached but not logged in |
| `scene-unavailable` | `!scene.available` **or** `sceneState !== 2` — see below |
| `off-scene` | The target's tile is outside the loaded area |
| `level-mismatch` | The target is on a different floor |
| `stale-target` | The target is no longer the same thing — see §5.1 |
| `invalid-action` | The requested label is not offered, or the operation number is out of range |
| `unsupported-target` | The target's action family is `none` (another player's trade offer) |
| `component-not-visible` | The component's layer is not one the server will accept |
| `client-side-only` | The component's `clientCode` means the press produces no packet |
| `target-mask-mismatch` | This button may not be aimed at this kind of thing |
| `count-dialog-open` | A "how many?" prompt is open, so nothing else may be sent |
| `no-count-dialog` | `answerCount` was called with no prompt open |
| `invalid-count` | Not an integer in `[0, 2147483647]` |
| `no-modal-open` | `closeModal` with all three window ids at `-1` |
| `no-continue` | `continueDialog` with no continue button available |
| `unreachable` | **`walk` only** — the client would not route there |
| `driver-rejected` | The driver returned false or threw |

**`scene-unavailable` is two conditions, not one.** `scene.available` comes from
`ClientAdapter.ts:387` and is true *while the scene is still being rebuilt*. The
client sets `sceneState` to 1 while rebuilding and 2 when ready, and
`GameSnapshot.ts:310` already carries it. Testing only `available` reproduces
the documented failure where the client reports being in the game before the
scene exists and every interaction silently does nothing. Export a named
constant for the value 2; do not write a bare `2` at the call site.

**`level-mismatch` must stay separate from `off-scene`.** Scene-local
coordinates carry no floor number — the driver converts by plain subtraction —
so a tile one storey up passes the bounds check and acts on the same x,z
downstairs. Merging the two reasons destroys the one distinction a caller can
act on: "you changed floor, re-read the world" versus "the target scrolled out
of the loaded area".

### 2.3 `Outcome` — four arms, each carrying what it saw

```ts
export type Outcome =
    | { kind: 'refused';  reason: SendReason; tick: number }
    | { kind: 'matched';  arm: string; now: ReadContext; before: ReadContext; tick: number }
    | { kind: 'stalled';  now: ReadContext; before: ReadContext; tick: number }
    | { kind: 'expired';  now: ReadContext; before: ReadContext; tick: number };
```

Three properties of this type are load-bearing.

**`refused` carries the reason.** An earlier draft collapsed all eighteen
refusals into the bare word "refused". Every single walkthrough broke on it: one
needs to stop on `invalid-action` but keep going on `stale-target`; another needs
to tell "the shop closed under me" from "my label was wrong". Without the reason,
a caller who cares abandons `perform` and hand-writes send-then-wait, which is
worse than not shipping `perform` at all.

**Every arm that saw the world carries the world it saw.** Five of six
walkthroughs re-read a fresh snapshot immediately after every wait, purely to
find out what had changed. One shop purchase did that three times per click, and
each read rebuilds the scene: 104 × 104 × 4 = 43,264 tile probes with a type
lookup per hit (`ClientAdapter.ts:550-557`), plus three copies of the
10,816-entry collision array.

**`stalled` and `expired` are different answers.** `expired` means the budget ran
out. `stalled` means a thing that was moving stopped moving. Merging them is
what made a cooking range that only accepts the action from three of its four
sides read as a broken range for an entire run.

### 2.4 `Evidence` — a question about two observations

```ts
export type Evidence = (now: ReadContext, before: ReadContext) => boolean;
```

**`ReadContext`, not `GameSnapshot`.** A raw snapshot is a bag of readonly
arrays. Every query helper apiv2 owns is a method on `ReadContext`
(`ReadApi.ts:38-260`), and wrapping a snapshot in one costs nothing
(`ReadApi.ts:39`). With the raw snapshot, three walkthroughs abandoned the query
layer at exactly the point where being right matters — one re-implemented
`EntityQuery.withAction`'s trim-and-lowercase matching by hand and got it
subtly different.

---

## 3. The seam

```ts
export interface InteractionDriver {
    dispatch(command: WireCommand): boolean;
}
```

One method, one direction — the mirror of `SnapshotSource { read(): GameSnapshot }`.

Everything above this line is a pure function of one captured observation.
Everything below is opcode lookup and coordinate conversion. That split is what
makes the whole thing testable: a fake driver that records what it was given,
plus a fixture snapshot, exercises every rule with no game running anywhere.

**Nothing that makes a decision may live below the seam.** If a command shape
ever needs the driver to look something up or choose between options, the shape
is wrong and must be split. This already happened once: an earlier `{kind:'use'}`
shape hid two different selection opcodes and two different aim tables, four
decisions the driver would have had to infer. It became `use-item` and
`use-widget`.

### The factory

```ts
export function createInteractions(deps: {
    source: SnapshotSource;
    driver: InteractionDriver;
    sleep?: (ms: number) => Promise<void>;
    pollMs?: number;
}): { interactions: Interactions; settle: Settle };
```

- **One factory, not two**, because the waiting half must read from the *same*
  source as the sending half. Two sources means the "before" picture and the
  picture a send was checked against are two different reads, and every
  before-and-after comparison measures the wrong pair.
- **`sleep` is injected** because a 30-tick wait against the real clock is 18
  real seconds, and this project's rule is that tests finish in under two
  minutes.
- **`pollMs` exists** because the confirm loop reads the source once per poll and
  a full read is expensive (§2.3). Default it to one tick. Without it the loop
  costs more than the thing it is watching.

---

## 4. Sending — eight methods

All synchronous. None ever throw. All return `SendResult`.

```ts
interact(target: OpTarget, action: string | RegExp | number): SendResult
useItemOn(item: ItemSnapshot, target: OpTarget): SendResult
useWidgetOn(widget: WidgetSnapshot, target: OpTarget): SendResult
press(widget: WidgetSnapshot): SendResult
continueDialog(): SendResult
closeModal(): SendResult
answerCount(value: number): SendResult
walk(tile: WorldTile): SendResult
```

### `interact` — every ordinary click in the game

Attacking, talking, chopping, opening, taking from the floor, dropping, wearing,
withdrawing from the bank, buying from a shop. All the same operation with a
different label.

**How the operation number is found.** Each thing carries a list of up to five
menu labels. The number sent is the matching label's position in that list, plus
one. That is the only place in this entire API where visible text decides
anything, and it matches the project rule: match things by id, match actions by
name.

**Why the argument accepts a regular expression.** Labels are not stable. The
bank interface says `Withdraw 1` (`bank_main.if:754-758`) where other interfaces
say `Withdraw-1`. In a shop, `option1` is `Value`, so `Buy 1` is operation *two*
(`shop_template.if:608-611`). A walkthrough that could only pass a plain string
hand-wrote its own pattern resolver — the third copy of that scan in this
codebase.

**Why it accepts a plain number.** `apiv2/nav` route legs already carry a
resolved operation number (`nav/types.ts:212`). Without the numeric form a
caller converts it back to a label so this method can convert it forward again.
A number is validated as 1–5 with `target.actions[n-1]` present and not the
literal string `hidden`.

**Bank and shop quantities need no special support.** They are item operations on
the container component, dispatched by label position exactly like everything
else. There is no bank-specific or shop-specific anything in this API.

### `useItemOn` and `useWidgetOn` — using one thing on another

Raw fish on a fire, ore on a furnace, a spell aimed at a monster.

**This can never be two public calls.** Selecting sends nothing at all:
`Client.ts:9126-9135` and `Client.ts:9137-9164` both set fields inside the
client and return. Those fields appear in no snapshot and in no reader method,
so nothing can observe them and nothing can clear them. A public
`select()` would let an item sit selected invisibly, and the caller's next
unrelated click would silently become "use the fish on that". Doing both halves
in one call is also the only way the driver can send a cancel when the second
half fails.

**`useWidgetOn` checks the aim mask.** A targetable button carries a set of flags
saying which kinds of thing it may be aimed at. A mismatch is sent cheerfully by
the client and ignored completely by the server — no error, nothing in the chat
box. The check is one comparison against a number already in the snapshot.

### `press` — any button in any interface

Dialogue choices, quantity buttons, prayers, combat styles, the run toggle,
quest journal rows.

**It takes the component record, never a bare id.** Four separate decisions need
fields only the record carries: which of four messages to send (`buttonType`),
whether the press produces a packet at all (`clientCode`), what it may be aimed
at (`targetMask`), and whether the server will accept it (`layerId`). Worse, a
bare id makes the send *throwable*: the client dereferences its component table
unguarded at `Client.ts:9101, 9138, 9178, 9201, 9248, 9258, 9275, 9288`, and on
two of those paths the error is thrown **after** the packet has already been
written.

**Four routes over six button types** (`IfType.ts:30-35`):

| `buttonType` | Route |
|---|---|
| 1 (ok), 4 (toggle), 5 (select) | `IF_BUTTON` |
| 6 (continue) | `PAUSE_BUTTON` |
| 3 (close) | `CLOSE_BUTTON` |
| 2 (target) | **Refused** — this belongs to `useWidgetOn` |
| 0 | **Refused** — the server drops it (`IfButtonHandler.ts:16`) |

The abandoned earlier attempt fell both 0 and 2 through to `IF_BUTTON`
(`LiveInteractionDriver.ts:76-82`). Do not repeat that.

**Toggle and select also change a client-side value locally**
(`Client.ts:9276-9296`). So a setting appearing to change in the next snapshot is
*not* proof the server agreed. Anything confirming a toggle must check something
else.

**`operationOf` must never be called on a component.** A component's action list
is its item operations followed by its button text and its aim verb
(`ClientAdapter.ts:1340-1348`), so it is not addressable by position. Note the
distinction: the *items inside* an inventory-style component **are** positional
and go through the same rule as everything else.

### `continueDialog` — the safe way to dismiss a window mid-run

This is not a duplicate of `closeModal`. **Closing a window cancels work the
server still owes you.** The close message leads to a server-side close with
"clear the pending queue" defaulting to true, and a 27-bar smelting run is
exactly such a pending queue. Closing it mid-run throws away every bar not yet
made.

It cannot be expressed as `press(widget)` either: the read half hands out a bare
continue-button id, and `ClientAdapter.ts:702` returns `-1` once a continue is
already pending — a guard a generic press would bypass, letting a second press
report success while the client sends nothing.

### `closeModal` — shut everything, and tell the server

Refuses with `no-modal-open` when all three window ids are `-1`.

It must send the close instruction directly rather than going through the
adapter's own close helper, which gives up unless it can find a close *button* in
the tree (`ClientAdapter.ts:1175-1186`). Going direct is the only way to close a
chat-only or side-only window at all. The client ignores the parameters entirely
and clears all three window ids together (`Client.ts:9307-9309`, `11030-11047`).

**Never expose the client's other close call** (`ClientAdapter.ts:1166-1173`). It
clears the window id locally and tells the server nothing, leaving the client
believing the window is shut while the server still has it open — after which
every click is dropped with no message and no amount of reading explains why.

### `answerCount` — type a number into the "how many?" prompt

Refuses anything that is not a whole number from 0 to 2,147,483,647. The client
floors fractions and clamps negatives, so a caller who computed −3 would withdraw
nothing and never be told; and the value is sent as a 32-bit signed number, so
anything at or above 2,147,483,648 wraps around.

**The ordering hazard is fixed by mechanism, not by convention.** The client
clears its "prompt is open" flag on the first three lines of *any* menu action
and tells the server nothing (`Client.ts:8666-8669`), while the server stays
parked waiting for a number. So: **while a count prompt is open, every send
except `answerCount` refuses immediately with `count-dialog-open`.** That makes
the two-step "press X, then answer 43" sequence impossible for a caller to
break. Two walkthroughs hit this hazard and one rated it as blocking its task
outright.

### `walk` — go to a tile

**This is the one method whose client answer carries real information.** For
everything else the client works out a route, throws the answer away, and sends
regardless. Walking is different: if it genuinely cannot route there, it sends
nothing and returns false. That false becomes `unreachable`.

**`unreachable` exists only here.** It was originally proposed for `interact`
too. That is both uncomputable and wrong: the existing reachability check gives
up after 400 search steps (`nav/localReach.ts:15`), roughly a ten-tile radius, so
it reports "unreachable" for most genuinely reachable things; and the client does
its own approach path using the object's real footprint before sending the
operation anyway (`Client.ts:5697-5728`). Pre-refusing would block normal play.
**A corollary the implementer must not miss: `interact` never needs a pre-walk.**

**Two behaviours to document rather than hide.** When the exact tile cannot be
reached, the client silently walks to a tile within one square and still reports
success — it scans a 3×3 ring and accepts any tile under 100 search steps
(`Client.ts:5899-5919`). And walking to the tile you already occupy sends nothing
while still returning true (`Client.ts:5990`).

**One walk is bounded by the loaded area, not by a step count.** The 25-item cap
in the client is on *turning points*, not tiles — the route only records a point
when the direction changes. A straight 170-tile walk is two turning points and
goes through intact. The real limit is the 104×104 loaded area.

---

## 5. Two rules that apply to every send

### 5.1 Re-check the target in the same instant as the send

Every send re-finds its target in a fresh observation and refuses with
`stale-target` if it is not the same thing. The fields to compare differ by kind,
and a weaker check fails in a specific way:

| Kind | Compare | Why |
|---|---|---|
| NPC | `index` **and** `id` | The NPC table is 16,384 recycled slots (`Client.ts:1965-1967`) and only the slot number goes over the wire (`Client.ts:8801`). Slot alone attacks whatever moved in. |
| Player | `index`, canonicalised `name`, and `index !== selfSlot` | Same recycling problem, plus never target yourself. |
| Scenery | `tile`, `layer` **and** `typecode` | Up to four objects occupy one tile (`ClientAdapter.ts:552-557`), so the packed word alone is ambiguous and the tile alone is the question, not the answer. |
| Ground item | `id` **and** `tile` | — |
| Carried item | `componentId`, `slot` **and** `id` | The server re-checks all three and drops the click silently if any is stale. |

**Never compare tile, health, animation or stack count.** Comparing the count
refuses a still-valid pickup because another drop landed on the same tile.
Comparing tile or health refuses every living, moving NPC.

The two failure modes also differ, which is worth knowing when debugging: a stale
scenery or NPC target sends nothing at all, while a stale ground item **is** sent
and rejected by the server, burning a tick.

### 5.2 Refuse what a snapshot can prove wrong, and nothing more

The visibility check is the clearest case. The server accepts a component click
from **five** sources, not three (`Player.ts:2127-2128`): the main window, the
chat window, the side window, **any assigned side tab**, and the tutorial window.

Two consequences:

1. Component lookup must search the main widget list **and** every side tab's
   widgets. The main list omits the side tab entirely whenever a side window is
   open (`ClientAdapter.ts:903-909`) — which is precisely when a bank or shop is
   open. Six of six walkthroughs wrote this lookup by hand and three wrote
   versions that miss side tabs.
2. This is also why there is no "switch to that side tab" method. The server
   accepts a click on any assigned tab whether or not it is the one displayed.

**`component-not-visible` is best-effort.** It tests the client's mirror of
server state, so it can be wrong. It refuses what is certainly wrong; it never
guarantees the opposite.

---

## 6. Waiting — three methods

```ts
perform(send: (api: Interactions) => SendResult, opts: SettleOptions): Promise<Outcome>
until(opts: SettleOptions): Promise<Outcome>
ticks(count: number): Promise<void>

interface SettleOptions {
    arms: Record<string, Evidence>;      // evaluated in key order, first match wins
    since?: ReadContext;
    stalled?: { while: Evidence; forTicks: number };
    budgetTicks: number;
    budgetMs?: number;
}
```

### `perform` — do it, then watch for it

It takes a function that does the sending so that **it** controls the order, and
the order is the easy thing to get wrong. It captures the "before" observation
immediately *before* invoking the send. A caller who sends first and then starts
waiting captures "before" too late, so a result that arrives quickly is invisible
and they burn the whole budget waiting for something that already happened.

### `until` — watch without sending

For waiting on a window to finish building before clicking inside it, and for
waiting to stop moving after a walk. It captures "before" on entry, unless
`since` is supplied.

### `ticks` — wait a fixed number of ticks

Without it, the idiom that emerges is `until` with a condition that is never true
and a discarded expiry — which reads like a bug. It is also the only correct
pause after acting on a level-triggered condition: an "eat when health is below
half" loop re-fires on the very next poll because health is *still* below half.
One walkthrough worked around this with a mutable counter captured inside a
supposedly pure predicate.

### Why the options look like this

- **`arms` is a named record, not two slots.** A smelting loop has three endings;
  a fight has four. Two slots called `done` and `failed` cannot express that, and
  the returned `arm` name tells the caller which happened.
- **`since` lets a follow-up question reach back.** After one wait resolves, the
  next question is often about a change already inside the first baseline.
  Re-baselining to "now" can never see it.
- **`stalled` needs its own shape.** "The numbers stopped moving" is the
  definition of a stalled production run, and no two-observation predicate can
  express it, because `before` is pinned and never advances.
- **Budgets are in game ticks**, because a tick is 100 milliseconds on the
  development server and 600 on a live one — a six-fold difference. Every one of
  the old code's 47 timeout constants had to be retuned at least once for exactly
  this reason.
- **`budgetMs` is a backstop, not the main budget.** The tick counter only
  advances when the server sends a position update (`BotHost.ts:69-73`), so a
  dropped connection freezes the clock and a tick budget alone waits forever.

Both waiting methods must also stop as soon as the observation says the client
is no longer attached or no longer in the game.

---

## 7. Naming what counts as proof — ten functions

Pure functions. All run offline against fixtures.

```ts
operationOf(target: OpTarget, action: string | RegExp): number | null
arrived(tile: WorldTile, radius?: number): Evidence
itemDelta(itemId: number, change: number, container?: ItemContainer): Evidence
xpGained(skillIndex: number, atLeast?: number): Evidence
engaged(target: NpcSnapshot | PlayerSnapshot): Evidence
modalOpened(rootComponentId?: number): Evidence
modalClosed(rootComponentId?: number): Evidence
optionGone(target: LocSnapshot, action: string): Evidence
said(...phrases: string[]): Evidence
serverRefused(): Evidence
```

**`operationOf`** — find the label, return its position plus one. Capped at index
5. Never matches `null` or the literal string `hidden` (the server rejects that
explicitly for scenery and floor items). First match wins, case-insensitive after
trimming. **Never call it on a component record.** Index 6 exists in the client's
table but is always "Examine", which is handled locally and sends nothing.

It is public because a caller often needs to know whether an option is offered
*before* committing to a walk across town. A planned route may say "click Open on
this door"; if the live door offers "Close", it is already open and the step
should be skipped.

**`arrived`** — `radius` defaults to **0**, and this default matters in both
directions. Exact equality is unsatisfiable for an ordinary walk, because the
client settles for one tile away and reports success. But defaulting to 1 breaks
two other tasks: testing one specific side of a station, and stepping through a
door where the near and far tiles are one apart — a tolerant check reports
success while still standing in front of a shut gate. Levels are compared for
equality always: most ladder landings keep the same x and z and change only the
floor, so any check ignoring level is true before the click is even sent.

**`itemDelta`** — signed, meaning "at least this much, in this direction". Three
things it must get right:

1. **Sum stack sizes, not records.** A stack of 300 coins is one record.
2. **Take a container.** The same physical inventory is transmitted to two
   different containers while banking, so an unqualified delta double-counts.
3. **"At least", never exact.** A shop's buy loop moves one unit at a time and
   stops on out-of-coins, out-of-stock or out-of-space, so "Buy 10" routinely
   delivers seven. An exact predicate times out on a click that worked.

Document one trap: withdrawing a noted item produces a *different* item id, so
the delta on the requested id is zero.

**`engaged`** — the target's own scene slot, or that target's health dropping.
Insisting on the requested target rather than "am I fighting anything" is what
made combat confirmation correct in the old code.

**`modalClosed` is not the negation of `modalOpened`.** Closing clears all three
window ids together, so a caller checking only the main one is wrong whenever a
bank's side pane is up.

**`said`** — the only signal for a whole class of failures where the server
accepts the message, checks its own rules, and answers with a line of text.
"I can't reach that!" is checked in thirteen separate places in the old code.
Ship one exported constant for that phrase; every other phrase is the caller's
knowledge, not this API's.

**`serverRefused`** — the most common silent drop in real play is the server
throwing the click away because your character is busy: stunned, mid-animation,
or running a script. It is checked first in five separate handlers, with no chat
line and no state change, so it is indistinguishable from a wrong target and both
burn a full budget. It *is* observable, just not in the snapshot today — see
prerequisite 4.

---

## 8. Required changes to the read half

These are **prerequisites, not extras.** Three methods above do not work without
them.

### 8.1 A sequence number on chat lines

*Files: `RawClient.ts`, `ClientAdapter.ts`, `GameSnapshot.ts`, `ChatQuery.ts`*

```ts
ChatLineSnapshot.sequence: number
ChatQuery.since(sequence: number): this
```

`said(...)` cannot be implemented without it. The lines that matter repeat
verbatim, and the chat reader returns a newest-first rolling buffer of 100 lines
with no ordering — so a line from the *previous* attempt matches instantly and
reports a failure on a click that was fine. Two walkthroughs hit this twice per
loop.

**Do not try to derive it by comparing two snapshots.** Two identical consecutive
lines defeat that completely.

Implementation: wrap the client's chat-adding method with a module-level counter,
the same way the incoming-traffic hook is already wrapped at
`ClientAdapter.ts:236-247`. The buffer always prepends at index 0 and shifts, so
after N additions the line at index `i` is the `(N - i)`th ever added.

### 8.2 A stack-summing total

*File: `apiv2/queries/ItemQuery.ts`*

```ts
/** Summed stack quantity across every matching record. */
total(): number {
    return this.results().reduce((sum, item) => sum + item.count, 0);
}
```

`Query.count()` returns the number of records (`Query.ts:56`), so 100 arrows
count as 1. Every buying, selling, withdrawing and depositing loop needs the
summed quantity to know when it is finished.

**It must not be called `count`.** At the call site, `count()` versus `total()`
would otherwise be a coin flip.

### 8.3 Which tiles an object can be used from

*New file: `apiv2/queries/LocApproach.ts`, forwarded from `SceneQuery.ts`*

```ts
canOperateFrom(loc: LocSnapshot, scene: SceneSnapshot, from: WorldTile): boolean | null
operableTiles(loc: LocSnapshot, scene: SceneSnapshot): WorldTile[] | null
```

This is the "standing on the wrong side of a station" failure. A cooking range is
one tile wide and two long with a forced approach direction, so "the four
neighbours of its tile" — which is what the current executor uses — is wrong
twice over.

It is a port of the client's own footprint test over the **live** scene flags,
plus the rotation the client applies. Returns `null` for any shape the client
does not route with a footprint (walls, wall decorations, roofs); for those, do
not pre-position, just send and let the client's own pathing arrive.

**`apiv2/nav` does not already solve this.** It routes tile-index to tile-index
over an offline grid built from content files, takes no footprint, and answers
against content collision rather than the live scene.

**Needed only by `walk`, never by `interact`** — see §4, `walk`.

### 8.4 The client's destination flag

*Files: `RawClient.ts`, `ClientAdapter.ts`, `GameSnapshot.ts`, `LiveSnapshotSource.ts`*

```ts
GameSnapshot.mapFlag: { readonly lx: number; readonly lz: number } | null
```

This is the server's only observable "I threw that away" signal. Every silent
drop clears it, and a successful walk or click sets it. Exposing it converts a
whole family of full-budget timeouts into an immediate refusal — three separate
walkthroughs papered over this with retry counters, which is the bar for adding
something.

Zero is the sentinel for "no flag", not a coordinate. Arriving also clears it, so
`serverRefused` must compare the player's tile to distinguish arrival from
rejection.

### 8.5 Component lookup by id

*File: `apiv2/ReadApi.ts`*

```ts
ReadContext.component(componentId: number): WidgetSnapshot | null
```

Searches the main widget list, then every side tab's widgets, de-duplicating on
component id. Required because `press` and `useWidgetOn` take records rather than
ids, and the obvious one-line lookup breaks precisely while banking (§5.2).

### 8.6 The tutorial window

*Files: `GameSnapshot.ts`, `ClientAdapter.ts`*

Add `tutorial` to the modal snapshot and as a fourth root in the widget reader.
Without it a tutorial-window component is both absent from the observation and
falsely refused.

### 8.7 Route legs must carry their tiles

*Files: `apiv2/nav/types.ts`, `apiv2/nav/router.ts`*

```ts
RouteLeg.path?: readonly number[]   // every tile index crossed, in travel order
RouteLeg.at?: number                // door and transport legs: the tile of the thing to click
```

`walk` is one click inside the loaded area, but the router folds every
consecutive step into a single leg and throws the tiles away
(`nav/router.ts:474-478`). A Lumbridge-to-Draynor walk becomes one leg of 170
tiles, far outside a 104×104 area, and a walkthrough could not split it into hops
at all. The router already holds both values while building; collecting them is
free.

Without `at`, a step barred by two halves of a double door emits two legs with
identical starts, and searching for the nearest object by id picks the same half
twice.

---

## 9. The live driver

The entire translation layer. Every decision is already made above it.

Imports use the rs2b0t project's own shorthand, where `#/` means its `src/`
folder. This is the same form that fixes `apiv2/snapshots/LiveSnapshotSource.ts:1-2`
and `apiv2/queries/SceneQuery.ts:1-2`, whose current `../../../src/...` is a
leftover from apiv2 living outside the client project and resolves to nothing.

```ts
// apiv2/interaction/LiveInteractionDriver.ts

import { MiniMenuAction } from '#/client/MiniMenuAction.js';
import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import type { InteractionDriver, OpTarget, WireCommand } from './WireCommand.js';

// Five families, five separate opcode ranges. The operation number is an INDEX,
// never an opcode.
const NPC = [MiniMenuAction.OP_NPC1, MiniMenuAction.OP_NPC2, MiniMenuAction.OP_NPC3, MiniMenuAction.OP_NPC4, MiniMenuAction.OP_NPC5];
const PLAYER = [MiniMenuAction.OP_PLAYER1, MiniMenuAction.OP_PLAYER2, MiniMenuAction.OP_PLAYER3, MiniMenuAction.OP_PLAYER4, MiniMenuAction.OP_PLAYER5];
const LOC = [MiniMenuAction.OP_LOC1, MiniMenuAction.OP_LOC2, MiniMenuAction.OP_LOC3, MiniMenuAction.OP_LOC4, MiniMenuAction.OP_LOC5];
const OBJ = [MiniMenuAction.OP_OBJ1, MiniMenuAction.OP_OBJ2, MiniMenuAction.OP_OBJ3, MiniMenuAction.OP_OBJ4, MiniMenuAction.OP_OBJ5];
const HELD = [MiniMenuAction.OP_HELD1, MiniMenuAction.OP_HELD2, MiniMenuAction.OP_HELD3, MiniMenuAction.OP_HELD4, MiniMenuAction.OP_HELD5];
const COMPONENT = [MiniMenuAction.INV_BUTTON1, MiniMenuAction.INV_BUTTON2, MiniMenuAction.INV_BUTTON3, MiniMenuAction.INV_BUTTON4, MiniMenuAction.INV_BUTTON5];

const USE_ON: Record<OpTarget['kind'], number> = {
    npc: MiniMenuAction.USEHELD_ONNPC,
    player: MiniMenuAction.USEHELD_ONPLAYER,
    location: MiniMenuAction.USEHELD_ONLOC,
    groundItem: MiniMenuAction.USEHELD_ONOBJ,
    item: MiniMenuAction.USEHELD_ONHELD
};

const AIM_AT: Record<OpTarget['kind'], number> = {
    npc: MiniMenuAction.TGT_NPC,
    player: MiniMenuAction.TGT_PLAYER,
    location: MiniMenuAction.TGT_LOC,
    groundItem: MiniMenuAction.TGT_OBJ,
    item: MiniMenuAction.TGT_HELD
};

// Four routes over six button types. Types 0 and 2 never reach here — the send
// layer refuses them.
const BUTTON: Readonly<Record<number, number>> = {
    1: MiniMenuAction.IF_BUTTON,
    3: MiniMenuAction.CLOSE_BUTTON,
    4: MiniMenuAction.TOGGLE_BUTTON,
    5: MiniMenuAction.SELECT_BUTTON,
    6: MiniMenuAction.PAUSE_BUTTON
};

function opcodeFor(target: OpTarget, operation: number): number | undefined {
    if (!Number.isInteger(operation) || operation < 1 || operation > 5) return undefined;
    const table =
        target.kind === 'npc' ? NPC
        : target.kind === 'player' ? PLAYER
        : target.kind === 'location' ? LOC
        : target.kind === 'groundItem' ? OBJ
        : target.actionFamily === 'held' ? HELD
        : target.actionFamily === 'component' ? COMPONENT
        : null;
    return table === null ? undefined : table[operation - 1];
}

/** Fire one already-chosen opcode at a target, converting tiles here and now. */
function fire(target: OpTarget, opcode: number | undefined): boolean {
    if (opcode === undefined) return false;
    if (target.kind === 'npc' || target.kind === 'player') {
        return actions.menuAction(opcode, target.index, 0, 0);
    }
    if (target.kind === 'item') {
        return actions.menuAction(opcode, target.id, target.slot, target.componentId);
    }
    const scene = reader.sceneBounds();
    if (!scene.available || target.tile.level !== scene.level) return false;
    const lx = target.tile.x - scene.baseX;
    const lz = target.tile.z - scene.baseZ;
    if (lx < 0 || lz < 0 || lx >= scene.width || lz >= scene.height) return false;
    return actions.menuAction(opcode, target.kind === 'location' ? target.typecode : target.id, lx, lz);
}

/**
 * Select then aim, atomically.
 *
 * Both selection calls send nothing: they set fields inside the client and
 * return early. If the aim half does not go out, those fields are left set and
 * are NOT cleared by the client's trailing reset — so a later use-on would send
 * a well-formed packet built from stale values. CANCEL has no branch of its own
 * and works purely by falling through to that reset, which is exactly what is
 * wanted here.
 */
function selectThenAim(open: () => boolean, aim: () => boolean): boolean {
    if (!open()) return false;
    const aimed = aim();
    if (!aimed) actions.menuAction(MiniMenuAction.CANCEL, 0, 0, 0);
    return aimed;
}

export const liveDriver: InteractionDriver = {
    dispatch(command: WireCommand): boolean {
        try {
            switch (command.kind) {
                case 'op':
                    return fire(command.target, opcodeFor(command.target, command.operation));

                case 'use-item':
                    return selectThenAim(
                        () => actions.menuAction(MiniMenuAction.USEHELD_START, command.select.id, command.select.slot, command.select.componentId),
                        () => fire(command.target, USE_ON[command.target.kind])
                    );

                case 'use-widget':
                    return selectThenAim(
                        () => actions.menuAction(MiniMenuAction.TGT_BUTTON, 0, 0, command.componentId),
                        () => fire(command.target, AIM_AT[command.target.kind])
                    );

                case 'button': {
                    const opcode = BUTTON[command.buttonType];
                    return opcode === undefined ? false : actions.menuAction(opcode, 0, 0, command.componentId);
                }

                case 'continue':
                    return actions.menuAction(MiniMenuAction.PAUSE_BUTTON, 0, 0, command.componentId);

                case 'close':
                    // NOT actions.closeModal(): that requires a main window AND a
                    // discoverable close button, while the client ignores the
                    // parameters entirely and clears all three window ids. Going
                    // direct is the only way to close a chat-only or side-only
                    // window at all.
                    return actions.menuAction(MiniMenuAction.CLOSE_BUTTON, 0, 0, 0);

                case 'count':
                    return actions.answerCountDialog(command.value);

                case 'walk': {
                    const scene = reader.sceneBounds();
                    if (!scene.available || command.tile.level !== scene.level) return false;
                    return actions.walkTo(command.tile.x - scene.baseX, command.tile.z - scene.baseZ);
                }
            }
        } catch {
            // Load-bearing, not padding. The client dereferences its component
            // table without a guard in eight places, and on two paths it throws
            // AFTER the packet has been written. The send layer validates every
            // component against the observation first, so reaching this catch
            // means the client and the observation disagreed: report it as
            // driver-rejected rather than letting an error out of a method the
            // spec promises never throws.
            return false;
        }
    }
};
```

---

## 10. Where this lives, and the build order

### Step 0 — move apiv2 into the client project

apiv2 is its own thing, but it is built for one game client and can only ever
run inside that client's process. So it lives in the rs2b0t project, as its own
top-level folder, beside `src/` rather than inside it.

**It is not `m8aq/api`, and it reuses nothing from there.** That folder contains
an earlier attempt with a different shape — verbs that wait for you rather than
returning a value. Read it for lessons if useful; import none of it.

The move is three small things:

1. Copy the whole `apiv2` folder into the rs2b0t project root.
2. Rewrite four import lines that are currently broken. They read
   `../../../src/...`, which was correct when apiv2 sat inside the client project
   and resolves to nothing today. They become the project's own shorthand, where
   `#/` means `src/`:
   - `apiv2/snapshots/LiveSnapshotSource.ts:1-2` → `#/bot/BotHost.js`,
     `#/bot/adapter/ClientAdapter.js`
   - `apiv2/queries/SceneQuery.ts:1-2` → `#/dash3d/CollisionFlag.js`,
     `#/bot/nav/localReach.js`
3. Nothing else. rs2b0t's TypeScript settings have no file list — they cover
   everything in the project except a short exclusion list, which apiv2 is not
   on. So the whole thing is error-checked and its tests run from the moment it
   arrives, with no settings change at all.

**Why this removes the problem rather than solving it.** In rs-sdk, apiv2's two
client-touching files pulled the entire game client into a compilation with
stricter rules than the client is written for, so checking apiv2 meant reporting
thousands of false errors in the client. Inside the client project both halves
are checked by the same rules the client already passes. One consequence worth
naming: rs2b0t does not turn on the "check an array position exists before using
it" rule that rs-sdk does, so apiv2 is checked slightly less strictly than
rs-sdk would have. It is checked *at all*, which it is not today.

The route planner (`apiv2/nav`) and the bundled pathfinder (`apiv2/vendor`) move
with it. §8.7 changes route legs, and walking a planned route needs both halves
in the same place.

### Then, in order

1. **`interact` only, no waiting layer.** The command type, `operationOf`, and
   the refusal checks. A fake driver that records what it was given. Two fixture
   observations — a monster at scene slot 12 offering "Attack", and a different
   monster now in slot 12. Assert three things: the live case records one command
   with operation 1 and index 12; the changed case returns `stale-target` and
   records nothing; an unoffered label returns `invalid-action`. If these run
   green with no game client anywhere, the shape is real.
2. **The remaining seven sends**, with their refusals.
3. **`perform`, `until`, `ticks`** and the ten evidence functions.
4. **The read-half prerequisites** (§8). Do 8.2 and 8.5 first — they are small
   and unblock the most.
5. **The live driver**, and one run against a real game.

---

## 11. What is deliberately not here

| Excluded | Why |
|---|---|
| Named verbs (`attack`, `mine`, `chop`, `bankWithdraw`, `equip`, `pickup`, `drop`) | Each is `interact` or `press` with a different label. "Take" is already the third floor-item label and "Drop" the fifth carried-item label, so the position rule produces the right number by itself — but note these are *conditionally synthesised* by the adapter, and only on items read out of the carried inventory. An item read from the bank side pane carries the component's labels instead. |
| Any method taking a quantity as a number | Quantity is an item operation on the container component. A numeric parameter would hide a polling loop inside what looks like one click. |
| `select`, `clearSelection`, or reading what is selected | The three fields involved appear in no observation. This is the one place reading and writing genuinely cannot mirror each other. |
| `setRun(bool)`, `setAutoRetaliate(bool)` | The observation gives the on-button and off-button ids and no current setting. A boolean would claim to know a state it cannot see. |
| `selectSideTab(index)` | It sends nothing to the server. The server accepts a click on any assigned tab regardless of what is displayed. The only capability lost is one tutorial-island trigger. |
| `walkRoute(route)`, `travelTo(destination)` | Turning a plan into clicks is a policy loop — split into hops, find the door's live identity, retry from the nearest tile reached — built on `walk`, `interact` and `perform`. The route planner is also a one-per-process object costing 1–4 seconds and hundreds of megabytes to build, so it must never be constructed inside a movement loop. |
| `examine` | Sends nothing; adds a line of text locally. |
| `say`, `cheat`, private messages, friends lists, character design | The client adapter exposes none of them. **State plainly what this costs:** an apiv2-based bot cannot use the development teleport command, so the scenario-and-checkpoint debug loop that `CLAUDE.md` rule 1 requires keeps running through the old SDK. |
| `login`, `logout` | Not game interactions, and login handles a password. |
| `dispatchRaw(opcode, a, b, c)` | Pushes real decisions below the seam where no test can reach them, and creates a second writer that can race the first into a stuck selection. |

Also rejected after the walkthroughs asked for them: a hop loop owning walking
(one walkthrough; route tiles plus a radius make the caller's loop writable), a
"stat below" helper (two lines once evidence takes a read context), combinators
for and/or/not (three lines each), and a "damage exchanged" evidence function
(does not actually solve the problem it was proposed for).

**Method total: 23.** Two seam, eight sends, three waits, ten evidence and
helpers.

---

## 12. What is still unknown

Read this before trusting anything above in a live run.

1. **`sent: true` still cannot mean "bytes left the client"** (§1). The honest
   fix is to sample the client's output buffer position before and after the
   call and return whether it moved — two lines in the driver, which would turn a
   large class of full-budget timeouts into immediate refusals. It is not here
   because the output buffer is not exposed and nobody has measured whether other
   traffic interleaves. **Expect to want this in the first week.**
2. **`engaged` resolves before the refusal it is meant to catch.** The server
   marks you as facing the target when it accepts the click, but prints "Someone
   else is fighting that" later, on arrival. On a contested target the success arm
   fires and the failure arrives after the call returned. Only live contention
   will show how often this matters.
3. **Three different collision models disagree.** The client's own, `apiv2/nav`'s
   offline grid (built with every door open), and the server's — which includes
   other players and NPCs that neither of the other two can see. A tile all three
   call fine can still produce "I can't reach that!". No offline work fixes this.
4. **`budgetMs` is a guess.** The suggested default assumes a 600ms tick, but the
   development engine runs at 100ms, so the same script has a six-fold different
   wall clock. Measure on the development tick before fixing the default.
5. **Refusing every press with a non-zero `clientCode` has not been swept.** Only
   two such codes produce packets, so refusing the rest loses nothing this API
   claims to do — but nobody has enumerated which real components in this content
   carry one. If a common one does, the refusal will look like a bug.
6. **The count-prompt lock has an untested exit.** While a prompt is open, the
   only way out is answering it. Whether the server's suspended script tolerates a
   zero at every point it asks for a number is unverified; the bank does.
7. **The destination-flag signal may not be clean enough.** There is a one-tick
   window around crossing a region boundary where the flag has been shifted and
   the player position has not. Live running is the only way to learn how often
   that produces a false refusal.
8. **Adding tiles to route legs changes the planner's output size**, and nobody
   has measured it. The timing test targets 5–10ms per query.
