import { join, dirname } from "node:path";
import { FailError, UsageError } from "./errors.ts";
import { type Fields, hasFields, parseFields } from "./fields.ts";
import {
	type Change,
	type Outcome,
	addModel,
	buildEntry,
	getProvider,
	modelEntry,
	modelIds,
	modelsOf,
	parseRef,
	refText,
	removeModels,
	settingsReferences,
	summarize,
	updateModel,
	withModels,
} from "./model-ops.ts";
import { type Json, type Loaded, commit, listBackups, loadConfig, loadSettings, namedAgentDir, readJsonQuietly, resolveConfigPath, undoLast } from "./store.ts";
import { BUDGET_LEVELS, checkLevel, disableModels, enableModels, selectionOf, setBudgets, setDefault, setModelThinking } from "./settings-ops.ts";
import { fetchModelList } from "./sync.ts";
import { probe as runProbe, parseTarget } from "./probe.ts";
import { validateEntry } from "./fields.ts";

export interface Context {
	env: NodeJS.ProcessEnv;
}

export interface Report {
	lines: string[];
	json: Json;
	exitCode?: number;
}

export interface Common {
	config?: string;
	settings?: string;
	dryRun: boolean;
}

type Values = Record<string, string | boolean | (string | boolean)[] | undefined>;

function open(common: Common, ctx: Context): Loaded {
	return loadConfig(resolveConfigPath(common.config, ctx.env));
}

/** Write an outcome unless it is a dry run or changed nothing; build the report either way. */
function finish(loaded: Loaded, outcome: Outcome, common: Common, extraLines: string[] = [], extraJson: Json = {}): Report {
	if (outcome.changes.length > 0 && !loaded.canonical) {
		outcome.warnings.push(
			"the file's layout changed (it was not in standard JSON.stringify layout, for example compact arrays or escaped characters); the backup keeps the original",
		);
	}
	const lines = [...outcome.changes.map((c) => c.line), ...extraLines, ...outcome.warnings.map((w) => `warning: ${w}`)];
	let backup: string | undefined;
	if (outcome.changes.length > 0 && !common.dryRun) {
		backup = commit(loaded, outcome.config).backup;
		lines.push(`wrote ${loaded.path} (backup: ${backup})`);
	} else if (outcome.changes.length > 0) {
		lines.push("dry run: nothing written");
	}
	return {
		lines,
		json: {
			ok: true,
			dryRun: common.dryRun,
			changes: outcome.changes.map(({ op, target }) => ({ op, target })),
			warnings: outcome.warnings,
			...(backup ? { backup } : {}),
			...extraJson,
		},
	};
}

/** settings.json next to models.json, unless --settings names another file. */
function settingsPath(common: Common, ctx: Context): string {
	if (common.settings !== undefined) return resolveConfigPath(common.settings, ctx.env);
	return resolveConfigPath(join(namedAgentDir(common.config, ctx.env), "settings.json"), ctx.env);
}

function modelsQuietly(common: Common, ctx: Context): Json | undefined {
	return readJsonQuietly(resolveConfigPath(common.config, ctx.env));
}

export function show(positionals: string[], values: Values, common: Common, ctx: Context): Report {
	if (values.settings === true) {
		if (positionals.length > 0) throw new UsageError("show --settings takes no argument");
		const selection = selectionOf(loadSettings(settingsPath(common, ctx)).config);
		return {
			lines: Object.keys(selection).length === 0 ? ["no model settings are set"] : Object.entries(selection).map(([k, v]) => `${k}: ${JSON.stringify(v)}`),
			json: { ok: true, settings: selection },
		};
	}
	const { config } = open(common, ctx);
	const [target] = positionals;
	if (positionals.length > 1) throw new UsageError("show takes at most one argument");
	if (target === undefined) {
		const providers = summarize(config);
		return {
			lines: providers.map((p) => `${p.name}  ${p.models} models${p.api ? `  api=${p.api}` : ""}${p.baseUrl ? `  ${p.baseUrl}` : ""}`),
			json: { ok: true, providers },
		};
	}
	if (target.includes("/")) {
		const ref = parseRef(target);
		const entry = modelEntry(config, ref);
		return { lines: [JSON.stringify(entry, null, 2)], json: { ok: true, model: entry } };
	}
	const ids = modelIds(config, target);
	return { lines: [`${target}  ${ids.length} models`, ids.join("  ")], json: { ok: true, provider: target, models: ids } };
}

