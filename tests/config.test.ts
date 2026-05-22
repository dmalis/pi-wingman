import test from "node:test";
import assert from "node:assert/strict";
import { normalizeConfig, defaultWingmanConfig } from "../src/config.ts";

const baseReviewer = { name: "codex", provider: "openai", model: "gpt-5-codex", thinking: "high" as const };

test("config applies defaults and keeps commit-friendly fields", () => {
	const config = normalizeConfig({ reviewers: [baseReviewer] });
	assert.equal(config.version, 1);
	assert.equal(config.exclude, defaultWingmanConfig.exclude);
	assert.equal(config.defaultReviewers, "all-eligible");
	assert.deepEqual(config.logging, { enabled: false, raw: false });
	assert.deepEqual(config.reviewers, [baseReviewer]);
});

test("config rejects missing reviewer aliases", () => {
	assert.throws(() => normalizeConfig({ reviewers: [{ provider: "openai", model: "gpt-5" }] }), /missing required name alias/);
});

test("config rejects non slug reviewer aliases", () => {
	assert.throws(() => normalizeConfig({ reviewers: [{ ...baseReviewer, name: "Bad Alias!" }] }), /must match \[a-z0-9\._-\]\+/);
});

test("config rejects duplicate reviewer aliases", () => {
	assert.throws(() => normalizeConfig({ reviewers: [baseReviewer, { name: "codex", provider: "google", model: "gemini-2.5-pro" }] }), /Duplicate Wingman reviewer alias/);
});
