---
name: dex
description: Manage tasks via dex CLI. Use when breaking down complex work, tracking implementation items, or persisting context across sessions.
---

# Agent Coordination with dex

## Command Invocation

Use `dex` directly for all commands:

```bash
dex <command>
```

If `dex` is not on PATH, use `npx @zeeg/dex <command>` instead. Check once at the start:
```bash
command -v dex &>/dev/null && echo "use: dex" || echo "use: npx @zeeg/dex"
```

Use dex to act as a **master coordinator** for complex work:
- Break down large tasks into structured deliverables
- Track tickets with full context (like GitHub Issues)
- Record implementation results (like PR descriptions)
- Enable seamless handoffs between sessions and agents

## Core Principle: Tickets, Not Todos

Dex tasks are **tickets** - structured artifacts with comprehensive context:
- **Description**: One-line summary (issue title)
- **Context**: Full background, requirements, approach (issue body)
- **Result**: Implementation details, decisions, outcomes (PR description)

This rich context enables:
- You (the agent) to resume work without losing context
- Other agents to pick up related work
- Coordinated decomposition of complex tasks
- Reconciliation of decisions and data across sessions

Think: "Would someone understand the what, why, and how from this task alone?"

## Important: Dex Tasks are Ephemeral

**Never reference Dex task IDs in external artifacts:**
- Commit messages
- Pull request descriptions
- GitHub issues
- Documentation

Dex tasks are temporary coordination tools, not permanent records. Task IDs like `abc123` will become meaningless once tasks are completed and cleaned up, and referencing them pollutes version history with dead links.

When creating commits or PRs, describe the work itself - not the dex task that tracked it.

## When to Use dex as Coordinator

Use dex when you need to:
- **Break down complexity**: Large feature → subtasks with clear boundaries
- **Track multi-step work**: Implementation spanning 3+ distinct steps
- **Persist context**: Work continuing across sessions
- **Coordinate with other agents**: Shared understanding of goals/progress
- **Record decisions**: Capture rationale for future reference

Example workflow:
1. User: "Add user authentication system"
2. You create parent task with full requirements
3. You break into subtasks: DB schema, API endpoints, frontend, tests
4. You work through each, completing with detailed results
5. Context preserved for future enhancements or debugging

Skip task creation when:
- Work is a single atomic action
- Everything fits in one session with no follow-up
- Overhead of tracking exceeds value

## Important: dex vs Claude Code's TaskCreate

Claude Code has built-in task tools (`TaskCreate`, `TaskUpdate`, `TaskList`). **Do not confuse these with dex.**

| | dex | Claude Code TaskCreate |
|---|---|---|
| **Persistence** | Persists in `.dex/` files | Session-only, lost when session ends |
| **Context** | Rich (description + context + result) | Basic (subject + description) |
| **Hierarchy** | 3-level (epic -> task -> subtask) | Flat dependencies only |
| **Collaboration** | Git-trackable, shareable | Not shareable |

**Rule of thumb:**
- Use **dex** for work that needs to persist, be handed off, or tracked across sessions
- Use **Claude Code's TaskCreate** only for ephemeral in-session tracking (like a scratchpad)

When the user asks you to "break down work" or "create subtasks" for anything meaningful, use dex.

## CLI Usage

### Create a Task

```bash
dex create -d "Short description" --context "Full implementation context"
```

Options:
- `-d, --description` (required): One-line summary
- `--context` (required): Full implementation details
- `-p, --priority <n>`: Lower = higher priority (default: 1)
- `-b, --blocked-by <ids>`: Comma-separated task IDs that must complete first
- `--parent <id>`: Parent task ID (creates subtask)

Context should include:
- What needs to be done and why
- Specific requirements and constraints
- Implementation approach (steps, files to modify, technical choices)
- How to know it's done (acceptance criteria)
- Related context (files, dependencies, parent task)

### Writing Comprehensive Context

Include all essential information naturally - don't force rigid headers. Look at how the real example does it.

**Good Example**:
```bash
dex create -d "Migrate storage to one file per task" \
  --context "Change storage format for git-friendliness:

Structure:
.dex/
└── tasks/
    ├── abc123.json
    └── def456.json

NO INDEX - just scan task files. For typical task counts (<100), this is fast.

Implementation:
1. Update storage.ts:
   - read(): Scan .dex/tasks/*.json, parse each, return TaskStore
   - write(task): Write single task to .dex/tasks/{id}.json
   - delete(id): Remove .dex/tasks/{id}.json
   - Add readTask(id) for single task lookup

2. Task file format: Same as current Task schema (one task per file)

3. Migration: On read, if old tasks.json exists, migrate to new format

4. Update tests

Benefits:
- Create = new file (never conflicts)
- Update = single file change
- Delete = remove file
- No index to maintain or conflict
- git diff shows exactly which tasks changed"
```

