import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { backupDir, listBackups, loadSettings, commit } from "../src/store.ts";
import { cli, read, readJson, sandbox } from "./helpers.ts";

// F9 and F10: model filters and defaults in settings.json. G2 and G3 apply to this file too.
const MODELS = JSON.stringify({ providers: { p: { models: [{ id: "glm-5" }, { id: "kimi" }] } } });
const OTHER = { theme: "dark", compaction: { reserveTokens: 1000 }, packages: ["a", "b"] };

function setup(settings: object | null = { ...OTHER }) {
	const sb = sandbox(MODELS);
	const path = join(sb.dir, "settings.json");
	if (settings !== null) writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
	return { sb, path };
}

/** Everything outside the named keys must be unchanged. */
function onlyKeys(before: Record<string, unknown>, after: Record<string, unknown>, keys: string[]) {
	const strip = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
	assert.deepEqual(strip(after), strip(before));
}

test("show --settings prints only the model-selection keys", async () => {
	const { sb } = setup({ ...OTHER, defaultProvider: "p", defaultModel: "glm-5", enabledModels: ["a"], modelThinkingLevels: { "p/glm-5": "high" } });
	const r = await cli(sb, "show", "--settings");
	assert.match(r.out, /defaultProvider: "p"/);
	assert.match(r.out, /enabledModels: \["a"\]/);
	assert.doesNotMatch(r.out, /theme|compaction/);
	assert.equal((await cli(setup(null).sb, "show", "--settings")).out.trim(), "no model settings are set");
});

test("enable: the first pattern warns that it narrows pi to a list; the rest add; duplicates warn", async () => {
	const { sb, path } = setup();
	const before = readJson(path);
	const first = await cli(sb, "enable", "opencode-go/*", "sonnet");
	assert.equal(first.code, 0, first.err);
	assert.match(first.out, /warning: enabledModels was not set, so pi offered every model; it now holds only: opencode-go\/\*, sonnet/);
	assert.deepEqual(readJson(path).enabledModels, ["opencode-go/*", "sonnet"]);
	onlyKeys(before, readJson(path), ["enabledModels"]);
	const again = await cli(sb, "enable", "sonnet", "haiku");
	assert.doesNotMatch(again.out, /was not set/);
	assert.match(again.out, /warning: sonnet is already in enabledModels/);
	assert.deepEqual(readJson(path).enabledModels, ["opencode-go/*", "sonnet", "haiku"]);
});

test("disable removes patterns; an emptied list is removed; --all clears it; unknown patterns warn", async () => {
	const { sb, path } = setup({ ...OTHER, enabledModels: ["a", "b"] });
	const near = await cli(sb, "disable", "aa");
	assert.match(near.out, /warning: aa is not in enabledModels; did you mean a\?/);
	assert.deepEqual(readJson(path).enabledModels, ["a", "b"]);
	await cli(sb, "disable", "a");
	assert.deepEqual(readJson(path).enabledModels, ["b"]);
	const last = await cli(sb, "disable", "b");
	assert.match(last.out, /now empty, so the setting was removed/);
	assert.equal("enabledModels" in readJson(path), false);
	writeFileSync(path, JSON.stringify({ ...OTHER, enabledModels: ["x", "y"] }));
	await cli(sb, "disable", "--all");
	assert.equal("enabledModels" in readJson(path), false);
	assert.match((await cli(sb, "disable", "--all")).out, /warning: enabledModels is not set/);
	assert.equal((await cli(sb, "disable")).code, 2);
	assert.equal((await cli(sb, "disable", "x", "--all")).code, 2);
});

test("default sets provider and model together, and thinking alone", async () => {
	const { sb, path } = setup({ ...OTHER, defaultProvider: "old", defaultModel: "old-m", defaultThinkingLevel: "low" });
	const before = readJson(path);
	const r = await cli(sb, "default", "p/glm-5", "--thinking", "high");
	assert.equal(r.code, 0, r.err);
	assert.match(r.out, /~ defaultProvider: "old" → "p"/);
	assert.match(r.out, /~ defaultModel: "old-m" → "glm-5"/);
	assert.match(r.out, /~ defaultThinkingLevel: "low" → "high"/);
	const after = readJson(path);
	assert.deepEqual([after.defaultProvider, after.defaultModel, after.defaultThinkingLevel], ["p", "glm-5", "high"]);
	onlyKeys(before, after, ["defaultProvider", "defaultModel", "defaultThinkingLevel"]);
	await cli(sb, "default", "--thinking", "max");
	assert.equal(readJson(path).defaultModel, "glm-5");
	assert.equal(readJson(path).defaultThinkingLevel, "max");
});

test("default warns about a model models.json does not list, with a suggestion, and still sets it", async () => {
	const { sb, path } = setup();
	const r = await cli(sb, "default", "p/glm-6");
	assert.equal(r.code, 0);
	assert.match(r.out, /warning: p\/glm-6 is not in models.json; did you mean glm-5\?; fine if it is a built-in pi model/);
	assert.equal(readJson(path).defaultModel, "glm-6");
	const noop = await cli(sb, "default", "p/glm-6");
	assert.match(noop.out, /nothing to change/);
});

