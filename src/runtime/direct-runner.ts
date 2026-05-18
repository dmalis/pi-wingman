import { complete, type Message, type Model } from "@earendil-works/pi-ai";
import type { ModelRegistryLike } from "../models.ts";
import type { ResolvedReviewer, ReviewerResult, WingmanContextPack } from "../types.ts";
import { buildReviewerPrompt, buildReviewerSystemPrompt, summarizeReviewerOutput } from "../review/prompts.ts";

export type DirectRunnerContext = {
	modelRegistry: ModelRegistryLike & {
		getApiKeyAndHeaders(model: Model<any>): Promise<{ ok: true; apiKey?: string; headers?: Record<string, string> } | { ok: false; error: string }>;
	};
	signal?: AbortSignal;
};

export async function runDirectReviewer(input: {
	ctx: DirectRunnerContext;
	reviewer: ResolvedReviewer;
	context: WingmanContextPack;
	round: number;
	previousRoundDigest?: string;
}): Promise<ReviewerResult> {
	const prompt = buildReviewerPrompt(input);
	try {
		const auth = await input.ctx.modelRegistry.getApiKeyAndHeaders(input.reviewer.modelRef);
		if (!auth.ok) throw new Error(auth.error);
		if (!auth.apiKey && !auth.headers) throw new Error(`No auth configured for ${input.reviewer.key}.`);
		const messages: Message[] = [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }];
		const response = await complete(input.reviewer.modelRef, {
			systemPrompt: buildReviewerSystemPrompt(input.context.mode),
			messages,
		}, {
			apiKey: auth.apiKey,
			headers: auth.headers,
			signal: input.ctx.signal,
			maxTokens: Math.min(input.reviewer.modelRef.maxTokens || 8192, 12000),
			reasoningEffort: input.reviewer.thinking,
			reasoning: input.reviewer.thinking,
		});
		if (response.stopReason === "aborted") return { reviewer: input.reviewer, status: "cancelled", round: input.round, backend: "direct", prompt, error: "aborted" };
		if (response.stopReason === "error") throw new Error(response.errorMessage || "model returned an error");
		const output = response.content.filter((part): part is { type: "text"; text: string } => part.type === "text").map((part) => part.text).join("\n").trim();
		if (!output) throw new Error("reviewer returned no text output");
		return { reviewer: input.reviewer, status: "ok", round: input.round, backend: "direct", prompt, output, summary: summarizeReviewerOutput(output) };
	} catch (error) {
		if (input.ctx.signal?.aborted) return { reviewer: input.reviewer, status: "cancelled", round: input.round, backend: "direct", prompt, error: "aborted" };
		return { reviewer: input.reviewer, status: "failed", round: input.round, backend: "direct", prompt, error: error instanceof Error ? error.message : String(error) };
	}
}
