/** The ten typical mistakes of G5. Each is a task, the command that goes wrong, and the command that fixes it. */
export interface Scenario {
	id: string;
	task: string;
	/** Arguments after `pi-models`, as a weak model might first write them. */
	mistaken: string[];
	/** Arguments of a correct command. The files it produces are the expected result. */
	correct: string[];
}

export const SCENARIOS: Scenario[] = [
	{
		id: "typo-model-id",
		task: "Set the context window of the model glm-5.3-flash in provider opencode-go to 1000000.",
		mistaken: ["update", "opencode-go/glm-5.3-flsh", "--contextWindow", "1000000"],
		correct: ["update", "opencode-go/glm-5.3-flash", "--contextWindow", "1000000"],
	},
	{
		id: "typo-provider",
		task: "Add a model hy5 to provider opencode-go, with context window 256000 and max output tokens 32000.",
		mistaken: ["add", "opencode_go/hy5", "--contextWindow", "256000", "--maxTokens", "32000"],
		correct: ["add", "opencode-go/hy5", "--contextWindow", "256000", "--maxTokens", "32000"],
	},
	{
		id: "kebab-flag",
		task: "Add a model hy5 to provider opencode-go, with context window 256000.",
		mistaken: ["add", "opencode-go/hy5", "--context-window", "256000"],
		correct: ["add", "opencode-go/hy5", "--contextWindow", "256000"],
	},
	{
		id: "add-existing",
		task: "Change the max output tokens of the existing model glm-5.3 in provider opencode-go to 65536.",
		mistaken: ["add", "opencode-go/glm-5.3", "--maxTokens", "65536"],
		correct: ["update", "opencode-go/glm-5.3", "--maxTokens", "65536"],
	},
	{
		id: "partial-cost",
		task: "Add a model hy5 to provider opencode-go. Its input price is 0.4 and its output price is 1.2 dollars per 1M tokens; both cache prices are 0.",
		mistaken: ["add", "opencode-go/hy5", "--cost.input", "0.4", "--cost.output", "1.2"],
		correct: ["add", "opencode-go/hy5", "--cost.input", "0.4", "--cost.output", "1.2", "--cost.cacheRead", "0", "--cost.cacheWrite", "0"],
	},
	{
		id: "number-shorthand",
		task: "Set the context window of the model glm-5.3-flash in provider opencode-go to one million tokens.",
		mistaken: ["update", "opencode-go/glm-5.3-flash", "--contextWindow", "1M"],
		correct: ["update", "opencode-go/glm-5.3-flash", "--contextWindow", "1000000"],
	},
	{
		id: "no-provider-prefix",
		task: "Remove the model kimi-k3 from provider opencode-go.",
		mistaken: ["remove", "kimi-k3"],
		correct: ["remove", "opencode-go/kimi-k3"],
	},
	{
		id: "update-without-field",
		task: "Mark the model glm-5.3 in provider opencode-go as not a reasoning model.",
		mistaken: ["update", "opencode-go/glm-5.3"],
		correct: ["update", "opencode-go/glm-5.3", "--no-reasoning"],
	},
	{
		id: "bad-thinking-level",
		task: "Set pi's default thinking level to high.",
		mistaken: ["default", "--thinking", "hihg"],
		correct: ["default", "--thinking", "high"],
	},
	{
		id: "boolean-with-value",
		task: "Mark the model glm-5.3-flash in provider opencode-go as not a reasoning model.",
		mistaken: ["update", "opencode-go/glm-5.3-flash", "--reasoning", "false"],
		correct: ["update", "opencode-go/glm-5.3-flash", "--no-reasoning"],
	},
];
