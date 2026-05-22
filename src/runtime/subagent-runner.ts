import { createAgentSession, createExtensionRuntime, createReadOnlyTools, type ResourceLoader } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import type { ResolvedReviewer, ReviewerResult, WingmanContextPack } from "../types.ts";
import { buildSubagentPrompt, summarizeReviewerOutput } from "../review/prompts.ts";
import { extractTextContent } from "../target/session-context.ts";

export function createCleanResourceLoader(): ResourceLoader {
	return {
		getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => undefined,
		getAppendSystemPrompt: () => [],
		extendResources: () => undefined,
		reload: async () => undefined,
	};
}

function toolNames(tools: Array<{ name: string }>): string[] {
	return tools.map((tool) => tool.name);
}

function finalAssistantText(session: { sessionManager?: { getBranch?: () => unknown[] } }): string {
	const branch = session.sessionManager?.getBranch?.() ?? [];
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = branch[index] as { type?: string; message?: { role?: string; content?: unknown } };
		if (entry.type === "message" && entry.message?.role === "assistant") {
			const text = extractTextContent(entry.message.content).trim();
			if (text) return text;
		}
	}
	return "";
}

export async function runSubagentReviewer(input: {
	reviewer: ResolvedReviewer;
	context: WingmanContextPack;
	signal?: AbortSignal;
}): Promise<ReviewerResult> {
	const prompt = buildSubagentPrompt(input);
	try {
		const tools = toolNames(createReadOnlyTools(input.context.cwd));
		const { session } = await createAgentSession({
			cwd: input.context.cwd,
			model: input.reviewer.modelRef as Model<any>,
			thinkingLevel: input.reviewer.thinking === "off" ? undefined : input.reviewer.thinking,
			tools,
			resourceLoader: createCleanResourceLoader(),
		});
		if (input.signal?.aborted) return { reviewer: input.reviewer, status: "cancelled", backend: "subagent", prompt, error: "aborted" };
		const abort = () => session.abort?.();
		input.signal?.addEventListener("abort", abort, { once: true });
		try {
			await session.prompt(prompt, { source: "extension" });
		} finally {
			input.signal?.removeEventListener("abort", abort);
		}
		if (input.signal?.aborted) return { reviewer: input.reviewer, status: "cancelled", backend: "subagent", prompt, error: "aborted" };
		const output = finalAssistantText(session).trim();
		if (!output) throw new Error("subagent returned no assistant text");
		return { reviewer: input.reviewer, status: "ok", backend: "subagent", prompt, output, summary: summarizeReviewerOutput(output) };
	} catch (error) {
		if (input.signal?.aborted) return { reviewer: input.reviewer, status: "cancelled", backend: "subagent", prompt, error: "aborted" };
		return { reviewer: input.reviewer, status: "failed", backend: "subagent", prompt, error: error instanceof Error ? error.message : String(error) };
	}
}
