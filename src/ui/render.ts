import type { ReviewerResult, WingmanRunResult } from "../types.ts";

function formatDuration(ms: number | undefined): string | undefined {
	if (ms === undefined) return undefined;
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	return `${(ms / 60_000).toFixed(1)}m`;
}

function statusLine(result: ReviewerResult): string {
	const icon = result.status === "ok" ? "[ok]" : result.status === "failed" ? "[failed]" : "[cancelled]";
	const duration = formatDuration(result.durationMs);
	const timing = duration ? `, ${duration}` : "";
	const detail = result.status === "ok" ? "returned review output" : result.error ?? result.status;
	return `- ${icon} ${result.reviewer.name} (${result.reviewer.key}, ${result.backend}${timing}): ${detail}`;
}

export function formatWingmanRunResult(input: Omit<WingmanRunResult, "text">): string {
	const ok = input.results.filter((result) => result.status === "ok");
	const failed = input.results.filter((result) => result.status === "failed");
	const cancelled = input.results.filter((result) => result.status === "cancelled");
	const latestOk = new Map<string, ReviewerResult>();
	for (const result of ok) latestOk.set(result.reviewer.key, result);
	const latest = Array.from(latestOk.values());
	const duration = formatDuration(input.durationMs);
	return [
		`Wingman complete: ${ok.length} ok / ${failed.length} failed / ${cancelled.length} cancelled${duration ? ` in ${duration}` : ""}`,
		`Target: ${input.targetLabel}${input.cancelled ? " (cancelled)" : ""}`,
		"",
		"Reviewer status:",
		...input.results.map(statusLine),
		"",
		latest.length > 0 ? "Reviewer summaries:" : undefined,
		...latest.map((result) => [`## ${result.reviewer.name} (${result.reviewer.key})`, result.summary ?? result.output ?? "(no summary)"].join("\n")),
		failed.length > 0 ? "" : undefined,
		failed.length > 0 ? "Failures:" : undefined,
		...failed.map((result) => `- ${result.reviewer.name}: ${result.error ?? "failed"}`),
		"",
		"Main agent: integrate Wingman result. State what you accept, what you reject, and what concrete changes or next actions follow. Do not dump raw reviewer output. After synthesis, stop and wait for user confirmation before modifying files, updating plans, fixing, or continuing implementation.",
	].filter((line): line is string => line !== undefined).join("\n");
}
