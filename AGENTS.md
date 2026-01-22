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
Use `dex` skill to coordinate complex work. Create tickets with full context (like GitHub Issues), break down into subtasks, complete with detailed results (like PR descriptions). See `skills/dex/SKILL.md`.

## Local Development
When working on dex itself, build and run from source instead of using the system-wide `dex` installation:
```bash
pnpm build                    # Compile TypeScript
pnpm start create -d "..."    # Run CLI commands
# or use dev mode:
pnpm dev                      # Watch mode in one terminal
node dist/index.js <command>  # Run in another terminal
```

## Testing the /dex Skill Locally

The `/dex` skill is auto-discovered from `skills/dex/SKILL.md` when working in this repo. To test the skill with your local build:

### Setup
```bash
pnpm build
pnpm link --global  # Makes local build available as 'dex' command
```

Now the `/dex` skill in Claude Code will use your local build.

### Development Cycle
```bash
# Make code changes...
pnpm build          # Rebuild
# Test skill via Claude Code
```

Or use watch mode:
```bash
pnpm dev            # Auto-rebuild on changes
# Test skill after rebuild completes
```

### Cleanup
```bash
pnpm unlink --global  # Remove global link
```
