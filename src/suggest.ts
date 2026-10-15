function distance(a: string, b: string): number {
	const row = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		let prev = row[0] as number;
		row[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const next = row[j] as number;
			row[j] = Math.min(next + 1, (row[j - 1] as number) + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
			prev = next;
		}
	}
	return row[b.length] as number;
}

/** The candidate closest to `input`, or undefined when nothing is close enough to be a typo. */
export function closest(input: string, candidates: readonly string[]): string | undefined {
	const lower = input.toLowerCase();
	let best: string | undefined;
	let bestScore = Number.POSITIVE_INFINITY;
	for (const candidate of candidates) {
		const c = candidate.toLowerCase();
		const score = c.includes(lower) || lower.includes(c) ? 1 : distance(lower, c);
		if (score < bestScore) {
			best = candidate;
			bestScore = score;
		}
	}
	const limit = Math.max(2, Math.ceil(input.length / 3));
	return best !== undefined && bestScore <= limit ? best : undefined;
}

/** " did you mean X?" or an empty string. */
export function didYouMean(input: string, candidates: readonly string[]): string {
	const hit = closest(input, candidates);
	return hit === undefined ? "" : `; did you mean ${hit}?`;
}