test("default and thinking reject bad input with exit 2", async () => {
	const { sb } = setup();
	assert.equal((await cli(sb, "default")).code, 2);
	assert.equal((await cli(sb, "default", "a/b", "c/d")).code, 2);
	const bad = await cli(sb, "default", "p/glm-5", "--thinking", "hihg");
	assert.equal(bad.code, 2);
	assert.match(bad.err, /did you mean high\?/);
	assert.equal((await cli(sb, "thinking", "p/glm-5")).code, 2);
	assert.equal((await cli(sb, "thinking", "p/glm-5", "high", "--unset")).code, 2);
	assert.equal((await cli(sb, "thinking", "glm-5", "high")).code, 2);
});

test("thinking sets, changes and unsets a per-model level; the last unset removes the map", async () => {
	const { sb, path } = setup();
	await cli(sb, "thinking", "p/glm-5", "high");
	assert.deepEqual(readJson(path).modelThinkingLevels, { "p/glm-5": "high" });
	await cli(sb, "thinking", "p/kimi", "off");
	await cli(sb, "thinking", "p/glm-5", "xhigh");
	assert.deepEqual(readJson(path).modelThinkingLevels, { "p/glm-5": "xhigh", "p/kimi": "off" });
	await cli(sb, "thinking", "p/glm-5", "--unset");
	await cli(sb, "thinking", "p/kimi", "--unset");
	assert.equal("modelThinkingLevels" in readJson(path), false);
	assert.match((await cli(sb, "thinking", "p/kimi", "--unset")).out, /has no thinking level set/);
});

test("budgets sets and unsets token budgets; the last unset removes the key", async () => {
	const { sb, path } = setup();
	await cli(sb, "budgets", "--low", "2048", "--high", "32000");
	assert.deepEqual(readJson(path).thinkingBudgets, { low: 2048, high: 32000 });
	await cli(sb, "budgets", "--low", "4096", "--unset", "high");
	assert.deepEqual(readJson(path).thinkingBudgets, { low: 4096 });
	await cli(sb, "budgets", "--unset", "low");
	assert.equal("thinkingBudgets" in readJson(path), false);
	assert.equal((await cli(sb, "budgets")).code, 2);
	assert.equal((await cli(sb, "budgets", "--low", "1.5")).code, 2);
	assert.equal((await cli(sb, "budgets", "--unset", "max")).code, 2);
});

test("a missing settings.json is created, with no backup; later changes make backups", async () => {
	const { sb, path } = setup(null);
	const r = await cli(sb, "default", "p/glm-5");
	assert.equal(r.code, 0, r.err);
	assert.deepEqual(readJson(path), { defaultProvider: "p", defaultModel: "glm-5" });
	assert.equal(existsSync(backupDir(path)), false);
	await cli(sb, "default", "p/kimi");
	assert.equal(listBackups(path).length, 1);
});

test("undo --settings restores settings.json byte for byte, and leaves models.json alone", async () => {
	const { sb, path } = setup();
	const originalModels = read(sb.models);
	const original = read(path);
	await cli(sb, "enable", "a");
	await cli(sb, "default", "p/glm-5", "--thinking", "low");
	await cli(sb, "thinking", "p/glm-5", "high");
	for (let i = 0; i < 3; i++) assert.equal((await cli(sb, "undo", "--settings")).code, 0);
	assert.equal(read(path), original);
	assert.equal(read(sb.models), originalModels);
	assert.equal(listBackups(sb.models).length, 0);
	assert.equal((await cli(sb, "undo", "--settings")).code, 1);
});

test("--dry-run writes nothing to settings.json", async () => {
	const { sb, path } = setup();
	const original = read(path);
	const r = await cli(sb, "default", "p/glm-5", "--dry-run");
	assert.match(r.out, /dry run: nothing written/);
	assert.equal(read(path), original);
	assert.equal(existsSync(backupDir(path)), false);
});

test("the indent of settings.json is kept", async () => {
	const { sb, path } = setup();
	writeFileSync(path, `{\n\t"theme": "dark"\n}\n`);
	await cli(sb, "default", "p/glm-5");
	assert.equal(read(path), `{\n\t"theme": "dark",\n\t"defaultProvider": "p",\n\t"defaultModel": "glm-5"\n}\n`);
});

test("settings are not overwritten when the file changes during a command", () => {
	const { path } = setup();
	const loaded = loadSettings(path);
	const other = `${read(path)}\n`;
	writeFileSync(path, other);
	assert.throws(() => commit(loaded, { ...loaded.config, defaultModel: "x" }), /changed while this command ran/);
	assert.equal(read(path), other);
	// A file created by someone else after we saw none is not overwritten either.
	const fresh = setup(null);
	const missing = loadSettings(fresh.path);
	writeFileSync(fresh.path, "{}\n");
	assert.throws(() => commit(missing, { defaultModel: "x" }), /changed while this command ran/);
	assert.equal(read(fresh.path), "{}\n");
});

test("--settings-file targets another file, such as a project's settings", async () => {
	const { sb } = setup();
	const other = join(sb.dir, "project-settings.json");
	writeFileSync(other, "{}\n");
	const r = await cli(sb, "default", "p/kimi", "--settings-file", other);
	assert.equal(r.code, 0, r.err);
	assert.equal(readJson(other).defaultModel, "kimi");
	assert.equal(existsSync(join(sb.dir, "settings.json")), true);
	assert.equal("defaultModel" in readJson(join(sb.dir, "settings.json")), false);
});

test("help for every settings command", async () => {
	const sb = sandbox(MODELS);
	for (const c of ["enable", "disable", "default", "thinking", "budgets"]) {
		const r = await cli(sb, c, "--help");
		assert.equal(r.code, 0, c);
		assert.match(r.out, new RegExp(`^pi-models ${c} —`), c);
	}
});
