import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { COMMAND_ORDER, renderCliDoc } from "../scripts/cli-doc.ts";
import { HELP } from "../src/help.ts";
import { cli, sandbox, write } from "./helpers.ts";

test("CLI.md is up to date: run `npm run docs` after changing a help text", () => {
	assert.equal(readFileSync(new URL("../CLI.md", import.meta.url), "utf8"), renderCliDoc());
});

test("CLI.md lists every command that has a help text, and no other", () => {
	assert.deepEqual([...COMMAND_ORDER].sort(), Object.keys(HELP).sort());
});

// The hand-written JSON section of CLI.md must match real output.
const MODELS = JSON.stringify({ providers: { p: { models: [{ id: "a", contextWindow: 5 }] } } });

test("the --json fields that CLI.md documents are the ones the commands print", async () => {
	const sb = sandbox(MODELS);
	write(sb, "settings.json", "{}");
	const keys = async (...args: string[]) => Object.keys(JSON.parse((await cli(sb, ...args, "--json")).out)).sort();
	const edit = ["backup", "changes", "dryRun", "ok", "warnings"];
	assert.deepEqual(await keys("add", "p/b", "--contextWindow", "1"), edit);
	assert.deepEqual(await keys("update", "p/b", "--maxTokens", "2"), edit);
	assert.deepEqual(await keys("remove", "p/b"), edit);
	assert.deepEqual(await keys("enable", "x"), edit);
	assert.deepEqual(await keys("disable", "x"), edit);
	assert.deepEqual(await keys("default", "p/a"), edit);
	assert.deepEqual(await keys("thinking", "p/a", "high"), edit);
	assert.deepEqual(await keys("budgets", "--low", "1"), edit);
	assert.deepEqual(await keys("show"), ["ok", "providers"]);
	assert.deepEqual(await keys("show", "p"), ["models", "ok", "provider"]);
	assert.deepEqual(await keys("show", "p/a"), ["model", "ok"]);
	assert.deepEqual(await keys("show", "--settings"), ["ok", "settings"]);
	assert.deepEqual(await keys("undo", "--list"), ["backups", "ok"]);
	assert.deepEqual(await keys("undo"), ["dryRun", "ok", "removed", "restored"]);
	const failed = await cli(sb, "update", "p/zzz", "--maxTokens", "1", "--json");
	assert.deepEqual(Object.keys(JSON.parse(failed.out)).sort(), ["error", "ok"]);
	assert.equal(failed.err, "");
});