Notice: It states the goal, shows the structure, lists specific implementation steps, and explains the benefits. Someone could pick this up without asking questions.

**Bad Example** (insufficient):
```bash
dex create -d "Add auth" --context "Need to add authentication"
```
❌ Missing: How to implement it, what files, what's done when, technical approach

### List Tasks

```bash
dex list                      # Show pending tasks (default)
dex list --all                # Include completed
dex list --completed          # Only completed
dex list --ready              # Only tasks ready to work on (no blockers)
dex list --blocked            # Only blocked tasks
dex list --query "login"      # Search in description/context
```

Blocked tasks show an indicator: `[B: xyz123]` (blocked by task xyz123) or `[B: 2]` (blocked by 2 tasks).

### View Task Details

```bash
dex show <id>
```

### Complete a Task

```bash
dex complete <id> --result "What was accomplished"
```

### Linking Commits to Tasks

When completing a task that involved creating a commit, link it using `--commit`:

```bash
dex complete abc123 --result "Implemented feature X" --commit a1b2c3d
```

This automatically captures:
- Commit SHA
- Commit message (from git)
- Current branch (from git)

The commit info appears in `dex show` output and helps trace implementations back to tasks.

**When to use `--commit`:**
- Task resulted in a git commit
- You want traceability between tasks and code changes
- The commit represents the primary deliverable of the task

**Example:**
```bash
git commit -m "Add JWT middleware for route protection"
# Note the commit SHA from output, e.g., a1b2c3d

dex complete xyz789 --result "Implemented JWT middleware..." --commit a1b2c3d
```

### Writing Comprehensive Results

Include all essential information naturally - explain what you did without requiring code review.

**Good Example**:
```bash
dex complete abc123 --result "Migrated storage from single tasks.json to one file per task:

Structure:
- Each task stored as .dex/tasks/{id}.json
- No index file (avoids merge conflicts)
- Directory scanned on read to build task list

Implementation:
- Modified Storage.read() to scan .dex/tasks/ directory
- Modified Storage.write() to write/delete individual task files
- Auto-migration from old single-file format on first read
- Atomic writes using temp file + rename pattern

Trade-offs:
- Slightly slower reads (must scan directory + parse each file)
- Acceptable since task count is typically small (<100)
- Better git history - each task change is isolated

All 60 tests passing, build successful."
```

Notice: States what changed, lists specific implementation details, explains trade-offs considered, confirms verification. Someone reading this understands what happened without looking at code.

**Bad Example** (insufficient):
```bash
dex complete abc123 --result "Fixed the storage issue"
```
❌ Missing: What was actually implemented, how, what decisions were made, what trade-offs

### Verification is Critical

**Before marking any task complete, you MUST verify your work.** Verification isn't optional - it's what separates "I think it's done" from "it's actually done."

Examples of strong verification:
- ✅ "All 60 tests passing, build successful"
- ✅ "All 69 tests passing. Ready for GitHub Issues and Projects v2 implementations"
- ✅ "Added comprehensive test suite in tests/config.test.ts. All 69 tests passing (9 new config tests)"

Example of weak verification to avoid:
- ❌ "Added 'link' and 'unlink' scripts to package.json"
  - No evidence the scripts actually work
  - No test run, no manual execution

**Verification methods by task type**:
- **Code changes**: Run full test suite, document passing test count
- **New features**: Run tests + manual testing of feature functionality
- **Configuration**: Test the config works (run commands, check workflows)
- **Documentation**: Verify examples work, links resolve, formatting renders
- **Refactoring**: Confirm tests still pass, no behavior changes

Your result MUST include explicit verification evidence. Don't just describe what you did - prove it works.

Result should include:
- What was implemented (the approach, how it works, what changed conceptually)
- Key decisions made and rationale
- Trade-offs or alternatives considered
- Any follow-up work or tech debt created
- **Verification evidence** (test results, build status, manual testing outcomes)

### Verifying Task Completion

Systematic verification is what separates high-quality task completion from guesswork. Before marking any task complete, follow this process:

