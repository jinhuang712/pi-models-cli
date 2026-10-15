/**
 * G5: errors a weak model can fix. For each scenario, the model sees the task, the help text, the failed
 * command and the real error, and answers with one corrected command. The command runs on a fresh copy of
 * the fixture and its result is compared with the result of the known-correct command.
 *
 * Usage: node eval/g5/run.ts --agent-dir <pi agent dir with auth.json> [--model openai-codex/gpt-6-luna] [--trials 3] [--help-mode full|main|none]
 *
 * Help modes: full = main help and the help of the failing command; main = main help only; none = no help at all.
 */
import { execFile } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, promisify } from "node:util";
import { HELP, MAIN_HELP } from "../../src/help.ts";
import { main } from "../../src/main.ts";
import { SCENARIOS, type Scenario } from "./scenarios.ts";

const run = promisify(execFile);
const { values } = parseArgs({ options: { "agent-dir": { type: "string" }, model: { type: "string" }, trials: { type: "string" }, thinking: { type: "string" }, "help-mode": { type: "string" } } });
const agentDir = values["agent-dir"];
if (!agentDir) throw new Error("--agent-dir is required");
const model = values.model ?? "openai-codex/gpt-6-luna";
const trials = Number(values.trials ?? 3);
const thinking = values.thinking ?? "medium";
const helpMode = values["help-mode"] ?? "full";
if (!["full", "main", "none"].includes(helpMode)) throw new Error("--help-mode must be full, main or none");
const FIXTURE = new URL("../../test/fixtures/models.json", import.meta.url).pathname;

function sandbox(): { dir: string; env: NodeJS.ProcessEnv } {
	const dir = mkdtempSync(join(tmpdir(), "g5-"));
	copyFileSync(FIXTURE, join(dir, "models.json"));
	writeFileSync(join(dir, "settings.json"), `${JSON.stringify({ theme: "dark" }, null, 2)}\n`);
	return { dir, env: { PI_CODING_AGENT_DIR: dir, PATH: process.env.PATH } };
}

async function exec(args: string[]) {
	const sb = sandbox();
	let out = "";
	let err = "";
	const code = await main(args, sb.env, { out: (t) => (out += t), err: (t) => (err += t) });
	const read = (f: string) => JSON.parse(readFileSync(join(sb.dir, f), "utf8"));
	return { code, out, err, models: read("models.json"), settings: read("settings.json"), sb };
}

/** Split a command line the way a shell would, for quotes only. */
function split(line: string): string[] | undefined {
	const out: string[] = [];
	let cur = "";
	let quote: string | undefined;
	let started = false;
	for (const ch of line) {
		if (quote) {
			if (ch === quote) quote = undefined;
			else cur += ch;
		} else if (ch === '"' || ch === "'") {
			quote = ch;
			started = true;
		} else if (/\s/.test(ch)) {
			if (started || cur !== "") out.push(cur);
			cur = "";
			started = false;
		} else cur += ch;
	}
	if (quote) return undefined;
	if (started || cur !== "") out.push(cur);
	return out;
}

