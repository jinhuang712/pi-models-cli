/**
 * Agentic check: a real agent session gets a release-day task and tools, in a sandbox copy of the fixture.
 * Conditions: `plain` has no pi-models CLI and no skill (editing the JSON by hand, as before this project);
 * `skill` has the CLI on PATH and the pi-models skill.
 *
 * Usage: node eval/agentic/run.ts --agent-dir <folder with auth.json> --model <provider/model> [--trials 2] [--conditions plain,skill]
 */
import { execFile } from "node:child_process";
import { chmodSync, cpSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { TASKS } from "./tasks.ts";

const { values } = parseArgs({ options: { "agent-dir": { type: "string" }, model: { type: "string" }, trials: { type: "string" }, conditions: { type: "string" }, thinking: { type: "string" }, tasks: { type: "string" } } });
const authDir = values["agent-dir"];
if (!authDir) throw new Error("--agent-dir is required");
const model = values.model ?? "openai-codex/gpt-6-luna";
const trials = Number(values.trials ?? 2);
const thinking = values.thinking ?? "medium";
const conditions = (values.conditions ?? "plain,skill").split(",");
const only = values.tasks?.split(",");
const repo = new URL("../../", import.meta.url).pathname;
const FIXTURE = join(repo, "test/fixtures/models.json");

interface Run {
	task: string;
	condition: string;
	trial: number;
	success: boolean;
	problem?: string;
	toolCalls: number;
	commands: string[];
	touchedConfigFiles: boolean;
	tokens: number;
	costUsd: number;
	seconds: number;
}

function setup(condition: string) {
	const dir = mkdtempSync(join(tmpdir(), "agentic-"));
	copyFileSync(FIXTURE, join(dir, "models.json"));
	writeFileSync(join(dir, "settings.json"), `${JSON.stringify({ theme: "dark" }, null, 2)}\n`);
	copyFileSync(join(authDir as string, "auth.json"), join(dir, "auth.json"));
	chmodSync(join(dir, "auth.json"), 0o600);
	const bin = join(dir, "bin");
	mkdirSync(bin);
	if (condition === "skill") {
		cpSync(join(repo, "skills/pi-models"), join(dir, "skills/pi-models"), { recursive: true });
		writeFileSync(join(bin, "pi-models"), `#!/bin/sh\nexec node ${join(repo, "src/cli.ts")} "$@"\n`);
		chmodSync(join(bin, "pi-models"), 0o755);
	}
	return { dir, bin };
}

function agent(args: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = execFile("pi", args, { env, cwd, timeout: 600_000, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
			if (error && !stdout) reject(error);
			else resolve(stdout);
		});
		child.stdin?.end();
	});
}

const runs: Run[] = [];
for (const task of TASKS.filter((t) => !only || only.includes(t.id))) {
	for (const condition of conditions) {
		for (let trial = 1; trial <= trials; trial++) {
			const { dir, bin } = setup(condition);
			const before = { models: JSON.parse(readFileSync(join(dir, "models.json"), "utf8")), settings: JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")) };
			const prompt = `${task.ask}\n\n(pi's configuration lives in the folder ${dir}.)`;
			const started = Date.now();
			const out = await agent(
				["-p", "--mode", "json", "--no-session", "--no-extensions", "--no-context-files", "--no-mcp", ...(condition === "skill" ? [] : ["--no-skills"]), "--model", model, "--thinking", thinking, prompt],
				{ ...process.env, PI_CODING_AGENT_DIR: dir, PATH: `${bin}:${process.env.PATH}` },
				dir,
			);
			let tokens = 0;
			let costUsd = 0;
			const commands: string[] = [];
			let toolCalls = 0;
			let touched = false;
			for (const line of out.split("\n")) {
				let e: any;
				try {
					e = JSON.parse(line);
				} catch {
					continue;
				}
				if (e.type === "message_end" && e.message?.role === "assistant" && e.message.usage) {
					tokens += (e.message.usage.input ?? 0) + (e.message.usage.output ?? 0);
					costUsd += e.message.usage.cost?.total ?? 0;
				}
				if (e.type === "tool_execution_start") {
					toolCalls++;
					const text = JSON.stringify(e.args ?? {});
					commands.push(e.toolName === "bash" ? String(e.args?.command ?? "") : `${e.toolName} ${text.slice(0, 120)}`);
					// Opening the config files directly is what the skill is meant to avoid.
					if (/(^|[^-\w])(models|settings)\.json/.test(text.replace(/pi-models/g, ""))) touched = true;
				}
			}
			const after = { models: JSON.parse(readFileSync(join(dir, "models.json"), "utf8")), settings: JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")) };
			const problem = task.check(before, after);
			const run: Run = { task: task.id, condition, trial, success: problem === undefined, ...(problem ? { problem } : {}), toolCalls, commands, touchedConfigFiles: touched, tokens, costUsd: Number(costUsd.toFixed(5)), seconds: Math.round((Date.now() - started) / 1000) };
			runs.push(run);
			console.log(`${run.success ? "PASS" : "FAIL"} ${task.id} ${condition} #${trial}: ${toolCalls} tool calls, ${tokens} tokens, ${run.seconds}s, opened config files: ${touched}${problem ? ` | ${problem}` : ""}`);
			rmSync(dir, { recursive: true, force: true });
		}
	}
}

const by = (c: string) => runs.filter((r) => r.condition === c);
const stat = (rs: Run[]) => ({ runs: rs.length, success: rs.filter((r) => r.success).length, openedConfigFiles: rs.filter((r) => r.touchedConfigFiles).length, meanToolCalls: Number((rs.reduce((a, r) => a + r.toolCalls, 0) / (rs.length || 1)).toFixed(1)), meanTokens: Math.round(rs.reduce((a, r) => a + r.tokens, 0) / (rs.length || 1)), meanSeconds: Math.round(rs.reduce((a, r) => a + r.seconds, 0) / (rs.length || 1)), meanCostUsd: Number((rs.reduce((a, r) => a + r.costUsd, 0) / (rs.length || 1)).toFixed(4)) });
const summary = { date: new Date().toISOString().slice(0, 10), model, thinking, trialsPerTask: trials, summary: Object.fromEntries(conditions.map((c) => [c, stat(by(c))])), runs };
const dirOut = new URL("./results", import.meta.url).pathname;
mkdirSync(dirOut, { recursive: true });
const file = join(dirOut, `${summary.date}-${model.replace(/\//g, "_")}.json`);
writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`\n${JSON.stringify(summary.summary, null, 2)}\nWritten to ${file}`);
