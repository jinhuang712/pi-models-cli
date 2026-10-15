# G5 evaluation

Measures GOALS.md G5: can a weak model fix a failed `pi-models` call in one retry?

For each of the ten mistakes in `scenarios.ts`, the model sees the task, `pi-models --help`, the help of the failing command, the failed command and its real error. It answers with one corrected command. The command runs on a fresh copy of `test/fixtures/models.json`, and the resulting files must equal the files produced by the known-correct command.

```bash
# An agent folder that holds only auth.json with the model's login (an API key or OAuth entry).
node eval/g5/run.ts --agent-dir <folder> --model openai-codex/gpt-6-luna --trials 3
```

Results land in `eval/g5/results/`. The model runs through `pi -p` with no tools, no session, no extensions and no context files.

Limits: the model gets the help of the failing command, as an agent that runs `--help` before retrying would see it. Without that help, results will be worse; that variant has not been run. One command per scenario means a pass shows the error and help were enough for a single fix, not that a long agent session goes well.

## Results, 2026-10-15

Ten mistakes, three trials each, thinking level `medium`. Help modes: `full` = main help and the help of the failing command, `main` = main help only, `none` = no help.

| Model | `full` | `main` | `none` |
|---|---|---|---|
| `openai-codex/gpt-6-luna` | 30/30 | 30/30 | 30/30 |
| `aliyun-workspace/deepseek-v4.1-flash` | 30/30 | not run | 30/30 |

Total: 150 of 150 corrected commands produced the right files. The files in `results/` are the raw replies of the last run of each configuration.

How the numbers came about, so they are not read as a first-try score:

- A first round with the original error messages gave `gpt-6-luna` 30/30 (`full`), 23/30 (`main`) and 25/30 (`none`). Those result files were overwritten by later runs; the numbers survive only here.
- The failures showed three weak messages: `--reasoning false` (and `--reasoning=false`, `reasoning=false`) gave no hint to use `--no-reasoning`; `update` with no field did not list the fields; an unknown option such as `--context` named no real flag. A `<provider>/<model>` copied from the help was also accepted. All four were fixed, and `pi-models --help` now lists both forms of `default`.
- The `none` runs and one `main` run came before the last help edit, which only changed the `default` lines of the main help; the `full` and last `main` runs used the final code.
- Two models of OpenCode Go (`mimo-v2.6-flash`, `qwen3.8-flash`) could not be tried: the plan answered HTTP 403 ("subscription ended"). The harness now aborts on an empty reply, retrying twice first, because an empty reply is a broken run and not a model mistake.

Three trials per scenario show "comfortably above 90%", not a precise rate. The author of the CLI wrote the harness.