#### The Verification Process

1. **Re-read the task context**: What did you originally commit to do?
2. **Check acceptance criteria**: Does your implementation satisfy the "Done when" conditions?
3. **Run relevant tests**: Execute the test suite and document results
4. **Test manually**: Actually try the feature/change yourself
5. **Compare with requirements**: Does what you built match what was asked?

#### What to Include in Your Result

**Code implementation example**:
```bash
dex complete xyz789 --commit a1b2c3d --result "Implemented JWT middleware for route protection:

Implementation:
- Created src/middleware/verify-token.ts with verifyToken function
- Uses jsonwebtoken library for signature verification
- Extracts user ID from payload and attaches to request
- Returns 401 for invalid/expired tokens with descriptive error messages

Key decisions:
- Separated 'expired' vs 'invalid' error codes for better client handling
- Made middleware reusable by accepting optional role requirements

Verification:
- All 69 tests passing (4 new tests for middleware edge cases)
- Manually tested with valid token: ✅ Access granted
- Manually tested with expired token: ✅ 401 with 'token_expired' code
- Manually tested with invalid signature: ✅ 401 with 'invalid_token' code
- Integrated into auth routes, confirmed protected endpoints work"
```

**Configuration/infrastructure example**:
```bash
dex complete abc456 --result "Added GitHub Actions workflow for CI:

Implementation:
- Created .github/workflows/ci.yml
- Runs on push to main and all PRs
- Jobs: lint, test, build
- Uses pnpm cache for faster runs

Verification:
- Pushed to test branch and opened PR #123
- Workflow triggered automatically: ✅
- All jobs passed (lint: 0 errors, test: 69/69 passing, build: successful)
- Build artifacts generated correctly
- Total run time: 2m 34s"
```

**Refactoring example**:
```bash
dex complete def123 --result "Refactored storage to one file per task:

Implementation:
- Split tasks.json into .dex/tasks/{id}.json files
- Modified Storage.read() to scan directory
- Modified Storage.write() for individual file operations
- Added auto-migration from old format

Trade-offs:
- Slightly slower reads (directory scan + parse each file)
- Acceptable for typical task counts (<100)
- Major benefit: git-friendly diffs, no merge conflicts

Verification:
- All 60 tests passing (including 8 storage tests)
- Build successful
- Manually tested migration: old tasks.json → individual files ✅
- Manually tested create/update/delete operations ✅
- Confirmed git diff shows only changed tasks"
```

#### Red Flags - Insufficient Verification

These are **NOT acceptable** completion results:

- ❌ "Fixed the bug" - What bug? How? Did you verify the fix?
- ❌ "Should work now" - "Should" means you didn't verify
- ❌ "Made the changes" - What changes? Did they work?
- ❌ "Updated the config" - Did you test the config?
- ❌ "Added tests" - Did the tests pass? What's the count?

If your result looks like these, **stop and verify your work properly**.

#### Cross-Reference Checklist

Before marking complete, verify all of these:

- [ ] Task description requirements met
- [ ] Context "Done when" criteria satisfied
- [ ] Tests passing (document count: "All X tests passing")
- [ ] Build succeeds (if applicable)
- [ ] Manual testing done (describe what you tested)
- [ ] No regressions introduced (existing features still work)
- [ ] Edge cases considered (error handling, invalid input)
- [ ] Follow-up work identified (created new tasks if needed)

**If you can't check all applicable boxes, the task isn't done yet.**

### Edit a Task

```bash
dex edit <id> -d "Updated description" --context "Updated context"
dex edit <id> --add-blocker xyz123      # Add blocking dependency
dex edit <id> --remove-blocker xyz123   # Remove blocking dependency
```

### Delete a Task

```bash
dex delete <id>
```

Note: Deleting a parent task also deletes all its subtasks.

## Blocking Dependencies

Use blocking dependencies to enforce task ordering when tasks must be completed in sequence:

```bash
# Create a task that depends on another
dex create -d "Deploy to production" --context "..." --blocked-by abc123

# Add a blocker to an existing task
dex edit xyz789 --add-blocker abc123

# Remove a blocker
dex edit xyz789 --remove-blocker abc123
```

### When to Use Blockers

Use blockers when:
- Task B cannot start until Task A completes (sequential work)
- Multiple tasks depend on a shared prerequisite
- You want to prevent out-of-order completion

Don't use blockers when:
- Tasks can be worked on in parallel
- The dependency is just a logical grouping (use subtasks instead)
- You'd be creating circular dependencies

