import test from "node:test";
import assert from "node:assert/strict";
import { reviewerOutputSignals, summarizeReviewerOutput } from "../src/review/prompts.ts";

test("reviewer output signals distinguish approve and concern terms", () => {
	assert.deepEqual(reviewerOutputSignals("Approve; blocking issue."), { approve: true, concern: true, yes: false, no: false });
});

test("summary prefers headings and bullets", () => {
	const summary = summarizeReviewerOutput("Intro\n# Verdict\n- first\n- second\nplain");
	assert.match(summary, /# Verdict/);
	assert.match(summary, /- first/);
});
