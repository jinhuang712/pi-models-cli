<!-- what-we-build: drafted 2026-10-15 -->
# Features

✅ built · 🚧 built with a gap · ⬜ planned

Nothing is built yet. The commands below are the contract. F1 to F7 edit `models.json`. F8 to F10 are phase 2, and their command names can still change.

All commands act on pi's `models.json` in the agent directory (`~/.pi/agent`, or the directory in `PI_CODING_AGENT_DIR`). Options for every command:

| Option | Meaning |
|---|---|
| `--config <path>` | Use another `models.json` |
| `--dry-run` | Show what would change and write nothing |
| `--json` | Print the result as JSON |
| `-h`, `--help` | Show help for the command |

Exit codes: `0` done, `1` failed with nothing written, `2` wrong usage.

## F1 — Show ⬜

Read the model list without opening the file.

| Command | Prints |
|---|---|
| `pi-models show` | Each provider: model count, `api`, base URL |
| `pi-models show <provider>` | The provider's model IDs on one line |
| `pi-models show <provider>/<model>` | That model's full entry, as JSON |

Settings: none.

## F2 — Add a model ⬜

`pi-models add <provider>/<model> [fields]` adds a model to a provider that already exists in `models.json`.

- Token counts (`--contextWindow`, `--maxTokens`) are whole decimal numbers, such as `1000000`; `1M`, `1e6` and `0x10` are refused.
- The fields use the names from `models.json`: `--name`, `--contextWindow`, `--maxTokens`, `--reasoning`, `--input text,image`, `--cost.input`, `--cost.output`, `--cost.cacheRead`, `--cost.cacheWrite`.
- `--copy-from <model>` starts from another model of the same provider. Every field is copied except `id` and `name`, including `compat` and `thinkingLevelMap`. The name is the new model ID unless you pass `--name`, so two models never share a display name. Fields you pass override the copy.
- Without `--copy-from`, only the fields you pass are written. pi applies its own defaults to the rest.
- pi needs all four cost rates (`--cost.input`, `--cost.output`, `--cost.cacheRead`, `--cost.cacheWrite`) together in a model entry. The command fails with the missing names when you pass fewer on a model that has no cost.
- The command fails when the model already exists (use `update`) or the provider is missing.

Settings: none.

## F3 — Update a model ⬜

`pi-models update <provider>/<model> [fields]` changes the fields you pass and nothing else.

- It takes the same fields as `add`, plus `--no-reasoning`. Once a model has a cost, you can change one rate at a time.
- `--unset <field>` removes a field, for example `--unset cost`. You can repeat it.
- It fails when the model does not exist, or when you pass no fields.

Settings: none.

## F4 — Remove models ⬜

`pi-models remove <provider>/<model>...` removes the listed models and changes nothing else in the provider.

- A model that does not exist is reported and skipped. The command exits `1` when it removed none.
- When a removed model is still your default model or listed in `enabledModels` in `settings.json`, the command prints a warning that names the setting. It only reads `settings.json`.

Settings: none.

## F5 — Sync a provider's models ⬜

`pi-models sync <provider>` adds the models that the provider's endpoint lists and your file does not. `pi-models sync --all` does this for every provider that has a base URL and a model list.

- It reads `GET {baseUrl}/models`, then `GET {baseUrl}/v1/models`. The key is the one pi uses: an API key stored in `auth.json`, then the provider's `apiKey` in `models.json` (a literal, `$ENV` or `!command`).
- It never changes a model that exists.
- A new model gets only the fields the endpoint reports. When the endpoint reports no limits, the model is added without `contextWindow` and `maxTokens`, and the output says `needs update` beside it. pi then uses its own default.
- `--copy-from <model>` starts each new model from that model.
- `--prune` also removes models the endpoint no longer lists. Without it, nothing is removed.
- A list that may be partial is never used to remove or report missing models: an empty list, a paged response (only the first page is read), or entries with no readable ID. The output says why, still adds the new models it did read, and ignores `--prune`.
- A model the endpoint lists twice is added once.
- A provider with no `/models` endpoint is skipped, and the output gives the reason.

