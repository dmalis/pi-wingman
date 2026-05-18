import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { projectRoot } from "../config.ts";
import type { WingmanConfig, WingmanRunResult } from "../types.ts";

function dateStamp(now = new Date()): string {
	return now.toISOString().slice(0, 10);
}

export async function appendWingmanLog(cwd: string, config: WingmanConfig, result: WingmanRunResult): Promise<void> {
	if (!config.logging.enabled) return;
	const dir = join(projectRoot(cwd), ".wingman", "logs");
	await mkdir(dir, { recursive: true });
	const entry = {
		time: new Date().toISOString(),
		request: result.request,
		mode: result.mode,
		target: result.targetLabel,
		rounds: result.rounds,
		cancelled: result.cancelled,
		reviewers: result.results.map((item) => ({ name: item.reviewer.name, model: item.reviewer.key, status: item.status, error: item.error, summary: item.summary, raw: config.logging.raw ? item.output : undefined })),
	};
	await appendFile(join(dir, `${dateStamp()}.jsonl`), `${JSON.stringify(entry)}\n`, "utf8");
}
