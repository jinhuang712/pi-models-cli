import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { cli, sandbox, write, type Sandbox } from "./helpers.ts";

// G6: probe costs nothing. A real local server logs every request it receives.
const requests: { method: string; url: string; auth?: string; body: string; headers: IncomingMessage["headers"] }[] = [];
let mode: "ok" | "401" | "404" | "open" = "ok";
let served: unknown = { data: [{ id: "good" }, { id: "other" }] };
let base = "";
const server = createServer((req: IncomingMessage, res: ServerResponse) => {
	let body = "";
	req.on("data", (c) => (body += c));
	req.on("end", () => {
		requests.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, ...(req.headers.authorization ? { auth: req.headers.authorization } : {}), body });
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
	assert.match(r.out, /! key {6}the endpoint lists models with no credentials at all/);
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

// Credentials must stay on the host they belong to, and out of the output.
test("a redirect is not followed, so no credential reaches another host (probe and sync)", async () => {
	let hits = 0;
	const other = createServer((_req, res) => {
		hits++;
		res.writeHead(200).end("{}");
	});
	await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", resolve));
	const target = `http://127.0.0.1:${(other.address() as AddressInfo).port}/models`;
	const redirecting = createServer((_req, res) => {
		res.writeHead(307, { location: target }).end();
	});
	await new Promise<void>((resolve) => redirecting.listen(0, "127.0.0.1", resolve));
	try {
		const url = `http://127.0.0.1:${(redirecting.address() as AddressInfo).port}/v1`;
		const sb = sandbox(JSON.stringify(config({ baseUrl: url, api: "anthropic-messages", headers: { "api-key": "HDR-SECRET-456" }, apiKey: "KEY-SECRET-123" })));
		fakePi(sb, TABLE(["good"]));
		const probed = await cli(sb, "probe", "p/good");
		assert.equal(probed.code, 1);
		assert.match(probed.out, /redirects instead of answering/);
		const synced = await cli(sb, "sync", "p");
		assert.equal(synced.code, 1);
		assert.match(synced.err, /redirect \(not followed/);
		assert.equal(hits, 0, "the other host received a request");
		assert.doesNotMatch(probed.out + synced.err, /SECRET/);
	} finally {
		other.close();
		redirecting.close();
	}
});

test("a key that is not a valid header value is never echoed (probe, probe --json and sync)", async () => {
	const sb = setup({ apiKey: "!printf 'warning: token cache stale\\nsk-SECRET-789'" });
	const human = await cli(sb, "probe", "p/good");
	const json = await cli(sb, "probe", "p/good", "--json");
	const synced = await cli(sb, "sync", "p");
	for (const r of [human, json, synced]) {
		assert.doesNotMatch(r.out + r.err, /sk-SECRET-789|token cache stale/);
		assert.notEqual(r.code, 0);
	}
	assert.match(human.out, /✗ endpoint .*header value cannot be sent/);
	assert.equal(requests.length, 0, "nothing was sent");
});

test("redact removes every header value and the bare key from an error text", async () => {
	const { redact } = await import("../src/sync.ts");
	const text = redact("bad value Bearer sk-abc-1234 and x-1234567 and sk-abc-1234", { accept: "application/json", authorization: "Bearer sk-abc-1234", "x-api-key": "x-1234567" });
	assert.equal(text, "bad value *** and *** and ***");
});

test("pi runs in a throwaway folder: your agent folder is untouched and only API keys are copied", async () => {
	mode = "ok";
	const sb = setup();
	write(sb, "auth.json", { p: { type: "api_key", key: "secret" }, anthropic: { type: "oauth", access: "OAUTH-TOKEN", refresh: "OAUTH-REFRESH" } });
	const script = join(sb.dir, "recording-pi.sh");
	const rec = join(sb.dir, "..", `rec-${process.pid}`);
	mkdirSync(rec, { recursive: true });
	writeFileSync(
		script,
		`#!/bin/sh\necho "$PI_CODING_AGENT_DIR" > ${rec}/dir\npwd > ${rec}/cwd\ncat "$PI_CODING_AGENT_DIR/auth.json" > ${rec}/auth 2>/dev/null\ntouch "$PI_CODING_AGENT_DIR/models-store.json" "$PI_CODING_AGENT_DIR/new-file"\ncat <<'EOF'\n${TABLE(["good"])}\nEOF\n`,
	);
	chmodSync(script, 0o755);
	sb.env.PI_MODELS_PI_BIN = script;
	const before2 = readdirSync(sb.dir).sort();
	const r = await cli(sb, "probe", "p/good");
	assert.equal(r.code, 0, r.out + r.err);
	const used = readFileSync(join(rec, "dir"), "utf8").trim();
	assert.notEqual(used, sb.dir);
	assert.equal(readFileSync(join(rec, "cwd"), "utf8").trim().replace(/^\/private/, ""), used.replace(/^\/private/, ""));
	assert.equal(existsSync(used), false, "the throwaway folder is removed");
	assert.deepEqual(readdirSync(sb.dir).sort(), before2, "no file appeared in your agent folder");
	assert.deepEqual(JSON.parse(readFileSync(join(rec, "auth"), "utf8")), { p: { type: "api_key", key: "secret" } });
	rmSync(rec, { recursive: true, force: true });
});

test("the comparison request without a key carries no provider headers either", async () => {
	mode = "open";
	const sb = setup({ headers: { "x-routing-secret": "abc123" } });
	await cli(sb, "probe", "p/good");
	const bare = requests.filter((q) => q.auth === undefined);
	assert.ok(bare.length > 0);
	for (const q of bare) assert.equal(q.headers["x-routing-secret"], undefined, "a provider header went out on the credential-free request");
	assert.ok(requests.some((q) => q.auth === "Bearer secret" && q.headers["x-routing-secret"] === "abc123"), "the normal request still carries the provider header");
});
