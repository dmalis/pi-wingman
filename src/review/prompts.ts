import type { ResolvedReviewer, WingmanContextPack } from "../types.ts";

export function buildReviewerSystemPrompt(): string {
	return [
		"You are Wingman: an independent second-opinion reviewer for a Pi coding session.",
		"You are not the implementer and not the source of truth.",
		"Do not edit files. Do not produce a full patch. Stay read-only.",
		"Review the main agent's answer, plan, proposed change, or user question from the provided context.",
		"Focus on correctness, risks, missed assumptions, alternatives, and whether the proposal is sound.",
		"If the user's request names a specific angle, weight that angle heavily.",
		"Be concrete, grounded, and concise.",
		"Return exactly the markdown sections requested by the user prompt. Do not add extra top-level sections.",
	].join("\n");
}

export function buildReviewerPrompt(input: { reviewer: ResolvedReviewer; context: WingmanContextPack }): string {
	return [
		`# Wingman second-opinion request`,
		`Reviewer: ${input.reviewer.name} (${input.reviewer.key})`,
		`Target: ${input.context.label}`,
		"",
		"## Instructions",
		"Return an independent second opinion for the main agent and user.",
		"Only report claims you can defend from the provided context or read-only inspection.",
		"If the answer/proposal is sound, say so and name the checks that matter most.",
		"Do not produce a full patch.",
		"",
		"## Required output format",
		"Use exactly these sections:",
		"",
		"### Verdict",
		"One sentence: sound / needs attention / unclear, with why.",
		"",
		"### What looks right",
		"Bullets for points you agree with. Use `(none)` if nothing material.",
		"",
		"### Concerns or missed assumptions",
		"Bullets for material risks, gaps, or weak assumptions. Use `(none)` if nothing material.",
		"",
		"### Recommended next action",
		"Bullets with concrete next steps or checks. Keep this short.",
		"",
		"## Context",
		input.context.content,
	].join("\n");
}

export function buildSubagentPrompt(input: { reviewer: ResolvedReviewer; context: WingmanContextPack }): string {
	return [
		buildReviewerSystemPrompt(),
		"",
		"You are running in an isolated read-only Pi worker session. Use read-only tools if needed to inspect the repository.",
		"Do not write, edit, commit, or mutate project files.",
		"",
		buildReviewerPrompt(input),
	].join("\n");
}

export function summarizeReviewerOutput(output: string): string {
	const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
	const headings = lines.filter((line) => /^#{1,4}\s+|^(verdict|what looks right|concerns|recommended next action)\b/i.test(line));
	const bullets = lines.filter((line) => /^[-*]\s+|^\d+\.\s+/.test(line));
	const selected = [...headings.slice(0, 6), ...bullets.slice(0, 8)];
	const fallback = lines.slice(0, 10);
	return (selected.length ? selected : fallback).join("\n").slice(0, 2000);
}

export function reviewerOutputSignals(output: string): { approve: boolean; concern: boolean; yes: boolean; no: boolean } {
	const text = output.toLowerCase();
	return {
		approve: /\b(approve|looks\s+sound|sound\s+plan|correct|ship|no\s+blocking|no\s+material|sound)\b/.test(text),
		concern: /\b(needs\s+attention|block|blocking|risk|bug|issue|unsafe|do\s+not\s+ship|missing|concern)\b/.test(text),
		yes: /\b(yes|recommend|should\s+add|do\s+it|prefer\s+adding)\b/.test(text),
		no: /\b(no|do\s+not|avoid|should\s+not|prefer\s+not)\b/.test(text),
	};
}
