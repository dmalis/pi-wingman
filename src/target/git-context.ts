import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export type ExecLike = (command: string, args: string[], options?: Record<string, unknown>) => Promise<{ code?: number; stdout?: string; stderr?: string }>;

export type GitState = {
	isRepo: boolean;
	root: string;
	branch?: string;
	defaultBranch?: string;
	isDirty: boolean;
	status: string;
};

export type GitContextResult = {
	content: string;
	large: boolean;
	bytes: number;
};

const MAX_UNTRACKED_BYTES = 12 * 1024;
const MAX_INLINE_DIFF_BYTES = 80 * 1024;
const MAX_CONTEXT_CHARS = 120_000;

function bound(text: string, limit: number): string {
	if (text.length <= limit) return text;
	return `${text.slice(0, limit)}\n... [truncated ${text.length - limit} chars]`;
}

async function git(exec: ExecLike, cwd: string, args: string[], signal?: AbortSignal): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> {
	try {
		const result = await exec("git", args, { cwd, signal });
		const code = result.code ?? 0;
		return { ok: code === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "", code };
	} catch (error) {
		return { ok: false, stdout: "", stderr: error instanceof Error ? error.message : String(error), code: 1 };
	}
}

export async function getGitState(exec: ExecLike, cwd: string, signal?: AbortSignal): Promise<GitState> {
	const rootResult = await git(exec, cwd, ["rev-parse", "--show-toplevel"], signal);
	if (!rootResult.ok || !rootResult.stdout.trim()) {
		return { isRepo: false, root: cwd, isDirty: false, status: "" };
	}
	const root = rootResult.stdout.trim();
	const [statusResult, branchResult, defaultBranch] = await Promise.all([
		git(exec, root, ["status", "--short", "--untracked-files=all"], signal),
		git(exec, root, ["branch", "--show-current"], signal),
		detectDefaultBranch(exec, root, signal).catch(() => undefined),
	]);
	const status = statusResult.stdout.trim();
	return {
		isRepo: true,
		root,
		branch: branchResult.stdout.trim() || undefined,
		defaultBranch,
		isDirty: Boolean(status),
		status,
	};
}

export async function detectDefaultBranch(exec: ExecLike, cwd: string, signal?: AbortSignal): Promise<string | undefined> {
	const remoteHead = await git(exec, cwd, ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"], signal);
	if (remoteHead.ok && remoteHead.stdout.trim()) return remoteHead.stdout.trim().replace(/^origin\//, "");
	for (const candidate of ["main", "master", "trunk"]) {
		const local = await git(exec, cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`], signal);
		if (local.ok) return candidate;
		const remote = await git(exec, cwd, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${candidate}`], signal);
		if (remote.ok) return `origin/${candidate}`;
	}
	return undefined;
}

async function listUntracked(exec: ExecLike, cwd: string, signal?: AbortSignal): Promise<string[]> {
	const result = await git(exec, cwd, ["ls-files", "--others", "--exclude-standard"], signal);
	return result.ok ? result.stdout.trim().split("\n").map((line) => line.trim()).filter(Boolean) : [];
}

async function formatUntracked(cwd: string, file: string): Promise<string> {
	const path = join(cwd, file);
	try {
		const info = await stat(path);
		if (info.isDirectory()) return `### ${file}\n(skipped: directory)`;
		if (info.size > MAX_UNTRACKED_BYTES) return `### ${file}\n(skipped: ${info.size} bytes exceeds ${MAX_UNTRACKED_BYTES})`;
		const content = await readFile(path);
		if (content.includes(0)) return `### ${file}\n(skipped: binary file)`;
		return [`### ${file}`, "```", content.toString("utf8").trimEnd(), "```"].join("\n");
	} catch (error) {
		return `### ${file}\n(skipped: ${error instanceof Error ? error.message : String(error)})`;
	}
}

function section(title: string, body: string): string {
	return [`## ${title}`, "", body.trim() || "(none)", ""].join("\n");
}

export async function collectWorkingTreeContext(exec: ExecLike, cwd: string, signal?: AbortSignal): Promise<GitContextResult> {
	const [status, staged, unstaged, untracked] = await Promise.all([
		git(exec, cwd, ["status", "--short", "--untracked-files=all"], signal),
		git(exec, cwd, ["diff", "--cached", "--binary", "--no-ext-diff", "--submodule=diff"], signal),
		git(exec, cwd, ["diff", "--binary", "--no-ext-diff", "--submodule=diff"], signal),
		listUntracked(exec, cwd, signal),
	]);
	const untrackedBody = (await Promise.all(untracked.slice(0, 20).map((file) => formatUntracked(cwd, file)))).join("\n\n");
	const content = [
		section("Git Status", status.stdout),
		section("Staged Diff", staged.stdout),
		section("Unstaged Diff", unstaged.stdout),
		section("Untracked Files", untrackedBody),
	].join("\n");
	const bytes = Buffer.byteLength(content, "utf8");
	return { content: bound(content, MAX_CONTEXT_CHARS), large: bytes > MAX_INLINE_DIFF_BYTES, bytes };
}

export async function collectBranchContext(exec: ExecLike, cwd: string, base: string, signal?: AbortSignal): Promise<GitContextResult> {
	const mergeBase = await git(exec, cwd, ["merge-base", "HEAD", base], signal);
	const range = mergeBase.ok && mergeBase.stdout.trim() ? `${mergeBase.stdout.trim()}..HEAD` : `${base}...HEAD`;
	const [log, stat, diff] = await Promise.all([
		git(exec, cwd, ["log", "--oneline", "--decorate", range], signal),
		git(exec, cwd, ["diff", "--stat", range], signal),
		git(exec, cwd, ["diff", "--binary", "--no-ext-diff", "--submodule=diff", range], signal),
	]);
	const content = [
		section("Comparison", `Base: ${base}\nRange: ${range}`),
		section("Commit Log", log.stdout),
		section("Diff Stat", stat.stdout),
		section("Branch Diff", diff.stdout),
	].join("\n");
	const bytes = Buffer.byteLength(content, "utf8");
	return { content: bound(content, MAX_CONTEXT_CHARS), large: bytes > MAX_INLINE_DIFF_BYTES, bytes };
}
