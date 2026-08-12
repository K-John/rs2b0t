[Manual](../README.md) › [Architecture](../ARCHITECTURE.md) › Import fences

# Import fences

Five fences in [`eslint.config.ts`](../../eslint.config.ts) declare the layering.

| Fence | Applies to | Allows |
|---|---|---|
| Client internals | `src/bot/**`, except `src/bot/adapter/**` and `src/bot/runtime/BotClient.ts` | the four protocol const-enums |
| DOM | `src/bot/**`, except `src/bot/ui/`, `src/bot/main.ts`, and `src/bot/multibox/{DomSlotOps,ProfileChooser,TabBar,VaultPrompt,main}.ts` | — |
| api leaf | `src/bot/api/**` | `runtime/{Settings,BotHost,Scheduler}` only — never script lifecycle |
| data inert | `src/bot/data/**` | value imports from `geometry/` only; type-only imports anywhere |
| abi surface | `src/bot/runtime/abi.ts` | `api/`, `data/`, `geometry/`, `nav/` |

`api` stands on `runtime/{Settings,BotHost,Scheduler}` because `Execution` needs
the Scheduler, `Game` and `fightUpkeep` need the tick count, and
`loadout`/`bank/rules` read the settings store. That is host substrate, not
script lifecycle.

`geometry/` is top-level rather than under `api/` because the data fence needs it
to be. ESLint compiles these patterns with gitignore semantics, where a path
under an excluded parent cannot be re-included — so `**/api/**` plus
`!**/api/geometry/**` is unsatisfiable no matter how it is spelled.

`abi.ts` carries one line-scoped `eslint-disable-next-line` for the Merlin
harness hooks, which are absent from `packages/rs2b0t-api/index.d.ts` and
consumed only by `tools/merlin-mordred-353-live.ts`. Being line-scoped, a new
quest import there still errors.

Exempt from the client fence: the protocol const-enums `ServerProt`, `ClientProt`,
`CollisionFlag` and `MiniMenuAction`. They are inlined at build time and carry no runtime
coupling.

Four imports carry a line-scoped `eslint-disable-next-line` with a TODO, in
`nav/pathScenePaint.ts`, `nav/worldStateLive.ts` and `ui/basemapRegen.ts`. They predate
the fence firing and need adapter accessors. The disables are per line rather than per
file, so a new client import in those files still errors.

## The fence was inert until 2026-08-11

Every pattern began with `#` (`#/client/*`, `#3rdparty/*`, …), and ESLint compiles
`no-restricted-imports` group patterns with gitignore semantics, where a leading `#`
marks a comment line. The whole group was discarded at config load, so the fence never
fired once. The patterns are escaped (`'\\#/client/*'`) and it now errors.

Two bypasses survive the escape:

- `patterns` does not cover dynamic `import()`.
- The DOM fence's `no-restricted-globals` is laundered by
  `(globalThis as {document?: Document}).document`.

## Prove a fence fires before trusting it

A fence nobody has watched fail is not a fence. Each of the three added in
2026-08 was checked by writing the forbidden import, confirming exactly one
error, and reverting.

| Fence | Probe |
|---|---|
| api leaf | add `import { ScriptRunner } from '../../runtime/ScriptRunner.js';` to `src/bot/api/game/Game.ts` |
| data inert | add a value import of `api/skills/Skills.js` to any `src/bot/data/*.ts` |
| abi surface | add a second `../quests/…` import to `src/bot/runtime/abi.ts` |

## See also

- [Architecture](../decisions/architecture.md)
