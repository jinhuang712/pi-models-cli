import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { type Entry, validateEntry } from "./fields.ts";
import type { ModelRef } from "./model-ops.ts";
import { getProvider, modelsOf } from "./model-ops.ts";
import { type Json, readJsonQuietly } from "./store.ts";
import { didYouMean } from "./suggest.ts";
import { type ParsedList, buildHeaders, getNoRedirect, invalidHeader, parseModelList, redact, resolveKeyDetailed } from "./sync.ts";

const run = promisify(execFile);

export type Status = "pass" | "fail" | "warn" | "skip";

export interface Check {
	name: string;
	status: Status;
	detail: string;
}

/** The api values pi ships with. A different value can still work through an extension, so it only warns. */
export const PI_APIS = [
	"openai-completions",
	"mistral-conversations",
	"openai-responses",
	"azure-openai-responses",
	"openai-codex-responses",
	"anthropic-messages",
	"bedrock-converse-stream",
	"google-generative-ai",
	"google-vertex",
	"pi-messages",
];

interface PiRow {
	provider: string;
	model: string;
	context: string;
	maxOut: string;
	thinking: string;
	images: string;
}

interface PiLoad {
	available: boolean;
	errors: string[];
	rows: PiRow[];
}

/**
 * Ask pi itself to load models.json. `pi --list-models` sends no model request.
 * pi runs in a throwaway agent directory, so it cannot write into yours: it creates files such as
 * auth.json and models-store.json where it runs. Only API keys are copied there, never OAuth
 * credentials, so pi has nothing to refresh over the network.
 */
async function askPi(configPath: string, agentDir: string, env: NodeJS.ProcessEnv, piBin: string): Promise<PiLoad> {
	const temp = mkdtempSync(join(tmpdir(), "pi-models-probe-"));
	try {
		copyFileSync(configPath, join(temp, "models.json"));
		const authPath = join(agentDir, "auth.json");
		const auth = readJsonQuietly(authPath);
		if (auth !== undefined) {
			const keysOnly = Object.fromEntries(Object.entries(auth).filter(([, v]) => typeof v === "object" && v !== null && (v as Json).type === "api_key"));
			writeFileSync(join(temp, "auth.json"), JSON.stringify(keysOnly), { mode: 0o600 });
		}
		if (existsSync(join(agentDir, "models-store.json"))) copyFileSync(join(agentDir, "models-store.json"), join(temp, "models-store.json"));
		const { stdout, stderr } = await run(piBin, ["--list-models"], {
			env: { ...env, PI_CODING_AGENT_DIR: temp },
			cwd: temp,
			timeout: 60_000,
			maxBuffer: 32 * 1024 * 1024,
		}).catch((error: NodeJS.ErrnoException & { stdout?: string; stderr?: string }) => {
			if (error.code === "ENOENT") throw error;
			return { stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
		});
		const text = `${stderr}\n${stdout}`;
		const errors: string[] = [];
		const block = /errors loading models\.json:\s*([\s\S]*?)(?:\n\s*\n|File:|$)/.exec(text)?.[1];
		if (block) errors.push(...block.split("\n").map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("Invalid models.json")));
		const rows: PiRow[] = [];
		for (const line of stdout.split("\n")) {
			const cols = line.trim().split(/\s{2,}/);
			if (cols.length >= 6 && cols[0] !== "provider") {
				rows.push({ provider: cols[0] as string, model: cols[1] as string, context: cols[2] as string, maxOut: cols[3] as string, thinking: cols[4] as string, images: cols[5] as string });
			}
		}
		return { available: true, errors, rows };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { available: false, errors: [], rows: [] };
		throw error;
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
}

interface Attempt {
	url: string;
	status?: number;
	error?: string;
	parsed?: ParsedList;
}

async function getModels(baseUrl: string, headers: Record<string, string>): Promise<Attempt[]> {
	const attempts: Attempt[] = [];
	for (const url of [`${baseUrl}/models`, `${baseUrl}/v1/models`]) {
		try {
			const response = await getNoRedirect(url, headers);
			const attempt: Attempt = { url, status: response.status };
			if (response.status >= 300 && response.status < 400) attempt.error = `HTTP ${response.status} redirect, not followed so no credentials leave this host`;
			if (response.status === 200) {
				const parsed = parseModelList(await response.json().catch(() => undefined));
				if (parsed) attempt.parsed = parsed;
			}
			attempts.push(attempt);
			if (attempt.parsed) break;
		} catch (error) {
			const text = error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error);
			attempts.push({ url, error: redact(text, headers) });
		}
	}
	return attempts;
}

