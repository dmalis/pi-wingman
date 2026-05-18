# pi-wingman

A standalone [Pi](https://pi.dev) extension for asking independent reviewer models to audit your current work.

Wingman lets your active coding model ask configured reviewer models for a second opinion, then passes the result back to the main agent for synthesis. The main agent summarizes what it accepts, what it rejects, and what it recommends next — then stops and waits for your confirmation.

## Features

- `/wingman` smart audit command
- `/wingman:setup` project-local reviewer setup UI
- Native Pi TUI model picker with checkbox selection and alias editing
- Configured reviewers only — no model guessing or hidden fallbacks
- Current model/provider exclusion policy
- Parallel reviewer execution with cancellable progress UI
- Smart target inference for plans, questions, diffs, branches, files, and recent conversation context
- Hybrid execution:
  - direct model calls for focused plan/question audits
  - clean read-only Pi subagents for larger repo/diff audits
- Optional project-local JSONL logging

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
/wingman:setup
```

The setup UI lets you:

- select reviewer models
- edit reviewer aliases with `e`
- toggle exclusion policy with `p`
- choose default reviewer behavior with `d`
- adjust max consensus rounds with `+` / `-`
- toggle optional logging with `l`

Project config is stored in:

```text
.wingman/config.json
```

This file contains only reviewer aliases and provider/model IDs. It does not contain API keys and is safe to commit if your team wants shared reviewer defaults.

## Usage

```text
/wingman
/wingman audit this plan
/wingman codex find consensus
/wingman challenge the auth design
/wingman review working tree changes
```

Natural language triggers also work:

```text
ask wingman
audit with codex
ask gemini find consensus
second opinion on this
sanity check with deepseek
```

Reviewer names come from your project config. For example, `audit with codex` only works if you configured a reviewer alias matching `codex`.

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
  "maxRounds": 3,
  "maxParallelReviewers": 4,
  "logging": {
    "enabled": false,
    "raw": false
  },
  "reviewers": [
    {
      "name": "opus",
      "provider": "anthropic",
      "model": "claude-opus-4-6",
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
