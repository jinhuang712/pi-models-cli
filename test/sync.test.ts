import assert from "node:assert/strict";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { resolveValue } from "../src/sync.ts";
import { cli, readJson, sandbox, write } from "./helpers.ts";

// G4: sync finds what the endpoint serves. A real local HTTP server stands in for a provider.
const seen: { url: string; headers: IncomingMessage["headers"] }[] = [];
let served: unknown = { data: [] };
let status = 200;
let base = "";
const server = createServer((req: IncomingMessage, res: ServerResponse) => {
	seen.push({ url: req.url ?? "", headers: req.headers });
	if (req.url === "/v1/models" || req.url === "/api/models") {
		res.writeHead(status, { "content-type": "application/json" });
		res.end(JSON.stringify(served));
	} else {
		res.writeHead(404).end();
	}
});

before(async () => {
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

function config(extra: object = {}, models: object[] = [{ id: "old-a" }, { id: "old-b", contextWindow: 10 }]) {
	return JSON.stringify({ providers: { p: { baseUrl: `${base}/v1`, apiKey: "literal-key", models, ...extra } } });
}

test("sync adds every served model the file lacks: 0 missing", async () => {
	served = { data: [{ id: "old-a" }, { id: "new-1" }, { id: "new-2", context_length: 262144, max_output_tokens: 8192 }, "new-3"] };
	const sb = sandbox(config());
	const r = await cli(sb, "sync", "p");
	assert.equal(r.code, 0, r.err);
	const ids = readJson(sb.models).providers.p.models.map((m: { id: string }) => m.id);
	for (const m of (served as { data: (string | { id: string })[] }).data) {
		assert.ok(ids.includes(typeof m === "string" ? m : m.id), `${JSON.stringify(m)} missing`);
	}
	assert.match(r.out, /\+ p\/new-1 {2}needs update/);
	assert.match(r.out, /\+ p\/new-2 {2}contextWindow=262144, maxTokens=8192\n/);
	assert.doesNotMatch(r.out, /p\/new-2.*needs update/);
	assert.match(r.out, /\? p\/old-b {2}no longer served \(kept/);
	const entry = readJson(sb.models).providers.p.models.find((m: { id: string }) => m.id === "new-2");
	assert.deepEqual(entry, { id: "new-2", contextWindow: 262144, maxTokens: 8192 });
});

test("sync never changes an existing model", async () => {
	served = { data: [{ id: "old-b", context_length: 999 }] };
	const sb = sandbox(config());
	await cli(sb, "sync", "p");
	assert.deepEqual(readJson(sb.models).providers.p.models[1], { id: "old-b", contextWindow: 10 });
});

test("--prune removes models the endpoint no longer serves; without it they stay", async () => {
	served = { data: [{ id: "old-a" }] };
	const sb = sandbox(config());
	await cli(sb, "sync", "p");
	assert.equal(readJson(sb.models).providers.p.models.length, 2);
	const r = await cli(sb, "sync", "p", "--prune");
	assert.match(r.out, /- p\/old-b {2}no longer served/);
	assert.deepEqual(readJson(sb.models).providers.p.models.map((m: { id: string }) => m.id), ["old-a"]);
});

test("--dry-run shows the diff and writes nothing; running again reports 'already in sync'", async () => {
	served = { data: [{ id: "old-a" }, { id: "old-b" }, { id: "n" }] };
	const sb = sandbox(config());
	const dry = await cli(sb, "sync", "p", "--dry-run");
	assert.match(dry.out, /dry run: nothing written/);
	assert.equal(readJson(sb.models).providers.p.models.length, 2);
	await cli(sb, "sync", "p");
	assert.match((await cli(sb, "sync", "p")).out, /already in sync/);
});

test("--copy-from starts new models from a sibling", async () => {
	served = { data: [{ id: "old-a" }, { id: "fresh" }] };
	const sb = sandbox(config({}, [{ id: "old-a", name: "A", compat: { k: 1 }, contextWindow: 5, maxTokens: 6 }]));
	const r = await cli(sb, "sync", "p", "--copy-from", "old-a");
	assert.doesNotMatch(r.out, /needs update/);
	assert.deepEqual(readJson(sb.models).providers.p.models[1], { id: "fresh", name: "fresh", compat: { k: 1 }, contextWindow: 5, maxTokens: 6 });
});

test("the key pi would use is sent: auth.json first, then apiKey (literal, $ENV, !command)", async () => {
	served = { data: [] };
	const auth = (headers: { authorization?: string }) => headers.authorization;
	// literal apiKey
	let sb = sandbox(config());
	await cli(sb, "sync", "p");
	assert.equal(auth(seen.at(-1)!.headers), "Bearer literal-key");
	// $ENV
	sb = sandbox(config({ apiKey: "$MY_KEY" }));
	sb.env.MY_KEY = "from-env";
	await cli(sb, "sync", "p");
	assert.equal(auth(seen.at(-1)!.headers), "Bearer from-env");
	// !command
	sb = sandbox(config({ apiKey: "!printf from-cmd" }));
	await cli(sb, "sync", "p");
	assert.equal(auth(seen.at(-1)!.headers), "Bearer from-cmd");
	// auth.json wins over apiKey
	sb = sandbox(config());
	write(sb, "auth.json", { p: { type: "api_key", key: "from-auth" } });
	await cli(sb, "sync", "p");
	assert.equal(auth(seen.at(-1)!.headers), "Bearer from-auth");
});

test("extra provider headers are sent; anthropic-style providers also get x-api-key", async () => {
	served = { data: [] };
	const sb = sandbox(config({ api: "anthropic-messages", headers: { "X-Agent": "pi" } }));
	await cli(sb, "sync", "p");
	const h = seen.at(-1)!.headers;
	assert.equal(h["x-agent"], "pi");
	assert.equal(h["x-api-key"], "literal-key");
	assert.equal(h["anthropic-version"], "2023-06-01");
});

test("an unreadable endpoint: one provider fails (exit 1); --all skips it with the reason", async () => {
	status = 500;
	const sb = sandbox(config());
	const one = await cli(sb, "sync", "p");
	assert.equal(one.code, 1);
	assert.match(one.err, /cannot read the model list of p: .*HTTP 500/);
	const all = await cli(sb, "sync", "--all");
	assert.equal(all.code, 0);
	assert.match(all.out, /skipped p: /);
	status = 200;
});

test("--all skips providers with no baseUrl or model list, and writes once", async () => {
	served = { data: [{ id: "a" }] };
	const sb = sandbox(
		JSON.stringify({
			providers: {
				p: { baseUrl: `${base}/v1`, models: [] },
				q: { baseUrl: `${base}/v1`, models: [] },
				onlyOverrides: { modelOverrides: {} },
				noUrl: { models: [] },
			},
		}),
	);
	const r = await cli(sb, "sync", "--all", "--json");
	const out = JSON.parse(r.out);
	assert.equal(out.changes.length, 2);
	const { listBackups } = await import("../src/store.ts");
	assert.equal(listBackups(sb.models).length, 1);
});

test("resolveValue: literals, interpolation, missing variables, failing commands", async () => {
	assert.equal(await resolveValue("plain", {}), "plain");
	assert.equal(await resolveValue("Bearer-${A}-$B", { A: "1", B: "2" }), "Bearer-1-2");
	assert.equal(await resolveValue("$NOPE", {}), undefined);
	assert.equal(await resolveValue("!exit 3", {}), undefined);
	assert.equal(await resolveValue("!printf ' x \\n'", {}), "x");
});
