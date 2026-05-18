import test from "node:test";
import assert from "node:assert/strict";
import { inferWingmanContext, parseMode } from "../src/target/infer-target.ts";

function nonRepoPi() {
	return {
		exec: async (command: string, args: string[]) => {
			if (command === "git" && args[0] === "rev-parse") return { code: 1, stdout: "", stderr: "not repo" };
			return { code: 1, stdout: "", stderr: "" };
		},
	} as any;
}

function repoPi(status = "", branch = "feature", defaultBranch = "main") {
	return {
		exec: async (_command: string, args: string[]) => {
			const key = args.join(" ");
			if (key === "rev-parse --show-toplevel") return { code: 0, stdout: "/repo\n" };
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

test("mode parsing detects consensus/adversarial/rescue/audit", () => {
	assert.equal(parseMode("find consensus"), "consensus");
	assert.equal(parseMode("pressure-test this"), "adversarial");
	assert.equal(parseMode("debug why stuck"), "rescue");
	assert.equal(parseMode("audit this"), "audit");
});

test("target inference prefers latest decision question for consensus", async () => {
	const context = await inferWingmanContext({ pi: nonRepoPi(), cwd: "/tmp", request: "find consensus", session: session("Implementation plan\n1. implement\n2. test\nShould we add the API layer?") });
	assert.equal(context.target.type, "question-consensus");
});

test("target inference detects current plan before git state", async () => {
	const context = await inferWingmanContext({ pi: repoPi(" M src/file.ts\n"), cwd: "/repo", request: "audit plan", session: session("Implementation plan\n1. implement change\n2. test it\n3. verify behavior") });
	assert.equal(context.target.type, "current-plan");
	assert.equal(context.backend, "direct");
});

test("target inference detects dirty working tree before branch diff", async () => {
	const context = await inferWingmanContext({ pi: repoPi(" M src/file.ts\n"), cwd: "/repo", request: "audit", session: session("Looks good.") });
	assert.equal(context.target.type, "working-tree");
});

test("target inference detects branch diff when repo is clean feature branch", async () => {
	const context = await inferWingmanContext({ pi: repoPi("", "feature", "main"), cwd: "/repo", request: "audit", session: session("") });
	assert.equal(context.target.type, "branch-diff");
});
