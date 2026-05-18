import test from "node:test";
import assert from "node:assert/strict";
import { runParallelWingmen } from "../src/runtime/parallel.ts";
import type { ResolvedReviewer, ReviewerResult, WingmanContextPack } from "../src/types.ts";

function reviewer(name: string): ResolvedReviewer {
	return {
		name,
		provider: "test",
		model: name,
		modelRef: { provider: "test", id: name, name, reasoning: false } as any,
		key: `test/${name}`,
		label: name,
		sameProvider: false,
		sameModel: false,
	};
}

function context(mode: WingmanContextPack["mode"] = "audit"): WingmanContextPack {
	return {
		target: { type: "freeform", focus: "audit", confidence: "high" },
		label: "freeform request",
		focus: "audit",
		mode,
		cwd: "/tmp",
		content: "context",
		backend: "direct",
		reason: "test",
	};
}

const ctx = { modelRegistry: { getAvailable: () => [], find: () => undefined, getApiKeyAndHeaders: async () => ({ ok: false as const, error: "no auth" }) } } as any;

test("parallel runner preserves ok, failed, and cancelled results", async () => {
	const reviewers = [reviewer("ok"), reviewer("failed"), reviewer("cancelled")];
	const result = await runParallelWingmen({
		ctx,
		context: context(),
		reviewers,
		maxRounds: 1,
		maxParallel: 2,
		runner: async (_options, item, round): Promise<ReviewerResult> => {
			if (item.name === "ok") return { reviewer: item, status: "ok", round, backend: "direct", prompt: "", output: "Looks sound. Ship it.", summary: "Looks sound" };
			if (item.name === "failed") return { reviewer: item, status: "failed", round, backend: "direct", prompt: "", error: "boom" };
			return { reviewer: item, status: "cancelled", round, backend: "direct", prompt: "", error: "aborted" };
		},
	});
	assert.equal(result.rounds, 1);
	assert.equal(result.cancelled, true);
	assert.deepEqual(result.results.map((item) => item.status), ["ok", "failed", "cancelled"]);
});

test("consensus mode stops early when consensus is reached", async () => {
	const reviewers = [reviewer("a"), reviewer("b")];
	const result = await runParallelWingmen({
		ctx,
		context: context("consensus"),
		reviewers,
		maxRounds: 3,
		maxParallel: 2,
		runner: async (_options, item, round): Promise<ReviewerResult> => ({ reviewer: item, status: "ok", round, backend: "direct", prompt: "", output: "Yes, recommend doing it.", summary: "yes" }),
	});
	assert.equal(result.rounds, 1);
	assert.equal(result.results.length, 2);
});

test("consensus mode continues when reviewers disagree", async () => {
	const reviewers = [reviewer("yes"), reviewer("no")];
	const result = await runParallelWingmen({
		ctx,
		context: context("consensus"),
		reviewers,
		maxRounds: 2,
		maxParallel: 2,
		runner: async (_options, item, round): Promise<ReviewerResult> => ({
			reviewer: item,
			status: "ok",
			round,
			backend: "direct",
			prompt: "",
			output: item.name === "yes" ? "Yes, recommend doing it." : "No, avoid this approach.",
			summary: item.name,
		}),
	});
	assert.equal(result.rounds, 2);
	assert.equal(result.results.length, 4);
});

test("parallel runner reports aborted before starting", async () => {
	const controller = new AbortController();
	controller.abort();
	const result = await runParallelWingmen({ ctx, context: context(), reviewers: [reviewer("a")], maxRounds: 1, maxParallel: 1, signal: controller.signal });
	assert.equal(result.cancelled, true);
	assert.equal(result.rounds, 0);
	assert.deepEqual(result.results, []);
});
