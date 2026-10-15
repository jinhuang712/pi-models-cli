<!-- what-we-build: drafted 2026-10-15 -->
# Goals

Each goal is a check with a number. Tests run in this repo against a copy of the author's real `~/.pi/agent/models.json`. Agent goals are measured by running a real session. Nothing is measured yet, because nothing is built.

| # | Goal | Want | Measure | Method | Measured on | Status |
|---|---|---|---|---|---|---|
| G1 | Cost of a model-list update | One short command per change; look without reading | An agent adds one model with 1 command and reads 0 bytes of `models.json`. Token cost ≤ number not set | Run one real update by session and one by CLI, then compare the two transcripts | The author's real update, on a real model release | ⬜ Open: baseline not measured, number not set |
| G2 | An edit touches only what you named | Edits cannot break neighbours | 0 differences outside the targeted entry, in 100% of test runs | Automated tests compare the parsed JSON before and after each command | Copy of the real `models.json`; from phase 2 also a copy of `settings.json` | ⬜ Open |
| G3 | Every write can be undone | Edits cannot break neighbours | `undo` restores a byte-identical file in 100% of runs. A process killed mid-write leaves the original file intact | Automated tests, including a kill test | Copy of the real `models.json`; from phase 2 also a copy of `settings.json` | ⬜ Open |
| G4 | `sync` finds what the endpoint serves | Lists follow the provider | 0 model IDs missing, compared with a direct `curl` of the endpoint, for every provider that has `/models` | A script compares `sync --dry-run` output with `curl` output | The author's providers | ⬜ Open |
| G5 | Errors a weak model can fix | Errors a weak model can fix in one retry | ≥ 90% of failed calls fixed in 1 retry by `gpt-6-luna` | A scripted run of about 10 typical mistakes: wrong ID, missing provider, bad flag, existing model | `gpt-6-luna` through pi (the weak model); G1 is measured with the default model, `aliyun-workspace/glm-5.3` | ⬜ Open |
| G6 | `probe` costs nothing (phase 2) | A free check that an entry will work | 0 billed requests: only GET requests, no POST | A test server logs every request, plus a read of the code path | Test server | ⬜ Open |
