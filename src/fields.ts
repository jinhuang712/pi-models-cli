import { UsageError } from "./errors.ts";

export const INPUT_TYPES = ["text", "image"] as const;
export const COST_KEYS = ["input", "output", "cacheRead", "cacheWrite"] as const;

type CostKey = (typeof COST_KEYS)[number];

/** Fields a command can set on a model. Names match models.json. */
export interface Fields {
	name?: string;
	contextWindow?: number;
	maxTokens?: number;
	reasoning?: boolean;
	input?: string[];
	cost?: Partial<Record<CostKey, number>>;
}

export type Entry = Record<string, unknown>;

/** The flags every field-setting command accepts, in parseArgs format. */
export const FIELD_OPTIONS = {
	name: { type: "string" },
	contextWindow: { type: "string" },
	maxTokens: { type: "string" },
	reasoning: { type: "boolean" },
	"no-reasoning": { type: "boolean" },
	input: { type: "string" },
	"cost.input": { type: "string" },
	"cost.output": { type: "string" },
	"cost.cacheRead": { type: "string" },
	"cost.cacheWrite": { type: "string" },
} as const;

type RawValues = Record<string, string | boolean | (string | boolean)[] | undefined>;

function str(values: RawValues, key: string): string | undefined {
	const value = values[key];
	return typeof value === "string" ? value : undefined;
}

function number(flag: string, text: string, min: "positive" | "nonnegative"): number {
	// Plain decimal digits only: no hex, exponent, sign or spaces. Token counts are whole numbers.
	const pattern = min === "positive" ? /^\d+$/ : /^\d+(\.\d+)?$/;
	const value = Number(text);
	const ok = pattern.test(text) && Number.isFinite(value) && (min === "positive" ? value > 0 : value >= 0);
	if (!ok) {
		const what = min === "positive" ? "a whole number greater than 0" : "a number of 0 or more, such as 0.4";
		throw new UsageError(`--${flag} must be ${what}, got '${text}'${/[km]$/i.test(text) ? "; write the full number, for example 1000000" : ""}`);
	}
	return value;
}

/** Read the field flags of a command into typed fields. Throws UsageError on a bad value. */
export function parseFields(values: RawValues): Fields {
	const fields: Fields = {};
	const name = str(values, "name");
	if (name !== undefined) {
		if (name.trim() === "") throw new UsageError("--name must not be empty");
		fields.name = name;
	}
	const contextWindow = str(values, "contextWindow");
	if (contextWindow !== undefined) fields.contextWindow = number("contextWindow", contextWindow, "positive");
	const maxTokens = str(values, "maxTokens");
	if (maxTokens !== undefined) fields.maxTokens = number("maxTokens", maxTokens, "positive");
	if (values.reasoning === true && values["no-reasoning"] === true) {
		throw new UsageError("pass either --reasoning or --no-reasoning, not both");
	}
	if (values.reasoning === true) fields.reasoning = true;
	if (values["no-reasoning"] === true) fields.reasoning = false;
	const input = str(values, "input");
	if (input !== undefined) {
		const list = input.split(",").map((s) => s.trim());
		const bad = list.find((s) => !(INPUT_TYPES as readonly string[]).includes(s));
		if (bad !== undefined || list.length === 0) {
			throw new UsageError(`--input takes a comma-separated list of ${INPUT_TYPES.join(", ")}, got '${input}'`);
		}
		fields.input = list;
	}
	for (const key of COST_KEYS) {
		const text = str(values, `cost.${key}`);
		if (text !== undefined) (fields.cost ??= {})[key] = number(`cost.${key}`, text, "nonnegative");
	}
	return fields;
}

export function hasFields(fields: Fields): boolean {
	return Object.keys(fields).length > 0;
}

/** Describe each set field as `key=value`, for output lines. */
export function describeFields(fields: Fields): string[] {
	const parts: string[] = [];
	for (const [key, value] of Object.entries(fields)) {
		if (key === "cost") {
			for (const [k, v] of Object.entries(value as object)) parts.push(`cost.${k}=${v}`);
		} else {
			parts.push(`${key}=${Array.isArray(value) ? value.join(",") : String(value)}`);
		}
	}
	return parts;
}

/** Merge fields into an entry. cost merges per rate, so one rate can change alone. */
export function applyFields(entry: Entry, fields: Fields): Entry {
	const out: Entry = { ...entry };
	const { cost, ...rest } = fields;
	Object.assign(out, rest);
	if (cost !== undefined) {
		const existing = typeof entry.cost === "object" && entry.cost !== null ? (entry.cost as Entry) : {};
		out.cost = { ...existing, ...cost };
	}
	return out;
}

const isPositive = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;

/**
 * Check an entry against the rules pi applies to a `models` entry in models.json.
 * Returns problems; an empty list means the entry is valid.
 */
export function validateEntry(entry: Entry): string[] {
	const problems: string[] = [];
	if (typeof entry.id !== "string" || entry.id === "") problems.push("id must be a non-empty string");
	if (entry.name !== undefined && (typeof entry.name !== "string" || entry.name === "")) {
		problems.push("name must be a non-empty string");
	}
	if (entry.reasoning !== undefined && typeof entry.reasoning !== "boolean") problems.push("reasoning must be true or false");
	if (entry.input !== undefined) {
		const ok = Array.isArray(entry.input) && entry.input.every((v) => (INPUT_TYPES as readonly string[]).includes(v as string));
		if (!ok) problems.push(`input must be a list of ${INPUT_TYPES.join(", ")}`);
	}
	for (const key of ["contextWindow", "maxTokens"] as const) {
		if (entry[key] !== undefined && !isPositive(entry[key])) problems.push(`${key} must be a positive number`);
	}
	if (entry.cost !== undefined) {
		const cost = entry.cost;
		if (typeof cost !== "object" || cost === null || Array.isArray(cost)) {
			problems.push("cost must be an object");
		} else {
			const missing = COST_KEYS.filter((k) => (cost as Entry)[k] === undefined);
			if (missing.length > 0) {
				problems.push(
					`cost needs all of ${COST_KEYS.join(", ")} (missing: ${missing.join(", ")}); pass them with ${missing.map((k) => `--cost.${k}`).join(" ")}`,
				);
			}
			for (const k of COST_KEYS) {
				const v = (cost as Entry)[k];
				if (v !== undefined && !(typeof v === "number" && Number.isFinite(v) && v >= 0)) {
					problems.push(`cost.${k} must be a number of 0 or more`);
				}
			}
		}
	}
	return problems;
}
