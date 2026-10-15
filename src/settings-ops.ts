import { UsageError } from "./errors.ts";
import { type ModelRef, type Outcome, modelIds, refText } from "./model-ops.ts";
import type { Json } from "./store.ts";
import { closest, didYouMean } from "./suggest.ts";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export const BUDGET_LEVELS = ["minimal", "low", "medium", "high"] as const;

export function checkLevel(text: string, flag = "thinking level"): string {
	if (!(THINKING_LEVELS as readonly string[]).includes(text)) {
		throw new UsageError(`${flag} must be one of ${THINKING_LEVELS.join(", ")}, got '${text}'${didYouMean(text, THINKING_LEVELS)}`);
	}
	return text;
}

const q = (v: unknown) => JSON.stringify(v);

function outcome(settings: Json, lines: string[], warnings: string[] = []): Outcome {
	return {
		config: settings,
		changes: lines.map((line) => ({ op: "update" as const, target: line.slice(2).split(":")[0] as string, line })),
		warnings,
	};
}

/** Is the model in models.json? A model can also come from pi's built-in catalog, so false only warns. */
function knownModel(models: Json | undefined, ref: ModelRef): boolean {
	const providers = models?.providers as Record<string, Json> | undefined;
	const provider = providers?.[ref.provider];
	if (provider === undefined || !Array.isArray(provider.models)) return false;
	return modelIds(models as Json, ref.provider).includes(ref.model);
}

function unknownWarning(models: Json | undefined, ref: ModelRef): string[] {
	if (models === undefined || knownModel(models, ref)) return [];
	const providers = models.providers as Record<string, Json>;
	const hint = providers[ref.provider] && Array.isArray(providers[ref.provider]?.models) ? didYouMean(ref.model, modelIds(models, ref.provider)) : "";
	return [`${refText(ref)} is not in models.json${hint}; fine if it is a built-in pi model`];
}

export function enableModels(settings: Json, patterns: string[]): Outcome {
	const current = Array.isArray(settings.enabledModels) ? (settings.enabledModels as string[]) : undefined;
	const next = [...(current ?? [])];
	const lines: string[] = [];
	const warnings: string[] = [];
	for (const pattern of patterns) {
		if (next.includes(pattern)) {
			warnings.push(`${pattern} is already in enabledModels`);
			continue;
		}
		next.push(pattern);
		lines.push(`+ enabledModels: ${pattern}`);
	}
	if (lines.length > 0 && current === undefined) {
		warnings.push(`enabledModels was not set, so pi offered every model; it now holds only: ${next.join(", ")}. Run \`pi-models disable --all\` to offer every model again`);
	}
	return outcome(lines.length > 0 ? { ...settings, enabledModels: next } : settings, lines, warnings);
}

export function disableModels(settings: Json, patterns: string[], all: boolean): Outcome {
	const current = Array.isArray(settings.enabledModels) ? (settings.enabledModels as string[]) : undefined;
	if (all) {
		if (current === undefined) return outcome(settings, [], ["enabledModels is not set; pi already offers every model"]);
		const { enabledModels: _removed, ...rest } = settings;
		return outcome(rest, ["- enabledModels: all patterns removed; pi offers every model"]);
	}
	if (current === undefined) {
		return outcome(settings, [], ["enabledModels is not set; there is nothing to disable"]);
	}
	const lines: string[] = [];
	const warnings: string[] = [];
	let next = [...current];
	for (const pattern of patterns) {
		if (!next.includes(pattern)) {
			const near = closest(pattern, next);
			warnings.push(`${pattern} is not in enabledModels${near ? `; did you mean ${near}?` : ""}`);
			continue;
		}
		next = next.filter((p) => p !== pattern);
		lines.push(`- enabledModels: ${pattern}`);
	}
	if (lines.length === 0) return outcome(settings, [], warnings);
	if (next.length === 0) {
		const { enabledModels: _removed, ...rest } = settings;
		lines.push("- enabledModels: now empty, so the setting was removed and pi offers every model");
		return outcome(rest, lines, warnings);
	}
	return outcome({ ...settings, enabledModels: next }, lines, warnings);
}

export function setDefault(settings: Json, ref: ModelRef | undefined, thinking: string | undefined, models: Json | undefined): Outcome {
	const next: Json = { ...settings };
	const lines: string[] = [];
	const set = (key: string, value: string) => {
		if (next[key] === value) return;
		lines.push(`~ ${key}: ${next[key] === undefined ? "unset" : q(next[key])} → ${q(value)}`);
		next[key] = value;
	};
	if (ref !== undefined) {
		set("defaultProvider", ref.provider);
		set("defaultModel", ref.model);
	}
	if (thinking !== undefined) set("defaultThinkingLevel", thinking);
	const warnings = ref ? unknownWarning(models, ref) : [];
	if (lines.length === 0) warnings.push("nothing to change: the defaults already have these values");
	return outcome(lines.length > 0 ? next : settings, lines, warnings);
}

export function setModelThinking(settings: Json, ref: ModelRef, level: string | undefined, models: Json | undefined): Outcome {
	const key = refText(ref);
	const levels = typeof settings.modelThinkingLevels === "object" && settings.modelThinkingLevels !== null ? { ...(settings.modelThinkingLevels as Json) } : {};
	if (level === undefined) {
		if (!(key in levels)) return outcome(settings, [], [`${key} has no thinking level set`]);
		delete levels[key];
		const { modelThinkingLevels: _removed, ...rest } = settings;
		return outcome(Object.keys(levels).length > 0 ? { ...settings, modelThinkingLevels: levels } : rest, [`- modelThinkingLevels.${key}`]);
	}
	if (levels[key] === level) return outcome(settings, [], [`${key} already has thinking level ${level}`, ...unknownWarning(models, ref)]);
	const before = levels[key];
	levels[key] = level;
	return outcome({ ...settings, modelThinkingLevels: levels }, [`~ modelThinkingLevels.${key}: ${before === undefined ? "unset" : q(before)} → ${q(level)}`], unknownWarning(models, ref));
}

export function setBudgets(settings: Json, values: Record<string, number>, unset: string[]): Outcome {
	const budgets = typeof settings.thinkingBudgets === "object" && settings.thinkingBudgets !== null ? { ...(settings.thinkingBudgets as Json) } : {};
	const lines: string[] = [];
	const warnings: string[] = [];
	for (const [level, value] of Object.entries(values)) {
		if (budgets[level] === value) continue;
		lines.push(`~ thinkingBudgets.${level}: ${budgets[level] === undefined ? "unset" : q(budgets[level])} → ${value}`);
		budgets[level] = value;
	}
	for (const level of unset) {
		if (!(level in budgets)) {
			warnings.push(`thinkingBudgets.${level} is not set`);
			continue;
		}
		delete budgets[level];
		lines.push(`- thinkingBudgets.${level}`);
	}
	if (lines.length === 0) return outcome(settings, [], [...warnings, ...(warnings.length === 0 ? ["nothing to change"] : [])]);
	if (Object.keys(budgets).length === 0) {
		const { thinkingBudgets: _removed, ...rest } = settings;
		return outcome(rest, lines, warnings);
	}
	return outcome({ ...settings, thinkingBudgets: budgets }, lines, warnings);
}

/** The model-selection keys of a settings file, for `show --settings`. */
export function selectionOf(settings: Json): Json {
	const keys = ["defaultProvider", "defaultModel", "defaultThinkingLevel", "modelThinkingLevels", "thinkingBudgets", "enabledModels"];
	return Object.fromEntries(keys.filter((k) => settings[k] !== undefined).map((k) => [k, settings[k]]));
}
