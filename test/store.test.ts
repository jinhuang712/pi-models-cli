import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, symlinkSync, chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { BACKUPS_KEPT, backupDir, listBackups } from "../src/store.ts";
import { FIXTURE, cli, sandbox } from "./helpers.ts";

// G3: every write can be undone, and a crash mid-write leaves the original intact.

test("undo restores a byte-identical file after each kind of change", async () => {
	const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")).providers["opencode-go"].models[0].id as string;
	for (const args of [
		["add", "opencode-go/zz-new", "--contextWindow", "9"],
		["update", `opencode-go/${fixture}`, "--maxTokens", "7"],
		["remove", `opencode-go/${fixture}`],
	]) {
		const sb = sandbox();
		const original = readFileSync(sb.models, "utf8");
		const changed = await cli(sb, ...args);
		assert.equal(changed.code, 0, changed.err);
		assert.notEqual(readFileSync(sb.models, "utf8"), original);
		const undone = await cli(sb, "undo");
		assert.equal(undone.code, 0, undone.err);
		assert.equal(readFileSync(sb.models, "utf8"), original, args.join(" "));
	}
});

test("undo twice steps back two changes", async () => {
	const sb = sandbox();
	const original = readFileSync(sb.models, "utf8");
	await cli(sb, "add", "opencode-go/zz-1", "--contextWindow", "1");
	const afterFirst = readFileSync(sb.models, "utf8");
	await cli(sb, "add", "opencode-go/zz-2", "--contextWindow", "2");
	await cli(sb, "undo");
	assert.equal(readFileSync(sb.models, "utf8"), afterFirst);
	await cli(sb, "undo");
	assert.equal(readFileSync(sb.models, "utf8"), original);
	const third = await cli(sb, "undo");
	assert.equal(third.code, 1);
	assert.match(third.err, /no backups/);
});

test("--dry-run writes nothing and makes no backup", async () => {
	const sb = sandbox();
	const original = readFileSync(sb.models, "utf8");
	const r = await cli(sb, "add", "opencode-go/zz-new", "--contextWindow", "9", "--dry-run");
	assert.equal(r.code, 0);
	assert.match(r.out, /dry run: nothing written/);
	assert.equal(readFileSync(sb.models, "utf8"), original);
	assert.equal(existsSync(backupDir(sb.models)), false);
});

test("only the newest backups are kept", async () => {
	const sb = sandbox();
	for (let i = 0; i < BACKUPS_KEPT + 5; i++) {
		const r = await cli(sb, "add", `opencode-go/zz-${i}`, "--contextWindow", "1");
		assert.equal(r.code, 0, r.err);
	}
	assert.equal(listBackups(sb.models).length, BACKUPS_KEPT);
});

test("a validation failure writes nothing and makes no backup", async () => {
	const sb = sandbox();
	const original = readFileSync(sb.models, "utf8");
	const r = await cli(sb, "add", "opencode-go/zz-new", "--cost.input", "1");
	assert.equal(r.code, 1);
	assert.match(r.err, /cost needs all of/);
	assert.equal(readFileSync(sb.models, "utf8"), original);
	assert.equal(existsSync(backupDir(sb.models)), false);
});

test("a process killed between the temp write and the rename leaves the original intact", () => {
	const sb = sandbox();
	const original = readFileSync(sb.models, "utf8");
	const result = spawnSync(process.execPath, [new URL("../src/cli.ts", import.meta.url).pathname, "add", "opencode-go/zz-new", "--contextWindow", "9"], {
		env: { ...sb.env, PI_MODELS_TEST_CRASH_BEFORE_RENAME: "1" },
	});
	assert.equal(result.signal, "SIGKILL");
	assert.equal(readFileSync(sb.models, "utf8"), original);
	JSON.parse(readFileSync(sb.models, "utf8"));
});

test("the file mode is kept", async () => {
	const sb = sandbox();
	chmodSync(sb.models, 0o600);
	await cli(sb, "add", "opencode-go/zz-new", "--contextWindow", "9");
	assert.equal(statSync(sb.models).mode & 0o777, 0o600);
});

test("a symlinked models.json is edited in place, and the link stays a link", async () => {
	const sb = sandbox();
	const real = join(sb.dir, "real.json");
	writeFileSync(real, readFileSync(sb.models));
	const link = join(sb.dir, "link.json");
	symlinkSync(real, link);
	const r = await cli(sb, "add", "opencode-go/zz-new", "--contextWindow", "9", "--config", link);
	assert.equal(r.code, 0, r.err);
	assert.match(readFileSync(real, "utf8"), /zz-new/);
	assert.ok(readdirSync(sb.dir).includes("link.json"));
	assert.equal(statSync(link).isFile(), true);
	assert.notEqual(readFileSync(real, "utf8"), readFileSync(sb.models, "utf8"));
});