export function add(positionals: string[], values: Values, common: Common, ctx: Context): Report {
	const [target, ...rest] = positionals;
	if (target === undefined || rest.length > 0) throw new UsageError("add takes one argument: <provider>/<model>");
	const copyFrom = typeof values["copy-from"] === "string" ? values["copy-from"] : undefined;
	const loaded = open(common, ctx);
	return finish(loaded, addModel(loaded.config, parseRef(target), parseFields(values), copyFrom), common);
}

export function update(positionals: string[], values: Values, common: Common, ctx: Context): Report {
	const [target, ...rest] = positionals;
	if (target === undefined || rest.length > 0) throw new UsageError("update takes one argument: <provider>/<model>");
	const fields = parseFields(values);
	const unset = Array.isArray(values.unset) ? (values.unset as string[]) : [];
	if (!hasFields(fields) && unset.length === 0) {
		throw new UsageError("update needs at least one field to change, for example --contextWindow 1000000, or --unset <field>");
	}
	const loaded = open(common, ctx);
	return finish(loaded, updateModel(loaded.config, parseRef(target), fields, unset), common);
}

export function remove(positionals: string[], common: Common, ctx: Context): Report {
	if (positionals.length === 0) throw new UsageError("remove takes one or more <provider>/<model>");
	const refs = positionals.map(parseRef);
	const loaded = open(common, ctx);
	const outcome = removeModels(loaded.config, refs);
	if (outcome.changes.length === 0) {
		throw new FailError(outcome.warnings.join("; ") || "nothing to remove");
	}
	const settings = readJsonQuietly(settingsPath(common, ctx));
	for (const ref of refs) {
		if (!outcome.changes.some((c) => c.target === refText(ref))) continue;
		const where = settingsReferences(settings, ref);
		if (where.length > 0) outcome.warnings.push(`${refText(ref)} is still set in settings.json: ${where.join(", ")}`);
	}
	return finish(loaded, outcome, common);
}

