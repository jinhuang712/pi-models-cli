import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/main.ts";

export const FIXTURE = new URL("./fixtures/models.json", import.meta.url).pathname;

export interface Sandbox {
	dir: string;
	models: string;
	env: NodeJS.ProcessEnv;
}

/** A temp agent directory holding a copy of the fixture (or the given text). */
export function sandbox(text?: string): Sandbox {
	const dir = mkdtempSync(join(tmpdir(), "pi-models-test-"));
	const models = join(dir, "models.json");
	if (text === undefined) copyFileSync(FIXTURE, models);
	else writeFileSync(models, text);
	return { dir, models, env: { PI_CODING_AGENT_DIR: dir, PATH: process.env.PATH } };
}

export function write(sb: Sandbox, name: string, value: unknown): void {
	mkdirSync(sb.dir, { recursive: true });
	writeFileSync(join(sb.dir, name), typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

export function read(path: string): string {
	return readFileSync(path, "utf8");
}

export function readJson(path: string): any {
	return JSON.parse(read(path));
}

export interface Run {
	code: number;
	out: string;
	err: string;
}

export async function cli(sb: Sandbox, ...args: string[]): Promise<Run> {
	let out = "";
	let err = "";
	const code = await main(args, sb.env, { out: (t) => (out += t), err: (t) => (err += t) });
	return { code, out, err };
}
