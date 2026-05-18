import type { Model } from "@earendil-works/pi-ai";
import type { ModelListItem, WingmanReviewerConfig } from "./types.ts";

export type ModelRegistryLike = {
	getAvailable(): Model<any>[];
	find(provider: string, modelId: string): Model<any> | undefined;
	getProviderDisplayName?(provider: string): string;
};

export function listAvailableModelItems(registry: ModelRegistryLike): ModelListItem[] {
	return registry.getAvailable()
		.map((model) => ({ provider: model.provider, model: model.id, name: model.name, reasoning: Boolean(model.reasoning), modelRef: model }))
		.sort((left, right) => left.provider.localeCompare(right.provider)
			|| Number(right.reasoning) - Number(left.reasoning)
			|| left.name.localeCompare(right.name)
			|| left.model.localeCompare(right.model));
}

export function modelKey(provider: string, model: string): string {
	return `${provider}/${model}`;
}

export function reviewerKey(reviewer: Pick<WingmanReviewerConfig, "provider" | "model">): string {
	return modelKey(reviewer.provider, reviewer.model);
}

export function sanitizeReviewerName(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "reviewer";
}

export function inferReviewerBaseName(item: Pick<ModelListItem, "provider" | "model" | "name">): string {
	const text = `${item.provider} ${item.model} ${item.name}`.toLowerCase();
	if (/opus/.test(text)) return "opus";
	if (/sonnet/.test(text)) return "sonnet";
	if (/haiku/.test(text)) return "haiku";
	if (/codex/.test(text)) return "codex";
	if (/gpt/.test(text)) return "gpt";
	if (/gemini|google/.test(text)) return "gemini";
	if (/claude|anthropic/.test(text)) return "claude";
	if (/deepseek/.test(text)) return "deepseek";
	if (/grok|xai/.test(text)) return "grok";
	if (/mistral/.test(text)) return "mistral";
	if (/kimi|moonshot/.test(text)) return "kimi";
	return sanitizeReviewerName(item.provider || item.model || item.name);
}

function modelAliasSuffix(item: Pick<ModelListItem, "model" | "name">, base: string): string {
	const text = `${item.model} ${item.name}`.toLowerCase();
	const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const afterBase = text.match(new RegExp(`${escaped}[^a-z0-9]*([0-9][a-z0-9._-]*(?:[-._][0-9a-z]+)*)`))?.[1];
	const version = afterBase ?? text.match(/([0-9]+(?:[._-][0-9a-z]+){0,3})/)?.[1] ?? item.model;
	return sanitizeReviewerName(version).replace(/[._]+/g, "-");
}

export function makeUniqueReviewerNames(items: ModelListItem[]): Map<string, string> {
	const bases = items.map((item) => inferReviewerBaseName(item));
	const totals = new Map<string, number>();
	for (const base of bases) totals.set(base, (totals.get(base) ?? 0) + 1);
	const used = new Set<string>();
	const names = new Map<string, string>();
	for (let i = 0; i < items.length; i += 1) {
		const item = items[i];
		const base = bases[i];
		let candidate = base;
		if ((totals.get(base) ?? 0) > 1) candidate = `${base}-${modelAliasSuffix(item, base)}`;
		let name = candidate;
		let counter = 2;
		while (used.has(name)) {
			name = `${candidate}-${counter}`;
			counter += 1;
		}
		used.add(name);
		names.set(modelKey(item.provider, item.model), name);
	}
	return names;
}

export function formatModelLabel(item: Pick<ModelListItem, "provider" | "model" | "name" | "reasoning">): string {
	const displayName = item.name && item.name !== item.model ? `${item.name} ` : "";
	return `${displayName}${item.provider}/${item.model}${item.reasoning ? " · reasoning" : ""}`;
}
