import test from "node:test";
import assert from "node:assert/strict";
import { buildWingmanToolInstruction, parseNaturalWingmanRequest, reviewerHintsFromConfig } from "../src/input.ts";

const reviewers = [
	{ name: "codex", provider: "openai", model: "gpt-5-codex" },
	{ name: "gem", provider: "google", model: "gemini-2.5-pro" },
];

test("natural routing uses configured reviewer hints", () => {
	const hints = reviewerHintsFromConfig(reviewers);
	assert.equal(hints.includes("codex"), true);
	assert.equal(hints.includes("gemini"), true);
	assert.deepEqual(parseNaturalWingmanRequest("audit with codex this plan", hints), {
		reviewerHint: "codex",
		request: "codex this plan",
	});
});

test("natural routing ignores unknown reviewer names", () => {
	const hints = reviewerHintsFromConfig(reviewers);
	assert.equal(parseNaturalWingmanRequest("audit with random this plan", hints), undefined);
});

test("natural routing handles wingman as product name, not reviewer alias", () => {
	const hints = reviewerHintsFromConfig(reviewers);
	assert.equal(parseNaturalWingmanRequest("ask wingman find consensus", hints)?.request, "find consensus");
	assert.equal(parseNaturalWingmanRequest("ask wingman find consensus", hints)?.reviewerHint, undefined);
	assert.deepEqual(parseNaturalWingmanRequest("audit with wingman", hints), { request: "audit with wingman" });
	assert.deepEqual(parseNaturalWingmanRequest("check with wingman", hints), { request: "check with wingman" });
	assert.deepEqual(parseNaturalWingmanRequest("audit with wingman this plan", hints), { request: "this plan" });
	assert.equal(parseNaturalWingmanRequest("do not ask wingman about this", hints), undefined);
});

test("tool instruction includes synthesis guidance", () => {
	const text = buildWingmanToolInstruction({ request: "audit", reviewerHint: "codex" });
	assert.match(text, /Call the `wingman` tool/);
	assert.match(text, /reviewerHint: codex/);
	assert.match(text, /synthesize/);
	assert.match(text, /stop and wait/i);
});
