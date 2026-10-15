# TODO

Small follow-ups with no milestone yet. Move an item to ROADMAP.md once it has one.

- **Measure pain 1.** We have no number for the cost of one model-list update by an agent session. Time one real update (tokens and minutes) and put the number in PROPOSAL.md → Pain points.
- **Check that pi accepts unknown fields in `models.json`.** pi's schema in `core/model-config.ts` does not set `additionalProperties: false`, so unknown fields look allowed, but nobody has loaded such a file in pi. The CLI writes only documented fields and keeps unknown ones it finds.
- ~~**Check the units of `cost`.**~~ Confirmed 2026-10-15: pi's `ModelCostSchema` says USD per million tokens, and all four rates are required in a model entry.
- **Probe which of your providers expose `/models`.** Done for `opencode-go` and `opencode-zen`: both answer. Not yet tried: `volcengine-*` and `ark-doubao` (their keys are `!command` or `$ENV`, and a command can open a Keychain prompt), `deepseek`, `zhipu-coding-plan`, `meridian`, `aliyun-workspace`.
- **Look into `deepseek-flash`.** It is your default model, and `sync opencode-go` reports it "no longer served" by the endpoint. It may be a hidden alias or a retired model. Check before `--prune` removes it.
- **Fill in limits for new models.** The endpoints of `opencode-go` and `opencode-zen` report no context sizes, so every synced model needs `update`. pi.dev's catalog might supply them. Check pi's catalog API before building this.
- **Clean up the temp file a killed write leaves** (`.models.json.tmp-<pid>`).
- **Decide on locking** for two commands running at once.
- **Follow paged `/models` responses** (`has_more` with `last_id`, `nextPageToken`) so `sync --prune` can work on providers that page. Today a paged list is read once and never pruned from.
- **Gemini-style lists** use IDs like `models/gemini-2.5-pro` and `inputTokenLimit`. `sync` would add `models/…` IDs. No provider in your file works this way, so it waits.
- **Env-var key fallback.** For built-in providers pi also reads keys from its own environment variables (for example `OPENAI_API_KEY`). `sync` does not, so it can send no key where pi would send one.
- **Read files with comments or trailing commas,** and keep the comments when writing. Today such a file is refused.
- **Large integers.** JSON.parse rounds numbers above 2^53. No model setting is that large, so this is only noted.
- **Keep ownership and ACLs** when renaming over `models.json`, or document the limit (the README documents it now).
- **Pick the binary name.** `pi-models` or another. `pimodel` is taken on npm.
- **Decide about a pi skill for agents.** A short skill or `AGENTS.md` snippet that teaches an agent the commands. Recommended, planned after the first build.
- **Run `@seqyuan/pimodel --dry-run` against `opencode-go`** to see what it handles before we reuse its code. We read its `core.js` but not `cli.js`, and have not run it.
- **Phase 2: `pi-models probe <provider>[/<model>]`, a check that costs nothing.** It must send no billed request. Planned checks, in order, each stopping with a clear reason:
  1. The entry passes pi's schema (known fields, valid `api` value, `baseUrl` is a URL).
  2. The API key resolves: the env var is set, the `!command` exits 0, or `auth.json` holds one.
  3. The host answers (DNS, TLS, HTTP).
  4. `GET {baseUrl}/models` returns 200 with that key. `opencode-go` answers 200 even without a key, so a 200 alone does not prove the key; compare against an authenticated call and an unauthenticated one where possible.
  5. The model ID is in the endpoint's list.
  6. The config is consistent: `api` matches the endpoint's path (for example `anthropic-messages` against a `/v1/messages` host), and `compat` and `thinkingLevelMap` contain only keys pi knows.

  Limit to state plainly in the help: without a real completion, probe cannot prove that `compat` or the thinking format is right, only that the entry is well-formed and reachable. Providers with no `/models` endpoint get checks 1 to 3 and a note. Open question: whether an opt-in `--live` flag (one real one-token request) belongs here. Not planned until you ask for it, since the stated goal is zero cost.
- **Phase 2: pi's model-filter settings.** pi decides which models appear and start with through `settings.json`: `enabledModels` (patterns, same format as `--models`, for startup selection and Ctrl+P cycling), `defaultProvider`, `defaultModel`, `defaultThinkingLevel` and `modelThinkingLevels` (per `provider/modelId`). Your file sets `defaultProvider=opencode-go`, `defaultModel=deepseek-flash`, `defaultThinkingLevel=xhigh`, and no `enabledModels`. The CLI would manage these as discrete commands in the same style, for example `pi-models enable <pattern>…`, `pi-models disable <pattern>…`, `pi-models default <provider>/<model> [--thinking <level>]`. You also asked for setting the default model and the default thinking effort. That covers every model-selection key in pi's `docs/settings.md → Model and thinking`: `defaultProvider`, `defaultModel`, `defaultThinkingLevel` (`off` to `max`), `modelThinkingLevels` (per `provider/modelId`, for example `pi-models thinking opencode-go/glm-5 high`), `thinkingBudgets` (token budgets for `minimal` to `high`) and `enabledModels`. Not included unless you ask: `hideThinkingBlock`, `showCacheMissNotices` and `cacheWarming`, because they change display and caching, not which model runs. It would also warn when a removed model is still in `enabledModels` or a default, since `remove` can otherwise leave a dangling reference. Check pi's pattern syntax (`provider/*`, `sonnet:high`) before designing the commands. The `settings.json` file needs the same backup, atomic write and `undo` as `models.json`.
- **Decide where phase 2 lives.** Add a ROADMAP.md milestone for it and a *Later* entry in FEATURES.md when those docs are drafted, then remove the two items above.
- **Correct an earlier count.** The conversation said "about 30" backup files. The real count is 23 `models.json.*` backups (plus 5 for `models-store.json`).
