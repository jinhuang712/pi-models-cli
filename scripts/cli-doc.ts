import { HELP, MAIN_HELP } from "../src/help.ts";

/** The commands in the order the reference lists them. */
export const COMMAND_ORDER = ["show", "add", "update", "remove", "sync", "probe", "enable", "disable", "default", "thinking", "budgets", "undo"];

const fence = (text: string) => `\`\`\`text\n${text.trimEnd()}\n\`\`\``;

/**
 * CLI.md, built from the help texts, so the reference cannot drift from `pi-models --help`.
 * The JSON section below is written by hand and is checked by test/cli-doc.test.ts against real output.
 */
export function renderCliDoc(): string {
	const parts: string[] = [
		"# CLI reference",
		"",
		"Every command of `pi-models`, with its options. The help texts below are generated from the tool itself (`npm run docs`), so they match `pi-models <command> --help` exactly. Do not edit them here.",
		"",
		"## Contents",
		"",
		...COMMAND_ORDER.map((c) => `- [\`pi-models ${c}\`](#pi-models-${c})`),
		"- [Machine-readable output (`--json`)](#machine-readable-output---json)",
		"",
		"## pi-models --help",
		"",
		fence(MAIN_HELP),
		"",
	];
	for (const command of COMMAND_ORDER) {
		const help = HELP[command];
		if (help === undefined) throw new Error(`no help text for ${command}`);
		parts.push(`## pi-models ${command}`, "", fence(help), "");
	}
	parts.push(
		"## Machine-readable output (`--json`)",
		"",
		"With `--json`, a command prints one JSON object on stdout and nothing on stderr. Check `ok` first.",
		"",
		"| Command | Fields besides `ok` |",
		"|---|---|",
		"| `add`, `update`, `remove`, `sync`, `enable`, `disable`, `default`, `thinking`, `budgets` | `dryRun`, `changes` (a list of `{op, target}`), `warnings`, and `backup` when a file was written. `sync` also has `skipped`, `needsUpdate` and `kept` |",
		"| `show` | `providers`, or `provider` and `models`, or `model`, or `settings` |",
		"| `probe` | `target` and `checks`, a list of `{name, status, detail}` where status is `pass`, `fail`, `warn` or `skip` |",
		"| `undo` | `restored`, `removed`, or `backups` with `--list` |",
		"| any failure | `error`, a message. The exit code is 1 for a failure and 2 for wrong usage |",
		"",
	);
	return `${parts.join("\n")}\n`;
}
