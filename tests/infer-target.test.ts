import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { inferWingmanContext } from "../src/target/infer-target.ts";

function repoPi(status = "", branch = "feature", defaultBranch = "main", root = "/repo") {
	return {
		exec: async (_command: string, args: string[]) => {
			const key = args.join(" ");
			if (key === "rev-parse --show-toplevel") return { code: 0, stdout: `${root}\n` };
			if (key === "status --short --untracked-files=all") return { code: 0, stdout: status };
			if (key === "branch --show-current") return { code: 0, stdout: `${branch}\n` };
			if (key === "symbolic-ref refs/remotes/origin/HEAD --short") return { code: 0, stdout: `origin/${defaultBranch}\n` };
			if (key.startsWith("diff") || key.startsWith("log") || key.startsWith("merge-base")) return { code: 0, stdout: "" };
			return { code: 1, stdout: "", stderr: "" };
		},
	} as any;
}

function session(assistantText: string) {
	return { getBranch: () => [{ message: { role: "assistant", content: [{ type: "text", text: assistantText }] } }] } as any;
}

test("target inference detects current plan before git state", async () => {
	const context = await inferWingmanContext({ pi: repoPi(" M src/file.ts\n"), cwd: "/repo", request: "audit plan", session: session("Implementation plan\n1. implement change\n2. test it\n3. verify behavior") });
	assert.equal(context.target.type, "current-plan");
	assert.equal(context.backend, "direct");
});

test("target inference uses explicit chat focus to review latest assistant answer", async () => {
	const context = await inferWingmanContext({ pi: repoPi(" M src/file.ts\n"), cwd: "/repo", request: "vite or grunt", session: session("Implementation plan\n1. implement change\n2. test it\n3. verify behavior") });
	assert.equal(context.target.type, "last-turn");
	assert.equal(context.label, "latest assistant turn");
	assert.match(context.content, /## User Request\n\nvite or grunt/);
	assert.match(context.content, /## Recent Conversation/);
	assert.match(context.content, /Implementation plan/);
});

test("target inference treats explicit request without chat as freeform", async () => {
	const context = await inferWingmanContext({ pi: repoPi(" M src/file.ts\n"), cwd: "/repo", request: "vite or grunt", session: session("") });
	assert.equal(context.target.type, "freeform");
	assert.equal(context.label, "freeform request");
	assert.match(context.content, /## Request\n\nvite or grunt/);
});

test("target inference detects dirty working tree before branch diff", async () => {
	const context = await inferWingmanContext({ pi: repoPi(" M src/file.ts\n"), cwd: "/repo", request: "audit", session: session("Looks good.") });
	assert.equal(context.target.type, "working-tree");
});

test("target inference detects branch diff when repo is clean feature branch", async () => {
	const context = await inferWingmanContext({ pi: repoPi("", "feature", "main"), cwd: "/repo", request: "audit", session: session("") });
	assert.equal(context.target.type, "branch-diff");
});

test("file target parsing stops before trailing natural-language focus", async () => {
	const root = await mkdtemp(join(tmpdir(), "wingman-files-"));
	await writeFile(join(root, "README.md"), "readme", "utf8");
	await writeFile(join(root, "src.ts"), "source", "utf8");
	const context = await inferWingmanContext({
		pi: repoPi("", "main", "main", root),
		cwd: root,
		request: "review files README.md src.ts for smoke test",
		session: session(""),
	});
	assert.deepEqual(context.target, { type: "files", paths: ["README.md", "src.ts"], confidence: "high" });
	assert.match(context.content, /## README\.md\n\nreadme/);
	assert.match(context.content, /## src\.ts\n\nsource/);
});

test("file target collection blocks paths outside project root", async () => {
	const parent = await mkdtemp(join(tmpdir(), "wingman-root-"));
	const root = join(parent, "repo");
	await mkdir(root);
	await writeFile(join(root, "inside.ts"), "inside", "utf8");
	await writeFile(join(parent, "outside.txt"), "secret outside", "utf8");
	const context = await inferWingmanContext({
		pi: repoPi("", "main", "main", root),
		cwd: root,
		request: "review files ../outside.txt inside.ts",
		session: session(""),
	});
	assert.equal(context.target.type, "files");
	assert.match(context.content, /## \.\.\/outside\.txt\n\n\(skipped: path escapes project root\)/);
	assert.doesNotMatch(context.content, /secret outside/);
	assert.match(context.content, /## inside\.ts\n\ninside/);
});
