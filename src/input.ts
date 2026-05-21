export type ParsedWingmanRequest = {
	request: string;
	reviewerHint?: string;
	allReviewers?: boolean;
};

const reviewerToken = "([a-z0-9][a-z0-9._:/-]*)";
const reviewVerbPattern = "(?:audit|check|review|inspect|critique|sanity[-\\s]+check|look\\s+at|take\\s+a\\s+look)";
const reviewStart = new RegExp(`^${reviewVerbPattern}\\b`, "i");
const builtInReviewerHints = new Set(["claude", "codex", "deepseek", "gemini", "gpt", "grok", "haiku", "openai", "opus", "sonnet", "xai"]);

function normalizedHintSet(hints: string[] | undefined): Set<string> {
	return new Set((hints ?? []).map((hint) => cleanHint(hint)).filter(Boolean));
}

function cleanFocus(value: string | undefined): string {
	return (value ?? "").trim().replace(/\s+/g, " ").replace(/^[\s:;-]+/g, "").replace(/[.?!]+$/g, "").trim();
}

function cleanHint(value: string | undefined): string {
	return (value ?? "").trim().replace(/^[^a-z0-9]+|[:\s,;.!?]+$/gi, "").replace(/[^a-z0-9._:/-]+$/gi, "").toLowerCase();
}

function knownHint(hint: string, configuredHints: Set<string>): boolean {
	const normalized = cleanHint(hint);
	return normalized === "wingman" || configuredHints.has(normalized) || builtInReviewerHints.has(normalized);
}

