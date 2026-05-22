import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { ResolvedReviewer, ReviewerProgress, ReviewerStatus, WingmanContextPack } from "../types.ts";

export type ProgressHandle = {
	signal: AbortSignal;
	update(progress: ReviewerProgress): void;
	finish<T>(value: T): T;
};

function statusIcon(status: ReviewerStatus): string {
	switch (status) {
		case "pending": return "○";
		case "running": return "⏳";
		case "ok": return "✓";
		case "failed": return "✗";
		case "cancelled": return "⊘";
	}
}

export async function withRunningProgress<T>(ctx: { hasUI?: boolean; ui: any }, input: { context: WingmanContextPack; reviewers: ResolvedReviewer[] }, run: (handle: ProgressHandle) => Promise<T>): Promise<T> {
	const controller = new AbortController();
	if (!ctx.hasUI) {
		return run({ signal: controller.signal, update: () => undefined, finish: (value) => value });
	}
	const result = await ctx.ui.custom((tui: any, theme: any, _kb: any, done: (value: T | { __wingmanError: string }) => void) => {
		const statuses = new Map<string, ReviewerProgress>();
		for (const reviewer of input.reviewers) statuses.set(reviewer.key, { reviewer, status: "pending" });
		let cachedLines: string[] | undefined;
		let finished = false;
		function requestRender() { cachedLines = undefined; tui.requestRender(); }
		function update(progress: ReviewerProgress) {
			statuses.set(progress.reviewer.key, progress);
			const values = Array.from(statuses.values());
			const running = values.filter((item) => item.status === "running").length;
			const ok = values.filter((item) => item.status === "ok").length;
			const failed = values.filter((item) => item.status === "failed").length;
			ctx.ui.setStatus?.("wingman", `wingman: ${ok} ok / ${failed} failed / ${running} running`);
			requestRender();
		}
		function finish<R>(value: R): R {
			finished = true;
			ctx.ui.setStatus?.("wingman", undefined);
			done(value as unknown as T);
			return value;
		}
		function handleInput(data: string) {
			if (matchesKey(data, Key.escape) && !finished) {
				controller.abort();
				for (const progress of statuses.values()) {
					if (progress.status === "pending" || progress.status === "running") statuses.set(progress.reviewer.key, { ...progress, status: "cancelled", error: "cancelled by user" });
				}
				requestRender();
			}
		}
		function render(width: number): string[] {
			if (cachedLines) return cachedLines;
			const lines: string[] = [];
			const add = (line = "") => lines.push(truncateToWidth(line, width));
			const border = theme.fg("accent", "─".repeat(width));
			add(border);
			add(theme.fg("accent", theme.bold(" Wingman running")) + theme.fg("dim", `  ${input.context.label}`));
			add(theme.fg("muted", ` Backend ${input.context.backend}`));
			add();
			for (const progress of statuses.values()) {
				const icon = statusIcon(progress.status);
				const color = progress.status === "ok" ? "success" : progress.status === "failed" ? "error" : progress.status === "cancelled" ? "warning" : progress.status === "running" ? "accent" : "muted";
				const detail = progress.error ?? progress.summary?.replace(/\s+/g, " ").slice(0, 80) ?? progress.status;
				add(theme.fg(color, ` ${icon} ${progress.reviewer.name.padEnd(12)} ${detail}`));
			}
			add();
			add(theme.fg("dim", controller.signal.aborted ? " Cancelling... completed reviewer output will be preserved" : " Esc cancel remaining reviewers"));
			add(border);
			cachedLines = lines;
			return lines;
		}
		run({ signal: controller.signal, update, finish }).then((value) => finish(value)).catch((error) => finish({ __wingmanError: error instanceof Error ? error.message : String(error) }));
		return { render, invalidate: () => { cachedLines = undefined; }, handleInput };
	});
	const value = result as T | { __wingmanError: string };
	if (typeof value === "object" && value !== null && "__wingmanError" in value) throw new Error(String(value.__wingmanError));
	return value as T;
}
