import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfiguredReviewers, reviewerMatchesHint, selectReviewers, type CurrentModel } from "../src/reviewer-selection.ts";
import type { WingmanConfig } from "../src/types.ts";

function model(provider: string, id: string) {
	return { provider, id, name: id, reasoning: true } as any;
}

function registry(models: Array<{ provider: string; id: string }>) {
	return {
		getAvailable: () => models.map((item) => model(item.provider, item.id)),
		find: (provider: string, id: string) => models.some((item) => item.provider === provider && item.id === id) ? model(provider, id) : undefined,
	};
}

function config(exclude: WingmanConfig["exclude"]): WingmanConfig {
	return {
		version: 1,
		exclude,
		defaultReviewers: "all-eligible",
		maxRounds: 3,
		maxParallelReviewers: 4,
		logging: { enabled: false, raw: false },
		reviewers: [
			{ name: "opus46", provider: "anthropic", model: "claude-opus-4.6" },
			{ name: "opus47", provider: "anthropic", model: "claude-opus-4.7" },
			{ name: "gemini", provider: "google", model: "gemini-2.5-pro" },
		],
	};
}

const allModels = registry([
	{ provider: "anthropic", id: "claude-opus-4.6" },
	{ provider: "anthropic", id: "claude-opus-4.7" },
	{ provider: "google", id: "gemini-2.5-pro" },
]);
const current: CurrentModel = { provider: "anthropic", id: "claude-opus-4.6" };

test("same-provider policy excludes all current-provider reviewers", () => {
	const selected = resolveConfiguredReviewers(config("same-provider"), allModels, current);
	assert.deepEqual(selected.map((reviewer) => reviewer.name), ["gemini"]);
});

test("same-model policy allows same-provider different model", () => {
	const selected = resolveConfiguredReviewers(config("same-model"), allModels, current);
	assert.deepEqual(selected.map((reviewer) => reviewer.name), ["opus47", "gemini"]);
});

test("exact same model is excluded even under same-model policy", () => {
	const selected = resolveConfiguredReviewers(config("same-model"), allModels, current);
	assert.equal(selected.some((reviewer) => reviewer.provider === "anthropic" && reviewer.model === "claude-opus-4.6"), false);
});

test("hint matching uses configured reviewer fields", () => {
	assert.equal(reviewerMatchesHint({ name: "gemini", provider: "google", model: "gemini-2.5-pro" }, "gem"), true);
	assert.equal(reviewerMatchesHint({ name: "gemini", provider: "google", model: "gemini-2.5-pro" }, "codex"), false);
});

test("ambiguous hints fail closed", () => {
	const eligible = resolveConfiguredReviewers(config("same-model"), allModels, undefined);
	assert.throws(() => selectReviewers({ eligible, hint: "opus" }), /Multiple eligible Wingman reviewers match hint/);
});

test("exact configured reviewer name wins before fuzzy model matching", () => {
	const eligible = resolveConfiguredReviewers(config("same-model"), allModels, undefined);
	assert.deepEqual(selectReviewers({ eligible, hint: "opus47" }).map((reviewer) => reviewer.name), ["opus47"]);
});

test("configured reviewer models must exist in registry", () => {
	assert.throws(() => resolveConfiguredReviewers(config("same-model"), registry([{ provider: "google", id: "gemini-2.5-pro" }]), undefined), /not available to Pi/);
});
