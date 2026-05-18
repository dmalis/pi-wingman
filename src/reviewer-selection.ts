import type { Model } from "@earendil-works/pi-ai";
import { modelKey, reviewerKey, type ModelRegistryLike } from "./models.ts";
import type { ExclusionPolicy, ResolvedReviewer, WingmanConfig, WingmanReviewerConfig } from "./types.ts";

export type CurrentModel = { provider: string; id: string } | undefined;

function sameModel(reviewer: WingmanReviewerConfig, current: CurrentModel): boolean {
	return Boolean(current && reviewer.provider === current.provider && reviewer.model === current.id);
}

function sameProvider(reviewer: WingmanReviewerConfig, current: CurrentModel): boolean {
	return Boolean(current && reviewer.provider === current.provider);
}

function isExcluded(reviewer: WingmanReviewerConfig, current: CurrentModel, policy: ExclusionPolicy): boolean {
	if (!current) return false;
	// Invariant: never run the exact same provider/model as the active main agent,
	// even when policy is relaxed to allow same-provider different-model reviews.
	if (sameModel(reviewer, current)) return true;
	if (policy === "same-provider") return sameProvider(reviewer, current);
	return false;
}

export function resolveConfiguredReviewers(config: WingmanConfig, registry: ModelRegistryLike, current: CurrentModel): ResolvedReviewer[] {
	if (config.reviewers.length === 0) throw new Error("Wingman reviewers are not configured. Run /wingman:setup first.");
	const seen = new Set<string>();
	const validated = config.reviewers.map((reviewer) => {
		const key = reviewerKey(reviewer);
		if (seen.has(key)) throw new Error(`Duplicate Wingman reviewer configured: ${key}`);
		seen.add(key);
		const modelRef = registry.find(reviewer.provider, reviewer.model);
		if (!modelRef) throw new Error(`Configured Wingman reviewer ${key} is not available to Pi. Run /wingman:setup to refresh project config.`);
		return {
			...reviewer,
			modelRef,
			key,
			label: `${reviewer.name} (${key})`,
			sameProvider: sameProvider(reviewer, current),
			sameModel: sameModel(reviewer, current),
		};
	});
	const selected = validated.filter((reviewer) => !isExcluded(reviewer, current, config.exclude));
	if (selected.length === 0) {
		const currentLabel = current ? modelKey(current.provider, current.id) : "the current model";
		throw new Error(`No eligible Wingman reviewers remain after excluding ${config.exclude === "same-provider" ? "current provider" : "current model"} (${currentLabel}). Run /wingman:setup or switch models.`);
	}
	return selected;
}

export function reviewerMatchesHint(reviewer: Pick<WingmanReviewerConfig, "name" | "provider" | "model">, hint: string): boolean {
	const normalized = hint.trim().toLowerCase();
	if (!normalized) return false;
	const haystack = `${reviewer.name} ${reviewer.provider} ${reviewer.model} ${reviewer.provider}/${reviewer.model}`.toLowerCase();
	return haystack.includes(normalized);
}

export function selectReviewers(input: {
	eligible: ResolvedReviewer[];
	hint?: string;
	names?: string[];
}): ResolvedReviewer[] {
	const names = input.names?.map((name) => name.trim()).filter(Boolean) ?? [];
	if (names.length > 0) {
		const selected = names.map((name) => {
			const matches = input.eligible.filter((reviewer) => reviewer.name === name || reviewer.key === name || reviewerMatchesHint(reviewer, name));
			if (matches.length === 0) throw new Error(`No eligible configured Wingman reviewer matches ${name}.`);
			if (matches.length > 1) throw new Error(`Multiple eligible Wingman reviewers match ${name}: ${matches.map((reviewer) => reviewer.key).join(", ")}.`);
			return matches[0];
		});
		return dedupeReviewers(selected);
	}
	const hint = input.hint?.trim();
	if (hint) {
		const matches = input.eligible.filter((reviewer) => reviewerMatchesHint(reviewer, hint));
		if (matches.length === 0) throw new Error(`No eligible configured Wingman reviewer matches hint ${hint}.`);
		if (matches.length > 1) throw new Error(`Multiple eligible Wingman reviewers match hint ${hint}: ${matches.map((reviewer) => reviewer.key).join(", ")}.`);
		return matches;
	}
	return input.eligible;
}

export function dedupeReviewers(reviewers: ResolvedReviewer[]): ResolvedReviewer[] {
	const seen = new Set<string>();
	return reviewers.filter((reviewer) => {
		if (seen.has(reviewer.key)) return false;
		seen.add(reviewer.key);
		return true;
	});
}

export function currentModelFromPi(model: Model<any> | undefined | null): CurrentModel {
	return model ? { provider: model.provider, id: model.id } : undefined;
}