function hasNegatedWingmanRequest(text: string): boolean {
	return /\b(?:do\s+not|don't|dont|never)\s+(?:ask|use|run|call)\b.{0,80}\b(?:wingman|reviewers?|codex|gemini|claude)\b/i.test(text)
		|| /\b(?:review|audit|check|inspect|critique)\b.{0,40}\bwithout\s+wingman\b/i.test(text)
		|| /\bwithout\s+wingman\b.{0,40}\b(?:review|audit|check|inspect|critique)\b/i.test(text);
}

function isConfigDiscussion(text: string): boolean {
	const normalized = text.toLowerCase();
	if (/\b(?:config|configuration|configure|setup|set\s+up|install|help)\b/.test(normalized)) {
		if (/^\s*(?:audit|check|review|inspect|critique|sanity[-\s]+check)\b/.test(normalized)) return false;
		return true;
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
	const input = cleanFocus(text);
	if (!input) return undefined;
	if (hasNegatedWingmanRequest(input)) return undefined;
	if (isConfigDiscussion(input)) return undefined;

	const configuredHints = normalizedHintSet(knownReviewerHints);
	return parseAllReviewerIntent(input)
		?? parseExplicitWingmanIntent(input, configuredHints)
		?? parseReviewerHintIntent(input)
		?? parseNoHintReviewIntent(input);
}

function parseAllReviewerIntent(input: string): ParsedWingmanRequest | undefined {
	if (/^ask\s+all(?:\s+eligible)?\s+(?:wingmen|reviewers?)$/i.test(input)) return { request: "auto", allReviewers: true };
	if (/^(?:run|use)\s+all(?:\s+eligible)?\s+(?:wingmen|reviewers?)$/i.test(input)) return { request: "auto", allReviewers: true };

	const wingmanAll = input.match(/^(?:(?:ask|use)\s+wingman(?:\s+to)?|wingman)\s+(.+?)\s+(?:with|using|via)\s+all(?:\s+eligible)?\s+(?:wingmen|reviewers?)$/i);
	if (wingmanAll?.[1]) return { request: cleanFocus(wingmanAll[1]), allReviewers: true };

	const askAll = input.match(/^ask\s+all(?:\s+eligible)?\s+(?:wingmen|reviewers?)\s+to\s+(.+)$/i);
	if (askAll?.[1]) return { request: cleanFocus(askAll[1]), allReviewers: true };

	const runAll = input.match(/^(?:run|use)\s+all(?:\s+eligible)?\s+(?:wingmen|reviewers?)(?:\s+(?:on|for|to))?\s+(.+)$/i);
	if (runAll?.[1]) return { request: cleanFocus(runAll[1]), allReviewers: true };

	const consensusAll = input.match(/^get\s+consensus\s+from\s+all(?:\s+eligible)?\s+(?:wingmen|reviewers?)(?:\s+(?:on|for))?\s*(.*)$/i);
	if (consensusAll) return { request: cleanFocus(consensusAll[1]) || "consensus", allReviewers: true };

	const reviewAll = input.match(new RegExp(`^(${reviewVerbPattern})\\b(?:\\s+(.+?))?\\s+(?:with|using|via)\\s+all(?:\\s+eligible)?\\s+(?:wingmen|reviewers?)$`, "i"));
	if (reviewAll?.[1]) {
		const target = reviewAll[2] ? ` ${cleanFocus(reviewAll[2])}` : "";
		return { request: cleanFocus(`${reviewAll[1].toLowerCase()}${target}`), allReviewers: true };
	}

	return undefined;
}

function parseExplicitWingmanIntent(input: string, configuredHints: Set<string>): ParsedWingmanRequest | undefined {
	const match = input.match(/^(?:(?:ask|use)\s+wingman(?:\s+to)?|wingman)\b\s*:?-?\s*(.+)$/i);
	let rawFocus = cleanFocus(match?.[1]);
	if (!rawFocus) return undefined;
	rawFocus = rawFocus.replace(/^to\s+/i, "");
	if (isConfigDiscussion(rawFocus)) return undefined;

	const colonHint = rawFocus.match(new RegExp(`^${reviewerToken}\\s*:\\s*(.+)$`, "i"));
	if (colonHint?.[1] && colonHint[2]) return { request: cleanFocus(colonHint[2]), reviewerHint: cleanHint(colonHint[1]) };

	const spaceHint = rawFocus.match(new RegExp(`^${reviewerToken}\\s+(.+)$`, "i"));
	if (spaceHint?.[1] && spaceHint[2] && knownHint(spaceHint[1], configuredHints) && !reviewStart.test(spaceHint[1])) {
		return { request: cleanFocus(spaceHint[2]), reviewerHint: cleanHint(spaceHint[1]) };
	}

	return { request: rawFocus };
}

function parseReviewerHintIntent(input: string): ParsedWingmanRequest | undefined {
	const targetWithReviewer = input.match(new RegExp(`^(${reviewVerbPattern})\\b\\s+(.+?)\\s+(?:with|using|via)\\s+${reviewerToken}$`, "i"));
	if (targetWithReviewer?.[1] && targetWithReviewer[2] && targetWithReviewer[3]) {
		return { request: cleanFocus(`${targetWithReviewer[1].toLowerCase()} ${targetWithReviewer[2]}`), reviewerHint: cleanHint(targetWithReviewer[3]) };
	}

	const verbWithReviewer = input.match(new RegExp(`^(${reviewVerbPattern})\\s+(?:with|using|via)\\s+${reviewerToken}(?:\\s*:?\\s*(.*))?$`, "i"));
	if (verbWithReviewer?.[1] && verbWithReviewer[2]) {
		return { request: cleanFocus(verbWithReviewer[3]) || cleanFocus(verbWithReviewer[1].toLowerCase()), reviewerHint: cleanHint(verbWithReviewer[2]) };
	}

	const askColon = input.match(new RegExp(`^(?:please\\s+)?ask\\s+${reviewerToken}\\s*:\\s*(.+)$`, "i"));
	if (askColon?.[1] && askColon[2]) {
		const who = cleanHint(askColon[1]);
		return who === "wingman" ? { request: cleanFocus(askColon[2]) } : { request: cleanFocus(askColon[2]), reviewerHint: who };
	}

	const askSpecific = input.match(new RegExp(`^(?:please\\s+)?ask\\s+${reviewerToken}\\b\\s*:?\\s*(.*)$`, "i"));
	if (askSpecific?.[1]) {
		const who = cleanHint(askSpecific[1]);
		let rest = cleanFocus(askSpecific[2]);
		if (who === "wingman") return rest ? { request: rest.replace(/^to\s+/i, "") } : undefined;
		if (rest.match(/^to\s+/i)) rest = cleanFocus(rest.replace(/^to\s+/i, ""));
		if (!rest || reviewStart.test(rest) || /^for\s+(?:a\s+)?second\s+opinion\b/i.test(rest)) {
			const secondOpinion = rest.match(/^for\s+(?:a\s+)?second\s+opinion(?:\s+on\s+(.+))?$/i);
			return { request: cleanFocus(secondOpinion?.[1]) || rest || `ask ${who}`, reviewerHint: who };
		}
	}

	const runBy = input.match(new RegExp(`^run\\s+(.+?)\\s+(?:by|past)\\s+${reviewerToken}$`, "i"));
	if (runBy?.[1] && runBy[2]) return { request: cleanFocus(runBy[1]), reviewerHint: cleanHint(runBy[2]) };

	const getTo = input.match(new RegExp(`^get\\s+${reviewerToken}\\s+to\\s+(.+)$`, "i"));
	if (getTo?.[1] && getTo[2] && reviewStart.test(getTo[2])) return { request: cleanFocus(getTo[2]), reviewerHint: cleanHint(getTo[1]) };

	const secondOpinionFrom = input.match(new RegExp(`^get\\s+(?:a\\s+)?second\\s+opinion\\s+from\\s+${reviewerToken}(?:\\s+on\\s+(.+))?$`, "i"));
	if (secondOpinionFrom?.[1]) return { request: cleanFocus(secondOpinionFrom[2]) || "second opinion", reviewerHint: cleanHint(secondOpinionFrom[1]) };

	return undefined;
}

function parseNoHintReviewIntent(input: string): ParsedWingmanRequest | undefined {
	const secondOpinion = input.match(/^(?:get\s+)?(?:a\s+)?second\s+opinion(?:\s+on\s+(.+))?$/i);
	if (secondOpinion) return { request: cleanFocus(secondOpinion[1]) || "second opinion" };
	if (/^sanity[-\s]+check\b/i.test(input)) return { request: input };
	return undefined;
}

export function buildWingmanToolInstruction(parsed: ParsedWingmanRequest, configuredReviewerNames: string[] = []): string {
	const hasReviewerSelection = Boolean(parsed.reviewerHint) || parsed.allReviewers;
	const reviewerList = configuredReviewerNames.length > 0 ? ` Configured reviewers: ${configuredReviewerNames.join(", ")}.` : "";
	const lines = ["Wingman request detected."];

	if (!hasReviewerSelection) {
		lines.push(`Review focus: ${parsed.request}`);
		lines.push(`No reviewer hint was provided.${reviewerList} Ask the user which configured eligible reviewer(s) to use before calling the \`wingman\` tool.`);
		lines.push("Do not call the `wingman` tool until the user chooses reviewer(s).");
		lines.push("After Wingman returns, synthesize the result: what you accept, what you reject, and what concrete next action follows. Then stop and wait for user confirmation before modifying files, updating plans, fixing, or continuing.");
		return lines.join("\n");
	}

	lines.push("Call the `wingman` tool with:", `- request: ${parsed.request}`);
	if (parsed.reviewerHint) lines.push(`- reviewerHint: ${parsed.reviewerHint}`);
	if (parsed.allReviewers) lines.push("The user asked for all eligible configured reviewers. Do not pass reviewerHint or reviewers.");
	lines.push("Only resolve reviewer hints against configured Wingman reviewers. Do not guess unconfigured models. If no configured reviewer matches, ask the user to configure or choose reviewers.");
	lines.push("Do not answer the review yourself before calling the tool.");
	lines.push("After Wingman returns, synthesize the result: what you accept, what you reject, and what concrete next action follows. Then stop and wait for user confirmation before modifying files, updating plans, fixing, or continuing.");
	return lines.join("\n");
}
