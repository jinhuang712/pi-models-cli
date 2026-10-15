---
name: pi-models
description: Add, update, remove or sync the models of a provider in pi's models.json, and set pi's default model, default thinking level or enabled models. Use this instead of reading or editing models.json or settings.json yourself. Use when a new model is released, a model is retired, or a provider's model list or limits change.
---

# pi-models

`pi-models` edits pi's `models.json` and `settings.json` with one short command per change. Never open, cat, or rewrite those files: they are large, and the tool does it safely (backup first, `undo` to reverse, a validation before every write).

If `pi-models` is not found, tell the user to install it from the pi-models-cli repo (`npm install -g .`). Do not fall back to editing the JSON.

## Do this

1. Look first, cheaply: `pi-models show` (providers), `pi-models show <provider>` (model IDs only), `pi-models show <provider>/<model>` (one entry).
2. Change one thing per command. Every command writes at once; add `--dry-run` to preview.
3. Read the output. A line starting `warning:` or `error:` says what to fix.

## Commands

```bash
pi-models add    <provider>/<model> [--copy-from <sibling>] [--contextWindow N] [--maxTokens N] [--reasoning] [--input text,image] [--name X] [--cost.input N --cost.output N --cost.cacheRead N --cost.cacheWrite N]
pi-models update <provider>/<model> [same fields] [--no-reasoning] [--unset <field>]
pi-models remove <provider>/<model>...
pi-models sync   <provider> | --all        # adds models the provider's /models endpoint lists; --prune also removes retired ones
pi-models probe  <provider>[/<model>]      # checks an entry will work; sends no billed request
pi-models default <provider>/<model> [--thinking off|minimal|low|medium|high|xhigh|max]   # or: default --thinking high
pi-models thinking <provider>/<model> <level>        # one model's thinking level; --unset removes it
pi-models enable <pattern>...                # which models pi starts with and cycles through
pi-models disable <pattern>... | --all
pi-models budgets --low N --high N ...      # token budgets of the thinking levels; --unset <level> removes one
pi-models undo [--settings]                 # reverse the last change
```

## Rules that save a retry

- A model is `<provider>/<model>`, for example `opencode-go/glm-5.3`. The provider must already be in `models.json`; this tool does not add providers.
- A new model usually has a sibling. Use `--copy-from <sibling>` so it keeps the sibling's `compat` and `thinkingLevelMap`, and pass only what differs, for example `--contextWindow 1000000`.
- Numbers are plain digits: `1000000`, not `1M`. Prices are dollars per 1M tokens.
- A model entry needs all four cost rates together, or none. To change one rate of an existing cost, pass only that rate.
- `--reasoning` and `--no-reasoning` are switches: they take no value. Do not write `--reasoning false`.
- `add` fails if the model exists (use `update`); `update` fails if it does not (use `add`).
- `sync` adds models without limits when the endpoint reports none; the output says `needs update`, so finish with `update <provider>/<model> --contextWindow N --maxTokens N`.
- `enable` narrows pi to the patterns you give (an unset list means every model). Use it only when asked to restrict models; `disable --all` goes back.
- Run `pi-models <command> --help` when unsure. The reference is in `CLI.md` of the repo.

## After a change

Say what changed in one line per model, and mention the backup path the command printed so the user can `pi-models undo`.
