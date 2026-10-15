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
	raw: string;
	config: Json;
}

export function loadConfig(path: string): Loaded {
	if (!existsSync(path)) throw new FailError(`${path} does not exist`);
	const raw = readFileSync(path, "utf8");
	let config: unknown;
	try {
		config = JSON.parse(raw);
	} catch (error) {
		throw new FailError(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (typeof config !== "object" || config === null || Array.isArray(config)) {
		throw new FailError(`${path} must hold a JSON object`);
	}
	const providers = (config as Json).providers;
	if (typeof providers !== "object" || providers === null || Array.isArray(providers)) {
		throw new FailError(`${path} has no "providers" object`);
	}
	return { path, raw, config: config as Json };
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

/** Serialize with the indent and trailing newline of the original text. */
export function serialize(config: Json, original: string): string {
	const indent = /^[ \t]+(?=")/m.exec(original)?.[0] ?? "  ";
	const text = JSON.stringify(config, null, indent);
	return original.endsWith("\n") || original === "" ? `${text}\n` : text;
}

export function backupDir(path: string): string {
	return join(dirname(path), `${basename(path).replace(/\.json$/, "")}.bak`);
}

function stamp(date: Date): string {
	const p = (n: number, w = 2) => String(n).padStart(w, "0");
	return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}-${p(date.getMilliseconds(), 3)}`;
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
	backup: string;
}

/** Save a backup of the current file, then write the new text. Keeps the newest BACKUPS_KEPT backups. */
export function commit(loaded: Loaded, next: Json, now: Date = new Date()): Written {
	const dir = backupDir(loaded.path);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	let backup = join(dir, `${stamp(now)}.json`);
	for (let n = 1; existsSync(backup); n++) backup = join(dir, `${stamp(now)}-${n}.json`);
	writeFileSync(backup, loaded.raw, { mode: 0o600 });
	writeAtomic(loaded.path, serialize(next, loaded.raw));
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
