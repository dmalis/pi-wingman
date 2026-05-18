export type ParsedWingmanRequest = {
	request: string;
	reviewerHint?: string;
};

function normalizedHintSet(hints: string[] | undefined): Set<string> {
	return new Set((hints ?? []).map((hint) => hint.trim().toLowerCase()).filter(Boolean));
}

function hintKnown(hint: string, hints: Set<string>): boolean {
	const normalized = hint.trim().toLowerCase();
	if (!normalized) return false;
	if (normalized === "wingman") return true;
	if (hints.has(normalized)) return true;
	for (const item of hints) {
		if (item.includes(normalized) || normalized.includes(item)) return true;
	}
	return false;
}

export function reviewerHintsFromConfig(reviewers: Array<{ name?: string; provider?: string; model?: string }>): string[] {
	const hints = new Set<string>();
	for (const reviewer of reviewers) {
		for (const value of [reviewer.name, reviewer.provider, reviewer.model, reviewer.provider && reviewer.model ? `${reviewer.provider}/${reviewer.model}` : undefined]) {
			if (!value) continue;
			const normalized = value.toLowerCase();
			hints.add(normalized);
			for (const part of normalized.split(/[^a-z0-9]+/).filter((part) => part.length >= 3)) hints.add(part);
		}
	}
	return Array.from(hints);
}

export function parseNaturalWingmanRequest(text: string, knownReviewerHints?: string[]): ParsedWingmanRequest | undefined {
	const trimmed = text.trim();
	const hints = normalizedHintSet(knownReviewerHints);
	if (!trimmed) return undefined;
	const negated = /\b(do\s+not|don't|dont|never|without|not)\b.{0,50}\b(ask\s+(wingman|codex|gemini|claude)|audit\s+with|second\s+opinion|sanity[-\s]+check)\b/i;
	if (negated.test(trimmed)) return undefined;

	const auditWith = trimmed.match(/^\s*(?:please\s+)?(?:audit|review|check|sanity[-\s]*check)\s+with\s+([a-z0-9._/-]+)\b\s*:?-?\s*(.*)$/i);
	if (auditWith) {
		const hint = auditWith[1].toLowerCase();
		const rest = auditWith[2]?.trim();
		if (hint === "wingman") return { request: rest || trimmed };
		if (!hintKnown(hint, hints)) return undefined;
		return { reviewerHint: hint, request: rest ? `${hint} ${rest}` : `audit with ${hint}` };
	}

	const askSpecific = trimmed.match(/^\s*(?:please\s+)?ask\s+([a-z0-9._/-]+)\b\s*:?-?\s*(.*)$/i);
	if (askSpecific) {
		const who = askSpecific[1].toLowerCase();
		if (hintKnown(who, hints)) {
			const rest = askSpecific[2]?.trim();
			return { reviewerHint: who === "wingman" ? undefined : who, request: rest || `ask ${who}` };
		}
	}

	if (/\b(second\s+opinion|sanity[-\s]+check|ask\s+wingman|wingman\s+audit)\b/i.test(trimmed)) {
		return { request: trimmed };
	}

	return undefined;
}

export function buildWingmanToolInstruction(parsed: ParsedWingmanRequest): string {
	return [
		"Wingman request detected.",
		"Call the `wingman` tool with:",
		`- request: ${parsed.request}`,
		parsed.reviewerHint ? `- reviewerHint: ${parsed.reviewerHint}` : undefined,
		"Do not answer the review yourself before calling the tool.",
		"After Wingman returns, synthesize the result: what you accept, what you reject, and what concrete next action follows. Then stop and wait for user confirmation before modifying files, updating plans, fixing, or continuing.",
	].filter((line): line is string => Boolean(line)).join("\n");
}
