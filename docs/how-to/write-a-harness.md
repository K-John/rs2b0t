[Manual](../README.md) › [Testing](../TESTING.md) › Write a harness

# Write a live harness

`tools/*-test.ts` drive a real browser against a real engine with Playwright. They
attach to the client through the harness ABI the client installs at
`globalThis.rs2b0t`:

```ts
rs2b0t.client     // ingame, sceneState, login(), loginUser/loginPass
rs2b0t.host       // tickCount
rs2b0t.runner     // state, ctx.log, bot, start(), stop()
rs2b0t.reader     // inventory(), npcs(), locs(), worldTile(), stat(), chat(), varp()
rs2b0t.registry   // the script registry
rs2b0t.actions
```

[`tools/lib/harness.ts`](../../tools/lib/harness.ts) holds the shared parts:

| Helper | Job |
|---|---|
| `parseArgs(argv, defaults)` | `--base`, `--minutes`, positional rest |
| `launchBrowser({ swiftshader })` | a configured Playwright browser |
| `HARNESS_VIEWPORT` | preferred page size **1280×720** (Playwright default) |
| `boot(page)` | wait until `client.constructor.loopCycle > 10` |
| `login(page, user, pass)` | log in and wait for `ingame && sceneState === 2` |
| `type(page, text)` | click the canvas, then type — cheats go through this |
| `bringUpOffIsland(page, opts)` | new account, teleported off tutorial island |
| `logout(page)` | clean **IF_BUTTON 2458** logout (`ClientProt.IF_BUTTON=9` / `logout:try_logout`) |
| `startFromLibrary(page, category, script)` | pick and start a script from the panel |

**Mainland bootstrap (fast path).** Prefer `mainlandAccount` in
[`tools/tutorial/harness.ts`](../../tools/tutorial/harness.ts): tele off-island →
`setvar tutorial 1000` → **IF_BUTTON logout** (com 2458) → login again so side
icons unlock. Clean logout ends the session promptly (often ~9s total after boot)
instead of an unclean disconnect that holds “already logged in” for ~60s. Packet
path: `actions.ifButton(2458)` → `ClientProt.IF_BUTTON` (opcode 9) with component
id → content `logout:try_logout` → `p_logout`.

**Map picker (basemap + walkable dots).** Product docs:
[Map tile picker](../MAP-PICKER.md). Bake once with `bun run gen:basemap` (writes
`out/worldmap-basemap.<fp>.png` + manifest; deploy copies them next to
`collision.lcnav.gz`, plus `worldmap.jag` when available for optional rebuild).
Smoke:

| Command | Proves |
|---|---|
| `bun run verify:map-picker -- <base>` | UI pick → Confirm → tile fields (`tools/map-picker-basemap-live.ts`); asserts `data-basemap` settled |
| `bun run verify:map-picker-e2e -- <base>` | login + pick + WalkTo arrives (`tools/map-picker-walkto-e2e-live.ts`; needs a loggable world / cheats for short hops) |

Unit: `test/ui/worldMapBasemap.test.ts`, `test/ui/mapPickerTheme.test.ts`,
`test/ui/worldMapPicker.test.ts` (collision pack for snap tests).

**Viewport (local preference).** Headed Chrome should use the **smaller** client scale
used by GatheringBot / `verify-gather-locs` / plain `browser.newPage()` — Playwright’s
default **1280×720**, exported as `HARNESS_VIEWPORT`. Do **not** set
`{ width: 1500, height: 1000 }` (or similar). `bot.html` scales the fixed **765×503**
game stage to fill the page; a large viewport makes the game look blown up and
flip-flops between harness prototypes. Prefer omitting `setViewportSize` /
`viewport` entirely so the default applies.

Some hard-won details:

- **Logging in auto-creates the account** on a local engine, so harnesses generate a
  fresh username per run rather than sharing state. With an always-on engine those
  become `.sav` files under `Server/engine/data/players/main/` and never go away on
  restart. Wipe harness junk (dry-run first):

  ```bash
  bash tools/cleanup-test-accounts.sh              # list
  bash tools/cleanup-test-accounts.sh --apply      # delete matched prefixes
  ```

  Defaults target common tool prefixes (`nvtr`, `nv2r`, `gbs`, `vgl`, …). Override
  with `--prefix`, or `--all-saves` (respects a small KEEP list). Prefer logout /
  idle suites before `--apply`. Stagger multi-suite boots (`sleep 45` between
  launches) so logins do not thrash the same title loop.

