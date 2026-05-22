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

function context(): WingmanContextPack {
	return {
		target: { type: "freeform", focus: "audit", confidence: "high" },
		label: "freeform request",
		focus: "audit",
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
		maxParallel: 2,
		runner: async (_options, item): Promise<ReviewerResult> => {
			if (item.name === "ok") return { reviewer: item, status: "ok", backend: "direct", prompt: "", output: "Looks sound. Ship it.", summary: "Looks sound" };
			if (item.name === "failed") return { reviewer: item, status: "failed", backend: "direct", prompt: "", error: "boom" };
			return { reviewer: item, status: "cancelled", backend: "direct", prompt: "", error: "aborted" };
		},
	});
	assert.equal(result.cancelled, true);
	assert.deepEqual(result.results.map((item) => item.status), ["ok", "failed", "cancelled"]);
});

test("parallel runner runs each reviewer once", async () => {
	const reviewers = [reviewer("a"), reviewer("b")];
	const result = await runParallelWingmen({
		ctx,
		context: context(),
		reviewers,
		maxParallel: 2,
		runner: async (_options, item): Promise<ReviewerResult> => ({ reviewer: item, status: "ok", backend: "direct", prompt: "", output: "Second opinion.", summary: "ok" }),
	});
	assert.equal(result.results.length, 2);
});

test("parallel runner reports aborted before starting", async () => {
	const controller = new AbortController();
	controller.abort();
	const result = await runParallelWingmen({ ctx, context: context(), reviewers: [reviewer("a")], maxParallel: 1, signal: controller.signal });
	assert.equal(result.cancelled, true);
	assert.deepEqual(result.results.map((item) => item.status), ["cancelled"]);
});
