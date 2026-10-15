import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { cli, sandbox, write, type Sandbox } from "./helpers.ts";

// G6: probe costs nothing. A real local server logs every request it receives.
const requests: { method: string; url: string; auth?: string; body: string }[] = [];
let mode: "ok" | "401" | "404" | "open" = "ok";
let served: unknown = { data: [{ id: "good" }, { id: "other" }] };
let base = "";
const server = createServer((req: IncomingMessage, res: ServerResponse) => {
	let body = "";
	req.on("data", (c) => (body += c));
	req.on("end", () => {
		requests.push({ method: req.method ?? "", url: req.url ?? "", ...(req.headers.authorization ? { auth: req.headers.authorization } : {}), body });
		const isModels = req.url === "/v1/models";
		const keyed = req.headers.authorization === "Bearer secret";
		const status = !isModels ? 404 : mode === "404" ? 404 : mode === "401" ? 401 : mode === "ok" && !keyed ? 401 : 200;
		res.writeHead(status, { "content-type": "application/json" });
		res.end(status === 200 ? JSON.stringify(served) : "{}");
	});
});
before(async () => {
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

/** A stand-in for the pi executable that prints what `pi --list-models` prints. */
function fakePi(sb: Sandbox, output: string): void {
	const path = join(sb.dir, "fake-pi.sh");
	writeFileSync(path, `#!/bin/sh\ncat <<'EOF'\n${output}\nEOF\n`);
	chmodSync(path, 0o755);
	sb.env.PI_MODELS_PI_BIN = path;
}

const TABLE = (rows: string[]) => ["provider  model  context  max-out  thinking  images", ...rows.map((m) => `p         ${m}  1M       64K      yes       no`)].join("\n");

function config(extra: object = {}, models: object[] = [{ id: "good", contextWindow: 1000 }]) {
	return { providers: { p: { baseUrl: `${base}/v1`, apiKey: "secret", api: "openai-completions", models, ...extra } } };
}

function setup(extra: object = {}, models?: object[]) {
	const sb = sandbox(JSON.stringify(config(extra, models)));
	fakePi(sb, TABLE(["good"]));
	requests.length = 0;
	return sb;
}

test("a healthy entry passes, and only GET requests without a body are sent (G6)", async () => {
	mode = "ok";
	const sb = setup();
	const r = await cli(sb, "probe", "p/good");
	assert.equal(r.code, 0, r.out + r.err);
	assert.match(r.out, /✓ entry {4}pi loads it/);
	assert.match(r.out, /✓ key {6}a key resolves from models.json apiKey \(literal\)/);
	assert.match(r.out, /✓ model {4}the endpoint lists good/);
	assert.match(r.out, /no billed request was sent/);
	assert.ok(requests.length > 0);
	for (const q of requests) {
		assert.equal(q.method, "GET");
		assert.equal(q.body, "");
		assert.match(q.url, /\/models$/);
	}
});

test("probe never prints the key", async () => {
	mode = "ok";
	const sb = setup();
	const r = await cli(sb, "probe", "p", "--json");
	assert.doesNotMatch(r.out + r.err, /secret/);
});

test("a rejected key fails, and the output says so", async () => {
	mode = "401";
	const r = await cli(setup(), "probe", "p/good");
	assert.equal(r.code, 1);
	assert.match(r.out, /✗ models {3}.*HTTP 401: the key is rejected/);
});

test("an endpoint that answers without a key gets a warning, not a pass for the key", async () => {
	mode = "open";
	const r = await cli(setup(), "probe", "p/good");
	assert.equal(r.code, 0);
	assert.match(r.out, /! key {6}the endpoint lists models without a key/);
	assert.equal(requests.some((q) => q.auth === undefined), true, "an unauthenticated request was sent for the comparison");
});

test("a model the endpoint does not list fails, with a suggestion; a whole provider only warns", async () => {
	mode = "ok";
	const sb = setup({}, [{ id: "goood" }, { id: "good" }]);
	fakePi(sb, TABLE(["goood", "good"]));
	const one = await cli(sb, "probe", "p/goood");
	assert.equal(one.code, 1);
	assert.match(one.out, /does not list 'goood'; did you mean good\?/);
	const all = await cli(sb, "probe", "p");
	assert.equal(all.code, 0);
	assert.match(all.out, /! model {4}1 of 2 models in the file are not listed by the endpoint: goood/);
});

test("a provider with no model list still gets the entry, key and host checks", async () => {
	mode = "404";
	const r = await cli(setup(), "probe", "p/good");
	assert.equal(r.code, 0);
	assert.match(r.out, /- models {3}no model list to compare with/);
});

test("an unreachable host fails", async () => {
	const sb = setup({ baseUrl: "http://127.0.0.1:1/v1" });
	const r = await cli(sb, "probe", "p/good");
	assert.equal(r.code, 1);
	assert.match(r.out, /✗ endpoint .*did not answer/);
});

test("a key that is configured but does not resolve fails before any request", async () => {
	const sb = setup({ apiKey: "$PROBE_TEST_UNSET" });
	const r = await cli(sb, "probe", "p/good");
	assert.equal(r.code, 1);
	assert.match(r.out, /✗ key .*does not resolve/);
	assert.equal(requests.length, 0);
});

test("no key configured is a warning", async () => {
	mode = "open";
	const sb = setup({ apiKey: undefined });
	const r = await cli(sb, "probe", "p/good");
	assert.equal(r.code, 0);
	assert.match(r.out, /! key {6}no key is configured/);
});

test("pi rejecting models.json fails with pi's own message", async () => {
	const sb = setup();
	fakePi(sb, "Warning: errors loading models.json:\nInvalid models.json schema:\n  - providers.p.models.0.thinkingLevelMap.bogus: must be one of off, minimal\n\nFile: /x/models.json");
	const r = await cli(sb, "probe", "p/good");
	assert.equal(r.code, 1);
	assert.match(r.out, /✗ entry {4}pi rejects models.json: .*thinkingLevelMap.bogus/);
	assert.equal(requests.length, 0, "no request is sent after a failed entry check");
});

test("without pi on PATH the entry is checked with our own rules, with a warning", async () => {
	mode = "ok";
	const sb = setup();
	sb.env.PI_MODELS_PI_BIN = join(sb.dir, "no-such-pi");
	const r = await cli(sb, "probe", "p/good");
	assert.equal(r.code, 0);
	assert.match(r.out, /! entry {4}pi was not found on PATH/);
	write(sb, "models.json", config({}, [{ id: "good", contextWindow: -1 }]));
	const bad = await cli(sb, "probe", "p/good");
	assert.equal(bad.code, 1);
	assert.match(bad.out, /contextWindow must be a positive number/);
});

test("an unknown api value warns", async () => {
	mode = "ok";
	const r = await cli(setup({ api: "carrier-pigeon" }), "probe", "p/good");
	assert.match(r.out, /! api {6}api 'carrier-pigeon' is not one pi ships with/);
});

test("usage: a missing provider or model is an error with a suggestion", async () => {
	const sb = setup();
	assert.match((await cli(sb, "probe", "q/good")).err, /provider 'q' is not in models.json/);
	assert.match((await cli(sb, "probe", "p/goodd")).err, /no model 'goodd' in p; did you mean good\?/);
	assert.equal((await cli(sb, "probe")).code, 2);
});

let realPi = false;
try {
	execFileSync("pi", ["--version"], { stdio: "ignore" });
	realPi = true;
} catch {}

test("with the real pi: a bad value only pi knows about is caught", { skip: !realPi && "pi is not installed" }, async () => {
	mode = "ok";
	const sb = sandbox(JSON.stringify(config({}, [{ id: "good", inputLimits: { maxRequestBytes: 0 } }])));
	const r = await cli(sb, "probe", "p/good");
	assert.equal(r.code, 1, r.out);
	assert.match(r.out, /pi rejects models.json/);
	assert.match(r.out, /inputLimits/);
});