/** The first line that starts with pi-models, with code fences and backticks removed. */
function extractCommand(reply: string): { args?: string[]; why?: string } {
	const line = reply
		.split("\n")
		.map((l) => l.replace(/^\s*[$>]\s*/, "").replace(/^`+|`+$/g, "").trim())
		.find((l) => l.startsWith("pi-models "));
	if (line === undefined) return { why: "no pi-models command in the reply" };
	if (/(&&|\|\||;|\|)/.test(line.replace(/(["']).*?\1/g, ""))) return { why: "more than one command" };
	const tokens = split(line);
	if (!tokens) return { why: "unbalanced quotes" };
	return { args: tokens.slice(1) };
}

function prompt(s: Scenario, failedOutput: string): string {
	const command = s.mistaken[0] as string;
	const help =
		helpMode === "none"
			? []
			: [
					"Its help text:",
					"",
					MAIN_HELP,
					...(helpMode === "full" ? [`The help text of \`pi-models ${command}\`:`, "", HELP[command] ?? "", ""] : []),
				];
	return [
		"You operate the `pi-models` command-line tool, which edits the model configuration of the pi coding agent.",
		"",
		...help,
		`Task: ${s.task}`,
		"",
		"You ran this command, and it failed:",
		"",
		`  pi-models ${s.mistaken.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`,
		"",
		"Its output:",
		"",
		failedOutput
			.trim()
			.split("\n")
			.map((l) => `  ${l}`)
			.join("\n"),
		"",
		"Reply with ONE corrected `pi-models` command on a single line, and nothing else.",
	].join("\n");
}

/** An empty reply is the provider's fault, not the model's: try again, then give up. */
async function ask(text: string): Promise<{ reply: string; ms: number }> {
	let lastError: unknown;
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			return await askOnce(text);
		} catch (error) {
			lastError = error;
		}
	}
	throw lastError;
}

async function askOnce(text: string): Promise<{ reply: string; ms: number }> {
	const started = Date.now();
	const child = execFile(
		"pi",
		["-p", "--no-session", "--no-tools", "--no-extensions", "--no-skills", "--no-context-files", "--no-mcp", "--model", model, "--thinking", thinking, text],
		{ env: { ...process.env, PI_CODING_AGENT_DIR: agentDir }, timeout: 180_000, maxBuffer: 8 * 1024 * 1024, cwd: agentDir },
	);
	child.stdin?.end();
	let stdout = "";
	let stderr = "";
	child.stdout?.on("data", (d) => (stdout += d));
	child.stderr?.on("data", (d) => (stderr += d));
	await new Promise<void>((resolve, reject) => {
		child.on("error", reject);
		child.on("close", () => resolve());
	});
	// An empty reply is a broken run (no login, no quota, a model that does not answer), not a model mistake.
	if (stdout.trim() === "") throw new Error(`the model returned nothing, so this run is invalid. pi said: ${stderr.trim().slice(0, 400) || "(nothing)"}`);
	return { reply: stdout.trim(), ms: Date.now() - started };
}

interface Trial {
	scenario: string;
	trial: number;
	reply: string;
	command?: string[];
	exitCode?: number;
	pass: boolean;
	why: string;
	ms: number;
}

const results: Trial[] = [];
for (const s of SCENARIOS) {
	const failed = await exec(s.mistaken);
	if (failed.code === 0) throw new Error(`scenario ${s.id}: the mistaken command did not fail`);
	const expected = await exec(s.correct);
	if (expected.code !== 0) throw new Error(`scenario ${s.id}: the correct command failed: ${expected.err}`);
	const failedText = failed.err || failed.out;
	for (let t = 1; t <= trials; t++) {
		const { reply, ms } = await ask(prompt(s, failedText));
		const parsed = extractCommand(reply);
		let pass = false;
		let why = parsed.why ?? "";
		let exitCode: number | undefined;
		if (parsed.args) {
			const got = await exec(parsed.args);
			exitCode = got.code;
			if (got.code !== 0) why = `the command failed: ${(got.err || got.out).trim().split("\n")[0]}`;
			else if (JSON.stringify(got.models) !== JSON.stringify(expected.models) || JSON.stringify(got.settings) !== JSON.stringify(expected.settings)) why = "it ran, but the files differ from the correct result";
			else pass = true;
		}
		results.push({ scenario: s.id, trial: t, reply, ...(parsed.args ? { command: parsed.args } : {}), ...(exitCode !== undefined ? { exitCode } : {}), pass, why, ms });
		console.log(`${pass ? "PASS" : "FAIL"} ${s.id} #${t} (${ms} ms)${pass ? "" : `: ${why}`}`);
	}
}

const passed = results.filter((r) => r.pass).length;
const summary = { date: new Date().toISOString().slice(0, 10), model, thinking, helpMode, trialsPerScenario: trials, scenarios: SCENARIOS.length, passed, total: results.length, rate: Number((passed / results.length).toFixed(3)), results };
const dir = join(new URL("./results", import.meta.url).pathname);
mkdirSync(dir, { recursive: true });
const file = join(dir, `${summary.date}-${model.replace(/\//g, "_")}-${helpMode}.json`);
writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`\n${passed}/${results.length} fixed in one retry (${(summary.rate * 100).toFixed(1)}%). Written to ${file}`);
