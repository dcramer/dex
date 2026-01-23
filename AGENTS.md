# Agent Instructions

## Package Manager
Use **pnpm**: `pnpm install`, `pnpm build`, `pnpm test`

## Commit Attribution
AI commits MUST include:
```
Co-Authored-By: Claude <noreply@anthropic.com>
```

## Architecture
```
src/
├── index.ts           # Entry: routes to CLI or MCP
├── types.ts           # Zod schemas
├── core/              # Storage + TaskService
├── tools/             # MCP tool handlers
├── mcp/server.ts      # MCP server
└── cli/commands.ts    # CLI handlers
```

## Storage
One file per task: `.dex/tasks/{id}.json`

## Task Management
Use `dex` skill to coordinate complex work. Create tickets with full context (like GitHub Issues), break down into subtasks, complete with detailed results (like PR descriptions). See `plugins/dex/skills/dex/SKILL.md`.

## Local Development

When working on dex itself, use `pnpm link --global` to make your local build available as the `dex` command:

### Setup
```bash
pnpm install
pnpm run link       # Shortcut for: pnpm build && pnpm link --global
```

Now you can use `dex` commands directly (e.g., `dex create`, `dex list`), and they'll run your local build.

### Development Cycle
```bash
# Make code changes...
pnpm build          # Rebuild
# Test with: dex list, dex create, etc.
```

Or use watch mode:
```bash
pnpm dev            # Auto-rebuild on changes in one terminal
dex list            # Test commands in another terminal
```

### Testing the /dex Skill
The `/dex` skill is auto-discovered from `skills/dex/SKILL.md` when working in this repo. Once you've run `pnpm run link`, the skill will automatically use your local build.

### Cleanup
```bash
pnpm run unlink     # Remove global link when done
```