Settings: none.

## F6 — Safe writes ⬜

Every command that changes a file saves a copy first and can be undone.

- Before a write, the command copies the file to `models.bak/` next to it. The newest 20 copies are kept. Names are UTC timestamps, so they sort in time order.
- When another process changes `models.json` while a command runs, the command fails and writes nothing, so no edit is lost.
- A file in a different layout (compact arrays, escaped characters) is rewritten in 2-space layout with a warning, and the backup keeps the original. Line endings (LF or CRLF) and a leading BOM are kept.
- A file with comments or trailing commas, which pi accepts, is refused with the reason, because rewriting it would drop them.
- A write happens in one step. A crash in the middle leaves the original file as it was.
- The command checks the new file before it writes. When the check fails, nothing is written and the exit code is `1`.
- `pi-models undo` restores the newest copy. Running it again steps back one more copy. `pi-models undo --list` shows the copies with their times.

Settings: none. The count of 20 is fixed, because a setting would hand you a decision that does not matter.

## F7 — Output for agents ⬜

A model can call every command correctly, and fix a wrong call in one retry.

- Each command prints one short line per change, such as `+ opencode-go/glm-5.3 (ctx=1000000, copied compat from glm-5)`.
- `--json` prints the same result as JSON.
- An error names the problem and suggests the fix, for example `no model 'glm-9' in opencode-go; did you mean glm-5?`.
- `pi-models --help` lists the commands, and `pi-models <command> --help` lists the fields, shows examples and states what the command refuses to do.

Settings: none.

## F8 — Probe an entry, free of cost ⬜

`pi-models probe <provider>[/<model>]` checks that an entry will work and sends no billed request. It runs these checks in order and stops at the first failure with the reason:

1. The entry passes pi's schema.
2. The API key resolves: the env var is set, the `!command` exits `0`, or `auth.json` holds a key.
3. The host answers.
4. `GET {baseUrl}/models` returns `200` with the key.
5. The model ID is in that list.
6. The config is consistent: `api` fits the endpoint, and `compat` and `thinkingLevelMap` hold only keys pi knows.

A provider with no `/models` endpoint gets checks 1 to 3 and a note. Probe cannot prove that `compat` or the thinking format is right, because that needs a real request. The help text says so.

Settings: none.

## F9 — Model filters ⬜

`pi-models enable <pattern>...` and `pi-models disable <pattern>...` edit `enabledModels` in `settings.json`, the list of models pi starts with and cycles through with Ctrl+P. Patterns use the same format as pi's `--models` option. The `settings.json` file gets the same backup, safe write and `undo` as F6.

Settings: none.

## F10 — Defaults ⬜

Commands set which model pi starts with and how hard it thinks, in `settings.json`:

- the default provider and model
- the default thinking level, from `off` to `max`
- a thinking level for one model, keyed by `provider/modelId`
- the token budgets for the `minimal`, `low`, `medium` and `high` thinking levels

The same backup, safe write and `undo` as F6 apply. These commands do not change display or cache settings.

Settings: none.

## Later, if needed

| Idea | Note |
|---|---|
| A pi skill that teaches an agent the commands | Recommended. It keeps weaker models from guessing flags |
| `probe --live`, one real one-token request | Costs money, so it waits until you ask for it |
| Shell completions | Nice to have, no pain behind it yet |

## Not planned

| Not this | Why |
|---|---|
| Adding a provider | Adding one is rare and the entry is short. Editing the file is the right tool |
| Replacing the whole file | It brings back the risk this project removes |
| Guessing `compat` or thinking settings | A wrong guess fails silently, for example with HTTP 400 |
| Calling an LLM from inside the tool | The caller decides the change. The tool only makes it |
| Managing API keys or logins | pi's `/login` does it, and it stores keys in `auth.json` |
| Changing pi itself | pi's core stays minimal, and a similar request was closed without action |
| Display and cache settings (`hideThinkingBlock`, `cacheWarming`, and similar) | They change how pi looks and caches, not which model runs |
