import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { WingmanContextPack, WingmanTarget } from "../types.ts";
import { collectBranchContext, collectWorkingTreeContext, getGitState, type ExecLike } from "./git-context.ts";
import { getLastAssistantText, getRecentConversation, looksLikePlan, summarizePlan, type SessionLike } from "./session-context.ts";

const MAX_FILE_BYTES = 64 * 1024;
const MAX_RECENT_CONVERSATION = 24_000;

function bound(text: string, limit: number): string {
	if (text.length <= limit) return text;
	return `${text.slice(0, limit)}\n... [truncated ${text.length - limit} chars]`;
}

function section(title: string, body: string): string {
	return [`## ${title}`, "", body.trim() || "(none)", ""].join("\n");
}

function parseExplicitTarget(request: string): WingmanTarget | undefined {
	const commit = request.match(/\bcommit\s+([0-9a-f]{6,40})\b/i);
	if (commit) return { type: "commit", sha: commit[1], confidence: "high" };
	const branch = request.match(/\b(?:branch|base)\s+([\w./:@-]+)\b/i);
	if (branch) return { type: "branch-diff", base: branch[1], confidence: "high" };
	const files = request.match(/\b(?:files?|folders?|paths?)\s+(.+)$/i);
	if (files) {
		const paths = files[1].split(/[\s,]+/).map((item) => item.trim()).filter(Boolean).filter((item) => !/^with$/i.test(item));
		if (paths.length > 0) return { type: "files", paths, confidence: "high" };
	}
	if (/\b(diff|changes|working tree|uncommitted)\b/i.test(request)) return { type: "working-tree", confidence: "medium" };
	return undefined;
}

function targetLabel(target: WingmanTarget): string {
	switch (target.type) {
		case "current-plan": return "current plan";
		case "working-tree": return "working tree changes";
		case "branch-diff": return `branch diff against ${target.base}`;
		case "commit": return `commit ${target.sha.slice(0, 12)}`;
		case "files": return `files ${target.paths.join(", ")}`;
		case "last-turn": return "latest assistant turn";
		case "freeform": return "freeform request";
	}
}

async function collectFileContext(cwd: string, paths: string[]): Promise<string> {
	const parts = [];
	for (const rawPath of paths.slice(0, 20)) {
		const path = resolve(cwd, rawPath);
		try {
			const content = await readFile(path);
			if (content.includes(0)) {
				parts.push(section(rawPath, "(binary file skipped)"));
			} else {
				parts.push(section(rawPath, bound(content.toString("utf8"), MAX_FILE_BYTES)));
			}
		} catch (error) {
			parts.push(section(rawPath, `(unreadable: ${error instanceof Error ? error.message : String(error)})`));
		}
	}
	return parts.join("\n");
}

export async function inferWingmanContext(input: {
	pi: ExtensionAPI;
	cwd: string;
	session?: SessionLike;
	request: string;
	targetHint?: string;
	signal?: AbortSignal;
}): Promise<WingmanContextPack> {
	const exec = input.pi.exec.bind(input.pi) as ExecLike;
	const request = input.request.trim();
	const lastAssistant = getLastAssistantText(input.session);
	const recentConversation = bound(getRecentConversation(input.session, 8), MAX_RECENT_CONVERSATION);
	const explicit = parseExplicitTarget(request);
	const git = await getGitState(exec, input.cwd, input.signal);
	const genericRequest = !request || /^(auto|this|current|current context|review|audit|check|second opinion|sanity[-\s]+check)$/i.test(request);
	const planRequest = /\b(plan|design|spec|proposal)\b/i.test(request);

	let target: WingmanTarget | undefined = explicit;
	let reason = explicit ? "explicit target in request" : "smart inference";
	if (!target && planRequest && looksLikePlan(lastAssistant)) {
		target = { type: "current-plan", text: summarizePlan(lastAssistant ?? ""), confidence: "high" };
	}
	if (!target && genericRequest && looksLikePlan(lastAssistant)) {
		target = { type: "current-plan", text: summarizePlan(lastAssistant ?? ""), confidence: "medium" };
	}
	if (!target && genericRequest && git.isRepo && git.isDirty) {
		target = { type: "working-tree", confidence: "high" };
	}
	if (!target && genericRequest && git.isRepo && git.branch && git.defaultBranch && git.branch !== git.defaultBranch) {
		target = { type: "branch-diff", base: git.defaultBranch, confidence: "medium" };
	}
	if (!target && lastAssistant) {
		target = { type: "last-turn", text: bound(lastAssistant, 16000), confidence: "medium" };
	}
	if (!target) {
		target = { type: "freeform", focus: request || "Provide an independent second opinion on the current context.", confidence: "low" };
	}

	let targetContent = "";
	let large = false;
	if (target.type === "working-tree" && git.isRepo) {
		const collected = await collectWorkingTreeContext(exec, git.root, input.signal);
		targetContent = collected.content;
		large = collected.large;
	} else if (target.type === "branch-diff" && git.isRepo) {
		const collected = await collectBranchContext(exec, git.root, target.base, input.signal);
		targetContent = collected.content;
		large = collected.large;
	} else if (target.type === "files") {
		targetContent = await collectFileContext(input.cwd, target.paths);
	} else if (target.type === "current-plan") {
		targetContent = section("Plan", target.text);
	} else if (target.type === "last-turn") {
		targetContent = section("Latest Assistant Turn", target.text);
	} else if (target.type === "commit" && git.isRepo) {
		const collected = await collectBranchContext(exec, git.root, `${target.sha}^`, input.signal).catch(() => ({ content: section("Commit", target.sha), large: false, bytes: 0 }));
		targetContent = collected.content;
		large = collected.large;
	} else {
		targetContent = section("Request", request);
	}

	const label = targetLabel(target);
	const focus = request || label;
	const content = [
		"# Wingman context pack",
		`CWD: ${git.root || input.cwd}`,
		`Target: ${label}`,
		`Inference: ${reason}; confidence ${target.confidence}`,
		"",
		section("User Request", request || "(no explicit request)"),
		section("Recent Conversation", recentConversation),
		section("Target Context", targetContent),
	].join("\n");

	return {
		target,
		label,
		focus,
		cwd: git.root || input.cwd,
		content,
		backend: large ? "subagent" : "direct",
		reason,
	};
}

export { targetLabel };
