import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Entry } from "./fields.ts";
import type { Json } from "./store.ts";

const run = promisify(execFile);

/** Resolve `!command`, `$NAME` / `${NAME}` interpolation or a literal, the way pi reads key values. */
export async function resolveValue(value: string, env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
	if (value.startsWith("!")) {
		try {
			const { stdout } = await run("sh", ["-c", value.slice(1)], { timeout: 15_000, env });
			const out = stdout.trim();
			return out === "" ? undefined : out;
		} catch {
			return undefined;
		}
	}
	let missing = false;
	// `$$` is a literal dollar sign, as in pi.
	const text = value.replace(/\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (all, a: string | undefined, b: string | undefined) => {
		if (all === "$$") return "$";
		const v = env[(a ?? b) as string];
		if (v === undefined || v === "") missing = true;
		return v ?? "";
	});
	return missing || text === "" ? undefined : text;
}

export interface KeyResult {
	key?: string;
	/** Where the key came from, or where we looked and failed. Never holds the key itself. */
	source?: string;
	/** True when a key is configured somewhere, whether or not it resolved. */
	configured: boolean;
}

function kindOf(value: string): string {
	return value.startsWith("!") ? "command" : /\$/.test(value) ? "environment variable" : "literal";
}

/** The key pi would use: a stored api_key in auth.json first, then the provider's apiKey. */
export async function resolveKeyDetailed(provider: Json, name: string, auth: Json | undefined, env: NodeJS.ProcessEnv = process.env): Promise<KeyResult> {
	let configured = false;
	let source: string | undefined;
	const stored = auth?.[name];
	if (typeof stored === "object" && stored !== null) {
		const entry = stored as Json;
		if (entry.type === "api_key" && typeof entry.key === "string") {
			configured = true;
			source = `auth.json (${kindOf(entry.key)})`;
			const key = await resolveValue(entry.key, env);
			if (key !== undefined) return { key, source, configured };
		}
	}
	if (typeof provider.apiKey === "string") {
		configured = true;
		source = `models.json apiKey (${kindOf(provider.apiKey)})`;
		const key = await resolveValue(provider.apiKey, env);
		if (key !== undefined) return { key, source, configured };
	}
	return { ...(source ? { source } : {}), configured };
}

export async function resolveKey(provider: Json, name: string, auth: Json | undefined, env: NodeJS.ProcessEnv = process.env) {
	return (await resolveKeyDetailed(provider, name, auth, env)).key;
}

/**
 * Request headers for the provider's /models endpoint. `withKey: false` sends nothing but `accept`: no key and
 * no provider headers, because a provider header can carry a credential too.
 */
export async function buildHeaders(provider: Json, name: string, auth: Json | undefined, env: NodeJS.ProcessEnv, withKey = true): Promise<Record<string, string>> {
	const headers: Record<string, string> = { accept: "application/json" };
	if (!withKey) return headers;
	const key = await resolveKey(provider, name, auth, env);
	if (key !== undefined) {
		headers.authorization = `Bearer ${key}`;
		if (provider.api === "anthropic-messages") {
			headers["x-api-key"] = key;
			headers["anthropic-version"] = "2023-06-01";
		}
	}
	const extra = provider.headers;
	if (typeof extra === "object" && extra !== null) {
		for (const [k, v] of Object.entries(extra as Entry)) {
			if (typeof v !== "string") continue;
			const resolved = await resolveValue(v, env);
			if (resolved !== undefined) headers[k.toLowerCase()] = resolved;
		}
	}
	return headers;
}

/** Replace every secret in `text` with ***, so an error message never echoes a key. */
export function redact(text: string, headers: Record<string, string>): string {
	let out = text;
	for (const [name, value] of Object.entries(headers)) {
		if (name === "accept" || value.length < 4) continue;
		for (const secret of new Set([value, value.replace(/^Bearer /, "")])) {
			if (secret.length >= 4) out = out.split(secret).join("***");
		}
	}
	return out;
}

/** The name of a header whose value cannot be sent, or undefined. Never returns the value. */
export function invalidHeader(headers: Record<string, string>): string | undefined {
	for (const [name, value] of Object.entries(headers)) {
		if (!/^[\t\x20-\x7e]*$/.test(value)) return name;
	}
	return undefined;
}

/** One GET that never follows a redirect: a redirect could carry the credentials to another host. */
export async function getNoRedirect(url: string, headers: Record<string, string>): Promise<Response> {
	return fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(15_000) });
}

