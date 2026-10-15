export const MAIN_HELP = `pi-models — edit pi's models.json without opening it

Usage:
  pi-models <command> [options]

Commands:
  show    [provider[/model]]        List providers, a provider's model IDs, or one model's entry
  add     <provider>/<model>        Add a model to a provider
  update  <provider>/<model>        Change fields on an existing model
  remove  <provider>/<model>...     Remove one or more models
  sync    <provider> | --all        Add models the provider's /models endpoint lists
  probe   <provider>[/<model>]      Check an entry will work, without a billed request

Settings commands (they edit settings.json next to models.json):
  enable  <pattern>...              Add patterns to enabledModels (the models pi starts with and cycles)
  disable <pattern>... | --all      Remove patterns, or clear the filter
  default <provider>/<model> [--thinking <level>]   Set the default model, and optionally the level
  default --thinking <level>        Set only the default thinking level (no model)
  thinking <provider>/<model> <level>   Set one model's default thinking level
  budgets --low <n> ...             Set the token budgets of the thinking levels

  undo                              Restore the previous models.json

Global options:
  --config <path>   models.json to edit
                    (default: ~/.pi/agent/models.json, honors PI_CODING_AGENT_DIR)
  --settings-file <path>   settings.json for the settings commands
                    (default: settings.json next to models.json)
  --dry-run         Show what would change, write nothing
  --json            Machine-readable output
  -h, --help        Show help for a command
  -v, --version

Every change writes immediately, after saving a backup to models.bak/ or settings.bak/
(last 20 kept). Run \`pi-models undo\` (or \`undo --settings\`) to reverse the last change.
Read the current model settings with \`pi-models show --settings\`.

Exit codes: 0 ok · 1 failed (nothing written) · 2 bad usage

Examples:
  pi-models show opencode-go
  pi-models add opencode-go/glm-5.3 --copy-from glm-5 --contextWindow 1000000
  pi-models update opencode-go/glm-5 --maxTokens 128000
  pi-models remove opencode-go/kimi-k2.5
  pi-models sync opencode-go
  pi-models probe opencode-go/glm-5

Run \`pi-models <command> --help\` for a command's options.
`;

const FIELDS = `Fields (names match models.json):
  --name <text>              Display name
  --contextWindow <n>        Context size in tokens, a whole number (1000000, not 1M)
  --maxTokens <n>            Max output tokens
  --reasoning                Mark as a reasoning model
  --input <list>             Input types, comma-separated: text,image
  --cost.input <usd>         Price per 1M input tokens
  --cost.output <usd>        Price per 1M output tokens
  --cost.cacheRead <usd>     Price per 1M cache-read tokens
  --cost.cacheWrite <usd>    Price per 1M cache-write tokens

pi needs all four cost rates together in a model entry. Pass all four when you
add a cost; once a model has a cost, you can change one rate at a time.`;

