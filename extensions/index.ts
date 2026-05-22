import type { ExtensionAPI, InputEvent, InputEventResult } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { readWingmanConfig } from "../src/config.ts";
import { parseNaturalWingmanRequest, buildWingmanToolInstruction, reviewerHintsFromConfig } from "../src/input.ts";
import { runWingman, setupWingman } from "../src/wingman.ts";
import type { WingmanRunResult } from "../src/types.ts";

const WingmanParams = Type.Object({
	request: Type.Optional(Type.String({ description: "What Wingman should audit, decide, challenge, or diagnose. Use 'auto' or omit for current context." })),
	reviewerHint: Type.Optional(Type.String({ description: "Configured reviewer hint such as codex, gemini, claude, or an exact configured reviewer name." })),
	target: Type.Optional(Type.String({ description: "Optional target hint: auto, working-tree, branch, plan, last-turn, files." })),
	reviewers: Type.Optional(Type.Array(Type.String(), { description: "Exact configured reviewer names or provider/model keys to run." })),
	maxRounds: Type.Optional(Type.Number({ description: "Maximum consensus rounds for consensus mode." })),
});

type WingmanParams = {
	request?: string;
	reviewerHint?: string;
	target?: string;
	reviewers?: string[];
	maxRounds?: number;
};

function resultContent(result: WingmanRunResult) {
	return [{ type: "text" as const, text: result.text }];
}

export default function wingmanExtension(pi: ExtensionAPI) {
	pi.registerCommand("wingman", {
		description: "Ask configured Wingman reviewers for an independent audit, consensus, or rescue diagnosis",
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
		description: "Run configured independent Wingman reviewer models in parallel for audits, consensus, or rescue diagnosis.",
		promptSnippet: "Ask configured independent reviewer models for a second opinion",
		promptGuidelines: [
			"Use wingman when the user asks for Wingman, a second opinion, consensus, or an audit with a configured reviewer.",
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
				maxRounds: params.maxRounds,
				interactive: false,
			});
			return { content: resultContent(result), details: result };
		},
		renderCall(args, theme) {
			const request = typeof args.request === "string" ? args.request : "auto";
			const hint = typeof args.reviewerHint === "string" ? ` via ${args.reviewerHint}` : "";
			return new Text(theme.fg("toolTitle", "Wingman ") + theme.fg("muted", `${request}${hint}`), 0, 0);
		},
		renderResult(result, _options, theme) {
			const details = result.details as WingmanRunResult | undefined;
			if (!details) return new Text(result.content.map((part) => part.type === "text" ? part.text : "").join("\n"), 0, 0);
			const ok = details.results.filter((item) => item.status === "ok").length;
			const failed = details.results.filter((item) => item.status === "failed").length;
			const cancelled = details.results.filter((item) => item.status === "cancelled").length;
			return new Text(theme.fg(ok > 0 ? "success" : "warning", `Wingman ${ok} ok / ${failed} failed / ${cancelled} cancelled`) + theme.fg("muted", ` • ${details.mode} • ${details.targetLabel}`), 0, 0);
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