export interface ProbeOptions {
	configPath: string;
	/** The folder holding models.json as the user named it (not where a symlink points). */
	agentDir: string;
	config: Json;
	auth: Json | undefined;
	env: NodeJS.ProcessEnv;
	target: { provider: string; model?: string };
	/** The pi executable. Tests substitute a stand-in. */
	piBin?: string;
}

/**
 * Check that a provider's entry will work, without sending a billed request.
 * Every request is a GET of the model list. Stops at the first failure that makes later checks meaningless.
 */
export async function probe(options: ProbeOptions): Promise<Check[]> {
	const { config, auth, env, target } = options;
	const provider = getProvider(config, target.provider);
	const models = modelsOf(provider);
	let probed: Entry[] = models;
	if (target.model !== undefined) {
		const hit = models.find((m) => m.id === target.model);
		if (hit === undefined) {
			throw new (await import("./errors.ts")).FailError(
				`no model '${target.model}' in ${target.provider}${didYouMean(target.model, models.map((m) => String(m.id)))}`,
			);
		}
		probed = [hit];
	}
	const checks: Check[] = [];
	const add = (name: string, status: Status, detail: string) => checks.push({ name, status, detail });
	const stop = () => checks.some((c) => c.status === "fail");

	// 1. Entry: pi's own loader, else our own rules.
	const problems = probed.flatMap((m) => validateEntry(m).map((p) => `${target.provider}/${String(m.id)}: ${p}`));
	const loaded = await askPi(options.configPath, options.agentDir, env, options.piBin ?? "pi");
	if (problems.length > 0) {
		add("entry", "fail", problems.join("; "));
	} else if (!loaded.available) {
		add("entry", "warn", "pi was not found on PATH; checked the entry with this tool's own rules only");
	} else if (loaded.errors.length > 0) {
		add("entry", "fail", `pi rejects models.json: ${loaded.errors.join("; ")}`);
	} else {
		const rows = loaded.rows.filter((r) => r.provider === target.provider && (target.model === undefined || r.model === target.model));
		if (target.model === undefined) {
			const ids = new Set(rows.map((r) => r.model));
			const listed = models.filter((m) => ids.has(String(m.id))).length;
			add(
				"entry",
				listed === models.length ? "pass" : "warn",
				`pi loads models.json and lists ${listed} of the ${models.length} models in the file for ${target.provider}${listed === models.length ? "" : "; pi lists a model only when its provider has usable credentials"}`,
			);
		} else if (rows[0]) {
			const r = rows[0];
			add("entry", "pass", `pi loads it: context ${r.context}, max output ${r.maxOut}, thinking ${r.thinking}, images ${r.images}`);
		} else {
			add("entry", "warn", "pi loads models.json but does not list this model; pi lists a model only when its provider has usable credentials");
		}
	}
	if (typeof provider.api === "string" && !PI_APIS.includes(provider.api)) {
		add("api", "warn", `api '${provider.api}' is not one pi ships with (${PI_APIS.join(", ")}); this works only if an extension provides it`);
	}
	if (stop()) return checks;

	// 2. Key.
	const key = await resolveKeyDetailed(provider, target.provider, auth, env);
	if (key.key !== undefined) add("key", "pass", `a key resolves from ${key.source}`);
	else if (key.configured) add("key", "fail", `a key is configured in ${key.source} but does not resolve (variable not set, or the command failed or printed nothing)`);
	else add("key", "warn", "no key is configured; this is fine only for an endpoint that needs none");
	if (stop()) return checks;

	// 3 and 4. Endpoint.
	const baseUrl = typeof provider.baseUrl === "string" ? provider.baseUrl.replace(/\/+$/, "") : undefined;
	if (baseUrl === undefined) {
		add("endpoint", "skip", "the provider has no baseUrl, so pi uses a built-in endpoint; nothing to check here");
		return checks;
	}
	const headers = await buildHeaders(provider, target.provider, auth, env, true);
	const badHeader = invalidHeader(headers);
	if (badHeader !== undefined) {
		add("endpoint", "fail", `the ${badHeader} header value cannot be sent: it has line breaks or non-ASCII characters (a !command that prints more than the key?)`);
		return checks;
	}
	const attempts = await getModels(baseUrl, headers);
	const answered = attempts.filter((a) => a.status !== undefined && !(a.status >= 300 && a.status < 400));
	if (answered.length === 0 && attempts.some((a) => a.status !== undefined)) {
		add("endpoint", "fail", `the endpoint redirects instead of answering (${attempts.map((a) => a.error ?? `HTTP ${a.status}`).join("; ")}); set baseUrl to the final address`);
		return checks;
	}
	if (answered.length === 0) {
		add("endpoint", "fail", `${baseUrl} did not answer: ${attempts.map((a) => a.error).join("; ")}`);
		return checks;
	}
	const good = attempts.find((a) => a.parsed);
	const denied = answered.find((a) => a.status === 401 || a.status === 403);
	if (!good && denied) {
		add("endpoint", "pass", `${baseUrl} answers`);
		add("models", "fail", `${denied.url} answered HTTP ${denied.status}: the key is rejected${key.key === undefined ? " (no key was sent)" : ""}`);
		return checks;
	}
	if (!good) {
		add("endpoint", "pass", `${baseUrl} answers`);
		add("models", "skip", `no model list to compare with (${answered.map((a) => `${a.url}: HTTP ${a.status}`).join("; ")}); the provider may not offer one. Entry, key and host were checked`);
		return checks;
	}
	add("endpoint", "pass", `${good.url} answers HTTP 200 with a model list`);
	if (key.key !== undefined) {
		const bare = await getModels(baseUrl, await buildHeaders(provider, target.provider, auth, env, false));
		if (bare.find((a) => a.parsed)) {
			add("key", "warn", "the endpoint lists models with no credentials at all, so a 200 does not prove the key works");
		}
	}

	// 5. Model presence.
	const list = good.parsed as ParsedList;
	const served = new Set(list.models.map((m) => m.id));
	const partial = list.complete ? "" : ` (the list may be partial: ${list.why})`;
	if (target.model !== undefined) {
		if (served.has(target.model)) add("model", "pass", `the endpoint lists ${target.model}`);
		else add("model", list.complete ? "fail" : "warn", `the endpoint does not list '${target.model}'${didYouMean(target.model, [...served])}${partial}`);
	} else {
		const missing = models.map((m) => String(m.id)).filter((id) => !served.has(id));
		if (missing.length === 0) add("model", "pass", `the endpoint lists all ${models.length} models in the file`);
		else {
			const shown = missing.slice(0, 10).join(", ") + (missing.length > 10 ? `, and ${missing.length - 10} more` : "");
			add("model", "warn", `${missing.length} of ${models.length} models in the file are not listed by the endpoint: ${shown}${partial}`);
		}
	}
	return checks;
}

export function parseTarget(ref: ModelRef | string): { provider: string; model?: string } {
	if (typeof ref !== "string") return ref;
	const slash = ref.indexOf("/");
	return slash === -1 ? { provider: ref } : { provider: ref.slice(0, slash), model: ref.slice(slash + 1) };
}
