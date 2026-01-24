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

Install the Claude Code plugin, then use natural language or slash commands:

```
> Use Dex. Work on the next logical task. When done, run code-simplifier
  and commit. Keep working until you're done with the next major task.
```

```
> Track the work from our plan with /dex-plan and then begin implementation.
```

```
> /dex create a task to refactor the authentication module
```

## Skills

Dex provides two skills for Claude Code:

### `/dex` — Task Management

Use `/dex` to manage tasks via natural language:

```
/dex create a task to add JWT authentication
/dex list all pending tasks
/dex show abc123
/dex complete abc123 with result "Implemented JWT middleware..."
```

The `/dex` skill enables agents to:
- **Break down complexity**: Large features into subtasks with clear boundaries
- **Track multi-step work**: Implementation spanning multiple distinct steps
- **Persist context**: Work continuing across sessions without losing context
- **Coordinate with other agents**: Shared understanding of goals and progress
- **Record decisions**: Capture rationale for future reference

**Example workflow:**
1. User: "Add user authentication system"
2. Agent creates parent task with full requirements
3. Agent breaks into subtasks: DB schema, API endpoints, frontend, tests
4. Agent works through each, completing with detailed results
5. Context preserved for future enhancements or debugging

### `/dex-plan` — Convert Plans to Tasks

Use `/dex-plan` to convert markdown planning documents into trackable tasks:

```
/dex-plan ~/.claude/plans/moonlit-brewing-lynx.md
/dex-plan @SPEC.md
/dex-plan docs/AUTHENTICATION_DESIGN.md
```

**Supported documents:**
- Plan files from Claude Code's plan mode
- Specification documents (`SPEC.md`, `REQUIREMENTS.md`)
- Design documents (`DESIGN.md`, `ARCHITECTURE.md`)
- Roadmaps and feature proposals

**What it does:**
1. Reads the markdown file
2. Extracts title from first `#` heading
3. Creates dex task with full markdown content as context
4. Analyzes structure for potential subtask breakdown
5. Automatically creates subtasks when appropriate (3-7 distinct steps)

**Example with automatic breakdown:**

Input (`auth-plan.md`):
```markdown
# Plan: Add Authentication System

## Implementation
1. Create database schema for users/tokens
2. Implement auth controller with endpoints
3. Add JWT middleware for route protection
4. Build frontend login/register forms
5. Add integration tests
```

Output:
```
Created task abc123 from plan

Analyzed plan structure: Found 5 distinct implementation steps
Created 5 subtasks:
- abc124: Create database schema for users/tokens
- abc125: Implement auth controller with endpoints
- abc126: Add JWT middleware for route protection
- abc127: Build frontend login/register forms
- abc128: Add integration tests

View full structure: dex show abc123
```

## Installation

### Claude Code (Marketplace)

```bash
claude plugin marketplace add dcramer/dex
claude plugin install dex@dex
```

Restart Claude Code after installation.

### Claude Code (Local Clone)

```bash
git clone git@github.com:dcramer/dex.git ~/dex
claude plugin marketplace add ~/dex
claude plugin install dex
```

### Updating

```bash
claude plugin marketplace update
claude plugin update dex@dex
```

### CLI Only

```bash
git clone git@github.com:dcramer/dex.git
cd dex
pnpm install && pnpm build
pnpm link --global  # Makes 'dex' command available globally
```

## Task Hierarchy

Dex supports a 3-level hierarchy for organizing work:

| Level | Name | Purpose |
|-------|------|---------|
| L0 | **Epic** | Large initiative (e.g., "Add user authentication system") |
| L1 | **Task** | Significant work item (e.g., "Implement JWT middleware") |
| L2 | **Subtask** | Atomic step (e.g., "Add token verification function") |

**When to use each level:**
- **Single task**: Small feature, 1-2 files, one session
- **Task with subtasks**: Medium feature, 3-5 files, 3-7 steps
- **Epic with tasks**: Large initiative, multiple areas, many sessions

## Blocking Dependencies

Use blockers to enforce task ordering:

```bash
dex create -d "Deploy to production" --context "..." --blocked-by abc123
dex edit xyz789 --add-blocker abc123
```

View blocked tasks:
```bash
dex list --blocked    # Only blocked tasks
dex list --ready      # Only unblocked tasks
```

## CLI Reference

### Creating Tasks

```bash
dex create -d "Short description" --context "Full implementation context"
```

Options:
- `-d, --description` (required): One-line summary
- `--context` (required): Full implementation details
- `-p, --priority <n>`: Lower = higher priority (default: 1)
- `-b, --blocked-by <ids>`: Comma-separated task IDs that block this task
- `--parent <id>`: Parent task ID (creates subtask)

**Good context includes:**
- What needs to be done and why
- Specific requirements and constraints
- Implementation approach
- Acceptance criteria

### Listing Tasks

```bash
dex list                      # Pending tasks (tree view)
dex list --all                # Include completed
dex list --completed          # Only completed
dex list --ready              # Only unblocked tasks
dex list --blocked            # Only blocked tasks
dex list --query "login"      # Search in description/context
dex list --flat               # Plain list instead of tree
```

### Viewing Tasks

```bash
dex show <id>
```

### Completing Tasks

```bash
dex complete <id> --result "What was accomplished"
dex complete <id> --result "..." --commit a1b2c3d  # Link to git commit
```

**Good results include:**
- What was implemented
- Key decisions and rationale
- Trade-offs considered
- Verification evidence (tests passing, manual testing)

### Editing Tasks

```bash
dex edit <id> -d "Updated description"
dex edit <id> --context "Updated context"
dex edit <id> --add-blocker xyz123
dex edit <id> --remove-blocker xyz123
```

### Deleting Tasks

```bash
dex delete <id>  # Also deletes subtasks
```

### Converting Plans

```bash
dex plan <markdown-file>           # Create task from markdown
dex plan <file> --priority 2       # Set priority
dex plan <file> --parent abc123    # Create as subtask
```

### Help

```bash
dex help
dex help <command>
```

## Storage

### File Storage (Default)

Tasks stored as individual files in `.dex/tasks/{id}.json`:
- In git repo: `<git-root>/.dex/tasks/`
- Fallback: `~/.dex/tasks/`

Override with `DEX_STORAGE_PATH` env var or `--storage-path` flag.

### GitHub Issues Storage

Store tasks as GitHub Issues:

1. Create a GitHub token with `repo` scope
2. Set token: `export GITHUB_TOKEN=ghp_...`
3. Run `dex init` to create config
4. Edit `~/.config/dex/dex.toml`:

```toml
[storage]
engine = "github-issues"

[storage.github-issues]
owner = "your-username"
repo = "dex-tasks"
token_env = "GITHUB_TOKEN"
label_prefix = "dex"
```

## Shell Completions

Enable tab completion for dex commands and task IDs:

**Bash** (`~/.bashrc`):
```bash
eval "$(dex completion bash)"
```

**Zsh** (`~/.zshrc`, after compinit):
```bash
eval "$(dex completion zsh)"
```

**Fish** (`~/.config/fish/config.fish`):
```fish
dex completion fish | source
```

## MCP Server

Run dex as an MCP server:

```bash
dex mcp
```

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
