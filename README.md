<!-- what-we-build: drafted 2026-10-15 -->
# pi-models-cli

Edit pi's `models.json` with small commands, so an agent never has to read or rewrite the file.

pi has no command that adds a model to a custom provider or updates a provider's model list. You edit a large JSON file by hand, or you spawn a session that reads and rewrites it. `pi-models` does that work with one short command and keeps a backup of every change.

## What it does

```bash
$ pi-models show opencode-go
opencode-go  33 models
glm-5.3-flash  deepseek-v4-flash  …

$ pi-models add opencode-go/glm-5.4 --copy-from glm-5.3-flash --contextWindow 1000000
+ opencode-go/glm-5.4  contextWindow=1000000, copied from glm-5.3-flash (…)
wrote ~/.pi/agent/models.json (backup: ~/.pi/agent/models.bak/20261015T124500123Z-000.json)

$ pi-models sync opencode-go
+ opencode-go/space-bunny  needs update (endpoint reported no limits)
? opencode-go/old-model  no longer served (kept; --prune removes it)

$ pi-models undo
```

| Command | Does |
|---|---|
| `show [provider[/model]]` | Lists providers, a provider's model IDs, or one model's entry |
| `add <provider>/<model>` | Adds a model; `--copy-from` starts from a sibling |
| `update <provider>/<model>` | Changes only the fields you pass; `--unset` removes one |
| `remove <provider>/<model>...` | Removes models, and warns if `settings.json` still uses one |
| `sync <provider>` or `--all` | Adds the models the provider's `/models` endpoint serves; `--prune` removes the ones it no longer serves |
| `undo` | Restores the previous file; run it again to step back further |

Every command takes `--dry-run`, `--json` and `--config <path>`. Run `pi-models <command> --help` for the fields and examples. Every write saves a backup to `models.bak/` first and keeps the newest 20. The full contract is in [FEATURES.md](FEATURES.md).

## Install

From a clone (not yet published to npm):

```bash
git clone https://github.com/jinhuang712/pi-models-cli.git
cd pi-models-cli
npm install -g .
```

This builds the CLI as part of the install. It needs Node 22.18 or newer, and has been tried only on Node 26. By default it edits `~/.pi/agent/models.json`, or the agent directory in `PI_CODING_AGENT_DIR`.

## First use

```bash
pi-models show                         # what providers do you have?
pi-models sync <provider> --dry-run    # what does the endpoint serve that your file lacks?
```

## Known limits

- `pi-models` does not add providers. Add a provider by editing the file, then use the commands for its models.
- Most endpoints list model IDs but no context sizes. `sync` adds those models without limits and marks them `needs update`. pi then uses its own defaults until you run `update`.
- pi needs all four cost rates (`--cost.input`, `--cost.output`, `--cost.cacheRead`, `--cost.cacheWrite`) together in a new model entry.
- Writes are atomic (a temp file, then a rename). The file mode is kept. Ownership and access-control lists are not.
- Two commands running at the same moment are not locked. When another process changes the file while a command runs, the command fails and writes nothing; run it again.
- A file with comments or trailing commas (pi accepts them) is refused, because rewriting it would drop them. A file in another layout is rewritten in 2-space layout, with a warning; the backup keeps the original.
- `sync` reads only the first page of a paged response. It never removes models based on a list that may be partial.
- A process killed during a write can leave a hidden `.models.json.tmp-<pid>` file next to `models.json`. The real file is untouched.
- Not built yet: `probe` and the settings commands (model filters, defaults). See [ROADMAP.md](ROADMAP.md).

## Documents

- [PROPOSAL.md](PROPOSAL.md): why this exists
- [GOALS.md](GOALS.md): the checks, with numbers
- [FEATURES.md](FEATURES.md): what it does and will do
- [ROADMAP.md](ROADMAP.md): milestones and progress
- [TODO.md](TODO.md): loose ends
- [CHANGELOG.md](CHANGELOG.md): what changed

The endpoint-probing idea for `sync` comes from [`@seqyuan/pimodel`](https://pi.dev/packages/@seqyuan/pimodel) (MIT).

## License

MIT
