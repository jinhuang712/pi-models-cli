type Json = Record<string, any>;

export interface Task {
	id: string;
	/** What the user asks, in plain words. */
	ask: string;
	/** Returns a problem, or undefined when the files are what the task asked for. */
	check(before: { models: Json; settings: Json }, after: { models: Json; settings: Json }): string | undefined;
}

const go = (files: { models: Json }) => files.models.providers["opencode-go"].models as Json[];
const find = (list: Json[], id: string) => list.find((m) => m.id === id);
const strip = (m: Json | undefined, ...keys: string[]) => (m === undefined ? undefined : Object.fromEntries(Object.entries(m).filter(([k]) => !keys.includes(k))));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Everything outside the named models of opencode-go, and every other provider, is unchanged. */
function untouched(before: { models: Json }, after: { models: Json }, touched: string[]): string | undefined {
	for (const name of Object.keys(before.models.providers)) {
		if (name !== "opencode-go" && !same(before.models.providers[name], after.models.providers[name])) return `provider ${name} changed`;
	}
	const rest = (f: { models: Json }) => go(f).filter((m) => !touched.includes(m.id));
	if (!same(rest(before), rest(after))) return "another model of opencode-go changed";
	const { models: _m, ...b } = before.models.providers["opencode-go"];
	const { models: _n, ...a } = after.models.providers["opencode-go"];
	return same(a, b) ? undefined : "opencode-go provider fields changed";
}

export const TASKS: Task[] = [
	{
		id: "add-sibling",
		ask: "A new model glm-5.4 is out for provider opencode-go. It is like glm-5.3, but with a 2000000 token context window. Add it.",
		check(before, after) {
			const made = find(go(after), "glm-5.4");
			if (!made) return "glm-5.4 was not added";
			const want = { ...strip(find(go(before), "glm-5.3"), "id", "name"), contextWindow: 2000000 };
			if (!same(strip(made, "id", "name"), want)) return "glm-5.4 differs from glm-5.3 in more than its context window";
			return untouched(before, after, ["glm-5.4"]) ?? (same(before.settings, after.settings) ? undefined : "settings changed");
		},
	},
	{
		id: "remove-two",
		ask: "Provider opencode-go retired the models kimi-k3 and kimi-k2.7-code. Remove them.",
		check(before, after) {
			if (find(go(after), "kimi-k3") || find(go(after), "kimi-k2.7-code")) return "a retired model is still there";
			return untouched(before, after, ["kimi-k3", "kimi-k2.7-code"]);
		},
	},
	{
		id: "release-day",
		ask: "Release day for provider opencode-go: add the model hy5 as a copy of hy4-preview but with a 256000 token context window, retire hy4-preview, and make opencode-go/hy5 the model pi starts with.",
		check(before, after) {
			const made = find(go(after), "hy5");
			if (!made) return "hy5 was not added";
			const want = { ...strip(find(go(before), "hy4-preview"), "id", "name"), contextWindow: 256000 };
			if (!same(strip(made, "id", "name"), want)) return "hy5 differs from hy4-preview in more than its context window";
			if (find(go(after), "hy4-preview")) return "hy4-preview is still there";
			const e = untouched(before, after, ["hy5", "hy4-preview"]);
			if (e) return e;
			const s = after.settings;
			if (s.defaultProvider !== "opencode-go" || s.defaultModel !== "hy5") return "the default model is not opencode-go/hy5";
			return s.theme === before.settings.theme ? undefined : "another setting changed";
		},
	},
	{
		id: "limits-and-reasoning",
		ask: "For opencode-go/glm-5.3, set the max output tokens to 65536 and mark it as not a reasoning model.",
		check(before, after) {
			const m = find(go(after), "glm-5.3");
			const want = { ...find(go(before), "glm-5.3"), maxTokens: 65536, reasoning: false };
			if (!same(m, want)) return "glm-5.3 is not exactly the old entry with the two changes";
			return untouched(before, after, ["glm-5.3"]);
		},
	},
	{
		id: "settings",
		ask: "Set pi's default thinking level to high, and make pi start with and cycle through only the opencode-go models.",
		check(before, after) {
			const s = after.settings;
			if (s.defaultThinkingLevel !== "high") return "the default thinking level is not high";
			if (!Array.isArray(s.enabledModels) || s.enabledModels.length !== 1 || !/^opencode-go\/\*$/.test(s.enabledModels[0])) return "enabledModels is not exactly [\"opencode-go/*\"]";
			if (s.theme !== before.settings.theme) return "another setting changed";
			return same(before.models, after.models) ? undefined : "models.json changed";
		},
	},
];
