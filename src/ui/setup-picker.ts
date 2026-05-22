import { decodeKittyPrintable, Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { configPath } from "../config.ts";
import { formatModelLabel, makeUniqueReviewerNames, modelKey, sanitizeReviewerName } from "../models.ts";
import type { DefaultReviewers, ExclusionPolicy, ModelListItem, WingmanConfig, WingmanReviewerConfig } from "../types.ts";

function printableChar(data: string): string | undefined {
	const decoded = decodeKittyPrintable(data);
	if (decoded && decoded.length === 1 && decoded >= " " && decoded !== "\x7f") return decoded;
	if (data.length === 1 && data >= " " && data !== "\x7f") return data;
	return undefined;
}

function key(data: string, value: string): boolean {
	return data === value || matchesKey(data, value as never) || matchesKey(data, Key.shift(value as never) as never);
}

function filterItems(items: ModelListItem[], query: string): ModelListItem[] {
	const normalized = query.trim().toLowerCase();
	if (!normalized) return items;
	return items.filter((item) => `${item.provider} ${item.model} ${item.name}`.toLowerCase().includes(normalized));
}

function reviewerForItem(item: ModelListItem, aliases: Map<string, string>, existing: Map<string, WingmanReviewerConfig>): WingmanReviewerConfig {
	const key = modelKey(item.provider, item.model);
	const found = existing.get(key);
	return { ...(found ?? { provider: item.provider, model: item.model, thinking: item.reasoning ? "high" : "off" as const }), name: aliases.get(key) ?? found?.name ?? item.provider };
}

function duplicateAliases(reviewers: WingmanReviewerConfig[]): string[] {
	const seen = new Set<string>();
	const dupes = new Set<string>();
	for (const reviewer of reviewers) {
		if (seen.has(reviewer.name)) dupes.add(reviewer.name);
		seen.add(reviewer.name);
	}
	return [...dupes];
}

function buildConfig(current: WingmanConfig, models: ModelListItem[], selected: Set<string>, aliases: Map<string, string>, existing: Map<string, WingmanReviewerConfig>, overrides: Partial<WingmanConfig>): WingmanConfig {
	const reviewers = models
		.filter((item) => selected.has(modelKey(item.provider, item.model)))
		.map((item) => reviewerForItem(item, aliases, existing));
	return {
		version: 1,
		exclude: overrides.exclude ?? current.exclude,
		defaultReviewers: overrides.defaultReviewers ?? current.defaultReviewers,
		maxParallelReviewers: current.maxParallelReviewers,
		logging: overrides.logging ?? current.logging,
		reviewers,
	};
}

async function chooseReviewerModels(ctx: { cwd: string; ui: any }, models: ModelListItem[], selected: Set<string>, aliases: Map<string, string>): Promise<boolean> {
	const result = await ctx.ui.custom((tui: any, theme: any, _kb: any, done: (value: boolean) => void) => {
		let query = "";
		let index = 0;
		let cachedLines: string[] | undefined;
		let searchMode = false;
		let message = "";

		function visible() { return filterItems(models, query); }
		function clamp() {
			const count = visible().length;
			index = Math.max(0, Math.min(index, Math.max(0, count - 1)));
		}
		function refresh() { cachedLines = undefined; clamp(); tui.requestRender(); }
		function toggle(item: ModelListItem | undefined) {
			if (!item) return;
			const k = modelKey(item.provider, item.model);
			if (selected.has(k)) selected.delete(k);
			else selected.add(k);
			refresh();
		}
		function handleInput(data: string) {
			const items = visible();
			if (searchMode) {
				if (matchesKey(data, Key.escape)) { searchMode = false; if (query) query = ""; refresh(); return; }
				if (matchesKey(data, Key.enter)) { searchMode = false; refresh(); return; }
				if (matchesKey(data, Key.backspace)) { query = query.slice(0, -1); refresh(); return; }
				const char = printableChar(data);
				if (char) { query += char; refresh(); return; }
				return;
			}
			if (matchesKey(data, Key.escape)) { done(false); return; }
			if (matchesKey(data, Key.up)) { index -= 1; refresh(); return; }
			if (matchesKey(data, Key.down)) { index += 1; refresh(); return; }
			if (matchesKey(data, Key.space)) { toggle(items[index]); return; }
			if (matchesKey(data, Key.enter)) { done(true); return; }
			if (key(data, "a")) { for (const item of items) selected.add(modelKey(item.provider, item.model)); refresh(); return; }
			if (key(data, "n")) { for (const item of items) selected.delete(modelKey(item.provider, item.model)); refresh(); return; }
			if (data === "/" || matchesKey(data, Key.slash)) { searchMode = true; message = "Search mode: type to filter, Enter keep filter, Esc clear"; refresh(); return; }
		}
		function render(width: number): string[] {
			if (cachedLines) return cachedLines;
			const lines: string[] = [];
			const add = (line: string = "") => lines.push(truncateToWidth(line, width));
			const items = visible();
			const top = theme.fg("accent", "─".repeat(width));
			add(top);
			add(theme.fg("accent", theme.bold(" Wingman setup: choose reviewer models")) + theme.fg("dim", `  ${configPath(ctx.cwd)}`));
			add(theme.fg("muted", ` Selected ${selected.size}/${models.length}`));
			add(theme.fg(searchMode ? "accent" : "muted", ` Search: ${query || "(press / to filter)"}${searchMode ? "_" : ""}`));
			if (message) add(theme.fg("muted", ` ${message}`));
			add();
			if (items.length === 0) add(theme.fg("warning", " No matching models"));
			else {
				const start = Math.max(0, Math.min(index - 8, Math.max(0, items.length - 17)));
				const page = items.slice(start, start + 17);
				for (let offset = 0; offset < page.length; offset += 1) {
					const item = page[offset];
					const absolute = start + offset;
					const k = modelKey(item.provider, item.model);
					const marker = selected.has(k) ? "[x]" : "[ ]";
					const cursor = absolute === index ? ">" : " ";
					const name = aliases.get(k) ?? item.provider;
					const text = `${cursor} ${marker} ${name.padEnd(12)} ${formatModelLabel(item)}`;
					add(absolute === index ? theme.fg("accent", text) : theme.fg(selected.has(k) ? "text" : "muted", text));
				}
			}
			add();
			add(theme.fg("dim", " ↑↓ move • Space toggle • / search • a all • n none • Enter continue • Esc cancel"));
			add(top);
			cachedLines = lines;
			return lines;
		}
		return { render, invalidate: () => { cachedLines = undefined; }, handleInput };
	});
	return result === true;
}

async function editAliases(ctx: { ui: any }, models: ModelListItem[], selected: Set<string>, aliases: Map<string, string>, existing: Map<string, WingmanReviewerConfig>): Promise<boolean> {
	const selectedModels = models.filter((item) => selected.has(modelKey(item.provider, item.model)));
	for (const item of selectedModels) {
		const k = modelKey(item.provider, item.model);
		const current = aliases.get(k) ?? existing.get(k)?.name ?? item.provider;
		const answer = await ctx.ui.input(`Alias for ${formatModelLabel(item)}`, current);
		if (answer === undefined) return false;
		const alias = sanitizeReviewerName(String(answer).trim() || current);
		if (!/^[a-z0-9._-]+$/.test(alias)) {
			ctx.ui.notify(`Invalid alias for ${formatModelLabel(item)}; keeping ${current}`, "warning");
			aliases.set(k, current);
		} else {
			aliases.set(k, alias);
		}
	}
	return true;
}

export async function showSetupPicker(ctx: { cwd: string; hasUI?: boolean; ui: any }, models: ModelListItem[], current: WingmanConfig): Promise<WingmanConfig | undefined> {
	if (!ctx.hasUI) return { ...current, reviewers: current.reviewers };

	const existing = new Map(current.reviewers.map((reviewer) => [modelKey(reviewer.provider, reviewer.model), reviewer]));
	const selected = new Set(current.reviewers.map((reviewer) => modelKey(reviewer.provider, reviewer.model)));
	const aliases = new Map<string, string>(makeUniqueReviewerNames(models));
	for (const reviewer of current.reviewers) aliases.set(modelKey(reviewer.provider, reviewer.model), reviewer.name);

	if (!(await chooseReviewerModels(ctx, models, selected, aliases))) return undefined;
	if (selected.size === 0) {
		ctx.ui.notify("Select at least one Wingman reviewer.", "warning");
		return undefined;
	}

	const editNames = await ctx.ui.confirm("Reviewer aliases", "Edit reviewer aliases now?", { timeout: 15000 });
	if (editNames && !(await editAliases(ctx, models, selected, aliases, existing))) return undefined;

	let exclude = current.exclude;
	let defaultReviewers = current.defaultReviewers;
	let logging = { ...current.logging };

	const policyChoice = await ctx.ui.select("Independence policy", [
		"Strongest: exclude same provider",
		"Flexible: exclude exact same model only",
	]);
	if (!policyChoice) return undefined;
	exclude = (String(policyChoice).startsWith("Strongest") ? "same-provider" : "same-model") as ExclusionPolicy;

	const defaultChoice = await ctx.ui.select("When /wingman runs without explicit reviewers", [
		"Use all eligible reviewers",
		"Ask each time",
	]);
	if (!defaultChoice) return undefined;
	defaultReviewers = (String(defaultChoice).startsWith("Use all") ? "all-eligible" : "ask") as DefaultReviewers;

	const advanced = await ctx.ui.confirm("Advanced settings", "Configure logging?", { timeout: 15000 });
	if (advanced) {
		const loggingChoice = await ctx.ui.select("Logging", ["Off", "Summary logs", "Raw logs"]);
		if (!loggingChoice) return undefined;
		logging = String(loggingChoice).startsWith("Off") ? { enabled: false, raw: false } : { enabled: true, raw: String(loggingChoice).startsWith("Raw") };
	}

	const next = buildConfig(current, models, selected, aliases, existing, { exclude, defaultReviewers, logging });
	const dupes = duplicateAliases(next.reviewers);
	if (dupes.length > 0) {
		ctx.ui.notify(`Duplicate aliases: ${dupes.join(", ")}`, "error");
		return undefined;
	}

	const summary = `Reviewers: ${next.reviewers.map((r) => r.name).join(", ")}\nPolicy: ${next.exclude}\nDefault: ${next.defaultReviewers}\nLogging: ${next.logging.enabled ? next.logging.raw ? "raw" : "summary" : "off"}`;
	const save = await ctx.ui.confirm("Save Wingman setup?", summary);
	return save ? next : undefined;
}
