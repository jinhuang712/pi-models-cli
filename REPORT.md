# pi-models-cli: status report, 2026-10-15

This report is a snapshot. The documents that own each fact are [PROPOSAL.md](PROPOSAL.md), [GOALS.md](GOALS.md), [FEATURES.md](FEATURES.md) and [ROADMAP.md](ROADMAP.md); when they disagree with this file, they win.

## Summary

All ten planned features are built, tested and reviewed, and nothing has been used on the author's real `models.json` yet. The headline goal, cost of a model-list update (G1), has not been measured. The goal about weak models (G5) was measured at 150 of 150 corrected commands, and stays open until the author accepts it. The repo has 11 local commits, no remote, and nothing is published.

## What was built

`pi-models` edits pi's `models.json` and `settings.json` with small commands, so an agent never reads or rewrites the whole file. 2,061 lines of TypeScript in `src/`, no runtime dependencies, tried only on Node 26 and pi 1.2.0.

| Feature | Commands | Status |
|---|---|---|
| F1 Show | `show`, `show --settings` | built |
| F2 to F4 Edit | `add` (with `--copy-from`), `update` (with `--unset`), `remove` | built |
| F5 Sync | `sync <provider>` or `--all`, `--prune`, `--copy-from` | built |
| F6 Safe writes | backups (newest 20), atomic write, `undo`, `--dry-run`, refusal to overwrite a concurrent change | built |
| F7 Output for agents | `--json`, short errors with suggestions, per-command `--help` | built |
| F8 Probe | `probe <provider>[/<model>]`: entry, key, endpoint, model, with no billed request | built |
| F9 Model filters | `enable`, `disable`, `undo --settings` | built |
| F10 Defaults | `default`, `thinking`, `budgets` | built |

Install from a clone with `npm install -g .`. It has not been published to npm.

## Evidence

- **Tests:** 97 passing across seven files. They run against a secret-free copy of the author's real `models.json`, and a local HTTP server logs every request that `sync` and `probe` send.
- **Mutation checks:** for each batch of fixes I broke the code on a scratch copy and confirmed that the new tests fail. Every mutant I tried was caught.
- **Two independent reviews** by a separate model that had no access to my conclusions. The first found 9 defects and 5 tests that could not fail; the second found 9 defects and 3 such tests. All are fixed, and each fix has a test.
- **Real endpoints:** `sync --dry-run` and `probe` ran against the real `opencode-go` and `opencode-zen` endpoints, on a scratch copy of the config. They found real drift (models to add, and models the endpoint no longer lists).
- **Byte-identical round trip:** adding and then removing a model gives back the author's exact `models.json`, so a change causes no formatting noise.

## Goals

| Goal | Result | Who must still act |
|---|---|---|
| G1 cost of an update | not measured; threshold "number not set" | the author times one real release-day update (agent session against CLI) with `aliyun-workspace/glm-5.3` |
| G2 an edit touches only what you named | tests pass, including for `settings.json` | the author accepts |
| G3 every write can be undone | tests pass, including a kill test | the author accepts |
| G4 `sync` finds what the endpoint serves | tests pass; dry-run on two real providers | the author accepts; other providers not tried |
| G5 errors a weak model can fix | 150 of 150 (see below) | the author accepts |
| G6 `probe` costs nothing | tests pass: only GET requests, no body | the author accepts |

The rule is that the author of a change cannot mark its goal met. I wrote the CLI and the harness, so every goal stays open in `GOALS.md` until the author reports a result.

### G5 in detail

Ten typical mistakes (typo in a model or provider, wrong flag spelling, `add` on an existing model, partial cost, `1M`, missing `provider/`, `update` with no field, misspelled thinking level, `--reasoning false`), three trials each. The model sees the task, optionally the help, the failed command and the real error, and answers with one corrected command. The command runs on a fresh copy of the fixture, and the files must equal what the correct command produces.

| Model | full help | main help only | no help |
|---|---|---|---|
| `openai-codex/gpt-6-luna` | 30/30 | 30/30 | 30/30 |
| `aliyun-workspace/deepseek-v4.1-flash` | 30/30 | not run | 30/30 |

A first round with the original messages gave `gpt-6-luna` 23/30 with the main help only and 25/30 with no help. That exposed four weak messages, which are now fixed. Three trials per scenario show "comfortably above 90%", not a precise rate. Details: [eval/g5/README.md](eval/g5/README.md).

## Mistakes along the way

- I reported 52 tests when the count was 38.
- I said "about 30" backup files when there were 23.
- I wrote the docs with the wrong key order for `sync`: pi uses `auth.json` first, then the provider's `apiKey`.
- I told the author their default model was `deepseek-flash`. It had changed at 12:25 to `aliyun-workspace/glm-5.3`.
- The harness counted empty model replies as failures, which printed "0 of 30" for two models that had never answered. It now aborts on an empty reply.
- A docs script aborted partway, and I committed the code a commit before its docs.

## Findings about the author's setup

- The OpenCode Go plan has ended: the endpoint answers HTTP 403, "subscription ended because its payment method needs authorization".
- `opencode-go` no longer lists `deepseek-flash`, `deepseek-v4-flash` or `deepseek-v4-flash-vision-exp`, which are still in `models.json`.
- The endpoint lists `gpt-6-luna` for `opencode-go`, and the file has `gpt-5.6-luna`. pi's built-in catalog also has `openai-codex/gpt-6-luna`.

## Limits and risks

- Nothing has run against the real `~/.pi/agent/` files. Start with `pi-models show` and `pi-models sync <provider> --dry-run`.
- `probe` cannot prove that `compat` or the thinking settings are right, and pi accepts misspelled `compat` keys silently. It depends on the output format of `pi --list-models`. Whether that command makes other network requests is unchecked.
- `sync` adds models without limits when the endpoint reports none, so they need `update`. It reads only the first page of a paged response and never prunes from a list that may be partial.
- The first `enable` narrows pi to the patterns given, because an unset `enabledModels` means every model. The command warns, and `disable --all` reverses it.
- Writes keep the file mode but not ACLs or ownership. Files with comments or trailing commas are refused.

## Open items

1. G1 timing, and acceptance of G2 to G6.
2. Binary name (`pi-models` is a working name; `pimodel` is taken on npm).
3. Public release: GitHub repo and npm package. `CONTRIBUTING.md` and `SECURITY.md` were dropped by decision; `CLI.md` is written.
4. The pi skill for agents: a short snippet that teaches the commands. Recommended, not built.
5. Technical backlog: pattern check for `enable`, `compat` typo detection, paged `/models`, and the rest of [TODO.md](TODO.md).
