[Manual](../README.md) › [Testing](../TESTING.md) › Nightly regression

# Run a nightly regression

`bun run regress` runs the offline gates, deploys once, then runs the live harnesses
sequentially and writes a report that diffs against the previous run.

## Run it

```sh
bun run regress                      # quick tier
bun run regress -- --tier standard   # adds the -live.ts harnesses
bun run regress -- --tier quests     # adds the 10 stage-driven quest runs
bun run regress -- --gates-only      # offline only, no engine needed
bun run regress -- --only troll,horror
```

Exit code is 1 when anything is failing, so it drives a cron or a CI job directly.

## Tiers

| Tier | Contains | Rough cost |
|---|---|---|
| `quick` | offline gates plus `tools/*-test.ts` | ~20 min |
| `standard` | adds `tools/*-live.ts` | 2–3 h |
| `quests` | adds harnesses that take `--stage` | overnight |

Tier is derived from the harness itself — anything accepting `--stage` is a quest run —
so a new harness lands in the right tier without editing a list.

## Watching it run

| Mode | Shows |
|---|---|
| Terminal (TTY) | one status line per item, rewritten in place with elapsed seconds and the child's most recent output line |
| Piped or cron | the same line, printed every 30 seconds, so a log records progress without carriage returns |
| `--verbose` / `-v` | every line the child emits, prefixed |

Full child output always reaches `out/regress/logs/<harness>.log` regardless of mode.

## The report

`out/regress/report.md`, with per-harness logs in `out/regress/logs/`.

It leads with **newly broken since the baseline**, then newly fixed, then still broken.
A suite where twelve things always fail tells you nothing; the diff against
`out/regress/latest.json` is what identifies a regression.

The first run has no baseline, so everything failing appears under "failing, no baseline
entry".

## Prerequisites

| | |
|---|---|
| Engine | running, and matching what the harnesses expect — most default to `:8890` |
| `ENGINE_DIR` | where deploy copies to; defaults to `~/code/rs2b2t-engine` |

The deploy step rebuilds `out/botclient.js` with `TARGET=local`. A live wall serving that
same file will reject new logins until it is rebuilt with `TARGET=live`.

## Gates judged on output, not exit code

The generator drift checks print `STALE` and some then exit non-zero on an unrelated
teardown crash in the vendored audio shim. Their verdict reads the output, so a clean
generator is not reported as a regression.

## Excluded

`hosted-proof-test.ts`, `hosted-wall-test.ts` and `external-script-test.ts` need a
registered account or a second origin, so no runner can provide their environment.

## See also

- [The live-harness ABI](write-a-harness.md)
- [Test suites](../reference/test-suites.md)
