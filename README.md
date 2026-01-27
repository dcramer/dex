# dex

Task tracking for AI agents. Persistent memory for complex, multi-session work.

## Why dex?

**Structured tasks, not simple todos.** Each task captures full context:

- **Description**: One-line summary (like an issue title)
- **Context**: Background, requirements, approach (like an issue body)
- **Result**: Implementation summary, decisions, outcomes (like a PR description)

**Built for agent coordination.** Agents break down work, track progress, and record results that persist across sessions.

**Git-friendly storage.** JSONL format (one task per line) enables collaboration, versioning, and conflict-free merges.

## Quick Start

Install the Claude Code plugin:

```bash
claude plugin marketplace add dcramer/dex
claude plugin install dex@dex
```

Use natural language or slash commands:

```
> Use Dex. Work on the next logical task. When done, run code-simplifier and commit.
```

```
/dex create a task to refactor the authentication module
```

**[Read the full documentation →](https://dcramer.github.io/dex/)**

## Contributing

### Development Setup

```bash
git clone git@github.com:dcramer/dex.git
cd dex
pnpm install && pnpm build
pnpm link      # Makes 'dex' command available globally
```

### Development Cycle

```bash
pnpm dev       # Watch mode - auto-rebuild on changes
```

### Testing the Claude Code Plugin

Test the plugin locally without installing from the marketplace:

```bash
claude --plugin-dir plugins/dex
```

This loads the plugin from the local directory. Restart Claude Code to pick up changes.

### Manual Build

```bash
# Make changes...
pnpm build
pnpm test
```

### Releasing

Releases are automated via GitHub Actions when a version tag is pushed.

```bash
# Run tests, build, and bump version (creates git tag)
pnpm release patch   # 0.1.0 → 0.1.1
pnpm release minor   # 0.1.0 → 0.2.0
pnpm release major   # 0.1.0 → 1.0.0

# Push commit and tag to trigger publish
git push --follow-tags
```

The workflow runs tests and publishes to npm with provenance.
