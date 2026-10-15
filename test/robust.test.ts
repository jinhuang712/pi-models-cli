import assert from "node:assert/strict";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync, writeFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { FailError } from "../src/errors.ts";
import { commit, listBackups, loadConfig, undoLast } from "../src/store.ts";
import { resolveValue } from "../src/sync.ts";
import { cli, read, readJson, sandbox } from "./helpers.ts";

// Cases found by an independent review of the first build.

test("backup names sort in time order, across a daylight-saving change and within one millisecond", () => {
	const sb = sandbox('{"providers":{"p":{"models":[]}}}\n');
	const moments = ["2026-11-01T05:30:00.000Z", "2026-11-01T06:10:00.000Z", "2026-11-01T06:10:00.000Z", "2026-11-01T06:10:00.001Z"];
	for (const [i, moment] of moments.entries()) {
		const loaded = loadConfig(sb.models);
		commit(loaded, { providers: { p: { models: [{ id: `v${i + 1}` }] } } }, new Date(moment));
	}
	const names = listBackups(sb.models);
	assert.equal(names.length, 4);
	assert.deepEqual(names, [...names].sort());
	// Backup k holds the file before change k. Undoing steps back newest first.
	for (const expected of [3, 2, 1]) {
		undoLast(sb.models);
		assert.equal(readJson(sb.models).providers.p.models[0]?.id, `v${expected}`);
	}
});

test("a change made by another process while a command runs is never overwritten", () => {
	const sb = sandbox();
	const loaded = loadConfig(sb.models);
	const other = `${read(sb.models)}\n`;
	writeFileSync(sb.models, other);
	assert.throws(() => commit(loaded, loaded.config), (e: Error) => e instanceof FailError && /changed while this command ran/.test(e.message));
	assert.equal(read(sb.models), other);
	assert.equal(listBackups(sb.models).length, 0);
});

test("CRLF line endings and a BOM are kept", async () => {
	const text = '{\r\n  "providers": {\r\n    "p": {\r\n      "models": []\r\n    }\r\n  }\r\n}\r\n';
	for (const prefix of ["", "\uFEFF"]) {
		const sb = sandbox(prefix + text);
		const r = await cli(sb, "add", "p/a", "--contextWindow", "5");
		assert.equal(r.code, 0, r.err);
		assert.doesNotMatch(r.out, /layout changed/);
		const after = read(sb.models);
		assert.equal(after.startsWith("\uFEFF"), prefix !== "");
		assert.equal(after.replace(/\r\n/g, "").includes("\n"), false, "every newline stays CRLF");
		assert.match(after, /"id": "a"/);
		await cli(sb, "remove", "p/a");
		assert.equal(read(sb.models), prefix + text);
	}
});