export async function sync(positionals: string[], values: Values, common: Common, ctx: Context): Promise<Report> {
	const all = values.all === true;
	if (all === (positionals.length > 0)) throw new UsageError("sync takes one <provider>, or --all");
	if (positionals.length > 1) throw new UsageError("sync takes one <provider>, or --all");
	const copyFrom = typeof values["copy-from"] === "string" ? values["copy-from"] : undefined;
	const prune = values.prune === true;
	const loaded = open(common, ctx);
	const auth = readJsonQuietly(join(namedAgentDir(common.config, ctx.env), "auth.json"));
	const names = all
		? Object.entries(loaded.config.providers as Record<string, Json>)
				.filter(([, p]) => typeof p.baseUrl === "string" && Array.isArray(p.models))
				.map(([n]) => n)
		: [positionals[0] as string];

	let config = loaded.config;
	const changes: Change[] = [];
	const lines: string[] = [];
	const warnings: string[] = [];
	const needsUpdate: string[] = [];
	const skipped: { provider: string; reason: string }[] = [];
	const kept: string[] = [];

	for (const name of names) {
		const provider = getProvider(config, name);
		const listed = await fetchModelList(provider, name, auth, ctx.env);
		if (!listed.ok) {
			if (!all) throw new FailError(`cannot read the model list of ${name}: ${listed.reason}`);
			skipped.push({ provider: name, reason: listed.reason });
			lines.push(`skipped ${name}: ${listed.reason}`);
			continue;
		}
		const have = new Set(modelsOf(provider).map((m) => String(m.id)));
		const served = new Set(listed.models.map((m) => m.id));
		let models = [...modelsOf(provider)];
		for (const item of listed.models) {
			if (have.has(item.id)) continue;
			have.add(item.id);
			served.add(item.id);
			const fields: Fields = {
				...(item.contextWindow ? { contextWindow: item.contextWindow } : {}),
				...(item.maxTokens ? { maxTokens: item.maxTokens } : {}),
			};
			const entry = buildEntry(provider, name, item.id, fields, copyFrom);
			const problems = validateEntry(entry);
			if (problems.length > 0) throw new FailError(`${name}/${item.id}: ${problems.join("; ")}`);
			models.push(entry);
			const missing = entry.contextWindow === undefined || entry.maxTokens === undefined;
			const target = `${name}/${item.id}`;
			if (missing) needsUpdate.push(target);
			const shown = Object.entries(fields).map(([k, v]) => `${k}=${v}`);
			if (copyFrom) shown.push(`copied from ${copyFrom}`);
			changes.push({
				op: "add",
				target,
				line: `+ ${target}${shown.length > 0 ? `  ${shown.join(", ")}` : ""}${missing ? "  needs update (endpoint reported no limits)" : ""}`,
			});
		}
		if (!listed.complete) {
			const gone = modelsOf(provider).filter((m) => !served.has(String(m.id))).length;
			warnings.push(`${name}: ${listed.why}${gone > 0 ? `; not checking the ${gone} models the file has that the list lacks` : ""}${prune ? " (--prune ignored)" : ""}`);
		}
		for (const id of listed.complete ? have : []) {
			if (served.has(id)) continue;
			if (prune) {
				models = models.filter((m) => m.id !== id);
				changes.push({ op: "remove", target: `${name}/${id}`, line: `- ${name}/${id}  no longer served` });
			} else {
				kept.push(`${name}/${id}`);
				lines.push(`? ${name}/${id}  no longer served (kept; --prune removes it)`);
			}
		}
		config = withModels(config, name, models);
	}

	const outcome: Outcome = { config, changes, warnings };
	const report = finish(loaded, outcome, common, lines, { skipped, needsUpdate, kept });
	if (changes.length === 0 && skipped.length === 0 && kept.length === 0) report.lines.push("already in sync");
	return report;
}

function settingsLoaded(common: Common, ctx: Context): Loaded {
	return loadSettings(settingsPath(common, ctx));
}

export function enable(positionals: string[], common: Common, ctx: Context): Report {
	if (positionals.length === 0) throw new UsageError("enable takes one or more model patterns, for example sonnet or opencode-go/*");
	if (positionals.some((p) => p.trim() === "")) throw new UsageError("a model pattern must not be empty");
	const loaded = settingsLoaded(common, ctx);
	return finish(loaded, enableModels(loaded.config, positionals), common);
}

export function disable(positionals: string[], values: Values, common: Common, ctx: Context): Report {
	const all = values.all === true;
	if (all === (positionals.length > 0)) throw new UsageError("disable takes one or more patterns, or --all");
	const loaded = settingsLoaded(common, ctx);
	return finish(loaded, disableModels(loaded.config, positionals, all), common);
}

export function setDefaults(positionals: string[], values: Values, common: Common, ctx: Context): Report {
	if (positionals.length > 1) throw new UsageError("default takes at most one argument: <provider>/<model>");
	const thinking = typeof values.thinking === "string" ? checkLevel(values.thinking, "--thinking") : undefined;
	const ref = positionals[0] === undefined ? undefined : parseRef(positionals[0]);
	if (ref === undefined && thinking === undefined) {
		throw new UsageError("default needs a <provider>/<model>, or --thinking <level>, or both. To read the defaults, run `pi-models show --settings`");
	}
	const loaded = settingsLoaded(common, ctx);
	return finish(loaded, setDefault(loaded.config, ref, thinking, modelsQuietly(common, ctx)), common);
}

