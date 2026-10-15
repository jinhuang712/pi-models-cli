# Changelog

## Unreleased

- `pi-models show` lists providers, a provider's model IDs, or one model's entry.
- `pi-models add`, `update` and `remove` change one model at a time and touch nothing else in the file. `add --copy-from` starts a model from a sibling, and `update --unset` removes a field.
- `pi-models sync` adds the models a provider's `/models` endpoint serves, and `--prune` removes the ones it no longer serves.
- Every change saves a backup first (the newest 20 are kept), writes the file in one step, and can be reversed with `pi-models undo`.
- `pi-models probe <provider>[/<model>]` checks that an entry will work without sending a billed request: pi loads the file, the key resolves, the endpoint answers, the key is accepted and the endpoint lists the model.
- `pi-models enable` and `disable` edit `enabledModels` in `settings.json`; `default`, `thinking` and `budgets` set the default model, the default thinking level, a model's thinking level and the thinking token budgets. `show --settings` prints these, and `undo --settings` reverses the last change to `settings.json`.
- `sync` and `probe` never follow a redirect, so a key cannot reach another host; error messages never contain a key; and `probe` runs pi in a throwaway folder so it cannot write into your agent folder.
- The settings commands read and write the `settings.json` next to `models.json` as named, also when `models.json` is a symlink. The first change to a missing `settings.json` can be undone, and a setting of the wrong shape is refused instead of overwritten.
- `CLI.md` lists every command and option. It is generated from `--help`, and a test fails if it is out of date (`npm run docs` rewrites it).
- Error messages are easier to act on: an unknown option names the closest real flag and lists the command's options; a switch given a value (`--reasoning false`) points at `--no-reasoning`; `update` with no field lists the fields; a `<placeholder>` copied from the help is refused; and `pi-models --help` shows both forms of `default`.
- A change made by another process while a command runs makes the command fail instead of overwriting it. CRLF line endings and a BOM are kept, and files with comments are refused rather than stripped.
- `sync --prune` never removes models based on an empty, paged or partly unreadable list.
- `--dry-run` previews any command, and `--json` prints machine-readable results with short, specific errors.
