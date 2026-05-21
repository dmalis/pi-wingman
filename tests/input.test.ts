import test from "node:test";
import assert from "node:assert/strict";
import { buildWingmanToolInstruction, parseNaturalWingmanRequest, reviewerHintsFromConfig } from "../src/input.ts";

const reviewers = [
	{ name: "codex", provider: "openai", model: "gpt-5-codex" },
	{ name: "gem", provider: "google", model: "gemini-2.5-pro" },
	{ name: "haiku", provider: "anthropic", model: "claude-haiku-4-5" },
];

test("natural routing parses configured reviewer-hint review phrases", () => {
	const hints = reviewerHintsFromConfig(reviewers);
	assert.equal(hints.includes("codex"), true);
	assert.equal(hints.includes("gemini"), true);
	assert.deepEqual(parseNaturalWingmanRequest("audit with codex: is this plan safe?", hints), {
		reviewerHint: "codex",
		request: "is this plan safe",
	});
	assert.deepEqual(parseNaturalWingmanRequest("check this with gemini", hints), {
		reviewerHint: "gemini",
		request: "check this",
	});
	assert.deepEqual(parseNaturalWingmanRequest("run this by claude", hints), {
		reviewerHint: "claude",
		request: "this",
	});
	assert.deepEqual(parseNaturalWingmanRequest("ask haiku to review this plan", hints), {
		reviewerHint: "haiku",
		request: "review this plan",
	});
	assert.deepEqual(parseNaturalWingmanRequest("ask codex: is this safe?", hints), {
		reviewerHint: "codex",
		request: "is this safe",
	});
});

test("natural routing preserves unknown explicit reviewer hints for configured-only tool resolution", () => {
	const hints = reviewerHintsFromConfig(reviewers);
	assert.deepEqual(parseNaturalWingmanRequest("audit with random: this plan", hints), {
		reviewerHint: "random",
		request: "this plan",
	});
});

test("natural routing handles wingman as product name, not reviewer alias", () => {
	const hints = reviewerHintsFromConfig(reviewers);
	assert.deepEqual(parseNaturalWingmanRequest("ask wingman to review this", hints), { request: "review this" });
	assert.deepEqual(parseNaturalWingmanRequest("ask wingman find consensus", hints), { request: "find consensus" });
	assert.deepEqual(parseNaturalWingmanRequest("wingman audit this plan", hints), { request: "audit this plan" });
	assert.deepEqual(parseNaturalWingmanRequest("ask wingman haiku: review this plan", hints), { request: "review this plan", reviewerHint: "haiku" });
	assert.equal(parseNaturalWingmanRequest("do not ask wingman about this", hints), undefined);
});

test("natural routing detects all-reviewer requests", () => {
	const hints = reviewerHintsFromConfig(reviewers);
	assert.deepEqual(parseNaturalWingmanRequest("ask all wingmen", hints), { request: "auto", allReviewers: true });
	assert.deepEqual(parseNaturalWingmanRequest("run all reviewers", hints), { request: "auto", allReviewers: true });
	assert.deepEqual(parseNaturalWingmanRequest("ask all wingmen to audit this", hints), { request: "audit this", allReviewers: true });
	assert.deepEqual(parseNaturalWingmanRequest("run all reviewers on this plan", hints), { request: "this plan", allReviewers: true });
	assert.deepEqual(parseNaturalWingmanRequest("get consensus from all reviewers on this", hints), { request: "this", allReviewers: true });
	assert.deepEqual(parseNaturalWingmanRequest("review this with all reviewers", hints), { request: "review this", allReviewers: true });
});

test("natural routing ignores passive mentions, config/setup/help, and negation", () => {
	const hints = reviewerHintsFromConfig(reviewers);
	assert.equal(parseNaturalWingmanRequest("Gemini has a large context window", hints), undefined);
	assert.equal(parseNaturalWingmanRequest("Codex docs say the API changed", hints), undefined);
	assert.equal(parseNaturalWingmanRequest("configure gemini as a reviewer", hints), undefined);
	assert.equal(parseNaturalWingmanRequest("wingman config uses gemini", hints), undefined);
	assert.equal(parseNaturalWingmanRequest("wingman setup with all reviewers", hints), undefined);
	assert.equal(parseNaturalWingmanRequest("wingman how do I configure gemini as a reviewer", hints), undefined);
	assert.equal(parseNaturalWingmanRequest("wingman help me set up codex reviewer", hints), undefined);
	assert.equal(parseNaturalWingmanRequest("review without wingman", hints), undefined);
	assert.equal(parseNaturalWingmanRequest("don't ask codex to review this", hints), undefined);
	assert.equal(parseNaturalWingmanRequest("I'm going to ask wingman to check this later", hints), undefined);
});

test("tool instruction includes synthesis guidance and reviewer hints", () => {
	const text = buildWingmanToolInstruction({ request: "audit", reviewerHint: "codex" });
	assert.match(text, /Call the `wingman` tool/);
	assert.match(text, /reviewerHint: codex/);
	assert.match(text, /Only resolve reviewer hints against configured Wingman reviewers/);
	assert.match(text, /synthesize/);
	assert.match(text, /stop and wait/i);
});

test("tool instruction asks before calling when no reviewer hint exists", () => {
	const text = buildWingmanToolInstruction({ request: "review this plan" }, ["codex", "haiku"]);
	assert.doesNotMatch(text, /Call the `wingman` tool with/);
	assert.match(text, /Configured reviewers: codex, haiku/);
	assert.match(text, /Ask the user which configured eligible reviewer/);
	assert.match(text, /Do not call the `wingman` tool until/);
});

test("tool instruction runs all reviewers without hint or names", () => {
	const text = buildWingmanToolInstruction({ request: "audit this", allReviewers: true });
	assert.match(text, /Call the `wingman` tool/);
	assert.match(text, /all eligible configured reviewers/);
	assert.doesNotMatch(text, /reviewerHint:/);
	assert.doesNotMatch(text, /reviewers:/);
});
