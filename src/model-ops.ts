import { FailError, UsageError } from "./errors.ts";
import { type Entry, type Fields, applyFields, describeFields, validateEntry } from "./fields.ts";
import type { Json } from "./store.ts";
import { didYouMean } from "./suggest.ts";

export interface ModelRef {
	provider: string;
	model: string;
}

/** Split `provider/model` at the first slash. Model IDs may hold slashes; provider names do not. */
export function parseRef(text: string): ModelRef {
	const slash = text.indexOf("/");
	if (slash <= 0 || slash === text.length - 1) {
		throw new UsageError(`'${text}' must look like <provider>/<model>, for example opencode-go/glm-5`);
	}
	const model = text.slice(slash + 1);
	if (/[<>]/.test(text)) {
		throw new UsageError(`'${text}' still has <placeholder> text; use a real provider and model, for example opencode-go/glm-5`);
	}
	if (model !== model.trim()) throw new UsageError(`the model ID in '${text}' must not start or end with a space`);
	return { provider: text.slice(0, slash), model };
}

export const refText = (ref: ModelRef) => `${ref.provider}/${ref.model}`;

export interface Change {
	op: "add" | "update" | "remove";
	target: string;
	/** One line for humans. */
	line: string;
}

export interface Outcome {
	config: Json;
	changes: Change[];
	warnings: string[];
}

function providersOf(config: Json): Record<string, Json> {
	return config.providers as Record<string, Json>;
}

function getProvider(config: Json, name: string): Json {
	const providers = providersOf(config);
	const provider = providers[name];
	if (provider === undefined) {
		const names = Object.keys(providers);
		throw new FailError(
			`provider '${name}' is not in models.json${didYouMean(name, names)} (providers: ${names.join(", ")}). pi-models does not add providers; add one by editing the file`,
		);
	}
	if (provider.models !== undefined && !Array.isArray(provider.models)) {
		throw new FailError(`providers.${name}.models is not a list; fix it by hand before using pi-models`);
	}
	return provider;
}

function modelsOf(provider: Json): Entry[] {
	return Array.isArray(provider.models) ? (provider.models as Entry[]) : [];
}

function idsOf(provider: Json): string[] {
	return modelsOf(provider).map((m) => String(m.id));
}

function findModel(provider: Json, providerName: string, id: string): Entry {
	const hit = modelsOf(provider).find((m) => m.id === id);
	if (hit === undefined) {
		throw new FailError(`no model '${id}' in ${providerName}${didYouMean(id, idsOf(provider))}`);
	}
	return hit;
}

function check(entry: Entry, label: string): void {
	const problems = validateEntry(entry);
	if (problems.length > 0) throw new FailError(`${label}: ${problems.join("; ")}`);
}

function withModels(config: Json, name: string, models: Entry[]): Json {
	return { ...config, providers: { ...providersOf(config), [name]: { ...getProvider(config, name), models } } };
}

const KEPT_OUT_OF_COPY = new Set(["id", "name"]);

/** Entry for a new model. A copy keeps every field except id and name; the name falls back to the new id. */
export function buildEntry(provider: Json, providerName: string, id: string, fields: Fields, copyFrom?: string): Entry {
	let entry: Entry = { id };
	if (copyFrom !== undefined) {
		const source = findModel(provider, providerName, copyFrom);
		const kept = Object.fromEntries(Object.entries(structuredClone(source)).filter(([k]) => !KEPT_OUT_OF_COPY.has(k)));
		entry = { id, name: id, ...kept };
	}
	return applyFields(entry, fields);
}

export function addModel(config: Json, ref: ModelRef, fields: Fields, copyFrom?: string): Outcome {
	const provider = getProvider(config, ref.provider);
	if (idsOf(provider).includes(ref.model)) {
		throw new FailError(`${refText(ref)} already exists; use update to change it`);
	}
	const entry = buildEntry(provider, ref.provider, ref.model, fields, copyFrom);
	check(entry, refText(ref));
	const notes = describeFields(fields);
	if (copyFrom !== undefined) {
		const copied = Object.keys(entry).filter((k) => k !== "id" && k !== "name" && !(k in fields));
		notes.push(`copied from ${copyFrom}${copied.length > 0 ? ` (${copied.join(", ")})` : ""}`);
	}
	return {
		config: withModels(config, ref.provider, [...modelsOf(provider), entry]),
		changes: [{ op: "add", target: refText(ref), line: `+ ${refText(ref)}${notes.length > 0 ? `  ${notes.join(", ")}` : ""}` }],
		warnings: [],
	};
}

