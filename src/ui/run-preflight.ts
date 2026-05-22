import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

function key(data: string, value: string): boolean {
	return data === value || matchesKey(data, value as never) || matchesKey(data, Key.shift(value as never) as never);
}

import type { ResolvedReviewer, WingmanContextPack } from "../types.ts";

export type PreflightResult =
	| { action: "run"; reviewers: ResolvedReviewer[]; request: string }
	| { action: "setup" }
	| { action: "cancel" };

export async function showRunPreflight(ctx: { hasUI?: boolean; ui: any }, input: { context: WingmanContextPack; reviewers: ResolvedReviewer[]; request: string }): Promise<PreflightResult> {
	if (!ctx.hasUI) return { action: "run", reviewers: input.reviewers, request: input.request };
	let request = input.request;
	let selected = new Set(input.reviewers.map((reviewer) => reviewer.key));
	for (;;) {
		const result = await ctx.ui.custom((tui: any, theme: any, _kb: any, done: (value: "run" | "edit" | "setup" | "cancel" | null) => void) => {
			let index = 0;
			let cachedLines: string[] | undefined;
			function refresh() { cachedLines = undefined; tui.requestRender(); }
			function handleInput(data: string) {
				if (matchesKey(data, Key.escape)) { done("cancel"); return; }
				if (matchesKey(data, Key.enter)) { done("run"); return; }
				if (matchesKey(data, Key.up)) { index = Math.max(0, index - 1); refresh(); return; }
				if (matchesKey(data, Key.down)) { index = Math.min(input.reviewers.length - 1, index + 1); refresh(); return; }
				if (matchesKey(data, Key.space)) {
					const reviewer = input.reviewers[index];
					if (selected.has(reviewer.key)) selected.delete(reviewer.key); else selected.add(reviewer.key);
					refresh();
					return;
				}
				if (key(data, "a")) { for (const reviewer of input.reviewers) selected.add(reviewer.key); refresh(); return; }
				if (key(data, "n")) { selected.clear(); refresh(); return; }
				if (key(data, "e")) { done("edit"); return; }
				if (key(data, "s")) { done("setup"); return; }
			}
			function render(width: number): string[] {
				if (cachedLines) return cachedLines;
				const lines: string[] = [];
				const add = (line = "") => lines.push(truncateToWidth(line, width));
				const border = theme.fg("accent", "─".repeat(width));
				add(border);
				add(theme.fg("accent", theme.bold(" Wingman")) + theme.fg("dim", `  ${input.context.mode} • ${input.context.label}`));
				add(theme.fg("muted", ` Backend ${input.context.backend} • Target confidence ${input.context.target.confidence}`));
				add();
				add(theme.fg("text", " What should Wingman check in this conversation?"));
				for (const line of (request || input.context.focus).split(/\r?\n/).slice(0, 4)) add(theme.fg("muted", `  ${line}`));
				add();
				add(theme.fg("text", ` Reviewers (${selected.size}/${input.reviewers.length} selected)`));
				for (let i = 0; i < input.reviewers.length; i += 1) {
					const reviewer = input.reviewers[i];
					const marker = selected.has(reviewer.key) ? "[x]" : "[ ]";
					const cursor = i === index ? ">" : " ";
					const text = `${cursor} ${marker} ${reviewer.name.padEnd(12)} ${reviewer.key}`;
					add(i === index ? theme.fg("accent", text) : theme.fg(selected.has(reviewer.key) ? "text" : "muted", text));
				}
				add();
				add(theme.fg("accent", " ⌨ Shortcuts") + theme.fg("muted", "  Enter run • Space toggle • a all • n none • e edit question • s setup • Esc cancel"));
				add(border);
				cachedLines = lines;
				return lines;
			}
			return { render, invalidate: () => { cachedLines = undefined; }, handleInput };
		});
		const action = result as "run" | "edit" | "setup" | "cancel" | null;
		if (action === "edit") {
			const edited = await ctx.ui.editor("What should Wingman check in this conversation?", request || input.context.focus);
			if (edited !== undefined) request = edited;
			continue;
		}
		if (action === "setup") return { action: "setup" };
		if (action !== "run") return { action: "cancel" };
		const reviewers = input.reviewers.filter((reviewer) => selected.has(reviewer.key));
		if (reviewers.length === 0) {
			ctx.ui.notify("Choose at least one Wingman reviewer.", "warning");
			continue;
		}
		return { action: "run", reviewers, request };
	}
}
