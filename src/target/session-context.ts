import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export type SessionLike = {
	getBranch(): SessionEntry[];
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

export function extractTextContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((part) => {
		if (typeof part === "string") return part;
		const obj = asRecord(part);
		if (!obj) return "";
		if (obj.type && obj.type !== "text") return "";
		return typeof obj.text === "string" ? obj.text : extractTextContent(obj.content);
	}).filter(Boolean).join("\n");
}

export function messageText(entry: unknown): { role: string; text: string } | undefined {
	const obj = asRecord(entry);
	const message = asRecord(obj?.message);
	if (!message || typeof message.role !== "string") return undefined;
	return { role: message.role, text: extractTextContent(message.content).trim() };
}

export function getRecentConversation(session: SessionLike | undefined, limit = 8): string {
	const branch = session?.getBranch?.() ?? [];
	const messages = branch.map(messageText).filter((item): item is { role: string; text: string } => Boolean(item?.text));
	return messages.slice(-limit).map((item) => `## ${item.role}\n${item.text}`).join("\n\n");
}

export function getLastAssistantText(session: SessionLike | undefined): string | undefined {
	const branch = session?.getBranch?.() ?? [];
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const item = messageText(branch[index]);
		if (item?.role === "assistant" && item.text) return item.text;
	}
	return undefined;
}

export function getLastUserText(session: SessionLike | undefined): string | undefined {
	const branch = session?.getBranch?.() ?? [];
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const item = messageText(branch[index]);
		if (item?.role === "user" && item.text) return item.text;
	}
	return undefined;
}

export function extractLatestQuestion(text: string | undefined): string | undefined {
	if (!text) return undefined;
	const candidates = text
		.split(/(?<=[?!])\s+|\n+/)
		.map((line) => line.trim())
		.filter((line) => line.endsWith("?") || /\b(should|would|could|do you want|prefer|which|whether)\b/i.test(line));
	return candidates.slice(-1)[0];
}

export function looksLikePlan(text: string | undefined): boolean {
	if (!text) return false;
	const lower = text.toLowerCase();
	if (/^#*\s*(implementation\s+)?plan\b/m.test(lower)) return true;
	if (/\b(plan|approach|design|spec|proposal)\b/.test(lower) && /\b(step|phase|task|implement|verify|test)\b/.test(lower)) return true;
	if ((text.match(/^\s*\d+\.\s+/gm)?.length ?? 0) >= 3 && /\b(test|implement|verify|change|refactor)\b/i.test(text)) return true;
	return false;
}

export function summarizePlan(text: string, limit = 16000): string {
	if (text.length <= limit) return text;
	return `${text.slice(0, limit)}\n... [plan truncated ${text.length - limit} chars]`;
}
