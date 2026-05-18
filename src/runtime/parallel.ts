import type { DirectRunnerContext } from "./direct-runner.ts";
import { runDirectReviewer } from "./direct-runner.ts";
import { runSubagentReviewer } from "./subagent-runner.ts";
import { buildRoundDigest, consensusReached } from "../review/prompts.ts";
import type { ResolvedReviewer, ReviewerProgress, ReviewerResult, WingmanContextPack } from "../types.ts";

export type ReviewerRunner = (options: ParallelRunOptions, reviewer: ResolvedReviewer, round: number, previousRoundDigest?: string) => Promise<ReviewerResult>;

export type ParallelRunOptions = {
	ctx: DirectRunnerContext;
	context: WingmanContextPack;
	reviewers: ResolvedReviewer[];
	maxRounds: number;
	maxParallel: number;
	signal?: AbortSignal;
	onProgress?: (progress: ReviewerProgress) => void;
	runner?: ReviewerRunner;
};

async function runWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
		for (;;) {
			const index = next++;
			if (index >= items.length) return;
			results[index] = await fn(items[index], index);
		}
	});
	await Promise.all(workers);
	return results;
}

async function runReviewer(options: ParallelRunOptions, reviewer: ResolvedReviewer, round: number, previousRoundDigest?: string): Promise<ReviewerResult> {
	options.onProgress?.({ reviewer, status: "running", round });
	const result = options.context.backend === "subagent"
		? await runSubagentReviewer({ reviewer, context: options.context, round, previousRoundDigest, signal: options.signal })
		: await runDirectReviewer({ ctx: options.ctx, reviewer, context: options.context, round, previousRoundDigest });
	options.onProgress?.({ reviewer, status: result.status, round, summary: result.summary, error: result.error });
	return result;
}

export async function runParallelWingmen(options: ParallelRunOptions): Promise<{ results: ReviewerResult[]; rounds: number; cancelled: boolean }> {
	const allResults: ReviewerResult[] = [];
	let previousRoundDigest: string | undefined;
	let activeReviewers = options.reviewers;
	let rounds = 0;
	for (let round = 1; round <= options.maxRounds; round += 1) {
		if (options.signal?.aborted) break;
		rounds = round;
		const runner = options.runner ?? runReviewer;
		const roundResults = await runWithConcurrency(activeReviewers, options.maxParallel, (reviewer) => runner(options, reviewer, round, previousRoundDigest));
		allResults.push(...roundResults);
		const successful = roundResults.filter((result) => result.status === "ok" && result.output);
		if (options.context.mode !== "consensus") break;
		if (round >= options.maxRounds) break;
		if (successful.length <= 1) break;
		if (consensusReached(successful.map((result) => result.output ?? ""))) break;
		previousRoundDigest = buildRoundDigest(successful.map((result) => ({ reviewer: result.reviewer, output: result.output, summary: result.summary })));
		activeReviewers = successful.map((result) => result.reviewer);
	}
	return { results: allResults, rounds, cancelled: Boolean(options.signal?.aborted || allResults.some((result) => result.status === "cancelled")) };
}