export function thinking(positionals: string[], values: Values, common: Common, ctx: Context): Report {
	const [target, level, ...rest] = positionals;
	const unset = values.unset === true;
	if (target === undefined || rest.length > 0 || (unset === (level !== undefined))) {
		throw new UsageError("thinking takes <provider>/<model> <level>, or <provider>/<model> --unset");
	}
	const loaded = settingsLoaded(common, ctx);
	return finish(loaded, setModelThinking(loaded.config, parseRef(target), level === undefined ? undefined : checkLevel(level), modelsQuietly(common, ctx)), common);
}

export function budgets(positionals: string[], values: Values, common: Common, ctx: Context): Report {
	if (positionals.length > 0) throw new UsageError("budgets takes only options: --minimal, --low, --medium, --high, --unset <level>");
	const set: Record<string, number> = {};
	for (const level of BUDGET_LEVELS) {
		const text = values[level];
		if (typeof text !== "string") continue;
		if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text))) {
			throw new UsageError(`--${level} must be a whole number of tokens that is not absurdly large, got '${text}'`);
		}
		set[level] = Number(text);
	}
	const unset = Array.isArray(values.unset) ? (values.unset as string[]) : [];
	for (const level of unset) {
		if (!(BUDGET_LEVELS as readonly string[]).includes(level)) throw new UsageError(`--unset takes one of ${BUDGET_LEVELS.join(", ")}, got '${level}'`);
	}
	if (Object.keys(set).length === 0 && unset.length === 0) throw new UsageError("budgets needs at least one of --minimal, --low, --medium, --high, --unset <level>");
	const loaded = settingsLoaded(common, ctx);
	return finish(loaded, setBudgets(loaded.config, set, unset), common);
}

export async function probe(positionals: string[], common: Common, ctx: Context): Promise<Report> {
	const [target, ...rest] = positionals;
	if (target === undefined || rest.length > 0) throw new UsageError("probe takes one argument: <provider> or <provider>/<model>");
	const loaded = open(common, ctx);
	const auth = readJsonQuietly(join(namedAgentDir(common.config, ctx.env), "auth.json"));
	const piBin = ctx.env.PI_MODELS_PI_BIN;
	const checks = await runProbe({
		configPath: loaded.path,
		agentDir: namedAgentDir(common.config, ctx.env),
		config: loaded.config,
		auth,
		env: ctx.env,
		target: parseTarget(target),
		...(piBin ? { piBin } : {}),
	});
	const mark = { pass: "✓", fail: "✗", warn: "!", skip: "-" } as const;
	const failed = checks.some((c) => c.status === "fail");
	return {
		lines: [...checks.map((c) => `${mark[c.status]} ${c.name.padEnd(8)} ${c.detail}`), failed ? `${target}: failed` : `${target}: ok (no billed request was sent)`],
		json: { ok: !failed, target, checks },
		exitCode: failed ? 1 : 0,
	};
}

export function undo(values: Values, common: Common, ctx: Context): Report {
	const path = values.settings === true ? settingsPath(common, ctx) : resolveConfigPath(common.config, ctx.env);
	const backups = listBackups(path);
	if (values.list === true) {
		return {
			lines: backups.length === 0 ? ["no backups"] : [...backups].reverse().map((b) => b),
			json: { ok: true, backups: [...backups].reverse() },
		};
	}
	const newest = backups.at(-1);
	if (newest === undefined) throw new FailError(`no backups to restore for ${path}`);
	if (common.dryRun) {
		return { lines: [`would restore ${newest}`, "dry run: nothing written"], json: { ok: true, dryRun: true, wouldRestore: newest } };
	}
	const { restored, removed } = undoLast(path);
	return {
		lines: [removed ? `removed ${path}: it did not exist before the change` : `restored ${path} from ${restored}`],
		json: { ok: true, dryRun: false, restored, removed },
	};
}
