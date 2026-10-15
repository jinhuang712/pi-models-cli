<!-- what-we-build: drafted 2026-10-15 -->
# pi-models-cli — Proposal

> Edit pi's `models.json` with small commands, so an agent never has to read or rewrite the file.

Proposed 2026-10-15. For where the work stands today, see ROADMAP.md.

## In short

A new model is released. You open a pi session and tell the agent to add it. The agent reads a 46 KB `models.json`, finds the right provider among 71 model entries, copies the settings of the closest sibling, and writes the whole file back. A weaker model does this slowly and gets it wrong, and every retry costs tokens.

**pi-models-cli turns that session into one command: `pi-models add opencode-go/glm-5.3 --copy-from glm-5`.**

## The shift

| Before | Now |
|---|---|
| A few providers, each with a short model list that changed rarely | Many gateways and plans (OpenCode Go and Zen, Volcengine, Ark, Zhipu), each adding and retiring models every few weeks |
| pi's built-in catalog covered the models you used | The built-in catalog covers only providers pi knows. A custom provider's list is yours to maintain |
| An agent could edit a small JSON file in one read | `models.json` mixes model IDs with hand-tuned fields (`compat`, `thinkingLevelMap`, `cost`), so a careless rewrite breaks working models |

pi has no command that adds a provider's models or edits its list. We checked the CLI (`pi --help`) and the pi source. For a custom provider, the only tool is the JSON file itself.

## Pain points

1. **Every update costs a model session.** On each release, an agent must read the whole file and write it back. This is slow, and a weaker model makes it slower and more expensive. We have not measured the cost of one update yet (see TODO.md).
2. **The lists go stale.** The `opencode-go` list holds 33 models and is kept by hand. pi's own catalog for that provider fell 8 models behind the provider's endpoint at one point (pi issue #8565).
3. **Hand-editing is risky.** One wrong edit to a curated field breaks a model that worked. The `~/.pi/agent/` folder shows the habit this forces: 23 `models.json.*` backup files, each one a manual safety copy made before a change.

These three share one root: the only interface to the model list is the whole file.

## The idea

**Give pi's model list a small command-line interface, so the model that decides a change never has to read or rewrite the file.** The agent decides what changes ("add `glm-5.3`, 1M context, copy `glm-5`"). The CLI reads the file, validates, saves a backup and writes. The agent's input stays small, and the file stays safe.

## What we want

- **One short command per change.** `add`, `update` and `remove` each take a provider and model plus flags that use the field names from `models.json`. This answers pain 1.
- **A way to look without reading.** `show` prints a provider's model IDs on one line, so the agent needs no file read. This answers pain 1.
- **Lists that follow the provider.** `sync` adds the models a provider's `/models` endpoint serves and the file lacks. This answers pain 2.
- **Edits that cannot break neighbours.** A command changes only the fields you pass. Every write saves a backup first, and `undo` restores it. This answers pain 3.
- **A free check that an entry will work.** `probe` tests a provider's endpoint, URL, key, model and config without sending a billed request, so a broken entry shows up before a session hits it. This answers pain 3.
- **Errors a weak model can fix in one retry.** Errors name the problem and suggest a fix, for example `no model 'glm-9' in opencode-go; did you mean glm-5?`. This answers pain 1.

## How it works

```bash
$ pi-models add opencode-go/glm-5.3 --copy-from glm-5 --contextWindow 1000000
+ opencode-go/glm-5.3  (ctx=1000000, copied compat and thinkingLevelMap from glm-5)

$ pi-models remove opencode-go/kimi-k2.5
- opencode-go/kimi-k2.5

$ pi-models sync opencode-go
+ minimax-m3   (endpoint reports no limits: run `update` to set them)
```

Every command writes at once, after saving a backup. `pi-models undo` reverses the last change. The full command set is in FEATURES.md.

## What we don't want

- **A model that reads or rewrites `models.json`.** That is the cost this project removes. The model decides changes, and the CLI makes them.
- **A command that replaces the whole file.** It would bring back pain 3.
- **Guessed `compat` settings.** A wrong `compat` fails silently with errors such as HTTP 400 (pi issue #10741). The caller says `--copy-from` or passes the flags. The CLI never infers them.
- **A wizard for adding providers.** Providers are rare to add and short to write. Editing the file is the right tool for that job.
- **Changes to pi itself.** pi's contribution rules say the core stays minimal, and a similar request (#10211) was closed without action.

For the full list, see FEATURES.md → Not planned.

## Who it is for

The first user is you: someone who keeps custom providers in `models.json` and updates them on each model release, usually through an agent. The project is meant to be public, for any pi user who maintains custom providers. An agent is a first-class user, so the commands, flags and errors are designed to be easy for a model to call correctly.

## Approach

- **Node and TypeScript, no runtime dependencies.** pi runs on Node, and the sibling `pid-*` projects use the same stack. This is planned, not yet built.
- **Build on existing work where it fits.** `@seqyuan/pimodel` (MIT) already probes `/v1/models`, `/models`, `/api/models` and `/api/tags` and reads limits from many field names. We reuse that approach with credit, and write the rest ourselves because its key handling and merge do not fit hand-tuned entries.
- **Own the file safely.** Writes are atomic (temp file, then rename) and take a backup first. The result is validated before it is written.
- **Resolve API keys the way pi does:** a key stored in `auth.json` first, then the provider's `apiKey` in `models.json` (literal, `$ENV` or `!command`). This is needed for `sync`.
- **Binary name:** open. `pi-models` matches the folder, and `pimodel` is taken on npm.

## Risks

| Risk | What reduces it |
|---|---|
| Some endpoints, such as Anthropic-style ones, have no `/models` | `sync` skips them with a reason. `add`, `update` and `remove` work for every provider |
| pi's `models.json` format changes | Validate against pi's own schema and keep fixtures from the real file. Check the schema in pi's source before each release |
| pi rejects fields it does not know | Write only fields pi documents. Check this before the first release (see TODO.md) |
| An immediate write damages the file | A backup before every write, atomic rename, validation, and `undo`. A `--dry-run` flag on every writing command |
| An agent calls the CLI wrongly | Short, specific errors with suggestions, and an `--help` page per command with examples |

## How we know it works

The headline check: an agent adds a model with one command and does not read `models.json`. The checks and their status are in GOALS.md.
