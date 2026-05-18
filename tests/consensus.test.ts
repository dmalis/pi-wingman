import test from "node:test";
import assert from "node:assert/strict";
import { consensusReached, reviewerOutputSignals, summarizeReviewerOutput } from "../src/review/prompts.ts";

test("consensus reaches when reviewers all approve", () => {
	assert.equal(consensusReached(["Looks sound. Ship it.", "No blocking concerns; approve."]), true);
});

test("consensus does not reach on conflicting yes/no recommendations", () => {
	assert.equal(consensusReached(["Yes, recommend adding it.", "No, avoid this approach."]), false);
});

test("consensus reaches for one or zero outputs", () => {
	assert.equal(consensusReached(["No material issues."]), true);
	assert.equal(consensusReached([]), true);
});

test("reviewer output signals distinguish approve and concern terms", () => {
	assert.deepEqual(reviewerOutputSignals("Approve; blocking issue."), { approve: true, concern: true, yes: false, no: false });
});

test("summary prefers headings and bullets", () => {
	const summary = summarizeReviewerOutput("Intro\n# Verdict\n- first\n- second\nplain");
	assert.match(summary, /# Verdict/);
	assert.match(summary, /- first/);
});
