# rs2b0t — a scriptable bot client for 2004scape / Lost City servers

rs2b0t is a TypeScript botting client for 2004-era RuneScape private servers. It
renders the real game client in the browser and drives it through a typed scripting
API, so bots see and act on exactly what a player would — no forged packets, no
synthetic mouse input.

**Built and supported for [rs2b2t](https://rs2b2t.com)**, a 2004scape anarchy fork.
Local development runs against the [LostCityRS](https://github.com/LostCityRS) Engine-TS
and Content pack at revision 274. It is **not** an official or supported client for the
pure Lost City or 2004scape projects, and it is not maintained for those targets.

Project site: **[2004bot.com](https://2004bot.com)** — overview, screenshots, and
rendered [API](https://2004bot.com/docs/api) / [dev](https://2004bot.com/docs/dev) docs.

## Run it

A hosted single-instance build lives at **https://w1.rs2b2t.com/rs2b0t** — open it, log
in with an rs2b2t account, pick a script, run. For several accounts in one tab, use the
MultiBox wall at **https://w1.rs2b2t.com/rs2b0t/wall**; keep that tab visible, because a
backgrounded tab is throttled by the browser.

## What it does

- **Typed scripting API** (`@rs2b0t/api`) — write bots in TypeScript against a stable,
  versioned surface: game state, entity queries, inventory, bank, shop, skills, dialogue,
  world-walking, events.
- **Bot base classes** for the common shapes — a simple `loop()`, a priority `TaskBot`,
  or a `TreeBot` behaviour tree.
- **World-walking** — A\* over a baked collision pack plus a door and transport graph,
  with stuck recovery, teleports and multi-level routing.
- **Quest and clue engines** — quests as pure `decide(snapshot) → step` modules; a clue
  solver covering easy, medium and hard trails including puzzle boxes and dig guardians.
- **Real client, no forged packets** — bots drive the client's own action dispatch
  (`doAction` / `tryMove`), so interaction packets are byte-identical to a human click,
  and outcomes are verified against game state rather than assumed.
- **In-client panel** — script library, per-script parameters, live logs, and an overlay
  for `onPaint` HUDs.
- **Out-of-tree scripts** — author a bot in its own repository against `@rs2b0t/api` and
  load it by URL. No fork required.

## Documentation

**[The manual](docs/README.md)** is the entry point.

| If you want to | Read |
|---|---|
| Write a bot | [Scripting API](docs/API.md), then [`templates/script-template/`](templates/script-template/) |
| See what already exists | [Bundled scripts](docs/SCRIPTS.md) |
| Run it locally | [Running locally](docs/RUNNING.md) |
| Change the client itself | [Architecture](docs/ARCHITECTURE.md), then [Testing](docs/TESTING.md) |
| Maintain the deployment | [Dev and deploy](docs/DEV.md) |

## Quick start (local development)

Requires [Bun](https://bun.sh), Node 24+, and a local game engine to deploy into.

1. `bun install`
2. `./tools/deploy-local-key.sh /path/to/engine`
3. Open that engine's `/bot.html`, log in, pick a script from the library.

The helper reads the engine's generated RSA key from `data/config/private.pem`, derives
the public modulus and exponent, and passes them to the client build. A fresh upstream
Lost City engine has a different RSA key from the hosted build, so skipping this ends in
login code 6.

**[docs/RUNNING.md](docs/RUNNING.md)** covers the whole path from a cold clone.

## Writing a bot

Bots subclass a base class and are registered with `defineBot`:

```ts
import { defineBot, Execution, Game, LoopingBot } from '@rs2b0t/api';

class MyBot extends LoopingBot {
    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame(), 0);
    }

    async loop(): Promise<void> {
        // one pass of the behaviour; await an Execution wait, never setTimeout
    }
}

export default defineBot({ name: 'MyBot', description: '…', create: () => new MyBot() });
```

A working example that loots and buries bones lives in
[`templates/script-template/`](templates/script-template/) — copy that directory to start
an out-of-tree bot. The same bot ships in-tree as
[`src/bot/scripts/BoneBurier.ts`](src/bot/scripts/BoneBurier.ts).

## Bundled scripts

`src/bot/scripts/` ships 52 bots across combat, thieving, skilling, shop running, clue
solving and quests, plus navigation and banking utilities. They double as worked examples
of the API.

**[docs/SCRIPTS.md](docs/SCRIPTS.md)** is the full catalog with every script's settings.
It is generated from the registry, so it cannot drift.

## How it connects

The client resolves its game server from the build target baked into the bundle:
`local` and `prod` talk same-origin to whatever origin served the page, and `live`
targets the world host directly through a local reverse proxy. See
[build targets](docs/reference/build-targets.md).

## Questions

**Does it work with Lost City or 2004scape?** It builds against that engine family for
local development, and the collision pack is generated from whatever engine you deploy
into. It is developed and tested against rs2b2t, and nothing else is supported.

**Does it move the mouse or read pixels?** No. There is no synthetic input and no screen
reading. Bots call the client's own action dispatch and read game state through a typed
adapter.

**Do I have to fork the repo to write a bot?** No. Compile against `@rs2b0t/api` in your
own repository and load the bundle by URL.

**Which RuneScape revision is this?** Revision 274, the ~2004 era client and content.

## License

[MIT](LICENSE).
