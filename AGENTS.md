# Agent Instructions

## Package Manager

Use **pnpm**: `pnpm install`, `pnpm build`, `pnpm test`

## Commit Attribution

AI commits MUST include:

```
Co-Authored-By: <model name> <noreply@anthropic.com>
```

Example: `Co-Authored-By: Claude Sonnet 4 <noreply@anthropic.com>`

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

JSONL format: `.dex/tasks.jsonl` (one task per line, auto-migrates from old formats)

## Task Management

Use `dex` skill for task coordination. See `plugins/dex/skills/dex/SKILL.md`

## Task Planning

Use `dex-plan` skill for creating tasks from planning docs. See `plugins/dex/skills/dex-plan/SKILL.md`

## Local Development

```bash
pnpm install && pnpm build && pnpm link  # Setup
pnpm build                               # Rebuild after changes
pnpm dev                                 # Watch mode
pnpm unlink                              # Cleanup
```

## Documentation

When adding or modifying CLI commands, update:

- `src/cli/help.ts` — Built-in help text
- `docs/src/pages/cli.astro` — CLI reference documentation

## TypeScript Exports

Use `export type` for type-only exports (interfaces, type aliases). Bun requires explicit type exports:

```ts
// Good
export type { GitHubRepo } from "./remote.js";
export { getGitHubRepo } from "./remote.js";

// Bad - fails in Bun
export { GitHubRepo, getGitHubRepo } from "./remote.js";
```

## Testing

When adding new behavior or modifying existing functionality, review `TESTING.md` to determine if tests are needed. Key points:

- Test error cases users will actually hit
- Add regression tests for bugs
- Co-locate tests with source (`foo.ts` → `foo.test.ts`)
