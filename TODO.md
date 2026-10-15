# TODO

Small follow-ups with no milestone yet. Move an item to ROADMAP.md once it has one.

- **Measure pain 1.** We have no number for the cost of one model-list update by an agent session. Time one real update (tokens and minutes) and put the number in PROPOSAL.md → Pain points.
- **Check that pi accepts unknown fields in `models.json`.** pi's schema in `core/model-config.ts` does not set `additionalProperties: false`, so unknown fields look allowed, but nobody has loaded such a file in pi. The CLI writes only documented fields and keeps unknown ones it finds.
- ~~**Check the units of `cost`.**~~ Confirmed 2026-10-15: pi's `ModelCostSchema` says USD per million tokens, and all four rates are required in a model entry.
- **Probe which of your providers expose `/models`.** Done for `opencode-go` and `opencode-zen`: both answer. Not yet tried: `volcengine-*` and `ark-doubao` (their keys are `!command` or `$ENV`, and a command can open a Keychain prompt), `deepseek`, `zhipu-coding-plan`, `meridian`, `aliyun-workspace`.
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
- **Detect misspelled `compat` keys in `probe`.** pi's schema accepts unknown keys, so a typo passes silently. Catching it needs the per-API key list from pi, which pi does not expose. Options: read pi's installed schema file, or copy the list and accept drift.
- **Check pi's pattern syntax for `enable`.** The settings commands accept any non-empty pattern and do not check it against pi's matching rules (`--models` accepts forms like `sonnet`, `provider/*` and `sonnet:high`). Read pi's matcher and warn on a pattern that matches nothing.
- **Project settings.** `--settings-file` points the settings commands at any file, such as a project's `.pi/settings.json`. A shorter `--local` flag like `pi config -l` may be worth adding.
- **Unset the default model.** `default` can only set a model, not clear it. Add `--unset` if the need comes up.
- **Does `pi --list-models` make network requests?** `probe` runs it in a throwaway folder with only API keys, so it cannot refresh an OAuth token. Whether it fetches pi's model catalog (a GET) was not checked.
- **Header-carried credentials in `sync` and `probe`.** A provider that authenticates through `headers` still gets those headers on the normal request. The comparison request without credentials sends none of them.

- **Note on G5's weak model.** `openai-codex/gpt-6-luna` comes from pi's built-in catalog (272K context, 128K max output, seen with `pi --list-models luna` on 2026-10-15), so `models.json` needs no change. `deepseek-flash` was dropped as the test model because `opencode-go` no longer lists it. Your `opencode-go` entry still has `gpt-5.6-luna`, and the endpoint now lists `gpt-6-luna` too; `pi-models sync opencode-go` would add it.
- **Run G5 without the command help, and with a weaker model.** The 30 of 30 result gives the model the help of the failing command. Try it with only the error, and with a smaller model, to see where it breaks. `eval/g5/run.ts` takes `--model`; the prompt change is small.
