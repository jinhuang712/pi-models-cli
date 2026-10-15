import assert from "node:assert/strict";
import { test } from "node:test";
import { cli, readJson, sandbox } from "./helpers.ts";

// G2: an edit touches only what you named. Compare the parsed file before and after each command.
type Json = Record<string, any>;

function assertOnlyTouched(before: Json, after: Json, provider: string, modelIds: string[]) {
	const { providers: bp, ...bRest } = before;
	const { providers: ap, ...aRest } = after;
	assert.deepEqual(aRest, bRest, "top-level keys outside providers changed");
	assert.deepEqual(Object.keys(ap), Object.keys(bp), "provider set or order changed");
	for (const name of Object.keys(bp)) {
		if (name !== provider) {
			assert.deepEqual(ap[name], bp[name], `provider ${name} changed`);
			continue;
		}
		const { models: bm = [], ...bFields } = bp[name];
		const { models: am = [], ...aFields } = ap[name];
		assert.deepEqual(aFields, bFields, `fields of ${name} outside models changed`);
		const others = (list: Json[]) => list.filter((m) => !modelIds.includes(m.id));
		assert.deepEqual(others(am), others(bm), `untouched models of ${name} changed`);
	}
}

const MODEL = "opencode-go";

test("add changes only the new model", async () => {
	const sb = sandbox();
	const before = readJson(sb.models);
	const source = before.providers[MODEL].models[0];
	const r = await cli(sb, "add", `${MODEL}/zz-new`, "--copy-from", source.id, "--contextWindow", "1000000");
	assert.equal(r.code, 0, r.err);
	const after = readJson(sb.models);
	assertOnlyTouched(before, after, MODEL, ["zz-new"]);
	const added = after.providers[MODEL].models.at(-1);
	assert.equal(added.id, "zz-new");
	assert.equal(added.name, "zz-new", "a copy takes the new id as its name");
	assert.equal(added.contextWindow, 1000000);
	assert.deepEqual(added.compat, source.compat, "compat is copied");
});

test("update changes only the named fields of one model", async () => {
	const sb = sandbox();
	const before = readJson(sb.models);
	const target = before.providers[MODEL].models.find((m: Json) => m.cost !== undefined);
	const r = await cli(sb, "update", `${MODEL}/${target.id}`, "--maxTokens", "4242", "--cost.input", "9");
	assert.equal(r.code, 0, r.err);
	const after = readJson(sb.models);
	assertOnlyTouched(before, after, MODEL, [target.id]);
	const changed = after.providers[MODEL].models.find((m: Json) => m.id === target.id);
	assert.deepEqual(changed, { ...target, maxTokens: 4242, cost: { ...target.cost, input: 9 } });
});

test("update --unset removes only that field", async () => {
	const sb = sandbox();
	const before = readJson(sb.models);
	const target = before.providers[MODEL].models.find((m: Json) => m.compat !== undefined);
	await cli(sb, "update", `${MODEL}/${target.id}`, "--unset", "compat");
	const after = readJson(sb.models);
	assertOnlyTouched(before, after, MODEL, [target.id]);
	const { compat: _gone, ...rest } = target;
	assert.deepEqual(after.providers[MODEL].models.find((m: Json) => m.id === target.id), rest);
});

test("remove changes only the removed models", async () => {
	const sb = sandbox();
	const before = readJson(sb.models);
	const [a, b] = before.providers[MODEL].models;
	const r = await cli(sb, "remove", `${MODEL}/${a.id}`, `${MODEL}/${b.id}`);
	assert.equal(r.code, 0, r.err);
	const after = readJson(sb.models);
	assertOnlyTouched(before, after, MODEL, [a.id, b.id]);
	assert.equal(after.providers[MODEL].models.length, before.providers[MODEL].models.length - 2);
});

test("ops work on every provider that has a model list", async () => {
	const sb = sandbox();
	const before = readJson(sb.models);
	for (const [name, p] of Object.entries<Json>(before.providers)) {
		if (!Array.isArray(p.models) || p.models.length === 0) continue;
		const fresh = sandbox();
		const r = await cli(fresh, "add", `${name}/zz-probe`, "--contextWindow", "8");
		assert.equal(r.code, 0, `${name}: ${r.err}`);
		assertOnlyTouched(before, readJson(fresh.models), name, ["zz-probe"]);
	}
});

test("a change keeps the file's formatting: add then remove gives the same bytes", async () => {
	const sb = sandbox();
	const { readFileSync } = await import("node:fs");
	const original = readFileSync(sb.models, "utf8");
	await cli(sb, "add", `${MODEL}/zz-new`, "--contextWindow", "5");
	await cli(sb, "remove", `${MODEL}/zz-new`);
	assert.equal(readFileSync(sb.models, "utf8"), original);
});
