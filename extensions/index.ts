import type { ExtensionAPI, InputEvent, InputEventResult } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { readWingmanConfig } from "../src/config.ts";
import { parseNaturalWingmanRequest, buildWingmanToolInstruction, reviewerHintsFromConfig } from "../src/input.ts";
import { runWingman, setupWingman } from "../src/wingman.ts";
import type { WingmanRunResult } from "../src/types.ts";

const WingmanParams = Type.Object({
	request: Type.Optional(Type.String({ description: "What Wingman should review. Use 'auto' or omit for current context." })),
	reviewerHint: Type.Optional(Type.String({ description: "Configured reviewer hint such as codex, gemini, claude, or an exact configured reviewer name." })),
	target: Type.Optional(Type.String({ description: "Optional target hint: auto, working-tree, branch, plan, last-turn, files." })),
	reviewers: Type.Optional(Type.Array(Type.String(), { description: "Exact configured reviewer names or provider/model keys to run." })),
});

type WingmanParams = {
	request?: string;
	reviewerHint?: string;
	target?: string;
	reviewers?: string[];
};

function resultContent(result: WingmanRunResult) {
	return [{ type: "text" as const, text: result.text }];
}

function formatDuration(ms: number | undefined): string | undefined {
	if (ms === undefined) return undefined;
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	return `${(ms / 60_000).toFixed(1)}m`;
}

export default function wingmanExtension(pi: ExtensionAPI) {
	pi.registerCommand("wingman", {
		description: "Ask configured Wingman reviewers for an independent second opinion",
		handler: async (args, ctx) => {
			const request = args.trim();
			if (/^(setup|config|configure)$/i.test(request)) {
				await setupWingman(pi, ctx);
				return;
			}
			const result = await runWingman(pi, ctx, { request: request || "auto", interactive: true });
			await pi.sendMessage?.({ customType: "wingman-result", content: result.text, display: true, details: result });
			if (!result.cancelled && result.results.some((item) => item.status === "ok")) {
				await pi.sendUserMessage("Integrate the Wingman result from the previous message for the user. State what you accept, what you reject, and concrete next actions. Do not dump raw reviewer output. After the synthesis, STOP and ask the user for confirmation before modifying files, updating plans, fixing, or continuing implementation.");
			}
		},
	});

	pi.registerTool({
		name: "wingman",
		label: "Wingman",
		description: "Run configured independent Wingman reviewer models in parallel for second opinions.",
		promptSnippet: "Ask configured independent reviewer models for a second opinion",
		promptGuidelines: [
			"Use wingman when the user asks for Wingman, a second opinion, or an audit/check with a configured reviewer.",
			"After wingman returns, synthesize accepted points, rejected points, and concrete next actions. Do not dump raw reviewer output.",
			"After that synthesis, always stop and ask the user for confirmation before modifying files, updating plans, fixing, or continuing implementation.",
		],
		parameters: WingmanParams,
		async execute(_toolCallId, params: WingmanParams, _signal, _onUpdate, ctx) {
			const result = await runWingman(pi, ctx, {
				request: params.request?.trim() || "auto",
				reviewerHint: params.reviewerHint,
				reviewerNames: params.reviewers,
				targetHint: params.target,
				interactive: false,
			});
			return { content: resultContent(result), details: result };
		},
		renderCall(args, theme) {
			const request = typeof args.request === "string" ? args.request : "auto";
			const hint = typeof args.reviewerHint === "string" ? ` via ${args.reviewerHint}` : "";
			return new Text(theme.fg("toolTitle", "Wingman ") + theme.fg("muted", `${request}${hint}`), 0, 0);
		},
		renderResult(result, { expanded }, theme) {
			const details = result.details as WingmanRunResult | undefined;
			const body = result.content.map((part) => part.type === "text" ? part.text : "").join("\n");
			if (!details) return new Text(body, 0, 0);
			const ok = details.results.filter((item) => item.status === "ok").length;
			const failed = details.results.filter((item) => item.status === "failed").length;
			const cancelled = details.results.filter((item) => item.status === "cancelled").length;
			const duration = formatDuration(details.durationMs);
			const header = theme.fg(ok > 0 ? "success" : failed > 0 ? "error" : "warning", `🪽 Wingman ${ok} ok / ${failed} failed / ${cancelled} cancelled`) + theme.fg("muted", `${duration ? ` · ${duration}` : ""} · ${details.targetLabel}`);
			if (expanded) return new Text(`${header}\n\n${body}`, 0, 0);
			const reviewers = details.results.map((item) => `${item.status === "ok" ? "✓" : item.status === "failed" ? "✗" : "⊘"} ${item.reviewer.name}${formatDuration(item.durationMs) ? ` ${formatDuration(item.durationMs)}` : ""}`).join(theme.fg("muted", " · "));
			return new Text(reviewers ? `${header}\n${theme.fg("dim", reviewers)}` : header, 0, 0);
		},
	});

	pi.registerMessageRenderer?.("wingman-result", (message, _options, theme) => {
		const content = typeof message.content === "string" ? message.content : String(message.content ?? "");
		return new Text(theme.fg("accent", "Wingman result") + "\n" + content, 0, 0);
	});

	pi.on("input", async (event: InputEvent, ctx): Promise<InputEventResult | undefined> => {
		if (event.source === "extension") return { action: "continue" };
		const config = await readWingmanConfig(ctx.cwd).catch(() => undefined);
		const reviewers = config?.reviewers ?? [];
		const parsed = parseNaturalWingmanRequest(event.text, reviewerHintsFromConfig(reviewers));
		if (!parsed) return { action: "continue" };
		return { action: "transform", text: buildWingmanToolInstruction(parsed, reviewers.map((reviewer) => reviewer.name)), images: event.images };
	});
}
