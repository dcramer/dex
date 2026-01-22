---
name: dex
description: Manage tasks via dex CLI. Use when breaking down complex work, tracking implementation items, or persisting context across sessions.
---

# Agent Coordination with dex

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

## CLI Usage

### Create a Task

```bash
dex create -d "Short description" --context "Full implementation context"
```

Options:
- `-d, --description` (required): One-line summary
- `--context` (required): Full implementation details
- `-p, --priority <n>`: Lower = higher priority (default: 1)

Context should include:
- What needs to be done and why
- Specific requirements and constraints
- Implementation approach (steps, files to modify, technical choices)
- How to know it's done (acceptance criteria)
- Related context (files, dependencies, parent task)

### Writing Comprehensive Context

Include all essential information naturally - don't force rigid headers. Look at how the real example does it.

**Good Example** (from actual task c2w75okn.json):
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
dex list --status completed   # Only completed
dex list --query "login"      # Search in description/context
```

### View Task Details

```bash
dex show <id>
```

### Complete a Task

```bash
dex complete <id> --result "What was accomplished"
```

### Writing Comprehensive Results

Include all essential information naturally - explain what you did without requiring code review.

**Good Example** (from actual task c2w75okn.json):
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

Real examples of strong verification from actual dex tasks:
- ✅ **c2w75okn**: "All 60 tests passing, build successful"
- ✅ **0319t60q**: "All 69 tests passing. Ready for GitHub Issues and Projects v2 implementations"
- ✅ **47smxc8f**: "Added comprehensive test suite in tests/config.test.ts. All 69 tests passing (9 new config tests)"
- ✅ **ke17bmvd**: "All 60 tests passing. FileStorage is ready as base implementation"

Real example of weak verification to avoid:
- ❌ **ok1oseqh**: "Added 'link' and 'unlink' scripts to package.json after test:watch"
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
dex complete xyz789 --result "Implemented JWT middleware for route protection:

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
```

### Delete a Task

```bash
dex delete <id>
```

Note: Deleting a parent task also deletes all its subtasks.

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

## Coordinating Complex Work

### Decomposition Strategy

When faced with large tasks:
1. Create parent task with overall goal and context
2. Analyze and identify 3-7 logical subtasks
3. Create subtasks with specific contexts and boundaries
4. Work through systematically, completing with results
5. Complete parent with summary of overall implementation

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
3. **Don't over-decompose**: 3-7 subtasks per parent is usually right
4. **Action-oriented descriptions**: Start with verbs ("Add", "Fix", "Update")
5. **Document results**: Record what was done and any follow-ups

## Storage

Tasks are stored as individual files:
- `<git-root>/.dex/tasks/{id}.json` (if in a git repo)
- `~/.dex/tasks/{id}.json` (fallback)

One file per task enables:
- Git-friendly diffs and history
- Collaboration without merge conflicts
- Easy task sharing and versioning

Override storage directory with `--storage-path` or `DEX_STORAGE_PATH` env var.

### Example Task File

See `.dex/tasks/c2w75okn.json` for a well-structured task with comprehensive context and result.
