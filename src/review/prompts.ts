import type { ResolvedReviewer, WingmanContextPack, WingmanMode } from "../types.ts";

export function buildReviewerSystemPrompt(mode: WingmanMode): string {
	const base = [
		"You are Wingman: an independent second-opinion reviewer for a Pi coding session.",
		"You are not the implementer and not the source of truth.",
		"Do not edit files. Do not tell the main agent to skip verification.",
		"Focus on material issues that could change the user's or main agent's decision.",
		"Be concrete, grounded, and concise.",
	];
	if (mode === "adversarial") {
		base.push("Adversarial stance: actively try to disprove the approach. Find the strongest reasons this should not ship yet.");
	} else if (mode === "consensus") {
		base.push("Consensus stance: answer the decision question clearly, identify assumptions, and say what evidence would change your mind.");
	} else if (mode === "rescue") {
		base.push("Rescue stance: diagnose the issue and recommend the safest next move. Stay read-only unless explicitly asked otherwise by the parent.");
	}
	return base.join("\n");
}

export function buildReviewerPrompt(input: { reviewer: ResolvedReviewer; context: WingmanContextPack; round: number; previousRoundDigest?: string }): string {
	const modeLine = input.context.mode === "consensus"
		? "Return a clear recommendation, confidence, key assumptions, and where you agree/disagree with any prior digest."
		: "Return findings, risks, recommendations, and strongest remaining checks.";
	return [
		`# Wingman review request`,
		`Reviewer: ${input.reviewer.name} (${input.reviewer.key})`,
		`Round: ${input.round}`,
		`Mode: ${input.context.mode}`,
		`Target: ${input.context.label}`,
		"",
		"## Instructions",
		modeLine,
		"Only report issues you can defend from the provided context or read-only inspection.",
		"If the plan/change is sound, say so and name the checks that matter most.",
		"Do not produce a full patch.",
		"",
		input.previousRoundDigest ? ["## Previous round digest", input.previousRoundDigest].join("\n") : undefined,
		"## Context",
		input.context.content,
	].filter((item): item is string => Boolean(item)).join("\n");
}

export function buildSubagentPrompt(input: { reviewer: ResolvedReviewer; context: WingmanContextPack; round: number; previousRoundDigest?: string }): string {
	return [
		buildReviewerSystemPrompt(input.context.mode),
		"",
		"You are running in an isolated read-only Pi worker session. Use read-only tools if needed to inspect the repository.",
		"Do not write, edit, commit, or mutate project files.",
		"",
		buildReviewerPrompt(input),
	].join("\n");
}

export function buildRoundDigest(results: Array<{ reviewer: ResolvedReviewer; output?: string; summary?: string; error?: string }>): string {
	return results.map((result) => {
		const body = result.summary ?? result.output ?? result.error ?? "No output.";
		return `### ${result.reviewer.name}\n${body.slice(0, 3000)}`;
	}).join("\n\n");
}

export function summarizeReviewerOutput(output: string): string {
	const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
	const headings = lines.filter((line) => /^#{1,4}\s+|^(verdict|summary|recommendation|findings|risks|consensus)\b/i.test(line));
	const bullets = lines.filter((line) => /^[-*]\s+|^\d+\.\s+/.test(line));
	const selected = [...headings.slice(0, 4), ...bullets.slice(0, 6)];
	const fallback = lines.slice(0, 8);
	return (selected.length ? selected : fallback).join("\n").slice(0, 2000);
}

export function reviewerOutputSignals(output: string): { approve: boolean; concern: boolean; yes: boolean; no: boolean } {
	const text = output.toLowerCase();
	return {
		approve: /\b(approve|looks\s+sound|sound\s+plan|correct|ship|no\s+blocking|no\s+material)\b/.test(text),
		concern: /\b(needs\s+attention|block|blocking|risk|bug|issue|unsafe|do\s+not\s+ship|missing)\b/.test(text),
		yes: /\b(yes|recommend|should\s+add|do\s+it|prefer\s+adding)\b/.test(text),
		no: /\b(no|do\s+not|avoid|should\s+not|prefer\s+not)\b/.test(text),
	};
}

export function consensusReached(outputs: string[]): boolean {
	if (outputs.length <= 1) return true;
	const signals = outputs.map(reviewerOutputSignals);
	const yes = signals.filter((signal) => signal.yes && !signal.no).length;
	const no = signals.filter((signal) => signal.no && !signal.yes).length;
	if (yes > 0 || no > 0) return yes === 0 || no === 0;
	const approve = signals.filter((signal) => signal.approve && !signal.concern).length;
	const concern = signals.filter((signal) => signal.concern && !signal.approve).length;
	return approve === 0 || concern === 0;
}