### Viewing Blocking Relationships

- `dex list` shows blocked indicator: `[B: xyz123]` or `[B: 2]`
- `dex list --blocked` shows only blocked tasks
- `dex list --ready` shows only tasks with no blockers
- `dex show <id>` displays "Blocked by:" and "Blocks:" sections

### Completion with Blockers

Blocked tasks can still be completed (soft enforcement), but you'll see a warning:
```
Warning: This task is blocked by 1 incomplete task(s):
  • abc123: Setup database schema
```

This allows flexibility while clearly communicating the intended order.

## Subtasks

Break complex work into subtasks when:
- Work naturally decomposes into 3+ discrete steps
- You want to track progress through a larger effort
- Subtasks could be worked on independently

Don't use subtasks when:
- Task is simple/atomic (one step)
- You'd only have 1-2 subtasks (just make separate tasks)

### Creating Subtasks

```bash
dex create -d "Implement login form" --context "..." --parent <parent-id>
```

### Viewing Subtasks

- `dex list` displays tasks as a tree (use `--flat` for plain list)
- `dex show <id>` includes subtask count

### Completion Rules

- A task cannot be completed while it has pending subtasks
- Complete all children before completing the parent

## Epics and Multi-Level Hierarchies

For large initiatives spanning multiple tasks, use a 3-level hierarchy:

| Level | Name | Purpose |
|-------|------|---------|
| L0 | **Epic** | Large initiative, root-level (e.g., "Add user authentication system") |
| L1 | **Task** | Significant work item under an epic (e.g., "Implement JWT middleware") |
| L2 | **Subtask** | Atomic implementation step (e.g., "Add token verification function") |

**Maximum depth is 3 levels.** Attempting to create a child of a subtask will fail.

### When to Use Epics

Use an epic when:
- Work spans 5+ distinct tasks
- Multiple areas of the codebase are affected
- Work will span multiple sessions or involve coordination
- You want high-level progress tracking

Don't create an epic when:
- Work is 2-3 tasks (just create them as siblings)
- Tasks are unrelated (create separate root tasks)
- You'd only have 1 task under the epic

### Creating an Epic Structure

```bash
# Create the epic
dex create -d "Add user authentication system" \
  --context "Full auth system with JWT tokens, password reset, session management..."

# Note the epic ID (e.g., abc123), then create tasks under it
dex create --parent abc123 -d "Implement JWT token generation" \
  --context "Create token service with signing and verification..."

dex create --parent abc123 -d "Add password reset flow" \
  --context "Email-based password reset with secure tokens..."

# For complex tasks, add subtasks
dex create --parent def456 -d "Add token verification function" \
  --context "Verify JWT signature and expiration..."
```

### Viewing Hierarchies

```bash
dex list                    # Full tree view with all levels
dex list abc123             # Show epic abc123 and its subtree
dex show abc123             # Epic details with task/subtask counts
dex show def456             # Task details with breadcrumb path
```

### Best Practices for Hierarchies

1. **Keep epics focused**: One epic = one major initiative
2. **3-7 tasks per epic**: If you have more, consider splitting the epic
3. **Subtasks are optional**: Only add L2 when a task is genuinely complex
4. **Avoid deep nesting**: If you need L3, restructure your breakdown
5. **Link context**: Reference parent in child task contexts

## Starting Work on a Task

When picking up a task to work on, **always check if the context is sufficient** before beginning implementation.

### Evaluating Task Context Quality

Read the task's context and ask yourself:
- Do I know **what** needs to be done specifically?
- Do I understand **why** this is needed?
- Is the **approach** clear (files to modify, patterns to follow)?
- Do I know when it's **done** (acceptance criteria)?

If the answer to any of these is "no," the task needs more context before you start.

### Insufficient Context → Enter Plan Mode

When a task has thin or vague context, **suggest entering plan mode** to flesh out the details:

```
This task doesn't have enough context to start implementation confidently.
I'd recommend entering plan mode to work through the requirements and approach.
```

**Examples of insufficient context:**
- "Add authentication" — What type? How? To which routes?
- "Fix the bug" — Which bug? What's the expected behavior?
- "Improve performance" — Where? What's the target? How to measure?

**When to proceed anyway:**
- Task is genuinely trivial/atomic (e.g., "Add .gitignore entry for .env")
- You have full context from the conversation that makes the task clear
- The task description itself is complete even if context field is light

