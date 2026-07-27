# rs2b0t manual

How the client works, how to run it, and how to write bots for it.

## Start here

| If you want to… | Read |
|---|---|
| Write a bot | [Scripting API](API.md), then [`templates/script-template/`](../templates/script-template/) |
| Run it locally | [Running locally](RUNNING.md) |
| Change the client itself | [Architecture](ARCHITECTURE.md) |
| Maintain the deployment | [Dev and deploy](DEV.md) |

## Pages

| Page | Covers |
|---|---|
| [Running locally](RUNNING.md) | prerequisites, getting an engine, deploying the client, tests, lint, smokes |
| [Architecture](ARCHITECTURE.md) | the layers, the fences, the ABI boundary, how a call becomes a packet |
| [Scripting API](API.md) | the complete `@rs2b0t/api` surface, with examples |
| [Dev and deploy](DEV.md) | build targets, the three run modes, the hosting pipeline |

---

`docs/superpowers/` holds design specs and implementation plans. Those are historical
records of decisions, not part of this manual.
