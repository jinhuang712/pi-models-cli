import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { type Common, type Context, type Report, add, budgets, disable, enable, probe, remove, setDefaults, show, sync, thinking, undo, update } from "./commands.ts";
import { FailError, UsageError } from "./errors.ts";
import { FIELD_OPTIONS } from "./fields.ts";
import { HELP, MAIN_HELP } from "./help.ts";
import { closest, didYouMean } from "./suggest.ts";

const GLOBAL = {
	config: { type: "string" },
	"settings-file": { type: "string" },
	"dry-run": { type: "boolean" },
	json: { type: "boolean" },
	help: { type: "boolean", short: "h" },
	version: { type: "boolean", short: "v" },
} as const;

type Spec = Record<string, { type: "string" | "boolean"; short?: string; multiple?: boolean }>;

const COMMAND_OPTIONS: Record<string, Spec> = {
	show: { settings: { type: "boolean" } },
	add: { ...FIELD_OPTIONS, "copy-from": { type: "string" } },
	update: { ...FIELD_OPTIONS, unset: { type: "string", multiple: true } },
	remove: {},
	sync: { all: { type: "boolean" }, prune: { type: "boolean" }, "copy-from": { type: "string" } },
	probe: {},
	enable: {},
	disable: { all: { type: "boolean" } },
	default: { thinking: { type: "string" } },
	thinking: { unset: { type: "boolean" } },
	budgets: { minimal: { type: "string" }, low: { type: "string" }, medium: { type: "string" }, high: { type: "string" }, unset: { type: "string", multiple: true } },
	undo: { list: { type: "boolean" }, settings: { type: "boolean" } },
};

export interface Io {
	out(text: string): void;
	err(text: string): void;
}

function version(): string {
	const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
	return pkg.version;
}

async function dispatch(command: string, positionals: string[], values: Record<string, never>, common: Common, ctx: Context): Promise<Report> {
	switch (command) {
		case "show":
			return show(positionals, values, common, ctx);
		case "enable":
			return enable(positionals, common, ctx);
		case "disable":
			return disable(positionals, values, common, ctx);
		case "default":
			return setDefaults(positionals, values, common, ctx);
		case "thinking":
			return thinking(positionals, values, common, ctx);
		case "budgets":
			return budgets(positionals, values, common, ctx);
		case "add":
			return add(positionals, values, common, ctx);
		case "update":
			return update(positionals, values, common, ctx);
		case "remove":
			return remove(positionals, common, ctx);
		case "sync":
			return sync(positionals, values, common, ctx);
		case "probe":
			return probe(positionals, common, ctx);
		default:
			return undo(values, common, ctx);
	}
}

/** Run the CLI. Returns the exit code. */
export async function main(argv: string[], env: NodeJS.ProcessEnv, io: Io): Promise<number> {
	const wantsJson = argv.includes("--json");
	try {
		const first = argv[0];
		if (first === undefined || first === "--help" || first === "-h" || first === "help") {
			io.out(MAIN_HELP);
			return 0;
		}
		if (first === "--version" || first === "-v") {
			io.out(`${version()}\n`);
			return 0;
		}
		if (!(first in COMMAND_OPTIONS)) {
			throw new UsageError(`unknown command '${first}'${didYouMean(first, Object.keys(COMMAND_OPTIONS))}. Run \`pi-models --help\``);
		}
		let parsed;
		try {
			parsed = parseArgs({
				args: argv.slice(1),
				options: { ...GLOBAL, ...(COMMAND_OPTIONS[first] as Spec) },
				allowPositionals: true,
				strict: true,
			});
		} catch (error) {
			const text = error instanceof Error ? error.message : String(error);
			const unknown = /Unknown option '--?([\w.-]+)'/.exec(text)?.[1];
			if (unknown !== undefined) {
				const flags = Object.keys({ ...GLOBAL, ...(COMMAND_OPTIONS[first] as Spec) }).filter((f) => f !== "version");
				const norm = (s: string) => s.toLowerCase().replace(/[-_.]/g, "");
				const byNorm = new Map(flags.map((f) => [norm(f), f]));
				const hit = byNorm.get(norm(unknown)) ?? byNorm.get(closest(norm(unknown), [...byNorm.keys()]) ?? "");
				throw new UsageError(
					`unknown option '--${unknown}'${hit ? `; did you mean --${hit}?` : ""}. Options of ${first}: ${flags.map((f) => `--${f}`).join(" ")}. Run \`pi-models ${first} --help\``,
				);
			}
			const flag = /Option '--([\w.-]+)' does not take an argument/.exec(text)?.[1];
			const hint =
				flag === "reasoning"
					? ". --reasoning is a switch with no value: pass --reasoning to turn it on, or --no-reasoning to turn it off"
					: flag
						? `. --${flag} is a switch with no value: pass it alone`
						: "";
			throw new UsageError(`${text}${hint}. Run \`pi-models ${first} --help\``);
		}
		if (parsed.values.help === true) {
			io.out(HELP[first] as string);
			return 0;
		}
		const common: Common = {
			dryRun: parsed.values["dry-run"] === true,
			...(typeof parsed.values.config === "string" ? { config: parsed.values.config } : {}),
			...(typeof parsed.values["settings-file"] === "string" ? { settings: parsed.values["settings-file"] } : {}),
		};
		const report = await dispatch(first, parsed.positionals, parsed.values as Record<string, never>, common, { env });
		io.out(parsed.values.json === true ? `${JSON.stringify(report.json)}\n` : `${report.lines.join("\n")}\n`);
		return report.exitCode ?? 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const code = error instanceof UsageError ? 2 : 1;
		if (!(error instanceof UsageError || error instanceof FailError) && process.env.PI_MODELS_DEBUG === "1") throw error;
		if (wantsJson) io.out(`${JSON.stringify({ ok: false, error: message })}\n`);
		else io.err(`error: ${message}\n`);
		return code;
	}
}
