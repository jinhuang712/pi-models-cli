import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { HELP } from "../src/help.ts";

const text = readFileSync(new URL("../skills/pi-models/SKILL.md", import.meta.url), "utf8");

test("the skill has the frontmatter pi needs: a name equal to its folder, and a routing description", () => {
	const front = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
	assert.match(front, /^name: pi-models$/m);
	const description = /^description: (.+)$/m.exec(front)?.[1] ?? "";
	assert.ok(description.length > 80, "the description must say what the skill does and when to use it");
	assert.match(description, /new model is released/);
});

test("every pi-models command the skill mentions is a real command", () => {
	const mentioned = new Set([...text.matchAll(/pi-models ([a-z]+)/g)].map((m) => m[1] as string));
	for (const word of mentioned) assert.ok(word in HELP, `the skill mentions 'pi-models ${word}', which is not a command`);
	for (const command of Object.keys(HELP)) assert.ok(mentioned.has(command), `the skill never mentions pi-models ${command}`);
});

test("the flags the skill promises exist in the help of the command", () => {
	for (const flag of ["--copy-from", "--contextWindow", "--maxTokens", "--reasoning", "--input", "--cost.cacheWrite"]) assert.match(HELP.add as string, new RegExp(flag.replace(".", "\\.")));
	assert.match(HELP.update as string, /--no-reasoning/);
	assert.match(HELP.update as string, /--unset/);
	assert.match(HELP.sync as string, /--prune/);
	assert.match(HELP.undo as string, /--settings/);
});
