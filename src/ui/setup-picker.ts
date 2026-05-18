import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { configPath } from "../config.ts";
import { formatModelLabel, makeUniqueReviewerNames, modelKey, sanitizeReviewerName } from "../models.ts";
import type { ModelListItem, WingmanConfig, WingmanReviewerConfig } from "../types.ts";

function isPrintable(data: string): boolean {
	return data.length === 1 && data >= " " && data !== "\x7f";
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

export async function showSetupPicker(ctx: { cwd: string; hasUI?: boolean; ui: any }, models: ModelListItem[], current: WingmanConfig): Promise<WingmanConfig | undefined> {
	if (!ctx.hasUI) {
		return { ...current, reviewers: current.reviewers };
	}
	const existing = new Map(current.reviewers.map((reviewer) => [modelKey(reviewer.provider, reviewer.model), reviewer]));
	const selected = new Set(current.reviewers.map((reviewer) => modelKey(reviewer.provider, reviewer.model)));
	const names = makeUniqueReviewerNames(models);
	const aliases = new Map<string, string>(names);
	for (const reviewer of current.reviewers) aliases.set(modelKey(reviewer.provider, reviewer.model), reviewer.name);
	let exclude = current.exclude;
	let maxRounds = current.maxRounds;
	let defaultReviewers = current.defaultReviewers;
	let loggingEnabled = current.logging.enabled;
	let rawLogging = current.logging.raw;

	const saved = await ctx.ui.custom((tui: any, theme: any, _kb: any, done: (value: WingmanConfig | null) => void) => {
		let query = "";
		let index = 0;
		let cachedLines: string[] | undefined;
		let editingKey: string | undefined;
		let editBuffer = "";
		let searchMode = false;
		let message = "";

		function visible() {
			return filterItems(models, query);
		}
		function clamp() {
			const count = visible().length;
			index = Math.max(0, Math.min(index, Math.max(0, count - 1)));
		}
		function refresh() {
			cachedLines = undefined;
			clamp();
			tui.requestRender();
		}
		function toggle(item: ModelListItem | undefined) {
			if (!item) return;
			const key = modelKey(item.provider, item.model);
			if (selected.has(key)) selected.delete(key);
			else selected.add(key);
			refresh();
		}
		function buildConfig(): WingmanConfig {
			const reviewers = models
				.filter((item) => selected.has(modelKey(item.provider, item.model)))
				.map((item) => reviewerForItem(item, aliases, existing));
			return { version: 1, exclude, defaultReviewers, maxRounds, maxParallelReviewers: current.maxParallelReviewers, logging: { enabled: loggingEnabled, raw: rawLogging }, reviewers };
		}
		function beginAliasEdit(item: ModelListItem | undefined) {
			if (!item) return;
			const key = modelKey(item.provider, item.model);
			selected.add(key);
			editingKey = key;
			editBuffer = aliases.get(key) ?? "";
			message = "Editing alias: use [a-z0-9._-]+, Enter apply, Esc cancel";
			refresh();
		}
		function applyAliasEdit() {
			if (!editingKey) return;
			const alias = editBuffer.trim();
			if (!/^[a-z0-9._-]+$/.test(alias)) {
				message = "Alias must match [a-z0-9._-]+";
				refresh();
				return;
			}
			aliases.set(editingKey, alias);
			editingKey = undefined;
			editBuffer = "";
			message = "Alias updated";
			refresh();
		}
		function handleInput(data: string) {
			const items = visible();
			if (editingKey) {
				if (matchesKey(data, Key.escape)) { editingKey = undefined; editBuffer = ""; message = "Alias edit cancelled"; refresh(); return; }
				if (matchesKey(data, Key.enter)) { applyAliasEdit(); return; }
				if (matchesKey(data, Key.backspace)) { editBuffer = editBuffer.slice(0, -1); refresh(); return; }
				if (isPrintable(data)) { editBuffer = sanitizeReviewerName(editBuffer + data); refresh(); return; }
				return;
			}
			if (searchMode) {
				if (matchesKey(data, Key.escape)) { searchMode = false; if (query) query = ""; refresh(); return; }
				if (matchesKey(data, Key.enter)) { searchMode = false; refresh(); return; }
				if (matchesKey(data, Key.backspace)) { query = query.slice(0, -1); refresh(); return; }
				if (isPrintable(data)) { query += data; refresh(); return; }
				return;
			}
			if (matchesKey(data, Key.escape)) {
				if (query) { query = ""; refresh(); return; }
				done(null);
				return;
			}
			if (matchesKey(data, Key.up)) { index -= 1; refresh(); return; }
			if (matchesKey(data, Key.down)) { index += 1; refresh(); return; }
			if (matchesKey(data, Key.enter)) {
				const next = buildConfig();
				const dupes = duplicateAliases(next.reviewers);
				if (dupes.length > 0) { message = `Duplicate aliases: ${dupes.join(", ")}`; refresh(); return; }
				done(next);
				return;
			}
			if (matchesKey(data, Key.space)) { toggle(items[index]); return; }
			if (matchesKey(data, Key.backspace)) { query = query.slice(0, -1); refresh(); return; }
			if (data === "a" || data === "A") { for (const item of items) selected.add(modelKey(item.provider, item.model)); refresh(); return; }
			if (data === "n" || data === "N") { for (const item of items) selected.delete(modelKey(item.provider, item.model)); refresh(); return; }
			if (data === "e" || data === "E") { beginAliasEdit(items[index]); return; }
			if (data === "p" || data === "P") { exclude = exclude === "same-provider" ? "same-model" : "same-provider"; refresh(); return; }
			if (data === "d" || data === "D") { defaultReviewers = defaultReviewers === "all-eligible" ? "ask" : "all-eligible"; refresh(); return; }
			if (data === "l") { loggingEnabled = !loggingEnabled; if (!loggingEnabled) rawLogging = false; refresh(); return; }
			if (data === "L") { rawLogging = !rawLogging; if (rawLogging) loggingEnabled = true; refresh(); return; }
			if (data === "+" || data === "=") { maxRounds = Math.min(10, maxRounds + 1); refresh(); return; }
			if (data === "-" || data === "_") { maxRounds = Math.max(1, maxRounds - 1); refresh(); return; }
			if (data === "/") { searchMode = true; message = "Search mode: type to filter, Enter keep filter, Esc clear"; refresh(); return; }
		}
		function render(width: number): string[] {
			if (cachedLines) return cachedLines;
			const lines: string[] = [];
			const add = (line: string = "") => lines.push(truncateToWidth(line, width));
			const items = visible();
			const top = theme.fg("accent", "─".repeat(width));
			add(top);
			add(theme.fg("accent", theme.bold(" Wingman setup")) + theme.fg("dim", `  ${configPath(ctx.cwd)}`));
			add(theme.fg("muted", ` Selected ${selected.size}/${models.length} • Exclude ${exclude} • Default ${defaultReviewers} • Max rounds ${maxRounds} • Logging ${loggingEnabled ? rawLogging ? "raw" : "summary" : "off"}`));
			add(theme.fg(exclude === "same-provider" ? "warning" : "accent", ` Policy: ${exclude === "same-provider" ? "same-provider = strongest independence" : "same-model = allow same-provider different-model reviewers"} (exact same model is always excluded at runtime)`));
			add(theme.fg(searchMode ? "accent" : "muted", editingKey ? ` Alias: ${editBuffer || "_"}` : ` Search: ${query || "(press / to filter)"}${searchMode ? "_" : ""}`));
			if (message) add(theme.fg(message.startsWith("Duplicate") || message.startsWith("Alias must") ? "warning" : "muted", ` ${message}`));
			add();
			if (items.length === 0) {
				add(theme.fg("warning", " No matching models"));
			} else {
				const start = Math.max(0, Math.min(index - 7, Math.max(0, items.length - 15)));
				const page = items.slice(start, start + 15);
				for (let offset = 0; offset < page.length; offset += 1) {
					const item = page[offset];
					const absolute = start + offset;
					const key = modelKey(item.provider, item.model);
					const marker = selected.has(key) ? "[x]" : "[ ]";
					const cursor = absolute === index ? ">" : " ";
					const name = aliases.get(key) ?? item.provider;
					const text = `${cursor} ${marker} ${name.padEnd(12)} ${formatModelLabel(item)}`;
					add(absolute === index ? theme.fg("accent", text) : theme.fg(selected.has(key) ? "text" : "muted", text));
				}
			}
			add();
			add(theme.fg("dim", " ↑↓ move • Space toggle • / search • e edit alias • Enter save • Esc clear/cancel • a all • n none • p policy • d default • +/- rounds • l logging"));
			add(top);
			cachedLines = lines;
			return lines;
		}
		return { render, invalidate: () => { cachedLines = undefined; }, handleInput };
	});
	return (saved as WingmanConfig | null) ?? undefined;
}
