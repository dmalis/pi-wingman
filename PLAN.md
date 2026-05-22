# Pi Wingman Extension Plan

## Goal

Build a standalone Pi extension that gives the current coding agent an independent second-opinion reviewer system.

The user should be able to say things like:

```text
/wingman
/wingman audit this plan
/wingman codex find consensus
ask wingman
ask codex find consensus
audit with gemini
```

…and Wingman should feel smart enough to infer what needs auditing: the latest plan, the latest question, the dirty diff, the branch diff, named files, or the recent conversation focus.

## Product identity

- Package/repo working name: `pi-wingman`.
- Commands:
  - `/wingman [request]`
  - `/wingman:setup`
- Project namespace:
  - `.wingman/`
- No MCC dependency and no MCC work folders.

## Non-goals

- Do not recreate a full workflow manager.
- Do not require active MCC/Malis work.
- Do not create per-work state directories.
- Do not expose many commands.
- Do not depend on `pi-subagents`.
- Do not let Wingman mutate files unless a future explicit write-capable rescue mode is deliberately designed.

## State and persistence

Default state should be minimal:

```text
.wingman/
  config.json
```

## Config shape

Project-local config only:

```json
{
  "version": 1,
  "exclude": "same-provider",
  "defaultReviewers": "all-eligible",
  "maxRounds": 3,
  "maxParallelReviewers": 4,
  "reviewers": [
    {
      "name": "codex",
      "provider": "openai",
      "model": "gpt-5-codex",
      "thinking": "high"
    },
    {
      "name": "gemini",
      "provider": "google",
      "model": "gemini-2.5-pro",
      "thinking": "high"
    }
  ]
}
```

`exclude` modes:

- `same-model`: exclude exact current provider/model.
- `same-provider`: exclude all configured reviewers from the current provider. This should be the default.

Reviewer selection must fail closed:

- Use only configured reviewers.
- Validate provider/model IDs against Pi's available model registry.
- Never silently fall back to unconfigured models.
- If the user hints `codex`, `gemini`, etc., match only configured reviewers by name/provider/model.

## User interface

### `/wingman:setup`

Use a native Pi TUI multi-select wizard.

Core screen:

```text
╭─ Wingman setup ─────────────────────────────────────────────╮
│ Project config: .wingman/config.json                        │
│                                                             │
│ Select reviewer models                                      │
│                                                             │
│ Search: gem                                                 │
│                                                             │
│ [x] codex        openai/gpt-5-codex          reasoning      │
│ [x] gemini       google/gemini-2.5-pro       reasoning      │
│ [ ] deepseek     openrouter/deepseek-v4-pro  reasoning      │
│ [ ] claude       anthropic/claude-opus-4.1   reasoning      │
│                                                             │
│ Space toggle • Enter save • / search • Esc cancel           │
╰─────────────────────────────────────────────────────────────╯
```

Interactions:

- `↑`/`↓`: move selection.
- `Space`: toggle model.
- Type or `/`: search/filter.
- `a`: select all visible.
- `n`: clear all visible.
- `p`: toggle exclusion policy.
- `r`: edit max rounds.
- `Enter`: save.
- `Esc`: cancel without saving.

### `/wingman`

Before running, show a compact preflight confirmation if target/reviewer choice is ambiguous:

```text
╭─ Wingman ───────────────────────────────────────────────────╮
│ Target: current plan                                        │
│ Mode: consensus                                             │
│ Max rounds: 3                                               │
│                                                             │
│ Reviewers                                                   │
│ [x] codex       openai/gpt-5-codex                          │
│ [x] gemini      google/gemini-2.5-pro                       │
│ [ ] deepseek    openrouter/deepseek-v4-pro                  │
│                                                             │
│ Focus                                                       │
│ “Should we add an API layer to auth?”                        │
│                                                             │
│ Enter run • Space toggle • e edit focus • Esc cancel         │
╰─────────────────────────────────────────────────────────────╯
```

If config says `defaultReviewers: all-eligible` and inference is confident, run without extra friction.

### Running UI

Parallel reviewer execution should be visible and cancellable:

```text
╭─ Wingman running ───────────────────────────────────────────╮
│ Target: current plan • Round 1/3                            │
│                                                             │
│ ⏳ codex       reviewing...                                  │
│ ✓  gemini      returned review output                       │
│ ⏳ deepseek    reviewing...                                  │
│                                                             │
│ Esc cancel remaining reviewers                              │
╰─────────────────────────────────────────────────────────────╯
```

Cancellation behavior:

- Abort all in-flight reviewer calls.
- Preserve completed reviewer output.
- Return a partial result summary to the main agent/user.

Use Pi UI primitives:

- `ctx.ui.custom()` for setup picker, preflight picker, and running progress.
- `ctx.ui.setStatus("wingman", ...)` for footer status.
- `ctx.ui.setWidget("wingman", ...)` for live parallel status when useful.
- Custom `renderCall`/`renderResult` for the `wingman` tool.

## Runtime model

Wingman should support two internal execution backends.

### Direct backend

Use `complete()` from `@earendil-works/pi-ai` when the extension has already collected enough bounded context.