- **`type()` clicks the canvas first.** Keystrokes sent without focusing the canvas
  are dropped.
- **Cheats need a clean dialog state.** `::~maxme` raises level-up dialogs that
  swallow the *next* typed command.
- **Prove the bot worked, don't assume it.** Assert on game state — XP gained, items
  held, tiles reached — not on log lines.
- Software rendering (SwiftShader) is unreliable for some harnesses; several need a
  real GPU. Parallel browsers also perturb door timing, so validate a door fix solo.
- **`~maxme` grants stats and never gear.** A quest with a real fight in it needs
  the harness to give and equip a kit, or the "max stats" account is punching a
  level-93 boss. `Equipment.equip()` awaits `Execution.delayUntil`, which needs a
  running script context and throws from `page.evaluate` — drive the Wield/Wear
  held-op yourself; the direct input driver's is synchronous.
- **`::give` → inventory; `::givebank` → bank.** Local engine cheats (no busy-guard).
  Content debugprocs `~item` / `~bankitem` do the same but need `p_finduid` (seed after
  dialogs, not mid-`~maxme`). Prefer engine cheats from Playwright; verify bank counts
  with a booth open when the seed matters.
- **`::bank_f2p` stocks a bulk bank** (coins, food, pickaxes, scimitars, …) with no
  dialog. Prefer it to `::bank_preset`, which first asks "This clears your bank.
  Continue?" and needs the choice answered before it does anything. It is a blunt
  fixture, not a realistic kit for a low-level quest.
- **Seeding the bank for realistic quest tests** is documented below.

### Shape

```ts
import { boot, fail, launchBrowser, parseArgs } from './lib/harness.js';
import type { Rs2b0t } from './lib/harness.js';

const { base, minutes, rest } = parseArgs(process.argv.slice(2), { minutes: 4 });
const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    page.on('pageerror', err => console.log(`pageerror: ${err}`));
    await page.goto(`${base}/bot.html`);
    await boot(page);
    // log in, seed preconditions with cheats, start the script,
    // then poll game state for evidence it worked
} finally {
    await browser.close();
}
```

Seed preconditions with cheats rather than waiting for the world to provide them, and
poll for a condition instead of sleeping a fixed time — a fixed wait is the most
common source of a flaky harness.

## The end-to-end smoke

```sh
bun run smoke                                     # against localhost:8890
bun run smoke http://localhost:8888 user pass     # another engine, named account
```

[`tools/e2e-smoke.ts`](../../tools/e2e-smoke.ts) is the single harness that stands in
for the whole client. It boots `bot.html`, logs in, asserts the adapter banner is
empty and the tick counter is advancing, then starts a looping bundled script
(`AIO Teleport`) from the library and drives it through pause, resume and stop —
checking that the overlay actually paints and that a paused script makes no
progress. Screenshots land in `out/`, and any page error fails the run.

It does **not** deploy. Deploy first (`bun run b0t`, or
[`tools/deploy-local.sh`](../../tools/deploy-local.sh)) or it loads a stale client.

The other harnesses are per-subsystem and are run individually — a quest chain,
FireGiant, GatheringBot (`bun run verify:gatheringbot`), the hosted wall, relogin,
external script loading, a nature-runner soak. Several want a real GPU or a special
environment rather than a plain local engine.

```sh
bun run verify:gatheringbot                 # Miner/Fisher/Woodcutter live paths
bun run verify:gatheringbot -- mining acquire
HEADED=1 BUDGET_S=180 bun tools/gatheringbot-test.ts fish-cook-bank fish-bank-raw-cook restock-fly-barb
```

GatheringBot scenarios cover bank/power gather, Catherby cook-then-bank (seed cooked
lobster → catch last → cook → deposit), Catherby bank-raw-then-cook (noted raw seed
un-notes into bank, catch last → bank hits N → cook batch), long paths, Buy/repair
(coins-only + Bob/Nurmof broken-tool repair), Gerrant multi-buy restock, Auto freeform
outside preset 64×64 map squares, and smith. Named camps floor leash to 64; only
Location Auto respects a tight `leashRadius` (and skips mob flee). See
[DEV.md](../how-to/gatheringbot-smoke.md) for the full id table and redeploy
notes. Mainland setup always relogs after tutorial unlock (`RELOG_*` env overrides
in `tools/tutorial/harness.ts`).

## See also

- [Seeding test accounts](../reference/seeding-test-accounts.md)
- [Test suites](../reference/test-suites.md)
