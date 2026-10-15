import assert from "node:assert/strict";
import { test } from "node:test";
import { cli, read, readJson, sandbox, write } from "./helpers.ts";

const text = JSON.stringify(
	{
		providers: {
			alpha: {
				baseUrl: "http://127.0.0.1:1",
				models: [
					{ id: "glm-5", name: "GLM 5", contextWindow: 200000, maxTokens: 4096, compat: { x: 1 }, reasoning: true },
					{ id: "org/deep", name: "Deep", cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 } },
				],
			},
			beta: { models: [{ id: "m1" }] },
			overridesOnly: { modelOverrides: {} },
		},
	},
	null,
	2,
);

test("show lists providers, ids and one entry", async () => {
	const sb = sandbox(text);
	assert.match((await cli(sb, "show")).out, /alpha {2}2 models/);
	assert.match((await cli(sb, "show", "alpha")).out, /glm-5 {2}org\/deep/);
	const one = await cli(sb, "show", "alpha/org/deep", "--json");
	assert.deepEqual(JSON.parse(one.out).model.id, "org/deep");
});

test("a model id may contain a slash", async () => {
	const sb = sandbox(text);
	const r = await cli(sb, "update", "alpha/org/deep", "--cost.input", "5");
	assert.equal(r.code, 0, r.err);
	assert.equal(readJson(sb.models).providers.alpha.models[1].cost.input, 5);
});

test("errors name the problem and suggest a fix", async () => {
	const sb = sandbox(text);
	const r = await cli(sb, "update", "alpha/glm-6", "--maxTokens", "1");
	assert.equal(r.code, 1);
	assert.match(r.err, /no model 'glm-6' in alpha; did you mean glm-5\?/);
	const p = await cli(sb, "add", "alhpa/x", "--contextWindow", "1");
	assert.match(p.err, /provider 'alhpa' is not in models.json; did you mean alpha\?/);
	assert.match(p.err, /does not add providers/);
});

test("usage errors exit 2", async () => {
	const sb = sandbox(text);
	assert.equal((await cli(sb, "frobnicate")).code, 2);
	assert.match((await cli(sb, "ad")).err, /did you mean add\?/);
	assert.equal((await cli(sb, "add", "alpha/x", "--nope")).code, 2);
	assert.equal((await cli(sb, "add", "alpha")).code, 2);
	assert.equal((await cli(sb, "update", "alpha/glm-5")).code, 2);
	assert.equal((await cli(sb, "add", "alpha/x", "--contextWindow", "1M")).code, 2);
	assert.match((await cli(sb, "add", "alpha/x", "--contextWindow", "1M")).err, /write the full number/);
	assert.equal((await cli(sb, "add", "alpha/x", "--reasoning", "--no-reasoning")).code, 2);
	assert.equal((await cli(sb, "add", "alpha/x", "--input", "audio")).code, 2);
	assert.equal((await cli(sb, "sync")).code, 2);
	assert.equal((await cli(sb, "sync", "alpha", "--all")).code, 2);
});

test("add refuses an existing model; update refuses a missing field set", async () => {
	const sb = sandbox(text);
	const r = await cli(sb, "add", "alpha/glm-5", "--contextWindow", "1");
	assert.equal(r.code, 1);
	assert.match(r.err, /already exists; use update/);
});

test("cost needs all four rates on a new model, one rate on an existing cost", async () => {
	const sb = sandbox(text);
	const bad = await cli(sb, "add", "alpha/n1", "--cost.input", "1");
	assert.equal(bad.code, 1);
	assert.match(bad.err, /missing: output, cacheRead, cacheWrite/);
	const ok = await cli(sb, "add", "alpha/n1", "--cost.input", "1", "--cost.output", "2", "--cost.cacheRead", "0", "--cost.cacheWrite", "0");
	assert.equal(ok.code, 0, ok.err);
	const partial = await cli(sb, "update", "alpha/glm-5", "--cost.input", "1");
	assert.equal(partial.code, 1, "glm-5 has no cost yet, so a single rate is not enough");
});

test("--copy-from copies compat but not the name; passed fields override", async () => {
	const sb = sandbox(text);
	await cli(sb, "add", "alpha/glm-6", "--copy-from", "glm-5", "--maxTokens", "9999");
	const added = readJson(sb.models).providers.alpha.models.at(-1);
	assert.deepEqual(added, { id: "glm-6", name: "glm-6", contextWindow: 200000, maxTokens: 9999, compat: { x: 1 }, reasoning: true });
	const missing = await cli(sb, "add", "alpha/glm-7", "--copy-from", "glm-55");
	assert.match(missing.err, /no model 'glm-55' in alpha; did you mean glm-5\?/);
});

test("--no-reasoning and --unset", async () => {
	const sb = sandbox(text);
	await cli(sb, "update", "alpha/glm-5", "--no-reasoning", "--unset", "compat");
	const m = readJson(sb.models).providers.alpha.models[0];
	assert.equal(m.reasoning, false);
	assert.equal("compat" in m, false);
	assert.equal((await cli(sb, "update", "alpha/glm-5", "--unset", "id")).code, 2);
});

test("remove skips missing models; exits 1 when none were removed", async () => {
	const sb = sandbox(text);
	const some = await cli(sb, "remove", "alpha/glm-5", "alpha/ghost");
	assert.equal(some.code, 0);
	assert.match(some.out, /skipped alpha\/ghost/);
	const none = await cli(sb, "remove", "alpha/ghost");
	assert.equal(none.code, 1);
});

test("remove warns when settings.json still uses the model, and never edits it", async () => {
	const sb = sandbox(text);
	const settings = { defaultProvider: "alpha", defaultModel: "glm-5", enabledModels: ["alpha/glm-5", "beta/m1"], modelThinkingLevels: { "alpha/glm-5": "high" } };
	write(sb, "settings.json", settings);
	const before = read(`${sb.dir}/settings.json`);
	const r = await cli(sb, "remove", "alpha/glm-5");
	assert.match(r.out, /alpha\/glm-5 is still set in settings.json: defaultModel, enabledModels, modelThinkingLevels/);
	assert.equal(read(`${sb.dir}/settings.json`), before);
});

test("--json output and errors", async () => {
	const sb = sandbox(text);
	const ok = JSON.parse((await cli(sb, "add", "alpha/j1", "--contextWindow", "5", "--json")).out);
	assert.equal(ok.ok, true);
	assert.deepEqual(ok.changes, [{ op: "add", target: "alpha/j1" }]);
	assert.ok(ok.backup);
	const bad = await cli(sb, "update", "alpha/zzz", "--maxTokens", "1", "--json");
	assert.equal(bad.code, 1);
	assert.equal(JSON.parse(bad.out).ok, false);
	assert.equal(bad.err, "");
});

test("help, per-command help and version", async () => {
	const sb = sandbox(text);
	assert.match((await cli(sb)).out, /pi-models — edit pi's models.json/);
	for (const c of ["show", "add", "update", "remove", "sync", "undo"]) {
		const r = await cli(sb, c, "--help");
		assert.equal(r.code, 0);
		assert.match(r.out, new RegExp(`^pi-models ${c} —`));
	}
	assert.match((await cli(sb, "--version")).out, /^\d+\.\d+\.\d+/);
});

test("a broken models.json fails cleanly", async () => {
	const sb = sandbox("{ nope");
	const r = await cli(sb, "show");
	assert.equal(r.code, 1);
	assert.match(r.err, /not valid JSON/);
});

test("providers with only overrides can still be listed", async () => {
	const sb = sandbox(text);
	assert.match((await cli(sb, "show", "overridesOnly")).out, /0 models/);
});