export const HELP: Record<string, string> = {
	show: `pi-models show — read without opening the file

Usage:
  pi-models show                       Providers: model count, api, base URL
  pi-models show <provider>            That provider's model IDs
  pi-models show <provider>/<model>    One model's full entry (JSON)
  pi-models show --settings            The model keys of settings.json: defaultProvider,
                                       defaultModel, defaultThinkingLevel, modelThinkingLevels,
                                       thinkingBudgets, enabledModels

Examples:
  pi-models show
  pi-models show opencode-go
  pi-models show opencode-go/glm-5
`,
	add: `pi-models add — add a model to a provider

Usage:
  pi-models add <provider>/<model> [options]

Fails if the model already exists (use \`update\`) or the provider is not in
models.json (providers are created by editing the file, not by this tool).

${FIELDS}

Copying:
  --copy-from <model>        Start from another model in the same provider.
                             Copies every field except id and name, including
                             compat and thinkingLevelMap. The name is the new
                             model ID unless you pass --name. Fields you pass
                             override the copy.

Examples:
  pi-models add opencode-go/glm-5.3 --copy-from glm-5 --contextWindow 1000000
  pi-models add ark-doubao/doubao-2 --input text,image --contextWindow 256000 --maxTokens 32000
  pi-models add opencode-go/glm-5.3 --copy-from glm-5 --dry-run

Without --copy-from, only the fields you pass are written. Fields you leave out
stay unset, and pi applies its own defaults.
`,
	update: `pi-models update — change fields on an existing model

Usage:
  pi-models update <provider>/<model> [options]

Only the fields you pass change; everything else, including compat and
thinkingLevelMap, is left as it is. Fails if the model does not exist, or if you
pass nothing to change.

${FIELDS}
  --no-reasoning             Mark as not a reasoning model

Removing a field:
  --unset <field>            Remove a top-level field, for example --unset cost
                             or --unset compat. Repeatable. The id cannot be unset.

Examples:
  pi-models update opencode-go/glm-5 --contextWindow 1000000
  pi-models update opencode-go/qwen3.5-plus --cost.input 0.4 --cost.output 1.2
  pi-models update opencode-go/glm-5 --unset thinkingLevelMap
`,
	remove: `pi-models remove — remove models from a provider

Usage:
  pi-models remove <provider>/<model>...

Removes only the listed models. Nothing else in the provider changes.
Models that do not exist are reported and skipped (exit 1 if none were removed).
When a removed model is still your default model or listed in enabledModels in
settings.json, the command warns. It never edits settings.json.

Examples:
  pi-models remove opencode-go/kimi-k2.5
  pi-models remove opencode-go/kimi-k2.5 opencode-go/mimo-v2-pro
`,
	sync: `pi-models sync — add models the provider's endpoint serves

Usage:
  pi-models sync <provider> [options]
  pi-models sync --all [options]

Reads GET {baseUrl}/models (then {baseUrl}/v1/models). The key is the one pi uses:
an API key stored in auth.json, else the provider's apiKey in models.json
(literal, $ENV or !command). Adds IDs missing from the file. Existing models are
never changed. A new model gets only the fields the endpoint reports; when it
reports no limits, the output marks the model "needs update".

Options:
  --prune           Also remove models the endpoint no longer lists
  --all             Every provider that has a baseUrl and a model list
  --copy-from <m>   Start each new model from this existing model

With --all, a provider whose endpoint cannot be read is skipped with the reason.
With one provider, the command fails instead.

Examples:
  pi-models sync opencode-go
  pi-models sync opencode-go --prune --dry-run
  pi-models sync --all
`,
	probe: `pi-models probe — check that an entry will work, at no cost

Usage:
  pi-models probe <provider>
  pi-models probe <provider>/<model>

Sends no billed request. The only requests are GETs of the provider's model list.
Checks, in order; the first failure stops the run:
  entry     pi itself loads models.json (runs \`pi --list-models\`, which sends no
            model request). Without pi on PATH, this tool's own rules are used.
  api       the api value is one pi ships with (a warning only)
  key       a key resolves: auth.json, else the provider's apiKey (literal, $ENV, !command)
  endpoint  the host answers, and GET {baseUrl}/models returns a model list
  models    the key is accepted, and the endpoint lists the model (or, for a whole
            provider, which models in the file it does not list)
Exit 0 when nothing failed (warnings do not fail), 1 otherwise.

What probe cannot prove: that compat or the thinking settings are right. That needs
a real request. A 200 from an endpoint that answers without a key does not prove the
key works; probe says so.

Examples:
  pi-models probe opencode-go
  pi-models probe opencode-go/glm-5.3-flash --json
`,
	enable: `pi-models enable — choose which models pi starts with and cycles through

Usage:
  pi-models enable <pattern>...

Adds patterns to enabledModels in settings.json. The patterns use the format of pi's
--models option, for example sonnet, opencode-go/* or sonnet:high. Patterns already
in the list are reported and skipped.

WARNING: when enabledModels is not set, pi offers every model. The first enable sets
the list, so pi then offers only the models those patterns match. The command warns
when it does this. \`pi-models disable --all\` offers every model again.

Examples:
  pi-models enable "opencode-go/*" sonnet
`,
	disable: `pi-models disable — remove patterns from enabledModels

Usage:
  pi-models disable <pattern>...
  pi-models disable --all

Removes the exact patterns you name. When the list becomes empty, the setting is
removed, so pi offers every model; an empty list is never written. --all removes the
setting at once. A pattern that is not in the list is reported, with a suggestion.

Examples:
  pi-models disable sonnet
  pi-models disable --all
`,
	default: `pi-models default — set the model and thinking level pi starts with

Usage:
  pi-models default <provider>/<model> [--thinking <level>]
  pi-models default --thinking <level>

Sets defaultProvider and defaultModel, and defaultThinkingLevel when you pass
--thinking. Levels: off, minimal, low, medium, high, xhigh, max.
A model that is not in models.json is still set, with a warning and a suggestion,
because it may be a built-in pi model. Read the current values with
\`pi-models show --settings\`.

Examples:
  pi-models default opencode-go/glm-5.3-flash --thinking high
  pi-models default --thinking xhigh
`,
	thinking: `pi-models thinking — set one model's default thinking level

Usage:
  pi-models thinking <provider>/<model> <level>
  pi-models thinking <provider>/<model> --unset

Writes modelThinkingLevels["<provider>/<model>"] in settings.json. This overrides the
default level for that model. Levels: off, minimal, low, medium, high, xhigh, max.
--unset removes the entry; the last removal removes the whole setting.

Examples:
  pi-models thinking opencode-go/glm-5.3-flash high
  pi-models thinking opencode-go/glm-5.3-flash --unset
`,
	budgets: `pi-models budgets — set the token budgets of the thinking levels

Usage:
  pi-models budgets [--minimal <n>] [--low <n>] [--medium <n>] [--high <n>] [--unset <level>]

Writes thinkingBudgets in settings.json. Each value is a whole number of tokens.
--unset removes one level's budget (repeatable); the last removal removes the setting.

Examples:
  pi-models budgets --low 2048 --high 32000
  pi-models budgets --unset high
`,
	undo: `pi-models undo — restore the previous file

Usage:
  pi-models undo [--list]
  pi-models undo --settings [--list]

Restores the newest backup in models.bak/ and removes it from the list, so running
undo again steps back one more change.
  --settings        Do this for settings.json (settings.bak/) instead of models.json
  --list            Show the backups, newest first

Examples:
  pi-models undo
  pi-models undo --settings --list
`,
};