export interface Listed {
	id: string;
	contextWindow?: number;
	maxTokens?: number;
}

const CONTEXT_KEYS = ["context_window", "context_length", "contextWindow", "max_context_length", "max_model_len", "input_token_limit", "max_input_tokens"];
const OUTPUT_KEYS = ["max_output_tokens", "max_completion_tokens", "maxTokens", "max_tokens", "output_token_limit"];

function positiveInt(value: unknown): number | undefined {
	const n = typeof value === "string" ? Number(value) : value;
	return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.trunc(n) : undefined;
}

function firstNumber(item: Json, keys: string[]): number | undefined {
	for (const key of keys) {
		const n = positiveInt(item[key]);
		if (n !== undefined) return n;
	}
	return undefined;
}

export interface ParsedList {
	models: Listed[];
	/** False when the list may be partial (paged, empty, or holding entries we could not read). Never prune from such a list. */
	complete: boolean;
	why?: string;
}

const PAGING_KEYS = ["nextPageToken", "next_page_token", "next_page", "nextPage"];

/** Read the model list out of the common response shapes: {data: [...]}, {models: [...]}, [...]. */
export function parseModelList(payload: unknown): ParsedList | undefined {
	const raw = Array.isArray(payload)
		? payload
		: typeof payload === "object" && payload !== null
			? ((payload as Json).data ?? (payload as Json).models)
			: undefined;
	if (!Array.isArray(raw)) return undefined;
	const byId = new Map<string, Listed>();
	let unreadable = 0;
	for (const item of raw) {
		let listed: Listed | undefined;
		if (typeof item === "string" && item !== "") {
			listed = { id: item };
		} else if (typeof item === "object" && item !== null) {
			const rec = item as Json;
			const id = [rec.id, rec.model, rec.name].find((v): v is string => typeof v === "string" && v !== "");
			if (id !== undefined) {
				const contextWindow = firstNumber(rec, CONTEXT_KEYS);
				const maxTokens = firstNumber(rec, OUTPUT_KEYS);
				listed = { id, ...(contextWindow ? { contextWindow } : {}), ...(maxTokens ? { maxTokens } : {}) };
			}
		}
		if (listed === undefined) unreadable++;
		else if (!byId.has(listed.id)) byId.set(listed.id, listed);
	}
	const models = [...byId.values()];
	const meta = typeof payload === "object" && payload !== null && !Array.isArray(payload) ? (payload as Json) : {};
	const paged = meta.has_more === true || PAGING_KEYS.some((k) => typeof meta[k] === "string" && meta[k] !== "");
	const why = paged
		? "the response is paged and only the first page was read"
		: unreadable > 0
			? `${unreadable} entries had no readable ID`
			: models.length === 0
				? "the endpoint returned no models"
				: undefined;
	return { models, complete: why === undefined, ...(why ? { why } : {}) };
}

export type FetchResult = ({ ok: true; url: string } & ParsedList) | { ok: false; reason: string };

/** GET {baseUrl}/models, then {baseUrl}/v1/models. Never throws. */
export async function fetchModelList(provider: Json, name: string, auth: Json | undefined, env: NodeJS.ProcessEnv = process.env): Promise<FetchResult> {
	const baseUrl = typeof provider.baseUrl === "string" ? provider.baseUrl.replace(/\/+$/, "") : undefined;
	if (baseUrl === undefined) return { ok: false, reason: "no baseUrl" };
	const headers = await buildHeaders(provider, name, auth, env);
	const reasons: string[] = [];
	const bad = invalidHeader(headers);
	if (bad !== undefined) {
		return { ok: false, reason: `the ${bad} header value is not valid in an HTTP header (a key or header value that has line breaks or non-ASCII characters?)` };
	}
	for (const url of [`${baseUrl}/models`, `${baseUrl}/v1/models`]) {
		try {
			const response = await getNoRedirect(url, headers);
			if (response.status >= 300 && response.status < 400) {
				reasons.push(`${url}: HTTP ${response.status} redirect (not followed, so no credentials leave this host)`);
			} else if (response.status === 200) {
				const parsed = parseModelList(await response.json().catch(() => undefined));
				if (parsed !== undefined) return { ok: true, url, ...parsed };
				reasons.push(`${url}: answered 200 but not with a model list`);
			} else {
				reasons.push(`${url}: HTTP ${response.status}`);
			}
		} catch (error) {
			reasons.push(`${url}: ${redact(error instanceof Error ? error.message : String(error), headers)}`);
		}
	}
	return { ok: false, reason: reasons.join("; ") };
}
