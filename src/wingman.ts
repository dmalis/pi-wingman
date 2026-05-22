import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { hasWingmanConfig, readWingmanConfig, writeWingmanConfig } from "./config.ts";
import { listAvailableModelItems, reviewerKey, type ModelRegistryLike } from "./models.ts";
import { currentModelFromPi, resolveConfiguredReviewers, reviewerMatchesHint, selectReviewers } from "./reviewer-selection.ts";
import { inferWingmanContext } from "./target/infer-target.ts";
import { showSetupPicker } from "./ui/setup-picker.ts";
import { showRunPreflight } from "./ui/run-preflight.ts";
import { withRunningProgress } from "./ui/running-progress.ts";
import { runParallelWingmen } from "./runtime/parallel.ts";
import { formatWingmanRunResult } from "./ui/render.ts";
import type { ResolvedReviewer, WingmanConfig, WingmanRunInput, WingmanRunResult } from "./types.ts";

export type WingmanContext = Pick<ExtensionContext, "cwd" | "hasUI" | "ui" | "model" | "modelRegistry" | "sessionManager" | "signal">;
export type WingmanCommandContext = Pick<ExtensionCommandContext, "cwd" | "hasUI" | "ui" | "model" | "modelRegistry" | "sessionManager" | "signal">;

function firstToken(value: string): string | undefined {
	return value.trim().split(/\s+/, 1)[0]?.toLowerCase();
}

function inferReviewerHintFromRequest(request: string, config: WingmanConfig): string | undefined {
	const token = firstToken(request);
	if (!token) return undefined;
	const matches = config.reviewers.filter((reviewer) => reviewer.name === token || reviewer.provider === token || reviewer.model.toLowerCase() === token || reviewerMatchesHint(reviewer, token));
	if (matches.length > 1) throw new Error(`Multiple configured Wingman reviewers match hint ${token}: ${matches.map((reviewer) => `${reviewer.name} (${reviewer.provider}/${reviewer.model})`).join(", ")}. Please use a unique reviewer alias.`);
	return matches.length === 1 ? token : undefined;
}

function productAliasRequest(request: string): boolean {
	return /\b(ask\s+wingman|with\s+wingman|wingman\s+audit|second\s+opinion|sanity[-\s]+check)\b/i.test(request);
}

function shouldShowPreflight(config: WingmanConfig, input: WingmanRunInput, contextConfidence: "high" | "medium" | "low", selected: ResolvedReviewer[]): boolean {
	if (!input.interactive) return false;
	if (!input.reviewerHint && productAliasRequest(input.request)) return true;
	if (config.defaultReviewers === "ask") return true;
	if (contextConfidence !== "high") return true;
	if (!input.reviewerHint && selected.length > 1 && /\b(pick|choose|which|decide)\b/i.test(input.request)) return true;
	return false;
}

export async function setupWingman(pi: ExtensionAPI, ctx: WingmanCommandContext): Promise<void> {
	const config = await readWingmanConfig(ctx.cwd);
	const models = listAvailableModelItems(ctx.modelRegistry as unknown as ModelRegistryLike);
	if (models.length === 0) {
		ctx.ui.notify("No authenticated Pi models are available. Configure providers first, then rerun /wingman setup.", "error");
		return;
	}
	const next = await showSetupPicker(ctx, models, config);
	if (!next) {
		ctx.ui.notify("Wingman setup cancelled.", "info");
		return;
	}
	await writeWingmanConfig(ctx.cwd, next);
	ctx.ui.notify(`Wingman saved ${next.reviewers.length} reviewer${next.reviewers.length === 1 ? "" : "s"} to .wingman/config.json.`, "info");
}

export async function runWingman(pi: ExtensionAPI, ctx: WingmanContext, input: WingmanRunInput): Promise<WingmanRunResult> {
	if (!hasWingmanConfig(ctx.cwd)) {
		if (input.interactive && ctx.hasUI) {
			ctx.ui.notify("Wingman is not configured for this project. Opening setup first.", "info");
			await setupWingman(pi, ctx);
			if (!hasWingmanConfig(ctx.cwd)) throw new Error("Wingman setup was cancelled. Run /wingman setup before /wingman.");
		} else {
			throw new Error("Wingman is not configured for this project. Run /wingman setup first, then retry /wingman.");
		}
	}
	const config = await readWingmanConfig(ctx.cwd);
	let reviewerHint = input.reviewerHint ?? inferReviewerHintFromRequest(input.request, config);
	const current = currentModelFromPi(ctx.model);
	const eligible = resolveConfiguredReviewers(config, ctx.modelRegistry as unknown as ModelRegistryLike, current);
	let selected = selectReviewers({ eligible, hint: reviewerHint, names: input.reviewerNames });
	let context = await inferWingmanContext({ pi, cwd: ctx.cwd, session: ctx.sessionManager, request: input.request, targetHint: input.targetHint, signal: ctx.signal });
	let request = input.request;

	if (shouldShowPreflight(config, { ...input, reviewerHint }, context.target.confidence, selected)) {
		const preflight = await showRunPreflight(ctx, { context, reviewers: eligible, request });
		if (preflight.action === "setup") {
			await setupWingman(pi, ctx);
			const cancelled: Omit<WingmanRunResult, "text"> = { request, target: context.target, targetLabel: context.label, cancelled: true, results: [] };
			return { ...cancelled, text: formatWingmanRunResult(cancelled) };
		}
		if (preflight.action === "cancel") {
			const cancelled: Omit<WingmanRunResult, "text"> = { request, target: context.target, targetLabel: context.label, cancelled: true, results: [] };
			return { ...cancelled, text: formatWingmanRunResult(cancelled) };
		}
		selected = preflight.reviewers;
		request = preflight.request.trim() || request;
		if (request !== input.request) {
			context = await inferWingmanContext({ pi, cwd: ctx.cwd, session: ctx.sessionManager, request, targetHint: input.targetHint, signal: ctx.signal });
		}
		reviewerHint = undefined;
	}

	const parallel = Math.max(1, Math.min(config.maxParallelReviewers, selected.length));
	const startedAt = Date.now();
	const runnerResult = await withRunningProgress(ctx, { context, reviewers: selected }, async (progress) => {
		return runParallelWingmen({
			ctx: { modelRegistry: ctx.modelRegistry as never, signal: progress.signal },
			context: { ...context, focus: request },
			reviewers: selected,
			maxParallel: parallel,
			signal: progress.signal,
			onProgress: progress.update,
		});
	});
	const base: Omit<WingmanRunResult, "text"> = {
		request,
		target: context.target,
		targetLabel: context.label,
		cancelled: runnerResult.cancelled,
		results: runnerResult.results,
		durationMs: Date.now() - startedAt,
	};
	const result: WingmanRunResult = { ...base, text: formatWingmanRunResult(base) };
	return result;
}