export const UNSETTABLE_NOT_ALLOWED = new Set(["id"]);

export function updateModel(config: Json, ref: ModelRef, fields: Fields, unset: string[]): Outcome {
	const provider = getProvider(config, ref.provider);
	const current = findModel(provider, ref.provider, ref.model);
	for (const key of unset) {
		if (UNSETTABLE_NOT_ALLOWED.has(key)) throw new UsageError(`--unset ${key} is not allowed: a model needs its ${key}`);
		if (key.includes(".")) {
			throw new UsageError(`--unset takes a top-level field, got '${key}'. To change one cost rate, use --cost.<rate>; to remove all of cost, use --unset cost`);
		}
	}
	const absent = unset.filter((key) => !(key in current));
	let entry = applyFields(current, fields);
	const unsetDone: string[] = [];
	for (const key of unset) {
		if (key in entry) {
			const { [key]: _removed, ...rest } = entry;
			entry = rest;
			unsetDone.push(key);
		}
	}
	check(entry, refText(ref));
	const diffs: string[] = [];
	for (const key of new Set([...Object.keys(current), ...Object.keys(entry)])) {
		const before = JSON.stringify(current[key]);
		const after = JSON.stringify(entry[key]);
		if (before === after) continue;
		diffs.push(
			unsetDone.includes(key) ? `unset ${key}` : before === undefined ? `${key}: ${after}` : `${key}: ${before} → ${after}`,
		);
	}
	const models = modelsOf(provider).map((m) => (m === current ? entry : m));
	const line = diffs.length === 0 ? `= ${refText(ref)}  no change` : `~ ${refText(ref)}  ${diffs.join(", ")}`;
	const warnings = absent.map((key) => `${refText(ref)} has no field '${key}' to unset`);
	if (diffs.length === 0) warnings.push(line.slice(2));
	return {
		config: withModels(config, ref.provider, models),
		changes: diffs.length === 0 ? [] : [{ op: "update", target: refText(ref), line }],
		warnings,
	};
}

export function removeModels(config: Json, refs: ModelRef[]): Outcome {
	let next = config;
	const changes: Change[] = [];
	const warnings: string[] = [];
	for (const ref of refs) {
		const provider = getProvider(next, ref.provider);
		if (!idsOf(provider).includes(ref.model)) {
			warnings.push(`skipped ${refText(ref)}: no such model${didYouMean(ref.model, idsOf(provider))}`);
			continue;
		}
		next = withModels(
			next,
			ref.provider,
			modelsOf(provider).filter((m) => m.id !== ref.model),
		);
		changes.push({ op: "remove", target: refText(ref), line: `- ${refText(ref)}` });
	}
	return { config: next, changes, warnings };
}

/** Where settings.json still points at a model. Reads only. */
export function settingsReferences(settings: Json | undefined, ref: ModelRef): string[] {
	if (settings === undefined) return [];
	const full = refText(ref);
	const found: string[] = [];
	if (settings.defaultModel === ref.model && (settings.defaultProvider === ref.provider || settings.defaultProvider === undefined)) {
		found.push("defaultModel");
	} else if (settings.defaultModel === full) {
		found.push("defaultModel");
	}
	// A pattern can end in :<level>, as in provider/model:high.
	const bare = (p: unknown) => (typeof p === "string" ? p.replace(/:(off|minimal|low|medium|high|xhigh|max)$/, "") : p);
	if (Array.isArray(settings.enabledModels) && settings.enabledModels.some((p) => bare(p) === full || bare(p) === ref.model)) {
		found.push("enabledModels");
	}
	const levels = settings.modelThinkingLevels;
	if (typeof levels === "object" && levels !== null && full in levels) found.push("modelThinkingLevels");
	return found;
}

export interface ProviderSummary {
	name: string;
	models: number;
	api?: string;
	baseUrl?: string;
}

export function summarize(config: Json): ProviderSummary[] {
	return Object.entries(providersOf(config)).map(([name, p]) => ({
		name,
		models: Array.isArray(p.models) ? p.models.length : 0,
		...(typeof p.api === "string" ? { api: p.api } : {}),
		...(typeof p.baseUrl === "string" ? { baseUrl: p.baseUrl } : {}),
	}));
}

export function modelIds(config: Json, providerName: string): string[] {
	return idsOf(getProvider(config, providerName));
}

export function modelEntry(config: Json, ref: ModelRef): Entry {
	return findModel(getProvider(config, ref.provider), ref.provider, ref.model);
}

export { getProvider, modelsOf, withModels };