Best for:

- latest assistant question
- current plan text
- small git diff
- small explicit focus

### Clean subagent backend

Use Pi SDK `createAgentSession()` with a clean resource loader and read-only tools for large or ambiguous repo audits.

Best for:

- large diffs
- branch reviews
- file/folder snapshots
- cases where reviewer should inspect repo context itself

Take the pattern from `pi-malis-workflow/extensions/task-native-runner.ts`:

- clean resource loader
- no inherited extensions
- read-only tools only
- selected reviewer model
- isolated context window

## Parallel execution

Configured eligible reviewers should run in parallel, bounded by `maxParallelReviewers`.

Rules:

- One failed reviewer should not fail the whole review if others succeed.
- Report every reviewer status: ok / failed / cancelled.
- No fallback reviewers unless explicitly configured later.
- AbortSignal must propagate to direct calls and subagent sessions where possible.

## Smart target inference

When user gives a vague request like `audit with codex`, infer the target in this order:

1. Latest assistant asked a decision question → `question-consensus`.
2. Latest assistant produced a plan/spec/design → `current-plan`.
3. User mentions files/paths → `files`.
4. Git working tree has staged/unstaged/untracked changes → `working-tree`.
5. Current branch differs from default branch → `branch-diff`.
6. Otherwise → `last-turn` / `conversation-focus`.

Target types:

```ts
type WingmanTarget =
  | { type: "question-consensus"; question: string }
  | { type: "current-plan"; text: string }
  | { type: "working-tree" }
  | { type: "branch-diff"; base: string }
  | { type: "commit"; sha: string }
  | { type: "files"; paths: string[] }
  | { type: "last-turn"; text: string }
  | { type: "freeform"; focus: string };
```

Borrow target-resolution ideas from `pi-review` and `codex-plugin-cc`:

- inspect `git status --short --untracked-files=all`
- inspect staged/unstaged shortstat
- detect default branch
- review branch diff against default branch when clean on feature branch
- inline small diffs only; for large diffs, let subagent inspect with read-only tools

## Review modes

Single `/wingman` command should infer mode from request text:

- `audit`: default second opinion.
- `adversarial`: user says challenge, adversarial, pressure-test, prove wrong.
- `consensus`: user says consensus, decide, choose between options, answer question.
- `rescue`: user says rescue/stuck/debug; read-only diagnosis initially.

No separate public commands are needed.

## Consensus loop

Consensus mode should be first-class and use `maxRounds`.

Flow:

1. Run all selected reviewers in parallel.
2. Normalize reviewer outputs into structured summaries.
3. Identify agreements, disagreements, blockers, and assumptions.
4. If consensus is not reached and rounds remain, run targeted follow-up prompts.
5. Stop when:
   - consensus reached
   - no material movement
   - max rounds hit
   - user cancels

The final result should include:

- reviewer status block
- consensus / no-consensus verdict
- accepted points
- dismissed or weak points
- concrete next action
- unresolved questions, if any

## Main-agent handoff

Wingman output is advisory. The main agent must synthesize, not dump raw reviewer text.

Tool/command result should instruct:

```text
Main agent: integrate Wingman result. State what you accept, what you reject, and what concrete changes or next actions follow. Do not dump raw reviewer output.
```

## Natural-language routing

Register an `input` handler for common triggers:

```text
ask wingman
audit with codex
audit with gemini
ask codex find consensus
second opinion on this
sanity check with deepseek
```

Transform into a normal `/wingman ...` request or inject a main-agent instruction to call the `wingman` tool.

Avoid false positives:

- ignore negated phrases like `do not ask wingman`
- ignore incidental mentions inside explanations unless phrased as a request

## Tool API

Expose one tool to the model:

```ts
wingman({
  request: string,
  reviewerHint?: string,
  target?: "auto" | "working-tree" | "branch" | "plan" | "last-turn" | "files",
  reviewers?: string[],
  maxRounds?: number
})
```

The command `/wingman` can call the same internal runtime directly.

## Suggested file layout

```text
package.json
extensions/
  index.ts
src/
  config.ts
  models.ts
  reviewer-selection.ts
  commands.ts
  input.ts
  tool.ts
  ui/
    setup-picker.ts
    run-preflight.ts
    running-progress.ts
    render.ts
  target/
    infer-target.ts
    git-context.ts
    session-context.ts
    context-pack.ts
  runtime/
    direct-runner.ts
    subagent-runner.ts
    parallel.ts
  review/
    prompts.ts
    consensus.ts
    summarize.ts
  types.ts
tests/
  config.test.ts
  reviewer-selection.test.ts
  infer-target.test.ts
  consensus.test.ts
  input.test.ts
```

## Implementation status

Completed for the standalone extension:

