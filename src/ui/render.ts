import type { ReviewerResult, WingmanRunResult } from "../types.ts";

function statusLine(result: ReviewerResult): string {
	const icon = result.status === "ok" ? "[ok]" : result.status === "failed" ? "[failed]" : "[cancelled]";
	const detail = result.status === "ok" ? "returned review output" : result.error ?? result.status;
	return `- ${icon} ${result.reviewer.name} (${result.reviewer.key}, ${result.backend}): ${detail}`;
}

export function formatWingmanRunResult(input: Omit<WingmanRunResult, "text">): string {
	const ok = input.results.filter((result) => result.status === "ok");
	const failed = input.results.filter((result) => result.status === "failed");
	const cancelled = input.results.filter((result) => result.status === "cancelled");
	const latestOk = new Map<string, ReviewerResult>();
	for (const result of ok) latestOk.set(result.reviewer.key, result);
	const latest = Array.from(latestOk.values());
	return [
		`Wingman complete: ${ok.length} ok / ${failed.length} failed / ${cancelled.length} cancelled`,
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
