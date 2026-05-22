# pi-wingman

A standalone [Pi](https://pi.dev) extension for asking independent reviewer models for a second opinion.

Wingman lets your active coding model ask configured reviewer models for a second opinion, then passes the result back to the main agent for synthesis. The main agent summarizes what it accepts, what it rejects, and what it recommends next — then stops and waits for your confirmation.

## Features

- `/wingman` smart second-opinion command
- `/wingman setup` project-local guided setup wizard
- Native Pi TUI model picker with checkbox selection
- Configured reviewers only — no model guessing or hidden fallbacks
- Current model/provider exclusion policy
- Parallel reviewer execution with cancellable progress UI
- Smart target inference for current answers, plans, diffs, branches, files, and recent conversation context
- Hybrid execution:
  - direct model calls for focused conversation/plan reviews
  - clean read-only Pi subagents for larger repo/diff reviews

## Install

Install from GitHub:

```bash
pi install git:github.com/dmalis/pi-wingman
```

Or install from a local checkout while developing:

```bash
pi install /absolute/path/to/pi-wingman
```

Reload or restart Pi after installing:

```text
/reload
```

## Setup

Run once per project:

```text
/wingman setup
```

If you run `/wingman` before configuring reviewers, Wingman opens setup automatically.

The setup wizard lets you:

- select reviewer models with a multi-check picker
- optionally edit reviewer aliases
- choose the exclusion policy
- choose default reviewer behavior

Project config is stored in:

```text
.wingman/config.json
```

This file contains only reviewer aliases and provider/model IDs. It does not contain API keys and is safe to commit if your team wants shared reviewer defaults.

## Usage

```text
/wingman
/wingman setup
/wingman audit this plan
/wingman codex check this plan
/wingman review working tree changes
```

Natural language triggers also work:

```text
ask wingman to review this
audit with codex: is this plan safe?
ask gemini to check this
ask all wingmen
run all reviewers
second opinion on this
sanity check with deepseek
```

Reviewer hints are resolved only against configured reviewers. Exact configured aliases win first; provider/model text and aliases like `codex`, `gemini`, and `claude` only work when they match your config. For example, `ask gemini to check this` requires a configured reviewer named `gemini` or a configured provider/model containing `gemini`; Wingman will not invent a Gemini reviewer automatically.

Minimal config snippet for that alias:

```json
{
  "name": "gemini",
  "provider": "google",
  "model": "gemini-3-flash-preview",
  "thinking": "high"
}
```

Ambiguous or unknown hints fail closed instead of silently falling back to arbitrary models. Help/setup/config phrases and negated requests such as `do not use wingman` are ignored.

## Behavior

Wingman is advisory and read-only.

After reviewers respond, the main agent receives the Wingman result and must synthesize it for you. It should explain:

- what reviewer points it accepts
- what it rejects or considers weak
- what concrete changes it recommends
- what decision it needs from you

The main agent should then stop and wait for confirmation before changing files, updating plans, fixing code, or continuing implementation.

## Config example

```json
{
  "version": 1,
  "exclude": "same-provider",
  "defaultReviewers": "all-eligible",
  "maxParallelReviewers": 4,
  "reviewers": [
    {
      "name": "opus",
      "provider": "anthropic",
      "model": "claude-opus-4-1",
      "thinking": "high"
    },
    {
      "name": "deepseek",
      "provider": "openrouter",
      "model": "deepseek/deepseek-v4-pro",
      "thinking": "high"
    }
  ]
}
```

### Exclusion policy

- `same-provider`: exclude all reviewers from the active provider. Best for independent cross-provider review.
- `same-model`: exclude only the exact active provider/model. Allows same-provider different-model review.

The exact active model is always excluded.

## Development

```bash
npm test
```

The test script creates temporary symlinks to the globally installed Pi packages, runs the Node test suite, and removes the symlinks afterward.
