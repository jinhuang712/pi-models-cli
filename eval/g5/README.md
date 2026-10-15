# G5 evaluation

Measures GOALS.md G5: can a weak model fix a failed `pi-models` call in one retry?

For each of the ten mistakes in `scenarios.ts`, the model sees the task, `pi-models --help`, the help of the failing command, the failed command and its real error. It answers with one corrected command. The command runs on a fresh copy of `test/fixtures/models.json`, and the resulting files must equal the files produced by the known-correct command.

```bash
# An agent folder that holds only auth.json with the model's login (an API key or OAuth entry).
node eval/g5/run.ts --agent-dir <folder> --model openai-codex/gpt-6-luna --trials 3
```

Results land in `eval/g5/results/`. The model runs through `pi -p` with no tools, no session, no extensions and no context files.

Limits: the model gets the help of the failing command, as an agent that runs `--help` before retrying would see it. Without that help, results will be worse; that variant has not been run. One command per scenario means a pass shows the error and help were enough for a single fix, not that a long agent session goes well.
