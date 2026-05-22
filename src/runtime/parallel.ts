import type { ResolvedReviewer, ReviewerProgress, ReviewerResult, WingmanContextPack } from "../types.ts";
import { runDirectReviewer, type DirectRunnerContext } from "./direct-runner.ts";
import { runSubagentReviewer } from "./subagent-runner.ts";

export type ParallelRunOptions = {
	ctx: DirectRunnerContext;
	context: WingmanContextPack;
	reviewers: ResolvedReviewer[];
	maxParallel: number;
	signal?: AbortSignal;
	onProgress?: (progress: ReviewerProgress) => void;
	runner?: (options: ParallelRunOptions, reviewer: ResolvedReviewer) => Promise<ReviewerResult>;
};

async function runOne(options: ParallelRunOptions, reviewer: ResolvedReviewer): Promise<ReviewerResult> {
	if (options.signal?.aborted) return { reviewer, status: "cancelled", backend: options.context.backend, prompt: "", error: "aborted", durationMs: 0 };
	const startedAt = Date.now();
	options.onProgress?.({ reviewer, status: "running" });
	const result = options.runner
		? await options.runner(options, reviewer)
		: options.context.backend === "subagent"
			? await runSubagentReviewer({ reviewer, context: options.context, signal: options.signal })
			: await runDirectReviewer({ ctx: options.ctx, reviewer, context: options.context });
	const durationMs = Date.now() - startedAt;
	const timedResult = { ...result, durationMs };
	options.onProgress?.({ reviewer, status: timedResult.status, summary: timedResult.summary, error: timedResult.error, durationMs });
	return timedResult;
}

async function runPool<T>(items: T[], limit: number, run: (item: T) => Promise<ReviewerResult>): Promise<ReviewerResult[]> {
	const results: ReviewerResult[] = [];
	let index = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		for (;;) {
			const current = index++;
			if (current >= items.length) return;
			results[current] = await run(items[current]);
		}
	});
	await Promise.all(workers);
	return results;
}

export async function runParallelWingmen(options: ParallelRunOptions): Promise<{ results: ReviewerResult[]; cancelled: boolean }> {
	for (const reviewer of options.reviewers) options.onProgress?.({ reviewer, status: "pending" });
	const results = await runPool(options.reviewers, Math.max(1, options.maxParallel), (reviewer) => runOne(options, reviewer));
	return { results, cancelled: Boolean(options.signal?.aborted || results.some((result) => result.status === "cancelled")) };
}
