# Changelog

## Unreleased

- `pi-models show` lists providers, a provider's model IDs, or one model's entry.
- `pi-models add`, `update` and `remove` change one model at a time and touch nothing else in the file. `add --copy-from` starts a model from a sibling, and `update --unset` removes a field.
- `pi-models sync` adds the models a provider's `/models` endpoint serves, and `--prune` removes the ones it no longer serves.
- Every change saves a backup first (the newest 20 are kept), writes the file in one step, and can be reversed with `pi-models undo`.
- `pi-models probe <provider>[/<model>]` checks that an entry will work without sending a billed request: pi loads the file, the key resolves, the endpoint answers, the key is accepted and the endpoint lists the model.
- `pi-models enable` and `disable` edit `enabledModels` in `settings.json`; `default`, `thinking` and `budgets` set the default model, the default thinking level, a model's thinking level and the thinking token budgets. `show --settings` prints these, and `undo --settings` reverses the last change to `settings.json`.
- A change made by another process while a command runs makes the command fail instead of overwriting it. CRLF line endings and a BOM are kept, and files with comments are refused rather than stripped.
- `sync --prune` never removes models based on an empty, paged or partly unreadable list.
- `--dry-run` previews any command, and `--json` prints machine-readable results with short, specific errors.
