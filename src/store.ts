import {
	chmodSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { FailError } from "./errors.ts";

export const BACKUPS_KEPT = 20;

export type Json = Record<string, unknown>;

/** pi's agent directory: PI_CODING_AGENT_DIR, else ~/.pi/agent. */
export function agentDir(env: NodeJS.ProcessEnv = process.env): string {
	const dir = env.PI_CODING_AGENT_DIR?.trim();
	return dir ? dir : join(homedir(), ".pi", "agent");
}

export function resolveConfigPath(option: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
	const path = option ?? join(agentDir(env), "models.json");
	// A symlinked file is edited where it really lives, so the rename below never replaces the link.
	return existsSync(path) ? realpathSync(path) : path;
}

export interface Loaded {
	path: string;
	/** The file's exact text, including any BOM. Backups hold this. */
	raw: string;
	config: Json;
	eol: "\n" | "\r\n";
	bom: boolean;
	/** True when writing the unchanged config back would give the same text. */
	canonical: boolean;
	/** False for a settings file that does not exist yet; the first write creates it. */
	exists: boolean;
}

export function loadConfig(path: string): Loaded {
	return loadJsonFile(path, { requireProviders: true });
}

/** Load a settings file. A missing file reads as an empty object, and the first write creates it. */
export function loadSettings(path: string): Loaded {
	if (!existsSync(path)) {
		return { path, raw: "", config: {}, eol: "\n", bom: false, canonical: true, exists: false };
	}
	return loadJsonFile(path, { requireProviders: false });
}

function loadJsonFile(path: string, options: { requireProviders: boolean }): Loaded {
	if (!existsSync(path)) throw new FailError(`${path} does not exist`);
	const raw = readFileSync(path, "utf8");
	const bom = raw.startsWith("\uFEFF");
	const body = bom ? raw.slice(1) : raw;
	let config: unknown;
	try {
		config = JSON.parse(body);
	} catch (error) {
		const hint = /\/\/|\/\*|,\s*[}\]]/.test(body)
			? ". It may hold comments or trailing commas, which pi accepts but this tool would drop; remove them or edit the file by hand"
			: "";
		throw new FailError(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}${hint}`);
	}
	if (typeof config !== "object" || config === null || Array.isArray(config)) {
		throw new FailError(`${path} must hold a JSON object`);
	}
	const providers = (config as Json).providers;
	if (options.requireProviders && (typeof providers !== "object" || providers === null || Array.isArray(providers))) {
		throw new FailError(`${path} has no "providers" object`);
	}
	const loaded: Loaded = { path, raw, config: config as Json, eol: body.includes("\r\n") ? "\r\n" : "\n", bom, canonical: true, exists: true };
	loaded.canonical = render(loaded, loaded.config) === raw;
	return loaded;
}

/** Read a JSON file next to models.json, or undefined when it is missing or unreadable. */
export function readJsonQuietly(path: string): Json | undefined {
	try {
		const value: unknown = JSON.parse(readFileSync(path, "utf8"));
		return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : undefined;
	} catch {
		return undefined;
	}
}

/** Serialize with the indent, line endings, BOM and trailing newline of the original text. */
export function render(loaded: Loaded, config: Json): string {
	const body = loaded.bom ? loaded.raw.slice(1) : loaded.raw;
	const indent = /^[ \t]+(?=")/m.exec(body)?.[0] ?? "  ";
	let text = JSON.stringify(config, null, indent);
	if (loaded.eol === "\r\n") text = text.replace(/\n/g, "\r\n");
	if (body.endsWith("\n") || body === "") text += loaded.eol;
	return (loaded.bom ? "\uFEFF" : "") + text;
}

export function backupDir(path: string): string {
	return join(dirname(path), `${basename(path).replace(/\.json$/, "")}.bak`);
}

/** UTC, so names sort in time order across daylight-saving changes. */
function stamp(date: Date): string {
	return date.toISOString().replace(/[-:.]/g, "");
}

export function listBackups(path: string): string[] {
	const dir = backupDir(path);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((f) => f.endsWith(".json"))
		.sort()
		.map((f) => join(dir, f));
}

/** Write a file in one step: a temp file in the same folder, then a rename. */
export function writeAtomic(path: string, text: string): void {
	const temp = join(dirname(path), `.${basename(path)}.tmp-${process.pid}`);
	try {
		writeFileSync(temp, text, { mode: existsSync(path) ? statSync(path).mode & 0o777 : 0o600 });
		if (existsSync(path)) chmodSync(temp, statSync(path).mode & 0o777);
		// Test hook: lets a test kill the process between the two steps of an atomic write.
		if (process.env.PI_MODELS_TEST_CRASH_BEFORE_RENAME === "1") process.kill(process.pid, "SIGKILL");
		renameSync(temp, path);
	} catch (error) {
		if (existsSync(temp)) unlinkSync(temp);
		throw error;
	}
}

export interface Written {
	/** The backup file, or "" when the file did not exist yet. */
	backup: string;
}

/** Save a backup of the current file, then write the new text. Keeps the newest BACKUPS_KEPT backups. */
export function commit(loaded: Loaded, next: Json, now: Date = new Date()): Written {
	const dir = backupDir(loaded.path);
	// Another process may have changed the file since this command read it; never overwrite that change.
	const changed = loaded.exists ? !existsSync(loaded.path) || readFileSync(loaded.path, "utf8") !== loaded.raw : existsSync(loaded.path);
	if (changed) {
		throw new FailError(`${loaded.path} changed while this command ran; nothing was written. Run the command again`);
	}
	if (!loaded.exists) {
		writeAtomic(loaded.path, render(loaded, next));
		return { backup: "" };
	}
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	// A sequence number after the time keeps names unique and sorted when two backups share a millisecond.
	let backup = "";
	for (let n = 0; ; n++) {
		backup = join(dir, `${stamp(now)}-${String(n).padStart(3, "0")}.json`);
		if (!existsSync(backup)) break;
	}
	writeFileSync(backup, loaded.raw, { mode: 0o600 });
	writeAtomic(loaded.path, render(loaded, next));
	for (const old of listBackups(loaded.path).slice(0, -BACKUPS_KEPT)) unlinkSync(old);
	return { backup };
}

/** Restore the newest backup and drop it, so a second undo steps back one more change. */
export function undoLast(path: string): { restored: string } {
	const backups = listBackups(path);
	const newest = backups.at(-1);
	if (newest === undefined) throw new FailError(`no backups to restore in ${backupDir(path)}`);
	writeAtomic(path, readFileSync(newest, "utf8"));
	unlinkSync(newest);
	return { restored: newest };
}
