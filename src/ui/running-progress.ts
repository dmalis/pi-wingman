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

function statusColor(status: ReviewerStatus): string {
	switch (status) {
		case "ok": return "success";
		case "failed": return "error";
		case "cancelled": return "warning";
		case "running": return "accent";
		case "pending": return "muted";
	}
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	return `${(ms / 60_000).toFixed(1)}m`;
}

function reviewerDuration(progress: ReviewerProgress, startedAt: Map<string, number>): string | undefined {
	const duration = progress.durationMs ?? (progress.status === "running" ? Date.now() - (startedAt.get(progress.reviewer.key) ?? Date.now()) : undefined);
	return duration === undefined ? undefined : formatDuration(duration);
}

export async function withRunningProgress<T>(ctx: { hasUI?: boolean; ui: any }, input: { context: WingmanContextPack; reviewers: ResolvedReviewer[] }, run: (handle: ProgressHandle) => Promise<T>): Promise<T> {
	const controller = new AbortController();
	if (!ctx.hasUI) {
		return run({ signal: controller.signal, update: () => undefined, finish: (value) => value });
	}
	const result = await ctx.ui.custom((tui: any, theme: any, _kb: any, done: (value: T | { __wingmanError: string }) => void) => {
		const runStartedAt = Date.now();
		const reviewerStartedAt = new Map<string, number>();
		const statuses = new Map<string, ReviewerProgress>();
		for (const reviewer of input.reviewers) statuses.set(reviewer.key, { reviewer, status: "pending" });
		let cachedLines: string[] | undefined;
		let finished = false;
		let timer: ReturnType<typeof setInterval> | undefined;

		function requestRender() { cachedLines = undefined; tui.requestRender(); }

		function values(): ReviewerProgress[] { return Array.from(statuses.values()); }

		function counts() {
			const items = values();
			return {
				total: items.length,
				running: items.filter((item) => item.status === "running").length,
				ok: items.filter((item) => item.status === "ok").length,
				failed: items.filter((item) => item.status === "failed").length,
				cancelled: items.filter((item) => item.status === "cancelled").length,
			};
		}

		function updateChrome() {
			const c = counts();
			const active = c.running > 0 ? `${c.running} running` : c.ok + c.failed + c.cancelled === c.total ? "complete" : "starting";
			ctx.ui.setStatus?.("wingman", `wingman ${c.ok}/${c.total} ok${c.failed ? ` · ${c.failed} failed` : ""}${c.cancelled ? ` · ${c.cancelled} cancelled` : ""} · ${active}`);
		}

		function update(progress: ReviewerProgress) {
			if (progress.status === "running" && !reviewerStartedAt.has(progress.reviewer.key)) reviewerStartedAt.set(progress.reviewer.key, Date.now());
			statuses.set(progress.reviewer.key, progress);
			updateChrome();
			requestRender();
		}

		function clearChrome() {
			if (timer) clearInterval(timer);
			ctx.ui.setStatus?.("wingman", undefined);
		}

		function finish<R>(value: R): R {
			finished = true;
			clearChrome();
			done(value as unknown as T);
			return value;
		}

		function handleInput(data: string) {
			if (matchesKey(data, Key.escape) && !finished) {
				controller.abort();
				for (const progress of statuses.values()) {
					if (progress.status === "pending" || progress.status === "running") statuses.set(progress.reviewer.key, { ...progress, status: "cancelled", error: "cancelled by user" });
				}
				updateChrome();
				requestRender();
			}
		}

		function render(width: number): string[] {
			if (cachedLines) return cachedLines;
			const lines: string[] = [];
			const add = (line = "") => lines.push(truncateToWidth(line, width));
			const c = counts();
			const elapsed = formatDuration(Date.now() - runStartedAt);
			const border = theme.fg("accent", "─".repeat(width));
			add(border);
			add(theme.fg("accent", theme.bold(" 🪽 Wingman running")) + theme.fg("dim", `  ${input.context.label} · ${elapsed}`));
			add(theme.fg("muted", ` ${input.context.backend} backend · ${c.ok}/${c.total} ok${c.failed ? ` · ${c.failed} failed` : ""}${c.cancelled ? ` · ${c.cancelled} cancelled` : ""}`));
			add();
			for (const progress of statuses.values()) {
				const icon = statusIcon(progress.status);
				const color = statusColor(progress.status);
				const duration = reviewerDuration(progress, reviewerStartedAt);
				const detail = progress.error ?? progress.summary?.replace(/\s+/g, " ").slice(0, 80) ?? progress.status;
				add(theme.fg(color, ` ${icon} ${progress.reviewer.name.padEnd(12)} ${duration ? `${duration}  ` : ""}${detail}`));
			}
			add();
			add(theme.fg("dim", controller.signal.aborted ? " Cancelling... completed reviewer output will be preserved" : " Esc cancel remaining reviewers"));
			add(border);
			cachedLines = lines;
			return lines;
		}

		timer = setInterval(() => {
			if (!finished) {
				updateChrome();
				requestRender();
			}
		}, 1000);
		updateChrome();
		run({ signal: controller.signal, update, finish }).then((value) => finish(value)).catch((error) => finish({ __wingmanError: error instanceof Error ? error.message : String(error) }));
		return { render, invalidate: () => { cachedLines = undefined; }, handleInput };
	});
	const value = result as T | { __wingmanError: string };
	if (typeof value === "object" && value !== null && "__wingmanError" in value) throw new Error(String(value.__wingmanError));
	return value as T;
}