test("a file in a different layout is rewritten with a warning, and the backup keeps the original", async () => {
	const text = '{"providers":{"p":{"models":[{"id":"x","input":["text"]}]}}}';
	const sb = sandbox(text);
	const r = await cli(sb, "add", "p/a", "--contextWindow", "5");
	assert.match(r.out, /warning: the file's layout changed/);
	assert.equal(read(listBackups(sb.models)[0] as string), text);
});

test("a file with comments or trailing commas is refused, with the reason", async () => {
	for (const text of ['{ // note\n "providers": {} }', '{"providers": {"p": {"models": [],},},}']) {
		const sb = sandbox(text);
		const r = await cli(sb, "add", "p/a");
		assert.equal(r.code, 1);
		assert.match(r.err, /comments or trailing commas/);
		assert.equal(read(sb.models), text);
	}
});

test("a provider whose models is not a list is refused, not overwritten", async () => {
	const text = '{"providers":{"p":{"models":{"note":"x"}}}}';
	const sb = sandbox(text);
	const r = await cli(sb, "add", "p/a", "--contextWindow", "1");
	assert.equal(r.code, 1);
	assert.match(r.err, /providers.p.models is not a list/);
	assert.equal(read(sb.models), text);
});

test("token counts are whole decimal numbers; costs are plain decimals", async () => {
	const sb = sandbox('{"providers":{"p":{"models":[]}}}');
	for (const bad of ["0x10", "1.5", "1e6", "-5", "0", " 7", ""]) {
		const r = await cli(sb, "add", "p/a", `--contextWindow=${bad}`);
		assert.equal(r.code, 2, `contextWindow ${JSON.stringify(bad)}`);
	}
	for (const bad of ["1e1", "0x1", "-1", ".5"]) {
		const r = await cli(sb, "add", "p/a", `--cost.input=${bad}`, "--cost.output=1", "--cost.cacheRead=0", "--cost.cacheWrite=0");
		assert.equal(r.code, 2, `cost ${bad}`);
	}
	assert.equal((await cli(sb, "add", "p/a", "--contextWindow", "128000", "--cost.input", "0.4", "--cost.output", "2", "--cost.cacheRead", "0", "--cost.cacheWrite", "0")).code, 0);
});

test("--unset of a missing field warns; a dotted name is a usage error; a blank ID is refused", async () => {
	const sb = sandbox('{"providers":{"p":{"models":[{"id":"a","cost":{"input":1,"output":1,"cacheRead":0,"cacheWrite":0}}]}}}');
	const missing = await cli(sb, "update", "p/a", "--unset", "compat");
	assert.equal(missing.code, 0);
	assert.match(missing.out, /warning: p\/a has no field 'compat' to unset/);
	assert.equal((await cli(sb, "update", "p/a", "--unset", "cost.input")).code, 2);
	assert.equal((await cli(sb, "add", "p/ ", "--contextWindow", "1")).code, 2);
	assert.equal((await cli(sb, "add", "p/b ", "--contextWindow", "1")).code, 2);
});

test("a key with $$ keeps a literal dollar sign", async () => {
	assert.equal(await resolveValue("abc$$def", {}), "abc$def");
	assert.equal(await resolveValue("$$$X", { X: "1" }), "$1");
});

// sync against odd responses
let reply: unknown = {};
let hold: Promise<void> | undefined;
let base = "";
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
	await hold;
	res.writeHead(req.url === "/v1/models" ? 200 : 404, { "content-type": "application/json" });
	res.end(JSON.stringify(reply));
});
before(async () => {
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const cfg = () => JSON.stringify({ providers: { p: { baseUrl: `${base}/v1`, models: [{ id: "keep-a" }, { id: "keep-b" }] } } });
const ids = (sb: { models: string }) => readJson(sb.models).providers.p.models.map((m: { id: string }) => m.id);

test("sync writes a model once when the endpoint lists it several times", async () => {
	reply = { data: [{ id: "x" }, { id: "x", context_length: 5 }, "x", { id: "keep-a" }, { id: "keep-b" }] };
	const sb = sandbox(cfg());
	await cli(sb, "sync", "p");
	assert.deepEqual(ids(sb), ["keep-a", "keep-b", "x"]);
});

test("--prune never deletes from an empty, paged or partly unreadable list", async () => {
	const cases: [unknown, RegExp][] = [
		[{ data: [] }, /returned no models/],
		[{ data: [{ id: "keep-a" }], has_more: true, last_id: "keep-a" }, /paged/],
		[{ models: [{ id: "keep-a" }], nextPageToken: "abc" }, /paged/],
		[{ data: [{ id: "keep-a" }, { nothing: 1 }, 7] }, /2 entries had no readable ID/],
	];
	for (const [body, why] of cases) {
		reply = body;
		const sb = sandbox(cfg());
		const r = await cli(sb, "sync", "p", "--prune");
		assert.equal(r.code, 0, r.err);
		assert.match(r.out, why);
		assert.match(r.out, /--prune ignored/);
		assert.deepEqual(ids(sb), ["keep-a", "keep-b"], JSON.stringify(body));
	}
});

test("an incomplete list still adds new models, and does not claim others are gone", async () => {
	reply = { data: [{ id: "keep-a" }, { id: "new-1" }], has_more: true };
	const sb = sandbox(cfg());
	const r = await cli(sb, "sync", "p");
	assert.deepEqual(ids(sb), ["keep-a", "keep-b", "new-1"]);
	assert.doesNotMatch(r.out, /no longer served/);
});

test("sync does not overwrite an edit made while it waits for the endpoint", async () => {
	reply = { data: [{ id: "keep-a" }, { id: "keep-b" }, { id: "late" }] };
	let release: () => void = () => {};
	hold = new Promise<void>((resolve) => (release = resolve));
	const sb = sandbox(cfg());
	const pending = cli(sb, "sync", "p");
	await new Promise((resolve) => setTimeout(resolve, 100)); // the command has read the file and is waiting
	const edited = JSON.stringify({ providers: { p: { baseUrl: `${base}/v1`, models: [{ id: "keep-a" }, { id: "keep-b" }, { id: "added-meanwhile" }] } } });
	writeFileSync(sb.models, edited);
	release();
	hold = undefined;
	const r = await pending;
	assert.equal(r.code, 1);
	assert.match(r.err, /changed while this command ran/);
	assert.equal(readFileSync(sb.models, "utf8"), edited);
});