### Fleshing Out Context

In plan mode (or before starting), gather:
1. **Specific requirements**: What exactly needs to happen?
2. **Technical approach**: Which files, what patterns, what libraries?
3. **Acceptance criteria**: How do we know it's done?
4. **Edge cases**: What could go wrong? What needs handling?

Then update the task with comprehensive context:
```bash
dex edit <id> --context "Full implementation details..."
```

This investment pays off: clear context → confident implementation → quality results.

## Coordinating Complex Work

### Decomposition Strategy

When faced with large tasks:
1. **Assess scope**: Is this epic-level (5+ tasks) or task-level (3-7 subtasks)?
2. Create parent task/epic with overall goal and context
3. Analyze and identify 3-7 logical children
4. Create children with specific contexts and boundaries
5. Work through systematically, completing with results
6. Complete parent with summary of overall implementation

**Choosing the right level:**
- Small feature (1-2 files, ~1 session) → Single task, no subtasks
- Medium feature (3-5 files, 3-7 steps) → Task with subtasks
- Large initiative (multiple areas, many sessions) → Epic with tasks

### Subtask Best Practices

- **Independently understandable**: Each subtask should be clear on its own
- **Link to parent**: Reference parent task, explain how this piece fits
- **Specific scope**: What this subtask does vs what parent/siblings do
- **Clear completion**: Define "done" for this piece specifically

Example parent task context:
```
Need full authentication system for API.

Implementation:
1. Database schema for users/tokens → subtask
2. Auth controller with /login, /register, /logout endpoints → subtask
3. JWT middleware for route protection → subtask
4. Frontend login/register forms → subtask
5. Integration tests → subtask

[Full requirements, constraints, technical approach...]
```

Example subtask context:
```
Part of auth system (parent: abc123). This subtask: JWT verification middleware.

What it does:
- Verify JWT signature and expiration on protected routes
- Extract user ID from token payload
- Attach user object to request
- Return 401 for invalid/expired tokens

Implementation:
- Create src/middleware/verify-token.ts
- Export verifyToken middleware function
- Use jsonwebtoken library
- Handle expired vs invalid token cases separately

Done when:
- Middleware function complete and working
- Unit tests cover valid/invalid/expired scenarios
- Integrated into auth routes in server.ts
- Parent task can use this to protect endpoints
```

### Recording Results

Complete tasks **immediately after implementing AND verifying**:
- Capture decisions while fresh in context
- Record trade-offs considered during implementation
- Note any deviations from original plan
- **Document verification performed (tests, manual testing, build success)**
- Create follow-up tasks for tech debt or future work

**Critical: Always verify before completing**. Re-read the original task context and confirm your implementation matches all requirements. Your result should include explicit verification evidence.

This practice ensures:
- **Completed tasks are actually done** (not just 'probably done')
- Future you/agents understand the reasoning
- Decisions can be reconciled across sessions
- Implementation history is preserved
- Follow-ups aren't forgotten

## Best Practices

1. **Right-size tasks**: Completable in one focused session
2. **Clear completion criteria**: Context should define "done"
3. **Don't over-decompose**: 3-7 children per parent is usually right
4. **Respect the depth limit**: Max 3 levels (epic → task → subtask)
5. **Action-oriented descriptions**: Start with verbs ("Add", "Fix", "Update")
6. **Document results**: Record what was done and any follow-ups

## Storage

Tasks are stored as individual files:
- `<git-root>/.dex/tasks/{id}.json` (if in a git repo)
- `~/.dex/tasks/{id}.json` (fallback)

One file per task enables:
- Git-friendly diffs and history
- Collaboration without merge conflicts
- Easy task sharing and versioning

Override storage directory with `--storage-path` or `DEX_STORAGE_PATH` env var.

### Task File Format

Each task is stored as a JSON file with the following structure:
```json
{
  "id": "abc123",
  "parent_id": null,
  "description": "One-line summary",
  "context": "Full implementation details...",
  "priority": 1,
  "completed": false,
  "result": null,
  "blockedBy": ["xyz789"],
  "blocks": ["def456"],
  "children": [],
  "created_at": "2026-01-01T00:00:00.000Z",
  "updated_at": "2026-01-01T00:00:00.000Z",
  "completed_at": null
}
```

- `blockedBy`: Task IDs that must complete before this task
- `blocks`: Task IDs that this task is blocking (inverse of blockedBy)
- `children`: Child task IDs (inverse of parent_id)