- Package manifest and extension entrypoint.
- Project-local `.wingman/config.json` read/write only; no global Wingman config.
- Reviewer config validation with required unique slug-style aliases.
- Runtime reviewer/model validation against Pi's available model registry.
- Runtime same-provider / same-model exclusion, with exact same model always excluded.
- Native Pi TUI `/wingman:setup` model picker with alias editing, policy toggle, default reviewer mode toggle, and rounds controls.
- Smart context inference from recent session, plans/questions, explicit files/branches/commits, working tree, and branch diffs.
- Context pack building with bounded direct context and large-context routing to subagent backend.
- Direct reviewer runner via `complete()`.
- Clean read-only Pi subagent runner for large/ambiguous repo audits.
- Bounded parallel execution with progress, cancellation, partial results, and no fallback reviewers.
- Consensus loop with multiple rounds up to `maxRounds` and stop conditions.
- Natural-language trigger parsing using configured reviewer hints.
- Tool API and custom tool rendering.
- Automatic main-agent handoff for synthesis, with explicit stop-and-wait-for-user-confirmation instruction.
- Node test suite for core logic.

## Test status

Implemented `node:test` coverage for:

- Config defaults and validation.
- Duplicate, missing, and invalid aliases.
- Reviewer selection and exclusion.
- Exact same model exclusion invariant.
- Same-provider vs same-model policy.
- Hint matching and ambiguity.
- Natural trigger parsing using configured reviewer hints only.
- Target inference order and mode parsing.
- Consensus stop conditions and summaries.
- Parallel ok/failed/cancelled behavior, cancellation, and consensus rounds with an injected fake runner.

Validation commands pass:

- `tsc --noEmit` with temporary Pi package symlinks.
- `npm test`.

## Decisions from grill-me review

1. Wingman results must be passed back to the main agent automatically for synthesis. This is core behavior.
2. After synthesis, the main agent must stop and wait for user confirmation before modifying files, updating plans, or continuing implementation.
3. The stop-after-synthesis behavior applies always, including code/diff audit cases and requests that mention fixing. The agent may propose fixes, but must wait.
4. If `.wingman/config.json` is missing, `/wingman` should open `/wingman:setup` automatically in interactive mode. In non-interactive/tool mode, fail and tell the user to run `/wingman:setup`.
5. Reviewer `name` aliases are required and must be unique in project config. Setup should auto-generate collision-resistant names (for example `opus-4-6`, `opus-4-7`, not two plain `opus`). If a user hint matches multiple configured reviewers, Wingman must stop and ask; it must never guess.
6. Setup must allow saving reviewers from the same provider as the current model. Valid use case: main programmer is `opus-4.6`, reviewer is `opus-4.7`. Runtime exclusion policy decides eligibility per run; setup should not block these reviewers.
7. Runtime default remains `same-provider` because the primary value is independent cross-provider review. Exact same model must always be excluded regardless of policy. Users can switch to `same-model` when they intentionally want same-provider different-model review.
8. `/wingman:setup` must make exclusion policy prominent and easy to toggle: `same-provider = strongest independence`; `same-model = allow same-provider different model`.
9. Reviewer execution uses a hybrid backend. Direct model calls are preferred for plan/question/last-turn/small context because they keep reviewers focused. Clean read-only Pi subagents are used for large diffs, branch/file audits, and ambiguous repo audits where reviewers should inspect code themselves.
10. Default reviewer mode is `all-eligible`: `/wingman` runs all eligible configured reviewers without asking unless target/reviewer choice is ambiguous. Explicit hints narrow to matching configured reviewers.
11. `/wingman:setup` should allow editing reviewer aliases directly. Press `e` on a selected model to edit its alias, because aliases are part of the daily UX (`audit with opus`, `ask ds`).
12. Reviewer aliases must be slug-style only: `[a-z0-9._-]+`. Display labels can be pretty, but aliases should be command-friendly and unambiguous.
13. Do not add project-specific reviewer instruction files such as `.wingman/INSTRUCTIONS.md`. Keep reviewer behavior global/built-in for now; project-local state should stay focused on config.
14. `.wingman/config.json` is project-shared and commit-friendly. It contains no secrets, only reviewer aliases and provider/model IDs. Local auth remains in Pi auth/settings outside the project.

## Current implementation checkpoint

Completed in this pass:

- Auto-setup on missing `.wingman/config.json` for interactive `/wingman`; non-interactive/tool mode now fails closed with setup guidance.
- Main-agent handoff now explicitly requires synthesis and then stopping for user confirmation before modifications, plan updates, fixes, or continued implementation.
- Config validation now requires slug-style reviewer aliases and rejects duplicate aliases; ambiguous inferred reviewer hints now fail closed instead of guessing.
- Reviewer selection now makes exact same provider/model exclusion invariant regardless of exclusion policy.
- `/wingman:setup` now supports `e` to edit reviewer aliases, displays exclusion policy prominently, and blocks saving duplicate aliases.
- Alias generation is more collision-resistant for duplicate model families such as `opus-4-6` / `opus-4-7`.
- Typecheck passes with temporary Pi package symlinks.
- Added `node:test` suite for config, reviewer selection, input routing, target inference, consensus, and parallel execution behavior.
- Added `npm test` script that creates temporary Pi package symlinks, runs tests, and cleans up `node_modules`.

## Open questions

- Should branch/PR review support GitHub PR checkout? Later, not first pass.
