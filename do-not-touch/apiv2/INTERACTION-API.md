# Interaction API

This is the current contract for observing the client, sending one interaction,
and waiting for evidence that it worked. Import the modules you use directly;
there is no aggregate entry point.

## Construction

```ts
import { LiveSnapshotSource } from './snapshots/LiveSnapshotSource.js';
import { createInteractions } from './interaction/createInteractions.js';
import { liveDriver } from './interaction/LiveInteractionDriver.js';

const source = new LiveSnapshotSource();
const { interactions, settle } = createInteractions({ source, driver: liveDriver });
```

`createInteractions` keeps sending and waiting on the same `SnapshotSource`.
Tests can supply a fake source, driver, sleep function, and polling interval.

## Reading

`SnapshotSource.read()` returns an immutable `GameSnapshot`. Wrap one in
`ReadContext` for query views:

- Actors and world: `npcs`, `players`, `locs`, `groundItems`, `scene`.
- Items: `inventory`, `equipment`, `bank`, `bankSideItems`, and the three trade
  containers.
- Interface state: `widgets`, `sideTabs`, `component`, `componentItems`,
  `componentText`, and `componentModelObjId`.
- Other collections: `stats`, `chat`, `chatOptions`, `makeProducts`,
  `questStatuses`, and `varps`.

Read scalar state directly from `context.snapshot`, including the tick,
connection state, local player, modals, controls, camera, and world state.

## Sending

`Interactions` reads a fresh snapshot for every call. It checks connection and
scene state, validates live target identity, resolves labels to operation
numbers, and then asks its `InteractionDriver` to dispatch one `WireCommand`.

| Method | Action |
|---|---|
| `interact(target, action)` | Operate on an actor, location, ground item, or item by label, pattern, or operation number. |
| `useItemOn(item, target)` | Select an inventory item and aim it at a target. |
| `useWidgetOn(widget, target)` | Select a targetable widget and aim it at a target. |
| `press(widget)` | Press a visible server-handled button. |
| `continueDialog()` | Press the current continue component. |
| `closeModal()` | Close the active modal. |
| `answerCount(value)` | Answer the open count dialog with a 32-bit non-negative integer. |
| `walk(tile)` | Walk to an in-scene tile on the current level. |
| `clickSideTab(tab)` | Select an available side tab. |
| `login(username, password)` | Submit credentials while attached and logged out. |
| `clearLocalModal(componentId)` | Clear the named active local modal. |
| `setRun(on)` | Press the discovered run toggle. |
| `setRetaliate(on)` | Press the discovered auto-retaliate toggle. |

Every method returns:

```ts
type SendResult =
    | { sent: true; tick: number; command: WireCommand }
    | { sent: false; tick: number; reason: SendReason };
```

`sent: true` means the driver accepted the command. It does not prove that the
server accepted the action; use `Settle` for that.

The 11 wire kinds are `op`, `use-item`, `use-widget`, `button`, `continue`,
`close`, `count`, `walk`, `side-tab`, `login`, and `clear-local-modal`.

The refusal reasons are:

```text
not-attached              not-ingame             scene-unavailable
off-scene                 level-mismatch          stale-target
invalid-action            unsupported-target      component-not-visible
client-side-only          target-mask-mismatch    count-dialog-open
no-count-dialog           invalid-count           no-modal-open
no-continue               unreachable             invalid-tab
already-ingame            driver-rejected
```

## Waiting

`Settle` has three operations:

- `perform(send, options)` captures a baseline, sends through `Interactions`,
  and then watches for evidence. A refused send returns immediately.
- `until(options)` watches without sending.
- `ticks(count)` waits for client ticks, with a wall-clock backstop, and returns
  early if the client disconnects or logs out.

`SettleOptions` contains named evidence `arms`, a required `budgetTicks`, and
optional `since` and `budgetMs` overrides. The first matching arm wins.

```ts
type Outcome =
    | { kind: 'refused'; reason: SendReason; tick: number }
    | { kind: 'matched'; arm: string; now: ReadContext; before: ReadContext; tick: number }
    | { kind: 'expired'; now: ReadContext; before: ReadContext; tick: number };
```

Matched and expired outcomes carry both observations, so callers do not need an
extra read.

## Evidence

`Evidence` is `(now: ReadContext, before: ReadContext) => boolean`.

The supplied predicates are `arrived`, `itemDelta`, `xpGained`, `engaged`,
`modalOpened`, `modalClosed`, `optionGone`, `said`, `serverRefused`,
`sceneReady`, and `inventoryChanged`.

`said` compares chat sequence numbers, `itemDelta` compares stack totals in the
selected container, and `serverRefused` distinguishes a cleared destination
flag from arriving at that destination.

## Driver boundary

An `InteractionDriver` implements one method:

```ts
interface InteractionDriver {
    dispatch(command: WireCommand): boolean;
}
```

`liveDriver` is the client adapter. It converts world tiles to current
scene-local coordinates at dispatch time, maps widget button types to client
operations, performs both halves of use-on commands, and returns `false` when
the adapter rejects or throws.
