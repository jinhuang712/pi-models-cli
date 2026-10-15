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
import { type Json, type Loaded, commit, listBackups, loadConfig, readJsonQuietly, resolveConfigPath, undoLast } from "./store.ts";
import { fetchModelList } from "./sync.ts";
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

export function show(positionals: string[], common: Common, ctx: Context): Report {
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
	const settings = readJsonQuietly(join(dirname(loaded.path), "settings.json"));
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
	const auth = readJsonQuietly(join(dirname(loaded.path), "auth.json"));
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

export function undo(values: Values, common: Common, ctx: Context): Report {
	const path = resolveConfigPath(common.config, ctx.env);
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
	const { restored } = undoLast(path);
	return { lines: [`restored ${path} from ${restored}`], json: { ok: true, dryRun: false, restored } };
}
