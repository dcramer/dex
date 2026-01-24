# dex

Task tracking for LLM workflows. Gives your agent persistent memory for complex, multi-session work.

## Why dex?

**Tickets, Not Todos.** Dex tasks are structured artifacts with full context:
- **Description**: One-line summary (like an issue title)
- **Context**: Background, requirements, approach (like an issue body)
- **Result**: Implementation summary, decisions, outcomes (like a PR description)

**For Agent Coordination.** Agents can act as master coordinators on complex tasks—breaking down work, tracking progress, and recording comprehensive results that persist across sessions.

**Git-Friendly.** One task per file enables collaboration, versioning, and conflict-free workflows.

## Quick Start

Install the Claude Code plugin:

```bash
claude plugin marketplace add dcramer/dex
claude plugin install dex@dex
```

Then use natural language or slash commands:

```
> Use Dex. Work on the next logical task. When done, run code-simplifier and commit.
```

```
/dex create a task to refactor the authentication module
```

**[Read the full documentation →](https://dex.zeeg.me)**

## Contributing

### Development Setup

```bash
git clone git@github.com:dcramer/dex.git
cd dex
pnpm install
pnpm run link  # Makes 'dex' command available globally
```

### Development Cycle

```bash
pnpm dev       # Watch mode - auto-rebuild on changes
# In another terminal: test with dex commands
```

Or manually:

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

The workflow runs tests, and if they pass, publishes to npm with provenance.
