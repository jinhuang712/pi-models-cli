<!-- what-we-build: drafted 2026-10-15 -->
# Roadmap

Where the work stands, as of 2026-10-15. Behavior lives in FEATURES.md and the checks in GOALS.md. A milestone is done only when its exit criteria are measured by someone other than its author.

✅ done · 🟨 in progress · ⬜ not started

| Milestone | Scope | Exit criteria | Status |
|---|---|---|---|
| M1 — Edit and sync | F1 to F7 | G1 to G5 met | 🟨 built; tests pass; code reviewed once; goals not yet independently measured |
| M2 — Probe | F8 | G6 met | ⬜ |
| M3 — Settings | F9, F10 | G2 and G3 met for `settings.json` | ⬜ |
| M4 — Public release | README, CONTRIBUTING.md, SECURITY.md, npm package | A stranger installs it and runs `pi-models show` in under 5 minutes, watched once | ⬜ |

## M1 — Edit and sync

| Task | Status |
|---|---|
| `show`, `add`, `update`, `remove`, `sync`, `undo`, with `--dry-run` and `--json` | ✅ |
| Backups, atomic write, newest 20 kept | ✅ |
| Tests for G2, G3 and G4 on a secret-free copy of the real `models.json` (51 tests, passing 2026-10-15) | ✅ |
| `sync --dry-run` run against the real `opencode-go` and `opencode-zen` endpoints | ✅ |
| Independent review of the code and tests: 9 defects found, all fixed, 5 weak tests replaced and checked by mutation (2026-10-15) | ✅ |
| G1: time one real release-day update, by session and by CLI | ⬜ |
| G5: run the scripted mistakes with `deepseek-flash` | ⬜ |
| Use it on a real model release | ⬜ |

## M2 — Probe

| Task | Status |
|---|---|
| Design the six checks in TODO.md into a command | ⬜ |
| Test server that logs every request, for G6 | ⬜ |

## M3 — Settings

| Task | Status |
|---|---|
| Check pi's pattern syntax for `enabledModels` | ⬜ |
| Commands for `enabledModels` and the default model and thinking settings | ⬜ |
| Backup, safe write and `undo` for `settings.json` | ⬜ |

## M4 — Public release

| Task | Status |
|---|---|
| Decide the binary name | ⬜ |
| `CONTRIBUTING.md` and `SECURITY.md` | ⬜ |
| Publish to npm | ⬜ |
